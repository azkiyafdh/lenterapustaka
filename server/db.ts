import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';

const DB_PATH = path.resolve(process.cwd(), 'library.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const DAILY_FINE_IDR = 2000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':') || storedHash.startsWith('!')) {
    return false;
  }
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      member_code TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('member', 'librarian')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      isbn TEXT UNIQUE NOT NULL,
      qr_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      publisher TEXT NOT NULL,
      year INTEGER NOT NULL,
      shelf_location TEXT NOT NULL,
      total_copies INTEGER NOT NULL CHECK(total_copies >= 0),
      available_copies INTEGER NOT NULL CHECK(available_copies >= 0),
      synopsis TEXT NOT NULL,
      cover_url TEXT NOT NULL,
      cover_accent TEXT NOT NULL DEFAULT '#1E3A5F',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      loan_qr_code TEXT UNIQUE NOT NULL,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      borrowed_at TEXT NOT NULL,
      due_date TEXT NOT NULL,
      returned_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('borrowed', 'overdue', 'returned')),
      fine_amount INTEGER NOT NULL DEFAULT 0,
      last_reminded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT NOT NULL,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_replies (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reply_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminder_logs (
      id TEXT PRIMARY KEY,
      loan_id TEXT REFERENCES loans(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK(channel IN ('email', 'whatsapp', 'system')),
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('sent', 'logged_sandbox', 'failed')),
      gateway_detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0
    );
  `);

  seedInitialData();
}

function daysOffsetISO(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString();
}

function monthsOffsetISO(monthsAgo: number, dayOfMonth: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  d.setDate(Math.min(dayOfMonth, 28));
  d.setHours(10, 30, 0, 0);
  return d.toISOString();
}

function seedInitialData(): void {
  const bookCount = (db.prepare('SELECT COUNT(*) as cnt FROM books').get() as { cnt: number }).cnt;
  if (bookCount > 0) return;

  const now = new Date().toISOString();

  // Archive member profiles used solely to populate realistic catalog reviews and historical circulation stats.
  // Hash starts with '!' so verifyPassword always rejects login attempts for archive seed records.
  const seedUsers = [
    {
      id: 'usr-archive-1',
      name: 'Nadia Kusuma',
      email: 'nadia.kusuma@pustaka.example',
      phone: '+6281234567801',
      member_code: 'MEM-2026-101',
      role: 'member',
      password_hash: '!archive-seed',
      created_at: monthsOffsetISO(5, 3),
    },
    {
      id: 'usr-archive-2',
      name: 'Budi Santoso',
      email: 'budi.santoso@pustaka.example',
      phone: '+6281398765402',
      member_code: 'MEM-2026-102',
      role: 'member',
      password_hash: '!archive-seed',
      created_at: monthsOffsetISO(4, 11),
    },
    {
      id: 'usr-archive-3',
      name: 'Siti Rahmawati',
      email: 'siti.rahma@pustaka.example',
      phone: '+6285711223303',
      member_code: 'MEM-2026-103',
      role: 'member',
      password_hash: '!archive-seed',
      created_at: monthsOffsetISO(3, 19),
    },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, phone, member_code, role, password_hash, created_at)
    VALUES (@id, @name, @email, @phone, @member_code, @role, @password_hash, @created_at)
  `);

  const seedBooks = [
    {
      id: 'bk-01',
      isbn: '978-602-481-901-2',
      qr_code: 'LIB-BK-001',
      title: 'Jejak Maritim Nusantara',
      author: 'Dr. Haryo Wibisono',
      category: 'Sejarah & Budaya',
      publisher: 'Pustaka Cakrawala',
      year: 2024,
      shelf_location: 'Rak A-01',
      total_copies: 5,
      available_copies: 3,
      synopsis: 'Menelusuri jalur pelayaran kuno kepulauan Nusantara dari abad ke-7 hingga era niaga rempah, lengkap dengan peta rekonstruksi pelabuhan dan catatan arsip maritim.',
      cover_url: '/src/assets/images/cover_nusantara_history_1795675183152.jpg',
      cover_accent: '#1E3A5F',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'bk-02',
      isbn: '978-602-481-902-9',
      qr_code: 'LIB-BK-002',
      title: 'Arsitektur Sistem Terdistribusi',
      author: 'Raka Pratama, M.T.',
      category: 'Teknologi & Rekayasa',
      publisher: 'Informatika Press',
      year: 2025,
      shelf_location: 'Rak B-04',
      total_copies: 4,
      available_copies: 2,
      synopsis: 'Panduan komprehensif merancang layanan berskala tinggi yang tangguh terhadap kegagalan, mencakup konsensus, replikasi data real-time, serta observabilitas produksi.',
      cover_url: '/src/assets/images/cover_systems_engineering_1795675183467.jpg',
      cover_accent: '#334155',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'bk-03',
      isbn: '978-602-481-903-6',
      qr_code: 'LIB-BK-003',
      title: 'Atlas Botani & Ekologi Tropis',
      author: 'Prof. Lestari Handayani',
      category: 'Sains & Alam',
      publisher: 'Balai Riset Alam',
      year: 2023,
      shelf_location: 'Rak C-02',
      total_copies: 3,
      available_copies: 2,
      synopsis: 'Kajian visual dan taksonomi flora endemik hutan hujan tropis Indonesia beserta peran ekologisnya dalam menjaga siklus hidrologi dan keanekaragaman hayati.',
      cover_url: '/src/assets/images/cover_botanical_science_1795675184390.jpg',
      cover_accent: '#2D4F3E',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'bk-04',
      isbn: '978-602-481-904-3',
      qr_code: 'LIB-BK-004',
      title: 'Cahaya & Ruang: Tata Kota Modern',
      author: 'Ar. Dimas Prawira',
      category: 'Desain & Arsitektur',
      publisher: 'Atelier Pustaka',
      year: 2025,
      shelf_location: 'Rak D-01',
      total_copies: 4,
      available_copies: 4,
      synopsis: 'Esai visual tentang perancangan ruang publik ramah pejalan kaki, pencahayaan alami bangunan sipil, dan material berkelanjutan untuk iklim tropis lembap.',
      cover_url: '/src/assets/images/cover_urban_architecture_1795675185003.jpg',
      cover_accent: '#57534E',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'bk-05',
      isbn: '978-602-481-905-0',
      qr_code: 'LIB-BK-005',
      title: 'Senja di Pelabuhan Sunda Kelapa',
      author: 'Ratna Sari Dewi',
      category: 'Sastra & Fiksi',
      publisher: 'Lentera Aksara',
      year: 2024,
      shelf_location: 'Rak E-03',
      total_copies: 6,
      available_copies: 5,
      synopsis: 'Novel sejarah berlatar Jakarta pesisir tahun 1950-an tentang seorang pengarsip naskah tua yang menemukan surat-surat rahasia para pelaut pinisi.',
      cover_url: '',
      cover_accent: '#7C2D12',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'bk-06',
      isbn: '978-602-481-906-7',
      qr_code: 'LIB-BK-006',
      title: 'Ekonomi Sirkular & Rantai Pasok Hijau',
      author: 'Dr. Hendra Gunawan',
      category: 'Ekonomi & Bisnis',
      publisher: 'Gema Ekonomi',
      year: 2025,
      shelf_location: 'Rak F-02',
      total_copies: 4,
      available_copies: 3,
      synopsis: 'Analisis praktis transformasi model bisnis manufaktur dan logistik menuju efisiensi sumber daya, pengurangan emisi, serta valuasi jangka panjang.',
      cover_url: '',
      cover_accent: '#1E3A5F',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'bk-07',
      isbn: '978-602-481-907-4',
      qr_code: 'LIB-BK-007',
      title: 'Algoritma & Struktur Data Praktis',
      author: 'Bagus Setiawan, S.Kom.',
      category: 'Teknologi & Rekayasa',
      publisher: 'Informatika Press',
      year: 2024,
      shelf_location: 'Rak B-06',
      total_copies: 5,
      available_copies: 5,
      synopsis: 'Pembahasan mendalam tentang graf, pemrograman dinamis, indeks basis data, serta analisis kompleksitas dengan studi kasus sistem pencarian modern.',
      cover_url: '',
      cover_accent: '#0F172A',
      created_at: now,
      updated_at: now,
    },
    {
      id: 'bk-08',
      isbn: '978-602-481-908-1',
      qr_code: 'LIB-BK-008',
      title: 'Catatan Aksara Kuno Jawa & Bali',
      author: 'Dra. Sri Utami',
      category: 'Sejarah & Budaya',
      publisher: 'Pustaka Cakrawala',
      year: 2022,
      shelf_location: 'Rak A-05',
      total_copies: 3,
      available_copies: 3,
      synopsis: 'Pengantar filologi dan pelestarian digital naskah lontar, membahas teknik transliterasi, sejarah aksara, dan metode konservasi arsip kertas.',
      cover_url: '',
      cover_accent: '#3F6212',
      created_at: now,
      updated_at: now,
    },
  ];

  const insertBook = db.prepare(`
    INSERT INTO books (id, isbn, qr_code, title, author, category, publisher, year, shelf_location, total_copies, available_copies, synopsis, cover_url, cover_accent, created_at, updated_at)
    VALUES (@id, @isbn, @qr_code, @title, @author, @category, @publisher, @year, @shelf_location, @total_copies, @available_copies, @synopsis, @cover_url, @cover_accent, @created_at, @updated_at)
  `);

  const seedLoans = [
    // Historical returned loans across past 5 months for monthly statistics
    { id: 'ln-hist-1', loan_qr_code: 'LOAN-2026-0001', book_id: 'bk-01', user_id: 'usr-archive-1', borrowed_at: monthsOffsetISO(5, 4), due_date: monthsOffsetISO(5, 11), returned_at: monthsOffsetISO(5, 10), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-2', loan_qr_code: 'LOAN-2026-0002', book_id: 'bk-02', user_id: 'usr-archive-2', borrowed_at: monthsOffsetISO(5, 12), due_date: monthsOffsetISO(5, 19), returned_at: monthsOffsetISO(5, 21), status: 'returned', fine_amount: 4000, last_reminded_at: monthsOffsetISO(5, 20) },
    { id: 'ln-hist-3', loan_qr_code: 'LOAN-2026-0003', book_id: 'bk-03', user_id: 'usr-archive-3', borrowed_at: monthsOffsetISO(4, 5), due_date: monthsOffsetISO(4, 12), returned_at: monthsOffsetISO(4, 11), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-4', loan_qr_code: 'LOAN-2026-0004', book_id: 'bk-05', user_id: 'usr-archive-1', borrowed_at: monthsOffsetISO(4, 14), due_date: monthsOffsetISO(4, 21), returned_at: monthsOffsetISO(4, 19), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-5', loan_qr_code: 'LOAN-2026-0005', book_id: 'bk-07', user_id: 'usr-archive-2', borrowed_at: monthsOffsetISO(4, 20), due_date: monthsOffsetISO(4, 27), returned_at: monthsOffsetISO(4, 26), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-6', loan_qr_code: 'LOAN-2026-0006', book_id: 'bk-01', user_id: 'usr-archive-3', borrowed_at: monthsOffsetISO(3, 6), due_date: monthsOffsetISO(3, 13), returned_at: monthsOffsetISO(3, 12), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-7', loan_qr_code: 'LOAN-2026-0007', book_id: 'bk-04', user_id: 'usr-archive-1', borrowed_at: monthsOffsetISO(3, 15), due_date: monthsOffsetISO(3, 22), returned_at: monthsOffsetISO(3, 24), status: 'returned', fine_amount: 4000, last_reminded_at: monthsOffsetISO(3, 23) },
    { id: 'ln-hist-8', loan_qr_code: 'LOAN-2026-0008', book_id: 'bk-06', user_id: 'usr-archive-2', borrowed_at: monthsOffsetISO(2, 3), due_date: monthsOffsetISO(2, 10), returned_at: monthsOffsetISO(2, 9), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-9', loan_qr_code: 'LOAN-2026-0009', book_id: 'bk-02', user_id: 'usr-archive-3', borrowed_at: monthsOffsetISO(2, 11), due_date: monthsOffsetISO(2, 18), returned_at: monthsOffsetISO(2, 17), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-10', loan_qr_code: 'LOAN-2026-0010', book_id: 'bk-05', user_id: 'usr-archive-1', borrowed_at: monthsOffsetISO(2, 19), due_date: monthsOffsetISO(2, 26), returned_at: monthsOffsetISO(2, 25), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-11', loan_qr_code: 'LOAN-2026-0011', book_id: 'bk-03', user_id: 'usr-archive-2', borrowed_at: monthsOffsetISO(1, 5), due_date: monthsOffsetISO(1, 12), returned_at: monthsOffsetISO(1, 11), status: 'returned', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-hist-12', loan_qr_code: 'LOAN-2026-0012', book_id: 'bk-08', user_id: 'usr-archive-3', borrowed_at: monthsOffsetISO(1, 12), due_date: monthsOffsetISO(1, 19), returned_at: monthsOffsetISO(1, 21), status: 'returned', fine_amount: 4000, last_reminded_at: monthsOffsetISO(1, 20) },
    { id: 'ln-hist-13', loan_qr_code: 'LOAN-2026-0013', book_id: 'bk-04', user_id: 'usr-archive-1', borrowed_at: monthsOffsetISO(1, 20), due_date: monthsOffsetISO(1, 27), returned_at: monthsOffsetISO(1, 26), status: 'returned', fine_amount: 0, last_reminded_at: null },
    // Current month active & overdue loans
    { id: 'ln-cur-1', loan_qr_code: 'LOAN-2026-0014', book_id: 'bk-01', user_id: 'usr-archive-2', borrowed_at: daysOffsetISO(-10), due_date: daysOffsetISO(-3), returned_at: null, status: 'overdue', fine_amount: 6000, last_reminded_at: daysOffsetISO(-1) },
    { id: 'ln-cur-2', loan_qr_code: 'LOAN-2026-0015', book_id: 'bk-02', user_id: 'usr-archive-3', borrowed_at: daysOffsetISO(-12), due_date: daysOffsetISO(-5), returned_at: null, status: 'overdue', fine_amount: 10000, last_reminded_at: daysOffsetISO(-1) },
    { id: 'ln-cur-3', loan_qr_code: 'LOAN-2026-0016', book_id: 'bk-01', user_id: 'usr-archive-1', borrowed_at: daysOffsetISO(-3), due_date: daysOffsetISO(4), returned_at: null, status: 'borrowed', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-cur-4', loan_qr_code: 'LOAN-2026-0017', book_id: 'bk-02', user_id: 'usr-archive-1', borrowed_at: daysOffsetISO(-6), due_date: daysOffsetISO(1), returned_at: null, status: 'borrowed', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-cur-5', loan_qr_code: 'LOAN-2026-0018', book_id: 'bk-03', user_id: 'usr-archive-2', borrowed_at: daysOffsetISO(-2), due_date: daysOffsetISO(5), returned_at: null, status: 'borrowed', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-cur-6', loan_qr_code: 'LOAN-2026-0019', book_id: 'bk-05', user_id: 'usr-archive-3', borrowed_at: daysOffsetISO(-4), due_date: daysOffsetISO(3), returned_at: null, status: 'borrowed', fine_amount: 0, last_reminded_at: null },
    { id: 'ln-cur-7', loan_qr_code: 'LOAN-2026-0020', book_id: 'bk-06', user_id: 'usr-archive-1', borrowed_at: daysOffsetISO(-1), due_date: daysOffsetISO(6), returned_at: null, status: 'borrowed', fine_amount: 0, last_reminded_at: null },
  ];

  const insertLoan = db.prepare(`
    INSERT INTO loans (id, loan_qr_code, book_id, user_id, borrowed_at, due_date, returned_at, status, fine_amount, last_reminded_at)
    VALUES (@id, @loan_qr_code, @book_id, @user_id, @borrowed_at, @due_date, @returned_at, @status, @fine_amount, @last_reminded_at)
  `);

  const seedReviews = [
    {
      id: 'rev-1',
      book_id: 'bk-01',
      user_id: 'usr-archive-1',
      rating: 5,
      comment: 'Rekonstruksi jalur pelayaran Nusantara di bab tiga sangat membantu riset sejarah maritim saya. Ilustrasi petanya juga jernih dan mudah dipahami.',
      helpful_count: 8,
      created_at: daysOffsetISO(-8),
    },
    {
      id: 'rev-2',
      book_id: 'bk-02',
      user_id: 'usr-archive-2',
      rating: 5,
      comment: 'Penjelasan mengenai Raft consensus dan partisi jaringan sangat praktis untuk pengembang sistem backend di Indonesia.',
      helpful_count: 6,
      created_at: daysOffsetISO(-5),
    },
    {
      id: 'rev-3',
      book_id: 'bk-03',
      user_id: 'usr-archive-3',
      rating: 4,
      comment: 'Referensi gambar botani sangat detail. Akan lebih lengkap jika indeks nama daerah tanaman diperluas pada edisi berikutnya.',
      helpful_count: 4,
      created_at: daysOffsetISO(-4),
    },
    {
      id: 'rev-4',
      book_id: 'bk-05',
      user_id: 'usr-archive-1',
      rating: 5,
      comment: 'Alurnya tenang namun memikat. Deskripsi suasana pelabuhan lama terasa hidup sekali.',
      helpful_count: 5,
      created_at: daysOffsetISO(-2),
    },
  ];

  const insertReview = db.prepare(`
    INSERT INTO reviews (id, book_id, user_id, rating, comment, helpful_count, created_at)
    VALUES (@id, @book_id, @user_id, @rating, @comment, @helpful_count, @created_at)
  `);

  const seedReplies = [
    {
      id: 'rep-1',
      review_id: 'rev-1',
      user_id: 'usr-archive-2',
      reply_text: 'Setuju! Bagian lampiran sumber arsip pelabuhan Makassar juga sangat bagus untuk bahan bacaan lanjutan.',
      created_at: daysOffsetISO(-7),
    },
    {
      id: 'rep-2',
      review_id: 'rev-2',
      user_id: 'usr-archive-1',
      reply_text: 'Apakah buku ini juga membahas studi kasus WebSocket dan antrean pesan? Saya berencana meminjam pekan ini.',
      created_at: daysOffsetISO(-4),
    },
  ];

  const insertReply = db.prepare(`
    INSERT INTO review_replies (id, review_id, user_id, reply_text, created_at)
    VALUES (@id, @review_id, @user_id, @reply_text, @created_at)
  `);

  const seedLogs = [
    {
      id: 'rem-seed-1',
      loan_id: 'ln-cur-1',
      user_id: 'usr-archive-2',
      channel: 'email',
      recipient: 'budi.santoso@pustaka.example',
      subject: 'Pengingat Keterlambatan: Jejak Maritim Nusantara',
      message: 'Halo Budi Santoso, buku "Jejak Maritim Nusantara" (LOAN-2026-0014) telah melewati batas pengembalian selama 3 hari. Estimasi denda saat ini Rp 6.000. Mohon segera kembalikan melalui meja atau pemindaian QR.',
      status: 'logged_sandbox',
      gateway_detail: 'Dicatat di log otomatis sistem',
      created_at: daysOffsetISO(-1),
      is_read: 0,
    },
    {
      id: 'rem-seed-2',
      loan_id: 'ln-cur-1',
      user_id: 'usr-archive-2',
      channel: 'whatsapp',
      recipient: '+6281398765402',
      subject: 'Notifikasi WhatsApp Keterlambatan',
      message: '[Lentera Pustaka] Halo Budi Santoso, pengingat pengembalian buku "Jejak Maritim Nusantara" (Kode QR: LOAN-2026-0014) terlambat 3 hari. Mohon segera dikembalikan ke perpustakaan.',
      status: 'logged_sandbox',
      gateway_detail: 'Dicatat di log otomatis sistem',
      created_at: daysOffsetISO(-1),
      is_read: 0,
    },
  ];

  const insertLog = db.prepare(`
    INSERT INTO reminder_logs (id, loan_id, user_id, channel, recipient, subject, message, status, gateway_detail, created_at, is_read)
    VALUES (@id, @loan_id, @user_id, @channel, @recipient, @subject, @message, @status, @gateway_detail, @created_at, @is_read)
  `);

  const tx = db.transaction(() => {
    for (const u of seedUsers) insertUser.run(u);
    for (const b of seedBooks) insertBook.run(b);
    for (const l of seedLoans) insertLoan.run(l);
    for (const r of seedReviews) insertReview.run(r);
    for (const rp of seedReplies) insertReply.run(rp);
    for (const lg of seedLogs) insertLog.run(lg);
  });

  tx();
}

export function calculateOverdueDetails(dueDateIso: string, returnedAtIso: string | null): { overdueDays: number; fineAmount: number; isOverdue: boolean } {
  const reference = returnedAtIso ? new Date(returnedAtIso).getTime() : Date.now();
  const due = new Date(dueDateIso).getTime();
  if (reference <= due) {
    return { overdueDays: 0, fineAmount: 0, isOverdue: false };
  }
  const diffDays = Math.max(1, Math.ceil((reference - due) / (1000 * 60 * 60 * 24)));
  return {
    overdueDays: diffDays,
    fineAmount: diffDays * DAILY_FINE_IDR,
    isOverdue: true,
  };
}
