import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  calculateOverdueDetails,
  db,
  hashPassword,
  initDatabase,
  verifyPassword,
} from './server/db.ts';
import {
  dispatchReminderForLoan,
  getGatewayStatus,
  runAutomatedReminderSweep,
  syncOverdueStatuses,
} from './server/notifications.ts';
import type {
  AdminAnalytics,
  Book,
  Loan,
  Review,
  ReviewReply,
  UserProfile,
  UserRole,
} from './src/types.ts';

initDatabase();

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

interface SessionPayload {
  uid: string;
  role: UserRole;
  exp: number;
}

function signToken(userId: string, role: UserRole): string {
  const payload: SessionPayload = {
    uid: userId,
    role,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.uid || !parsed.role || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface AuthedRequest extends Request {
  user?: UserProfile;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Silakan masuk terlebih dahulu untuk melanjutkan.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const session = verifyToken(token);
  if (!session) {
    res.status(401).json({ error: 'Sesi Anda telah berakhir. Silakan masuk kembali.' });
    return;
  }
  const user = db
    .prepare('SELECT id, name, email, phone, member_code, role, created_at FROM users WHERE id = ?')
    .get(session.uid) as UserProfile | undefined;
  if (!user) {
    res.status(401).json({ error: 'Akun pengguna tidak ditemukan.' });
    return;
  }
  req.user = user;
  next();
}

function requireLibrarian(req: AuthedRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'librarian') {
      res.status(403).json({ error: 'Akses ditolak. Fitur ini khusus petugas perpustakaan.' });
      return;
    }
    next();
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
}

function isValidPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s-]/g, '');
  return /^\+?[0-9]{9,15}$/.test(cleaned);
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s-]/g, '');
  if (cleaned.startsWith('0')) {
    return '+62' + cleaned.slice(1);
  }
  if (!cleaned.startsWith('+')) {
    return '+' + cleaned;
  }
  return cleaned;
}

function getEnrichedBooks(): Book[] {
  const rows = db
    .prepare(
      `
      SELECT b.*,
        COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.book_id = b.id), 0) AS avg_rating,
        COALESCE((SELECT COUNT(*) FROM reviews r WHERE r.book_id = b.id), 0) AS review_count,
        COALESCE((SELECT COUNT(*) FROM loans l WHERE l.book_id = b.id AND l.status != 'returned'), 0) AS active_loan_count
      FROM books b
      ORDER BY b.created_at DESC, b.title ASC
      `
    )
    .all() as Book[];
  return rows;
}

function getEnrichedLoans(whereClause = '', params: unknown[] = []): Loan[] {
  syncOverdueStatuses();
  const rows = db
    .prepare(
      `
      SELECT l.id, l.loan_qr_code, l.book_id, l.user_id, l.borrowed_at, l.due_date, l.returned_at, l.status, l.fine_amount, l.last_reminded_at,
             b.title AS book_title, b.author AS book_author, b.isbn AS book_isbn, b.qr_code AS book_qr_code, b.shelf_location AS book_shelf, b.cover_url AS book_cover_url,
             u.name AS member_name, u.email AS member_email, u.phone AS member_phone, u.member_code AS member_code
      FROM loans l
      JOIN books b ON b.id = l.book_id
      JOIN users u ON u.id = l.user_id
      ${whereClause}
      ORDER BY
        CASE l.status WHEN 'overdue' THEN 0 WHEN 'borrowed' THEN 1 ELSE 2 END,
        l.borrowed_at DESC
      `
    )
    .all(...params) as Omit<Loan, 'overdue_days'>[];

  return rows.map((row) => {
    const calc = calculateOverdueDetails(row.due_date, row.returned_at);
    return {
      ...row,
      overdue_days: row.status === 'returned' ? 0 : calc.overdueDays,
      fine_amount: row.status === 'returned' ? row.fine_amount : calc.fineAmount,
    };
  });
}

