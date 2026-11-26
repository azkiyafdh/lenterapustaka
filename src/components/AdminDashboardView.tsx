import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookPlus,
  CheckCircle2,
  Download,
  ExternalLink,
  Mail,
  MessageCircle,
  Pencil,
  QrCode,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AdminAnalytics,
  Book,
  BookCategory,
  GatewayStatus,
  Loan,
  ReminderLog,
  UserProfile,
} from '../types';
import {
  apiRequest,
  buildWhatsAppDirectUrl,
  formatRupiah,
  formatTanggalID,
  formatWaktuID,
  getAuthToken,
} from '../lib/api';
import { MonthlyChart } from './MonthlyChart';
import { QrCodeDisplay } from './QrCodeDisplay';

const CATEGORIES: BookCategory[] = [
  'Sejarah & Budaya',
  'Teknologi & Rekayasa',
  'Sains & Alam',
  'Desain & Arsitektur',
  'Sastra & Fiksi',
  'Ekonomi & Bisnis',
];

interface AdminDashboardViewProps {
  user: UserProfile | null;
  books: Book[];
  wsTick: number;
  onOpenAuth: (mode: 'login' | 'claim_librarian') => void;
  onCatalogChanged: () => void;
}

export function AdminDashboardView({
  user,
  books,
  wsTick,
  onOpenAuth,
  onCatalogChanged,
}: AdminDashboardViewProps) {
  const [subTab, setSubTab] = useState<'analytics' | 'catalog' | 'reminders'>('analytics');
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [reminderLogs, setReminderLogs] = useState<ReminderLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add / Edit book form state
  const [showBookModal, setShowBookModal] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formAuthor, setFormAuthor] = useState('');
  const [formIsbn, setFormIsbn] = useState('');
  const [formCategory, setFormCategory] = useState<BookCategory>('Teknologi & Rekayasa');
  const [formPublisher, setFormPublisher] = useState('');
  const [formYear, setFormYear] = useState('2026');
  const [formShelf, setFormShelf] = useState('');
  const [formCopies, setFormCopies] = useState('4');
  const [formSynopsis, setFormSynopsis] = useState('');
  const [formSaving, setFormSaving] = useState(false);

  // QR label preview modal
  const [qrModalBook, setQrModalBook] = useState<Book | null>(null);
  const [sendingReminders, setSendingReminders] = useState(false);

  const isLibrarian = user?.role === 'librarian';

  async function loadAdminData() {
    if (!isLibrarian) return;
    setLoading(true);
    try {
      const [analyticsRes, loansRes, remindersRes] = await Promise.all([
        apiRequest<{ analytics: AdminAnalytics; gatewayStatus: GatewayStatus }>('/api/admin/analytics'),
        apiRequest<{ loans: Loan[] }>('/api/admin/loans'),
        apiRequest<{ logs: ReminderLog[]; gatewayStatus: GatewayStatus }>('/api/admin/reminders'),
      ]);
      setAnalytics(analyticsRes.analytics);
      setGatewayStatus(analyticsRes.gatewayStatus);
      setLoans(loansRes.loans);
      setReminderLogs(remindersRes.logs);
    } catch (err) {
      setActionMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memuat data dasbor pengelola.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdminData();
  }, [isLibrarian, wsTick]);

  if (!isLibrarian) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto space-y-4">
        <h2 className="font-editorial text-2xl font-semibold text-slate-900">
          Dasbor Pengelola & Statistik Bulanan
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Area ini dikhususkan bagi petugas perpustakaan untuk memantau pelaporan statistik bulanan otomatis, mengelola koleksi buku secara real-time, dan mengirimkan pengingat keterlambatan via Email & WhatsApp.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => onOpenAuth('login')}
            className="px-4 py-2.5 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors"
          >
            Masuk sebagai Petugas
          </button>
          <button
            type="button"
            onClick={() => onOpenAuth('claim_librarian')}
            className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Aktivasi Petugas Baru
          </button>
        </div>
      </div>
    );
  }

  function openAddBook() {
    setEditingBook(null);
    setFormTitle('');
    setFormAuthor('');
    setFormIsbn('');
    setFormCategory('Teknologi & Rekayasa');
    setFormPublisher('');
    setFormYear(String(new Date().getFullYear()));
    setFormShelf('Rak B-01');
    setFormCopies('4');
    setFormSynopsis('');
    setShowBookModal(true);
  }

  function openEditBook(book: Book) {
    setEditingBook(book);
    setFormTitle(book.title);
    setFormAuthor(book.author);
    setFormIsbn(book.isbn);
    setFormCategory(book.category);
    setFormPublisher(book.publisher);
    setFormYear(String(book.year));
    setFormShelf(book.shelf_location);
    setFormCopies(String(book.total_copies));
    setFormSynopsis(book.synopsis);
    setShowBookModal(true);
  }

  async function handleSaveBook(e: React.FormEvent) {
    e.preventDefault();
    setFormSaving(true);
    setActionMsg(null);
    try {
      const payload = {
        title: formTitle.trim(),
        author: formAuthor.trim(),
        isbn: formIsbn.trim(),
        category: formCategory,
        publisher: formPublisher.trim(),
        year: Number(formYear),
        shelf_location: formShelf.trim(),
        total_copies: Number(formCopies),
        synopsis: formSynopsis.trim(),
      };
      if (editingBook) {
        await apiRequest(`/api/books/${editingBook.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setActionMsg({
          type: 'success',
          text: `Koleksi "${formTitle}" diperbarui secara real-time.`,
        });
      } else {
        await apiRequest('/api/books', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setActionMsg({
          type: 'success',
          text: `Buku baru "${formTitle}" berhasil ditambahkan beserta kode QR.`,
        });
      }
      setShowBookModal(false);
      onCatalogChanged();
      void loadAdminData();
    } catch (err) {
      setActionMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menyimpan buku.',
      });
    } finally {
      setFormSaving(false);
    }
  }

  async function handleDeleteBook(book: Book) {
    setActionMsg(null);
    try {
      await apiRequest(`/api/books/${book.id}`, { method: 'DELETE' });
      setActionMsg({ type: 'success', text: `Buku "${book.title}" dihapus dari koleksi.` });
      onCatalogChanged();
      void loadAdminData();
    } catch (err) {
      setActionMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal menghapus buku.',
      });
    }
  }

  async function handleTriggerReminders(loanId?: string) {
    setSendingReminders(true);
    setActionMsg(null);
    try {
      const res = await apiRequest<{ sentCount: number }>('/api/admin/reminders/send', {
        method: 'POST',
        body: JSON.stringify({
          loan_id: loanId,
          channels: ['email', 'whatsapp'],
        }),
      });
      setActionMsg({
        type: 'success',
        text:
          res.sentCount > 0
            ? `${res.sentCount} notifikasi pengingat (Email & WhatsApp) berhasil diproses dan dicatat.`
            : 'Tidak ada pinjaman terlambat atau mendekati jatuh tempo yang memerlukan pengingat baru.',
      });
      void loadAdminData();
    } catch (err) {
      setActionMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mengirim pengingat.',
      });
    } finally {
      setSendingReminders(false);
    }
  }

  async function handleMarkReturnedByAdmin(loan: Loan) {
    setActionMsg(null);
    try {
      await apiRequest('/api/loans/return', {
        method: 'POST',
        body: JSON.stringify({ qr_code: loan.loan_qr_code }),
      });
      setActionMsg({
        type: 'success',
        text: `Pengembalian "${loan.book_title}" oleh ${loan.member_name} telah dicatat.`,
      });
      onCatalogChanged();
      void loadAdminData();
    } catch (err) {
      setActionMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memproses pengembalian.',
      });
    }
  }

  async function handleDownloadCsv() {
    const token = getAuthToken();
    const res = await fetch('/api/admin/report.csv', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'laporan-bulanan-lentera-pustaka.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeAndOverdueLoans = loans.filter((l) => l.status !== 'returned');

  return (
    <div className="space-y-6">
      {/* Workspace Header & Segmented Sub-navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="font-editorial text-2xl font-semibold text-slate-900">
            Dasbor Pengelola Perpustakaan
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Pelaporan statistik bulanan otomatis, manajemen koleksi real-time, dan pengingat Email/WhatsApp.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setSubTab('analytics')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'analytics'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Statistik Bulanan
          </button>
          <button
            type="button"
            onClick={() => setSubTab('catalog')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'catalog'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Koleksi Real-Time ({books.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('reminders')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'reminders'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Notifikasi Email & WA
          </button>
        </div>
      </div>

      {actionMsg && (
        <div
          className={`p-3.5 rounded-lg border text-sm flex items-start gap-2.5 ${
            actionMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {actionMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-700" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-700" />
          )}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* SUBTAB 1: MONTHLY ANALYTICS */}
      {subTab === 'analytics' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="text-xs text-slate-500">
              {loading ? 'Menghitung laporan otomatis...' : 'Data diperbarui otomatis setiap transaksi QR berlangsung.'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadAdminData()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Segarkan</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh Laporan CSV</span>
              </button>
            </div>
          </div>

          {analytics && (
            <>
              {/* 4-column KPI strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs text-slate-500">Total Koleksi Tersedia</div>
                  <div className="text-2xl font-semibold text-slate-900 tabular-nums mt-1">
                    {analytics.summary.available_copies} / {analytics.summary.total_copies}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 tabular-nums">
                    {analytics.summary.total_titles} judul terdaftar
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs text-slate-500">Sirkulasi Bulan Ini</div>
                  <div className="text-2xl font-semibold text-slate-900 tabular-nums mt-1">
                    {analytics.summary.loans_this_month} transaksi
                  </div>
                  <div className="text-xs text-emerald-700 mt-1 tabular-nums">
                    {analytics.summary.on_time_rate}% pengembalian tepat waktu
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs text-slate-500">Pinjaman Terlambat</div>
                  <div className="text-2xl font-semibold text-red-700 tabular-nums mt-1">
                    {analytics.summary.overdue_loans} buku
                  </div>
                  <div className="text-xs text-slate-600 mt-1 tabular-nums">
                    Akumulasi denda {formatRupiah(analytics.summary.total_fines_outstanding)}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs text-slate-500">Pengingat Terkirim (Bulan Ini)</div>
                  <div className="text-2xl font-semibold text-slate-900 tabular-nums mt-1">
                    {analytics.summary.reminders_sent_month} pesan
                  </div>
                  <div className="text-xs text-slate-500 mt-1 tabular-nums">
                    Email & WhatsApp otomatis
                  </div>
                </div>
              </div>

              {/* Chart + Category Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6">
                  <MonthlyChart data={analytics.monthly_series} />
                </div>

                <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <div className="text-sm font-semibold text-slate-900">
                    Sirkulasi per Kategori
                  </div>
                  <div className="space-y-3.5">
                    {analytics.category_breakdown.map((cat) => {
                      const maxLoans = Math.max(
                        1,
                        ...analytics.category_breakdown.map((c) => c.loan_count)
                      );
                      const pct = Math.round((cat.loan_count / maxLoans) * 100);
                      return (
                        <div key={cat.category} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-800 truncate">{cat.category}</span>
                            <span className="font-mono text-slate-600 tabular-nums shrink-0 ml-2">
                              {cat.loan_count} pinjam · {cat.book_count} judul
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#1E3A5F] rounded-full"
                              style={{ width: `${Math.max(8, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Popular Books Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Buku Paling Sering Dipinjam
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-600">
                        <th className="py-2.5 px-6">Judul Buku</th>
                        <th className="py-2.5 px-4">Kategori</th>
                        <th className="py-2.5 px-4 text-right">Total Peminjaman</th>
                        <th className="py-2.5 px-6 text-right">Rating Pembaca</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {analytics.popular_books.map((pb) => (
                        <tr key={pb.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-6">
                            <div className="font-medium text-slate-900">{pb.title}</div>
                            <div className="text-xs text-slate-500">{pb.author}</div>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">{pb.category}</td>
                          <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-900">
                            {pb.loan_count} kali
                          </td>
                          <td className="py-3 px-6 text-right font-mono text-xs tabular-nums text-slate-800">
                            {pb.avg_rating > 0 ? `${pb.avg_rating.toFixed(1)} / 5.0` : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* SUBTAB 2: REAL-TIME COLLECTION MANAGEMENT */}
      {subTab === 'catalog' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Manajemen Koleksi Buku Real-Time
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Setiap penambahan atau perubahan stok langsung tersinkronisasi ke seluruh browser anggota.
              </p>
            </div>
            <button
              type="button"
              onClick={openAddBook}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg whitespace-nowrap shrink-0"
            >
              <BookPlus className="w-4 h-4" />
              <span>Tambah Buku Baru</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-600">
                  <th className="py-3 px-6">Judul & Penulis</th>
                  <th className="py-3 px-4">Kategori</th>
                  <th className="py-3 px-4">Kode QR / Rak</th>
                  <th className="py-3 px-4 text-right">Stok</th>
                  <th className="py-3 px-6 text-right">Kelola</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {books.map((book) => (
                  <tr key={book.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-6">
                      <div className="font-medium text-slate-900">{book.title}</div>
                      <div className="text-xs text-slate-500">
                        {book.author} · ISBN <span className="font-mono">{book.isbn}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">{book.category}</td>
                    <td className="py-3 px-4 text-xs font-mono text-slate-700">
                      <div>{book.qr_code}</div>
                      <div className="text-slate-500">{book.shelf_location}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                      <span
                        className={
                          book.available_copies > 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'
                        }
                      >
                        {book.available_copies}
                      </span>
                      <span className="text-slate-400"> / {book.total_copies}</span>
                    </td>
                    <td className="py-3 px-6 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setQrModalBook(book)}
                          aria-label={`Lihat QR ${book.title}`}
                          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditBook(book)}
                          aria-label={`Ubah ${book.title}`}
                          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBook(book)}
                          aria-label={`Hapus ${book.title}`}
                          className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 3: OVERDUE & EMAIL / WHATSAPP REMINDERS */}
      {subTab === 'reminders' && (
        <div className="space-y-6">
          {/* Gateway configuration status banner */}
          {gatewayStatus && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1 text-xs text-slate-600">
                <div className="text-sm font-semibold text-slate-900">
                  Status Kanal Pengingat Otomatis (Email & WhatsApp)
                </div>
                <div>
                  Email SMTP:{' '}
                  <span className={gatewayStatus.smtp_configured ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                    {gatewayStatus.smtp_configured
                      ? `Terhubung (${gatewayStatus.smtp_from})`
                      : 'Mode Log Lokal (isi SMTP_HOST/USER/PASS di server env untuk kirim SMTP langsung)'}
                  </span>
                </div>
                <div>
                  WhatsApp Gateway:{' '}
                  <span className={gatewayStatus.whatsapp_configured ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                    {gatewayStatus.whatsapp_configured
                      ? 'Terhubung ke Webhook WhatsApp'
                      : 'Mode Log Lokal + Tautan WhatsApp Langsung (isi WHATSAPP_WEBHOOK_URL di server env untuk kirim otomatis)'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={sendingReminders}
                onClick={() => handleTriggerReminders()}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {sendingReminders ? 'Mengirim Pengingat...' : 'Jalankan Pengingat Otomatis Sekarang'}
                </span>
              </button>
            </div>
          )}

          {/* Active & Overdue Loans Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Daftar Pinjaman Aktif & Keterlambatan ({activeAndOverdueLoans.length})
              </h3>
            </div>

            {activeAndOverdueLoans.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Seluruh buku telah dikembalikan. Tidak ada keterlambatan aktif.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-600">
                      <th className="py-3 px-6">Anggota</th>
                      <th className="py-3 px-4">Buku & QR</th>
                      <th className="py-3 px-4">Jatuh Tempo</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-6 text-right">Kirim Pengingat / Kembali</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {activeAndOverdueLoans.map((loan) => {
                      const waText = `[Lentera Pustaka] Halo ${loan.member_name}, pengingat pengembalian buku "${loan.book_title}" (QR: ${loan.loan_qr_code}). Jatuh tempo: ${formatTanggalID(loan.due_date)}.`;
                      return (
                        <tr key={loan.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-6">
                            <div className="font-medium text-slate-900">{loan.member_name}</div>
                            <div className="text-xs text-slate-500 font-mono">
                              {loan.member_email} · {loan.member_phone}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-800">{loan.book_title}</div>
                            <div className="text-xs font-mono text-slate-500">{loan.loan_qr_code}</div>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700 tabular-nums">
                            {formatTanggalID(loan.due_date)}
                          </td>
                          <td className="py-3 px-4 text-xs font-medium">
                            {loan.status === 'overdue' ? (
                              <span className="text-red-700 tabular-nums">
                                Terlambat {loan.overdue_days} hari ({formatRupiah(loan.fine_amount)})
                              </span>
                            ) : (
                              <span className="text-emerald-700">Dipinjam</span>
                            )}
                          </td>
                          <td className="py-3 px-6 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={sendingReminders}
                                onClick={() => handleTriggerReminders(loan.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0"
                              >
                                <Mail className="w-3.5 h-3.5" />
                                <span>Email + WA</span>
                              </button>
                              <a
                                href={buildWhatsAppDirectUrl(loan.member_phone, waText)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap shrink-0"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                <span>WA Web</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <button
                                type="button"
                                onClick={() => handleMarkReturnedByAdmin(loan)}
                                className="px-2.5 py-1.5 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-md whitespace-nowrap shrink-0"
                              >
                                Terima Kembali
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Reminder Audit Log */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-900">
                Log Pengiriman Pengingat Email & WhatsApp
              </h3>
            </div>
            <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto">
              {reminderLogs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  Belum ada riwayat pengiriman pengingat.
                </div>
              ) : (
                reminderLogs.map((log) => (
                  <div key={log.id} className="px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="space-y-0.5 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2 text-slate-500">
                        <span className="font-semibold text-slate-800 uppercase">
                          {log.channel}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-700">{log.recipient}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{formatWaktuID(log.created_at)}</span>
                      </div>
                      <div className="font-medium text-slate-900">{log.subject}</div>
                      <div className="text-slate-600 line-clamp-2">{log.message}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`font-medium ${
                          log.status === 'sent'
                            ? 'text-emerald-700'
                            : log.status === 'failed'
                              ? 'text-red-700'
                              : 'text-slate-700'
                        }`}
                      >
                        {log.status === 'sent'
                          ? 'Terkirim'
                          : log.status === 'failed'
                            ? 'Gagal'
                            : 'Tercatat di Log'}
                      </span>
                      <div className="text-[11px] text-slate-400 mt-0.5 max-w-[220px] truncate">
                        {log.gateway_detail}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Book Modal */}
      {showBookModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-editorial text-xl font-semibold text-slate-900">
                {editingBook ? 'Ubah Data Buku' : 'Tambah Koleksi Buku Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setShowBookModal(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBook} className="p-6 space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Judul Buku</label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Penulis</label>
                  <input
                    type="text"
                    required
                    value={formAuthor}
                    onChange={(e) => setFormAuthor(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">ISBN</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingBook)}
                    value={formIsbn}
                    onChange={(e) => setFormIsbn(e.target.value)}
                    placeholder="978-602-..."
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kategori</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as BookCategory)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Penerbit</label>
                  <input
                    type="text"
                    required
                    value={formPublisher}
                    onChange={(e) => setFormPublisher(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tahun</label>
                  <input
                    type="number"
                    required
                    min={1900}
                    max={2100}
                    value={formYear}
                    onChange={(e) => setFormYear(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Lokasi Rak</label>
                  <input
                    type="text"
                    required
                    value={formShelf}
                    onChange={(e) => setFormShelf(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Eksemplar</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={500}
                    value={formCopies}
                    onChange={(e) => setFormCopies(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sinopsis</label>
                <textarea
                  rows={3}
                  required
                  value={formSynopsis}
                  onChange={(e) => setFormSynopsis(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBookModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg"
                >
                  {formSaving ? 'Menyimpan...' : 'Simpan Koleksi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Book QR Label Modal */}
      {qrModalBook && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6 space-y-4 text-center shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Label QR Buku</h3>
              <button
                type="button"
                onClick={() => setQrModalBook(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm font-medium text-slate-800">{qrModalBook.title}</div>
            <QrCodeDisplay
              value={qrModalBook.qr_code}
              label={`${qrModalBook.shelf_location} · ISBN ${qrModalBook.isbn}`}
              size={180}
            />
          </div>
        </div>
      )}
    </div>
  );
}
