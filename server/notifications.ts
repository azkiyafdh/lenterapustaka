import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { calculateOverdueDetails, db } from './db.ts';
import type { GatewayStatus, ReminderLog } from '../src/types.ts';

function isAllowedWebhookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host === '169.254.169.254'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getGatewayStatus(): GatewayStatus {
  const smtpConfigured = Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
  const whatsappConfigured = Boolean(
    process.env.WHATSAPP_WEBHOOK_URL && isAllowedWebhookUrl(process.env.WHATSAPP_WEBHOOK_URL)
  );
  return {
    smtp_configured: smtpConfigured,
    whatsapp_configured: whatsappConfigured,
    smtp_from: process.env.SMTP_FROM || 'Lentera Pustaka <noreply@lenterapustaka.id>',
  };
}

interface LoanReminderRow {
  id: string;
  loan_qr_code: string;
  due_date: string;
  status: string;
  last_reminded_at: string | null;
  book_title: string;
  user_id: string;
  member_name: string;
  member_email: string;
  member_phone: string;
}

function formatTanggalID(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

async function sendEmailReminder(
  to: string,
  subject: string,
  textBody: string
): Promise<{ status: 'sent' | 'logged_sandbox' | 'failed'; detail: string }> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || '587');
  const from = process.env.SMTP_FROM || 'Lentera Pustaka <noreply@lenterapustaka.id>';

  if (!host || !user || !pass) {
    return {
      status: 'logged_sandbox',
      detail: 'SMTP belum dikonfigurasi pada environment server; pengingat email dicatat di log.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: textBody,
    });
    return {
      status: 'sent',
      detail: `Terkirim melalui SMTP (${info.messageId})`,
    };
  } catch (err) {
    return {
      status: 'failed',
      detail: err instanceof Error ? err.message : 'Gagal mengirim email SMTP',
    };
  }
}

async function sendWhatsAppReminder(
  phone: string,
  message: string,
  meta: { memberName: string; bookTitle: string; dueDate: string; overdueDays: number; fineAmount: number }
): Promise<{ status: 'sent' | 'logged_sandbox' | 'failed'; detail: string }> {
  const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL;
  const apiToken = process.env.WHATSAPP_API_TOKEN;

  if (!webhookUrl || !isAllowedWebhookUrl(webhookUrl)) {
    return {
      status: 'logged_sandbox',
      detail: 'Gateway WhatsApp belum dikonfigurasi pada environment server; pesan dicatat di log.',
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiToken) {
      headers['Authorization'] = `Bearer ${apiToken}`;
    }
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: phone,
        message,
        metadata: meta,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        status: 'failed',
        detail: `Gateway WhatsApp merespons HTTP ${res.status}`,
      };
    }
    return {
      status: 'sent',
      detail: 'Terkirim melalui Gateway WhatsApp',
    };
  } catch (err) {
    return {
      status: 'failed',
      detail: err instanceof Error ? err.message : 'Gagal menghubungi Gateway WhatsApp',
    };
  }
}