function getReviewsForBook(bookId: string): Review[] {
  const reviews = db
    .prepare(
      `
      SELECT r.id, r.book_id, r.user_id, u.name AS user_name, u.role AS user_role,
             r.rating, r.comment, r.helpful_count, r.created_at
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.book_id = ?
      ORDER BY r.created_at DESC
      `
    )
    .all(bookId) as Omit<Review, 'replies'>[];

  const replyStmt = db.prepare(
    `
    SELECT rp.id, rp.review_id, rp.user_id, u.name AS user_name, u.role AS user_role,
           rp.reply_text, rp.created_at
    FROM review_replies rp
    JOIN users u ON u.id = rp.user_id
    WHERE rp.review_id = ?
    ORDER BY rp.created_at ASC
    `
  );

  return reviews.map((rev) => ({
    ...rev,
    replies: replyStmt.all(rev.id) as ReviewReply[],
  }));
}

function computeMonthlyAnalytics(): AdminAnalytics {
  syncOverdueStatuses();

  const bookAgg = db
    .prepare(
      `
      SELECT COUNT(*) AS total_titles,
             COALESCE(SUM(total_copies), 0) AS total_copies,
             COALESCE(SUM(available_copies), 0) AS available_copies
      FROM books
      `
    )
    .get() as { total_titles: number; total_copies: number; available_copies: number };

  const loanAgg = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN status != 'returned' THEN 1 ELSE 0 END) AS active_loans,
        SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_loans,
        COALESCE(SUM(CASE WHEN status != 'returned' THEN fine_amount ELSE 0 END), 0) AS total_fines_outstanding
      FROM loans
      `
    )
    .get() as { active_loans: number | null; overdue_loans: number | null; total_fines_outstanding: number };

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const allLoans = db
    .prepare('SELECT borrowed_at, due_date, returned_at, status FROM loans')
    .all() as { borrowed_at: string; due_date: string; returned_at: string | null; status: string }[];

  let loansThisMonth = 0;
  let returnedTotal = 0;
  let returnedOnTime = 0;

  for (const l of allLoans) {
    if (l.borrowed_at.slice(0, 7) === currentMonthKey) {
      loansThisMonth++;
    }
    if (l.status === 'returned' && l.returned_at) {
      returnedTotal++;
      if (new Date(l.returned_at).getTime() <= new Date(l.due_date).getTime()) {
        returnedOnTime++;
      }
    }
  }

  const onTimeRate = returnedTotal > 0 ? Math.round((returnedOnTime / returnedTotal) * 100) : 100;

  const remindersThisMonth = (
    db
      .prepare('SELECT COUNT(*) AS cnt FROM reminder_logs WHERE substr(created_at, 1, 7) = ?')
      .get(currentMonthKey) as { cnt: number }
  ).cnt;

  const totalMembers = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'member'`).get() as { cnt: number }
  ).cnt;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthlySeries = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    let borrowed = 0;
    let returned = 0;
    let overdue = 0;

    for (const l of allLoans) {
      if (l.borrowed_at.slice(0, 7) === key) {
        borrowed++;
      }
      if (l.returned_at && l.returned_at.slice(0, 7) === key) {
        returned++;
      }
      if (
        (l.status === 'overdue' && l.due_date.slice(0, 7) === key) ||
        (l.returned_at &&
          l.returned_at.slice(0, 7) === key &&
          new Date(l.returned_at).getTime() > new Date(l.due_date).getTime())
      ) {
        overdue++;
      }
    }

    monthlySeries.push({ month: key, label, borrowed, returned, overdue });
  }

  const categoryBreakdown = db
    .prepare(
      `
      SELECT b.category,
             COUNT(DISTINCT b.id) AS book_count,
             COUNT(l.id) AS loan_count
      FROM books b
      LEFT JOIN loans l ON l.book_id = b.id
      GROUP BY b.category
      ORDER BY loan_count DESC, book_count DESC
      `
    )
    .all() as AdminAnalytics['category_breakdown'];

  const popularBooks = db
    .prepare(
      `
      SELECT b.id, b.title, b.author, b.category,
             COUNT(l.id) AS loan_count,
             COALESCE((SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.book_id = b.id), 0) AS avg_rating
      FROM books b
      LEFT JOIN loans l ON l.book_id = b.id
      GROUP BY b.id
      ORDER BY loan_count DESC, avg_rating DESC
      LIMIT 6
      `
    )
    .all() as AdminAnalytics['popular_books'];

  return {
    summary: {
      total_titles: bookAgg.total_titles,
      total_copies: bookAgg.total_copies,
      available_copies: bookAgg.available_copies,
      active_loans: loanAgg.active_loans ?? 0,
      overdue_loans: loanAgg.overdue_loans ?? 0,
      loans_this_month: loansThisMonth,
      on_time_rate: onTimeRate,
      total_fines_outstanding: loanAgg.total_fines_outstanding ?? 0,
      reminders_sent_month: remindersThisMonth,
      total_members: totalMembers,
    },
    monthly_series: monthlySeries,
    category_breakdown: categoryBreakdown,
    popular_books: popularBooks,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcastEvent(event: string, payload: Record<string, unknown> = {}): void {
    const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ event: 'connected', payload: { ok: true }, timestamp: new Date().toISOString() }));
  });

  // --- AUTH ROUTES ---
  app.get('/api/auth/status', (_req, res) => {
    const libCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'librarian'`).get() as { cnt: number }
    ).cnt;
    res.json({
      hasLibrarian: libCount > 0,
      envPasscodeConfigured: Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0),
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  app.post('/api/auth/register', (req, res) => {
    const { name, email, phone, password } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      res.status(400).json({ error: 'Nama lengkap harus diisi (2–100 karakter).' });
      return;
    }
    if (typeof email !== 'string' || !isValidEmail(email.trim().toLowerCase())) {
      res.status(400).json({ error: 'Format alamat email tidak valid.' });
      return;
    }
    if (typeof phone !== 'string' || !isValidPhone(phone.trim())) {
      res.status(400).json({ error: 'Nomor WhatsApp harus berisi 9–15 digit angka yang valid.' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'Email tersebut sudah terdaftar. Silakan masuk.' });
      return;
    }

    const id = `usr-${crypto.randomUUID().slice(0, 8)}`;
    const memberCode = `MEM-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const createdAt = new Date().toISOString();
    const cleanPhone = normalizePhone(phone.trim());
    const passwordHash = hashPassword(password);

    db.prepare(
      `
      INSERT INTO users (id, name, email, phone, member_code, role, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, 'member', ?, ?)
      `
    ).run(id, name.trim(), cleanEmail, cleanPhone, memberCode, passwordHash, createdAt);

    const user: UserProfile = {
      id,
      name: name.trim(),
      email: cleanEmail,
      phone: cleanPhone,
      member_code: memberCode,
      role: 'member',
      created_at: createdAt,
    };
    const token = signToken(id, 'member');
    broadcastEvent('stats:updated');
    res.status(201).json({ token, user });
  });

  app.post('/api/auth/claim-librarian', (req, res) => {
    const { name, email, phone, password, passcode } = req.body ?? {};
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    const libCount = (
      db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'librarian'`).get() as { cnt: number }
    ).cnt;

    if (envPasscode) {
      if (typeof passcode !== 'string' || passcode !== envPasscode) {
        res.status(403).json({ error: 'Kode otorisasi petugas tidak sesuai.' });
        return;
      }
    } else if (libCount > 0) {
      res.status(403).json({
        error: 'Akun petugas pengelola sudah diaktifkan. Silakan masuk menggunakan akun petugas yang terdaftar.',
      });
      return;
    }

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      res.status(400).json({ error: 'Nama petugas harus diisi.' });
      return;
    }
    if (typeof email !== 'string' || !isValidEmail(email.trim().toLowerCase())) {
      res.status(400).json({ error: 'Format email petugas tidak valid.' });
      return;
    }
    if (typeof phone !== 'string' || !isValidPhone(phone.trim())) {
      res.status(400).json({ error: 'Nomor WhatsApp petugas tidak valid.' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'Email tersebut sudah digunakan akun lain.' });
      return;
    }

    const id = `lib-${crypto.randomUUID().slice(0, 8)}`;
    const memberCode = `STF-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
    const createdAt = new Date().toISOString();
    const cleanPhone = normalizePhone(phone.trim());
    const passwordHash = hashPassword(password);

    db.prepare(
      `
      INSERT INTO users (id, name, email, phone, member_code, role, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, 'librarian', ?, ?)
      `
    ).run(id, name.trim(), cleanEmail, cleanPhone, memberCode, passwordHash, createdAt);

    const user: UserProfile = {
      id,
      name: name.trim(),
      email: cleanEmail,
      phone: cleanPhone,
      member_code: memberCode,
      role: 'librarian',
      created_at: createdAt,
    };
    const token = signToken(id, 'librarian');
    res.status(201).json({ token, user });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Email dan kata sandi wajib diisi.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const row = db
      .prepare('SELECT id, name, email, phone, member_code, role, password_hash, created_at FROM users WHERE email = ?')
      .get(cleanEmail) as (UserProfile & { password_hash: string }) | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Email atau kata sandi tidak cocok.' });
      return;
    }

    const user: UserProfile = {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      member_code: row.member_code,
      role: row.role,
      created_at: row.created_at,
    };
    const token = signToken(row.id, row.role);
    res.json({ token, user });
  });

  // --- BOOK CATALOG ROUTES (REAL-TIME) ---
  app.get('/api/books', (_req, res) => {
    res.json({ books: getEnrichedBooks() });
  });

  app.get('/api/books/lookup', (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    if (!code) {
      res.status(400).json({ error: 'Kode QR atau ID buku wajib diisi.' });
      return;
    }
    const book = getEnrichedBooks().find(
      (b) => b.qr_code.toLowerCase() === code.toLowerCase() || b.isbn.toLowerCase() === code.toLowerCase() || b.id === code
    );
    const activeLoan = getEnrichedLoans(
      `WHERE lower(l.loan_qr_code) = lower(?) AND l.status != 'returned'`,
      [code]
    )[0];

    if (!book && !activeLoan) {
      res.status(404).json({ error: `Kode QR "${code}" tidak ditemukan di katalog maupun sirkulasi aktif.` });
      return;
    }
    res.json({ book: book ?? null, loan: activeLoan ?? null });
  });

  app.post('/api/books', requireLibrarian, (req: AuthedRequest, res) => {
    const {
      title,
      author,
      isbn,
      category,
      publisher,
      year,
      shelf_location,
      total_copies,
      synopsis,
      cover_accent,
    } = req.body ?? {};

    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160) {
      res.status(400).json({ error: 'Judul buku harus diisi (2–160 karakter).' });
      return;
    }
    if (typeof author !== 'string' || author.trim().length < 2 || author.trim().length > 120) {
      res.status(400).json({ error: 'Nama penulis harus diisi.' });
      return;
    }
    if (typeof isbn !== 'string' || isbn.trim().length < 5 || isbn.trim().length > 40) {
      res.status(400).json({ error: 'Nomor ISBN tidak valid.' });
      return;
    }
    const parsedYear = Number(year);
    const parsedCopies = Number(total_copies);
    if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2100) {
      res.status(400).json({ error: 'Tahun terbit tidak valid.' });
      return;
    }
    if (!Number.isInteger(parsedCopies) || parsedCopies < 1 || parsedCopies > 500) {
      res.status(400).json({ error: 'Jumlah eksemplar harus antara 1 dan 500.' });
      return;
    }

    const dupIsbn = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn.trim());
    if (dupIsbn) {
      res.status(409).json({ error: 'Buku dengan ISBN tersebut sudah terdaftar.' });
      return;
    }

    const id = `bk-${crypto.randomUUID().slice(0, 8)}`;
    const qrCode = `LIB-BK-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO books (id, isbn, qr_code, title, author, category, publisher, year, shelf_location, total_copies, available_copies, synopsis, cover_url, cover_accent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
      `
    ).run(
      id,
      isbn.trim(),
      qrCode,
      title.trim(),
      author.trim(),
      typeof category === 'string' && category.trim() ? category.trim() : 'Teknologi & Rekayasa',
      typeof publisher === 'string' && publisher.trim() ? publisher.trim() : 'Pustaka Digital',
      parsedYear,
      typeof shelf_location === 'string' && shelf_location.trim() ? shelf_location.trim() : 'Rak Umum-01',
      parsedCopies,
      parsedCopies,
      typeof synopsis === 'string' && synopsis.trim() ? synopsis.trim().slice(0, 1000) : 'Koleksi terbaru perpustakaan digital Lentera Pustaka.',
      typeof cover_accent === 'string' && /^#[0-9A-Fa-f]{6}$/.test(cover_accent) ? cover_accent : '#1E3A5F',
      now,
      now
    );

    const created = getEnrichedBooks().find((b) => b.id === id);
    broadcastEvent('books:updated', { action: 'created', bookId: id });
    res.status(201).json({ book: created });
  });

  app.put('/api/books/:id', requireLibrarian, (req: AuthedRequest, res) => {
    const bookId = req.params.id;
    const existing = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as
      | { id: string; total_copies: number; available_copies: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Buku tidak ditemukan.' });
      return;
    }

    const { title, author, category, publisher, year, shelf_location, total_copies, synopsis } = req.body ?? {};
    const borrowedCount = existing.total_copies - existing.available_copies;
    const nextTotal = total_copies !== undefined ? Number(total_copies) : existing.total_copies;

    if (!Number.isInteger(nextTotal) || nextTotal < borrowedCount || nextTotal > 500) {
      res.status(400).json({
        error: `Jumlah eksemplar minimal ${borrowedCount} (sesuai buku yang sedang dipinjam).`,
      });
      return;
    }

    const nextAvailable = nextTotal - borrowedCount;
    const now = new Date().toISOString();

    db.prepare(
      `
      UPDATE books
      SET title = COALESCE(?, title),
          author = COALESCE(?, author),
          category = COALESCE(?, category),
          publisher = COALESCE(?, publisher),
          year = COALESCE(?, year),
          shelf_location = COALESCE(?, shelf_location),
          total_copies = ?,
          available_copies = ?,
          synopsis = COALESCE(?, synopsis),
          updated_at = ?
      WHERE id = ?
      `
    ).run(
      typeof title === 'string' && title.trim() ? title.trim() : null,
      typeof author === 'string' && author.trim() ? author.trim() : null,
      typeof category === 'string' && category.trim() ? category.trim() : null,
      typeof publisher === 'string' && publisher.trim() ? publisher.trim() : null,
      year !== undefined && Number.isInteger(Number(year)) ? Number(year) : null,
      typeof shelf_location === 'string' && shelf_location.trim() ? shelf_location.trim() : null,
      nextTotal,
      nextAvailable,
      typeof synopsis === 'string' && synopsis.trim() ? synopsis.trim().slice(0, 1000) : null,
      now,
      bookId
    );

    const updated = getEnrichedBooks().find((b) => b.id === bookId);
    broadcastEvent('books:updated', { action: 'updated', bookId });
    res.json({ book: updated });
  });

  app.delete('/api/books/:id', requireLibrarian, (req: AuthedRequest, res) => {
    const bookId = req.params.id;
    const activeLoans = (
      db
        .prepare(`SELECT COUNT(*) AS cnt FROM loans WHERE book_id = ? AND status != 'returned'`)
        .get(bookId) as { cnt: number }
    ).cnt;
    if (activeLoans > 0) {
      res.status(409).json({
        error: 'Buku tidak dapat dihapus karena masih ada eksemplar yang sedang dipinjam anggota.',
      });
      return;
    }
    const info = db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Buku tidak ditemukan.' });
      return;
    }
    broadcastEvent('books:updated', { action: 'deleted', bookId });
    res.json({ deleted: true });
  });

  // --- REVIEWS & READER DISCUSSION ROUTES ---
  app.get('/api/books/:id/reviews', (req, res) => {
    const bookId = req.params.id;
    res.json({ reviews: getReviewsForBook(bookId) });
  });

  app.post('/api/books/:id/reviews', requireAuth, (req: AuthedRequest, res) => {
    const bookId = req.params.id;
    const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
    if (!book) {
      res.status(404).json({ error: 'Buku tidak ditemukan.' });
      return;
    }
    const { rating, comment } = req.body ?? {};
    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      res.status(400).json({ error: 'Rating harus berupa angka 1 sampai 5.' });
      return;
    }
    if (typeof comment !== 'string' || comment.trim().length < 4 || comment.trim().length > 800) {
      res.status(400).json({ error: 'Ulasan minimal 4 karakter dan maksimal 800 karakter.' });
      return;
    }

    const id = `rev-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO reviews (id, book_id, user_id, rating, comment, helpful_count, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      `
    ).run(id, bookId, req.user!.id, numRating, comment.trim(), now);

    broadcastEvent('reviews:updated', { bookId });
    broadcastEvent('books:updated', { action: 'rating_changed', bookId });
    res.status(201).json({ reviews: getReviewsForBook(bookId) });
  });

  app.post('/api/reviews/:reviewId/replies', requireAuth, (req: AuthedRequest, res) => {
    const reviewId = req.params.reviewId;
    const review = db
      .prepare('SELECT id, book_id FROM reviews WHERE id = ?')
      .get(reviewId) as { id: string; book_id: string } | undefined;
    if (!review) {
      res.status(404).json({ error: 'Ulasan tidak ditemukan.' });
      return;
    }
    const { reply_text } = req.body ?? {};
    if (typeof reply_text !== 'string' || reply_text.trim().length < 2 || reply_text.trim().length > 500) {
      res.status(400).json({ error: 'Balasan diskusi minimal 2 karakter.' });
      return;
    }

    const id = `rep-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO review_replies (id, review_id, user_id, reply_text, created_at)
      VALUES (?, ?, ?, ?, ?)
      `
    ).run(id, reviewId, req.user!.id, reply_text.trim(), now);

    broadcastEvent('reviews:updated', { bookId: review.book_id });
    res.status(201).json({ reviews: getReviewsForBook(review.book_id) });
  });

  app.post('/api/reviews/:reviewId/helpful', requireAuth, (req: AuthedRequest, res) => {
    const reviewId = req.params.reviewId;
    const review = db
      .prepare('SELECT id, book_id FROM reviews WHERE id = ?')
      .get(reviewId) as { id: string; book_id: string } | undefined;
    if (!review) {
      res.status(404).json({ error: 'Ulasan tidak ditemukan.' });
      return;
    }
    db.prepare('UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = ?').run(reviewId);
    broadcastEvent('reviews:updated', { bookId: review.book_id });
    res.json({ reviews: getReviewsForBook(review.book_id) });
  });

  // --- QR BORROWING & RETURNING ROUTES ---
  app.get('/api/loans/my', requireAuth, (req: AuthedRequest, res) => {
    const loans = getEnrichedLoans('WHERE l.user_id = ?', [req.user!.id]);
    res.json({ loans });
  });

  app.post('/api/loans/borrow', requireAuth, async (req: AuthedRequest, res) => {
    const { qr_code, loan_mode, member_email } = req.body ?? {};
    if (typeof qr_code !== 'string' || !qr_code.trim()) {
      res.status(400).json({ error: 'Kode QR buku wajib dipindai atau dimasukkan.' });
      return;
    }

    const cleanCode = qr_code.trim();
    const book = db
      .prepare('SELECT * FROM books WHERE lower(qr_code) = lower(?) OR lower(isbn) = lower(?) OR id = ?')
      .get(cleanCode, cleanCode, cleanCode) as Book | undefined;

    if (!book) {
      res.status(404).json({ error: `Buku dengan kode QR "${cleanCode}" tidak ditemukan.` });
      return;
    }

    let targetUserId = req.user!.id;
    if (req.user!.role === 'librarian' && typeof member_email === 'string' && member_email.trim()) {
      const targetMember = db
        .prepare('SELECT id FROM users WHERE lower(email) = lower(?) OR lower(member_code) = lower(?)')
        .get(member_email.trim(), member_email.trim()) as { id: string } | undefined;
      if (!targetMember) {
        res.status(404).json({ error: 'Anggota dengan email/kode tersebut tidak ditemukan.' });
        return;
      }
      targetUserId = targetMember.id;
    }

    const existingActive = db
      .prepare(`SELECT id FROM loans WHERE book_id = ? AND user_id = ? AND status != 'returned'`)
      .get(book.id, targetUserId);
    if (existingActive) {
      res.status(409).json({ error: 'Anda masih memiliki pinjaman aktif untuk buku ini.' });
      return;
    }

    const now = new Date();
    let dueDate = new Date(now);
    if (loan_mode === 'standard_14') {
      dueDate.setDate(dueDate.getDate() + 14);
    } else if (loan_mode === 'test_due_soon') {
      dueDate.setHours(dueDate.getHours() + 12);
    } else if (loan_mode === 'test_overdue') {
      dueDate.setDate(dueDate.getDate() - 2);
    } else {
      dueDate.setDate(dueDate.getDate() + 7);
    }

    const loanId = `ln-${crypto.randomUUID().slice(0, 8)}`;
    const loanQrCode = `LOAN-${now.getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`;
    const calc = calculateOverdueDetails(dueDate.toISOString(), null);
    const initialStatus = calc.isOverdue ? 'overdue' : 'borrowed';

    const tx = db.transaction(() => {
      const dec = db
        .prepare('UPDATE books SET available_copies = available_copies - 1, updated_at = ? WHERE id = ? AND available_copies > 0')
        .run(now.toISOString(), book.id);
      if (dec.changes === 0) {
        throw new Error('NO_STOCK');
      }
      db.prepare(
        `
        INSERT INTO loans (id, loan_qr_code, book_id, user_id, borrowed_at, due_date, returned_at, status, fine_amount, last_reminded_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
        `
      ).run(
        loanId,
        loanQrCode,
        book.id,
        targetUserId,
        now.toISOString(),
        dueDate.toISOString(),
        initialStatus,
        calc.fineAmount
      );
    });

    try {
      tx();
    } catch (err) {
      if (err instanceof Error && err.message === 'NO_STOCK') {
        res.status(409).json({ error: 'Stok buku saat ini sedang habis dipinjam.' });
        return;
      }
      throw err;
    }

    if (loan_mode === 'test_overdue' || loan_mode === 'test_due_soon') {
      await dispatchReminderForLoan(loanId, ['email', 'whatsapp']);
      broadcastEvent('notifications:updated', { userId: targetUserId });
    }

    const createdLoan = getEnrichedLoans('WHERE l.id = ?', [loanId])[0];
    broadcastEvent('books:updated', { action: 'borrowed', bookId: book.id });
    broadcastEvent('loans:updated', { loanId, userId: targetUserId });
    res.status(201).json({ loan: createdLoan });
  });

  app.post('/api/loans/return', requireAuth, (req: AuthedRequest, res) => {
    const { qr_code } = req.body ?? {};
    if (typeof qr_code !== 'string' || !qr_code.trim()) {
      res.status(400).json({ error: 'Kode QR peminjaman atau buku wajib diisi.' });
      return;
    }

    const cleanCode = qr_code.trim();
    let loanRow: { id: string; book_id: string; user_id: string; due_date: string } | undefined;

    if (req.user!.role === 'librarian') {
      loanRow = db
        .prepare(
          `
          SELECT l.id, l.book_id, l.user_id, l.due_date
          FROM loans l
          JOIN books b ON b.id = l.book_id
          WHERE l.status != 'returned'
            AND (lower(l.loan_qr_code) = lower(?) OR lower(b.qr_code) = lower(?) OR l.id = ?)
          ORDER BY l.borrowed_at ASC
          LIMIT 1
          `
        )
        .get(cleanCode, cleanCode, cleanCode) as typeof loanRow;
    } else {
      loanRow = db
        .prepare(
          `
          SELECT l.id, l.book_id, l.user_id, l.due_date
          FROM loans l
          JOIN books b ON b.id = l.book_id
          WHERE l.status != 'returned'
            AND l.user_id = ?
            AND (lower(l.loan_qr_code) = lower(?) OR lower(b.qr_code) = lower(?) OR l.id = ?)
          ORDER BY l.borrowed_at ASC
          LIMIT 1
          `
        )
        .get(req.user!.id, cleanCode, cleanCode, cleanCode) as typeof loanRow;
    }

    if (!loanRow) {
      res.status(404).json({
        error: `Tidak ditemukan peminjaman aktif yang cocok dengan kode QR "${cleanCode}".`,
      });
      return;
    }

    const returnedAt = new Date().toISOString();
    const calc = calculateOverdueDetails(loanRow.due_date, returnedAt);

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE loans SET status = 'returned', returned_at = ?, fine_amount = ? WHERE id = ?`
      ).run(returnedAt, calc.fineAmount, loanRow!.id);

      db.prepare(
        `UPDATE books SET available_copies = MIN(total_copies, available_copies + 1), updated_at = ? WHERE id = ?`
      ).run(returnedAt, loanRow!.book_id);
    });

    tx();

    const updatedLoan = getEnrichedLoans('WHERE l.id = ?', [loanRow.id])[0];
    broadcastEvent('books:updated', { action: 'returned', bookId: loanRow.book_id });
    broadcastEvent('loans:updated', { loanId: loanRow.id, userId: loanRow.user_id });
    res.json({ loan: updatedLoan });
  });

  // --- MEMBER NOTIFICATIONS ---
  app.get('/api/notifications/my', requireAuth, (req: AuthedRequest, res) => {
    const logs = db
      .prepare(
        `
        SELECT r.*, u.name AS member_name, b.title AS book_title
        FROM reminder_logs r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN loans l ON l.id = r.loan_id
        LEFT JOIN books b ON b.id = l.book_id
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
        LIMIT 40
        `
      )
      .all(req.user!.id);
    res.json({ notifications: logs });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('UPDATE reminder_logs SET is_read = 1 WHERE id = ? AND user_id = ?').run(
      req.params.id,
      req.user!.id
    );
    res.json({ ok: true });
  });

  // --- LIBRARIAN ADMIN ROUTES ---
  app.get('/api/admin/analytics', requireLibrarian, (_req, res) => {
    res.json({
      analytics: computeMonthlyAnalytics(),
      gatewayStatus: getGatewayStatus(),
    });
  });

  app.get('/api/admin/loans', requireLibrarian, (_req, res) => {
    res.json({ loans: getEnrichedLoans() });
  });

  app.get('/api/admin/members', requireLibrarian, (_req, res) => {
    const members = db
      .prepare(
        `
        SELECT u.id, u.name, u.email, u.phone, u.member_code, u.role, u.created_at,
               (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.status != 'returned') AS active_loans,
               (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.status = 'overdue') AS overdue_loans
        FROM users u
        ORDER BY u.created_at DESC
        `
      )
      .all();
    res.json({ members });
  });

  app.get('/api/admin/reminders', requireLibrarian, (_req, res) => {
    const logs = db
      .prepare(
        `
        SELECT r.*, u.name AS member_name, b.title AS book_title
        FROM reminder_logs r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN loans l ON l.id = r.loan_id
        LEFT JOIN books b ON b.id = l.book_id
        ORDER BY r.created_at DESC
        LIMIT 80
        `
      )
      .all();
    res.json({ logs, gatewayStatus: getGatewayStatus() });
  });

  app.post('/api/admin/reminders/send', requireLibrarian, async (req, res) => {
    const { loan_id, channels } = req.body ?? {};
    const validChannels: ('email' | 'whatsapp')[] = Array.isArray(channels)
      ? channels.filter((c): c is 'email' | 'whatsapp' => c === 'email' || c === 'whatsapp')
      : ['email', 'whatsapp'];

    if (validChannels.length === 0) {
      res.status(400).json({ error: 'Pilih minimal satu kanal pengingat (Email atau WhatsApp).' });
      return;
    }

    if (typeof loan_id === 'string' && loan_id.trim()) {
      const created = await dispatchReminderForLoan(loan_id.trim(), validChannels);
      broadcastEvent('notifications:updated', { count: created.length });
      res.json({ sentCount: created.length, logs: created });
      return;
    }

    const sweep = await runAutomatedReminderSweep(true);
    broadcastEvent('loans:updated');
    broadcastEvent('notifications:updated', { count: sweep.remindersCreated.length });
    res.json({ sentCount: sweep.remindersCreated.length, logs: sweep.remindersCreated });
  });

  app.get('/api/admin/report.csv', requireLibrarian, (_req, res) => {
    const analytics = computeMonthlyAnalytics();
    const lines = [
      ['Periode Bulan', 'Total Peminjaman', 'Total Pengembalian', 'Keterlambatan'].join(','),
      ...analytics.monthly_series.map((m) =>
        [m.label, m.borrowed, m.returned, m.overdue].join(',')
      ),
      '',
      ['Kategori', 'Jumlah Judul', 'Total Sirkulasi'].join(','),
      ...analytics.category_breakdown.map((c) =>
        [`"${c.category.replace(/"/g, '""')}"`, c.book_count, c.loan_count].join(',')
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="laporan-bulanan-perpustakaan.csv"');
    res.send('\uFEFF' + lines.join('\n'));
  });

  // Periodic background overdue + automated Email & WhatsApp sweep every 60s
  const sweepTimer = setInterval(() => {
    void runAutomatedReminderSweep(false).then((result) => {
      if (result.statusUpdated > 0) {
        broadcastEvent('loans:updated');
      }
      if (result.remindersCreated.length > 0) {
        broadcastEvent('notifications:updated', { count: result.remindersCreated.length });
      }
    });
  }, 60_000);
  sweepTimer.unref();

  // Vite / Static Frontend Serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Lentera Pustaka server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