export async function dispatchReminderForLoan(
  loanId: string,
  channels: ('email' | 'whatsapp')[] = ['email', 'whatsapp']
): Promise<ReminderLog[]> {
  const row = db
    .prepare(
      `
      SELECT l.id, l.loan_qr_code, l.due_date, l.status, l.last_reminded_at,
             b.title AS book_title,
             u.id AS user_id, u.name AS member_name, u.email AS member_email, u.phone AS member_phone
      FROM loans l
      JOIN books b ON b.id = l.book_id
      JOIN users u ON u.id = l.user_id
      WHERE l.id = ? AND l.status != 'returned'
      `
    )
    .get(loanId) as LoanReminderRow | undefined;

  if (!row) return [];

  const overdue = calculateOverdueDetails(row.due_date, null);
  const dueFormatted = formatTanggalID(row.due_date);

  const subject = overdue.isOverdue
    ? `Pengingat Keterlambatan (${overdue.overdueDays} Hari): ${row.book_title}`
    : `Pengingat Jatuh Tempo Pengembalian: ${row.book_title}`;

  const emailBody = overdue.isOverdue
    ? `Halo ${row.member_name},\n\nPeminjaman buku "${row.book_title}" (Kode QR: ${row.loan_qr_code}) telah melewati tanggal jatuh tempo (${dueFormatted}) selama ${overdue.overdueDays} hari.\nEstimasi denda keterlambatan saat ini: ${formatRupiah(overdue.fineAmount)}.\n\nMohon segera mengembalikan buku melalui pemindaian QR di perpustakaan.\n\nSalam,\nLentera Pustaka`
    : `Halo ${row.member_name},\n\nIni adalah pengingat otomatis bahwa peminjaman buku "${row.book_title}" (Kode QR: ${row.loan_qr_code}) akan jatuh tempo pada ${dueFormatted}.\nMohon kembalikan tepat waktu untuk menghindari denda keterlambatan.\n\nSalam,\nLentera Pustaka`;

  const waBody = overdue.isOverdue
    ? `[Lentera Pustaka] Halo ${row.member_name}, buku "${row.book_title}" (QR: ${row.loan_qr_code}) terlambat ${overdue.overdueDays} hari sejak ${dueFormatted}. Denda sementara ${formatRupiah(overdue.fineAmount)}. Mohon segera dikembalikan.`
    : `[Lentera Pustaka] Halo ${row.member_name}, pengingat bahwa buku "${row.book_title}" (QR: ${row.loan_qr_code}) jatuh tempo pada ${dueFormatted}. Terima kasih!`;

  const insertStmt = db.prepare(`
    INSERT INTO reminder_logs (id, loan_id, user_id, channel, recipient, subject, message, status, gateway_detail, created_at, is_read)
    VALUES (@id, @loan_id, @user_id, @channel, @recipient, @subject, @message, @status, @gateway_detail, @created_at, 0)
  `);

  const createdLogs: ReminderLog[] = [];
  const nowIso = new Date().toISOString();

  if (channels.includes('email')) {
    const emailRes = await sendEmailReminder(row.member_email, subject, emailBody);
    const logEntry: ReminderLog = {
      id: `rem-${crypto.randomUUID().slice(0, 8)}`,
      loan_id: row.id,
      user_id: row.user_id,
      member_name: row.member_name,
      book_title: row.book_title,
      channel: 'email',
      recipient: row.member_email,
      subject,
      message: emailBody,
      status: emailRes.status,
      gateway_detail: emailRes.detail,
      created_at: nowIso,
      is_read: 0,
    };
    insertStmt.run(logEntry);
    createdLogs.push(logEntry);
  }

  if (channels.includes('whatsapp')) {
    const waRes = await sendWhatsAppReminder(row.member_phone, waBody, {
      memberName: row.member_name,
      bookTitle: row.book_title,
      dueDate: row.due_date,
      overdueDays: overdue.overdueDays,
      fineAmount: overdue.fineAmount,
    });
    const logEntry: ReminderLog = {
      id: `rem-${crypto.randomUUID().slice(0, 8)}`,
      loan_id: row.id,
      user_id: row.user_id,
      member_name: row.member_name,
      book_title: row.book_title,
      channel: 'whatsapp',
      recipient: row.member_phone,
      subject: overdue.isOverdue ? 'Notifikasi WhatsApp Keterlambatan' : 'Pengingat WhatsApp Jatuh Tempo',
      message: waBody,
      status: waRes.status,
      gateway_detail: waRes.detail,
      created_at: nowIso,
      is_read: 0,
    };
    insertStmt.run(logEntry);
    createdLogs.push(logEntry);
  }

  db.prepare('UPDATE loans SET last_reminded_at = ? WHERE id = ?').run(nowIso, row.id);
  return createdLogs;
}

export function syncOverdueStatuses(): number {
  const activeLoans = db
    .prepare(`SELECT id, due_date, status, fine_amount FROM loans WHERE status != 'returned'`)
    .all() as { id: string; due_date: string; status: string; fine_amount: number }[];

  let updatedCount = 0;
  const updateStmt = db.prepare('UPDATE loans SET status = ?, fine_amount = ? WHERE id = ?');

  for (const loan of activeLoans) {
    const calc = calculateOverdueDetails(loan.due_date, null);
    const nextStatus = calc.isOverdue ? 'overdue' : 'borrowed';
    if (nextStatus !== loan.status || calc.fineAmount !== loan.fine_amount) {
      updateStmt.run(nextStatus, calc.fineAmount, loan.id);
      updatedCount++;
    }
  }
  return updatedCount;
}

export async function runAutomatedReminderSweep(forceAllOverdue = false): Promise<{
  statusUpdated: number;
  remindersCreated: ReminderLog[];
}> {
  const statusUpdated = syncOverdueStatuses();
  const nowMs = Date.now();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  const candidates = db
    .prepare(
      `
      SELECT id, due_date, status, last_reminded_at
      FROM loans
      WHERE status != 'returned'
      `
    )
    .all() as { id: string; due_date: string; status: string; last_reminded_at: string | null }[];

  const remindersCreated: ReminderLog[] = [];

  for (const loan of candidates) {
    const dueMs = new Date(loan.due_date).getTime();
    const isDueSoonOrOverdue = dueMs - nowMs <= twentyFourHoursMs;
    if (!isDueSoonOrOverdue) continue;

    if (!forceAllOverdue && loan.last_reminded_at) {
      const lastMs = new Date(loan.last_reminded_at).getTime();
      if (nowMs - lastMs < twentyFourHoursMs) {
        continue;
      }
    }

    const logs = await dispatchReminderForLoan(loan.id, ['email', 'whatsapp']);
    remindersCreated.push(...logs);
  }

  return { statusUpdated, remindersCreated };
}
