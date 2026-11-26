import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Mail, MessageCircle, QrCode } from 'lucide-react';
import type { Loan, ReminderLog, UserProfile } from '../types';
import { apiRequest, formatRupiah, formatTanggalID, formatWaktuID } from '../lib/api';
import { QrCodeDisplay } from './QrCodeDisplay';

interface MemberLoansViewProps {
  user: UserProfile | null;
  loans: Loan[];
  notifications: ReminderLog[];
  onRequireAuth: () => void;
  onActionSuccess: () => void;
}

export function MemberLoansView({
  user,
  loans,
  notifications,
  onRequireAuth,
  onActionSuccess,
}: MemberLoansViewProps) {
  const [selectedTicketQr, setSelectedTicketQr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto space-y-4">
        <h2 className="font-editorial text-2xl font-semibold text-slate-900">
          Pinjaman & Notifikasi Keterlambatan
        </h2>
        <p className="text-sm text-slate-600">
          Masuk atau daftar sebagai anggota untuk memantau status pinjaman buku, tiket QR pengembalian, serta kotak pengingat otomatis Email & WhatsApp Anda.
        </p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="px-5 py-2.5 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors"
        >
          Masuk / Daftar Anggota
        </button>
      </div>
    );
  }

  const overdueLoans = loans.filter((l) => l.status === 'overdue');
  const activeLoans = loans.filter((l) => l.status !== 'returned');
  const historyLoans = loans.filter((l) => l.status === 'returned');

  async function handleReturnLoan(loan: Loan) {
    setBusyId(loan.id);
    try {
      await apiRequest('/api/loans/return', {
        method: 'POST',
        body: JSON.stringify({ qr_code: loan.loan_qr_code }),
      });
      onActionSuccess();
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkRead(id: string) {
    await apiRequest(`/api/notifications/${id}/read`, { method: 'POST' });
    onActionSuccess();
  }

  return (
    <div className="space-y-8">
      {/* Overdue Alert Banner (Color + Icon + Clear Text) */}
      {overdueLoans.length > 0 && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-950">
                Terdapat {overdueLoans.length} pinjaman melewati batas waktu pengembalian
              </div>
              <div className="text-xs text-red-800 mt-0.5">
                Pengingat otomatis telah dikirim ke {user.email} dan WhatsApp {user.phone}. Mohon segera kembalikan buku agar denda tidak bertambah.
              </div>
            </div>
          </div>
          <div className="font-mono text-sm font-semibold text-red-900 tabular-nums shrink-0">
            Total Denda: {formatRupiah(overdueLoans.reduce((sum, l) => sum + l.fine_amount, 0))}
          </div>
        </div>
      )}

      {/* Active Loans Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Pinjaman Aktif Anda</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kartu Anggota <span className="font-mono text-slate-700">{user.member_code}</span>
            </p>
          </div>
          <span className="text-xs text-slate-600 tabular-nums">
            {activeLoans.length} buku sedang dipinjam
          </span>
        </div>

        {activeLoans.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Anda tidak memiliki pinjaman buku aktif saat ini. Jelajahi katalog atau pindai QR buku untuk meminjam.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-600">
                  <th className="py-3 px-6">Judul Buku</th>
                  <th className="py-3 px-4">Tiket QR</th>
                  <th className="py-3 px-4">Jatuh Tempo</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Denda</th>
                  <th className="py-3 px-6 text-right">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {activeLoans.map((loan) => (
                  <tr key={loan.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-6">
                      <div className="font-medium text-slate-900">{loan.book_title}</div>
                      <div className="text-xs text-slate-500">{loan.book_author} · {loan.book_shelf}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-700 tabular-nums">
                      {loan.loan_qr_code}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700 tabular-nums">
                      {formatTanggalID(loan.due_date)}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium">
                      {loan.status === 'overdue' ? (
                        <span className="inline-flex items-center gap-1.5 text-red-700">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Terlambat {loan.overdue_days} hari</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Aktif</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums text-slate-900">
                      {loan.fine_amount > 0 ? formatRupiah(loan.fine_amount) : 'Rp 0'}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedTicketQr(
                              selectedTicketQr === loan.loan_qr_code ? null : loan.loan_qr_code
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>Tiket QR</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === loan.id}
                          onClick={() => handleReturnLoan(loan)}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
                        >
                          {busyId === loan.id ? 'Memproses...' : 'Kembalikan'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedTicketQr && (
          <div className="p-6 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center gap-6">
            <QrCodeDisplay
              value={selectedTicketQr}
              label="Tunjukkan ke petugas atau pindai untuk pengembalian"
              size={140}
            />
            <div className="text-sm text-slate-700 space-y-1.5">
              <div className="font-semibold text-slate-900">Tiket Sirkulasi QR Code</div>
              <p className="text-xs text-slate-600 max-w-md">
                Unduh atau tampilkan kode QR ini saat mengembalikan buku di meja perpustakaan maupun melalui menu Pindai QR mandiri.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Automated Email & WhatsApp Reminder Inbox */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Riwayat Pengingat Email & WhatsApp
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Notifikasi pengembalian otomatis yang dikirim ke {user.email} dan {user.phone}
            </p>
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada notifikasi pengingat yang dikirim untuk akun Anda.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                className={`p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
                  notif.is_read ? 'bg-white' : 'bg-slate-50/80'
                }`}
              >
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                      {notif.channel === 'email' ? (
                        <Mail className="w-3.5 h-3.5 text-[#1E3A5F]" />
                      ) : (
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                      )}
                      {notif.channel === 'email' ? 'Email' : 'WhatsApp'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{notif.recipient}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatWaktuID(notif.created_at)}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{notif.subject}</div>
                  <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                    {notif.message}
                  </p>
                </div>

                {!notif.is_read && (
                  <button
                    type="button"
                    onClick={() => handleMarkRead(notif.id)}
                    className="self-start px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md whitespace-nowrap shrink-0"
                  >
                    Tandai Dibaca
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Loan History */}
      {historyLoans.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">Riwayat Pengembalian</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-6">Judul Buku</th>
                  <th className="py-2.5 px-4">Tanggal Pinjam</th>
                  <th className="py-2.5 px-4">Tanggal Kembali</th>
                  <th className="py-2.5 px-6 text-right">Denda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {historyLoans.map((h) => (
                  <tr key={h.id}>
                    <td className="py-3 px-6 font-medium text-slate-800">{h.book_title}</td>
                    <td className="py-3 px-4 text-xs text-slate-600 tabular-nums">
                      {formatTanggalID(h.borrowed_at)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 tabular-nums">
                      {h.returned_at ? formatTanggalID(h.returned_at) : '-'}
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-xs tabular-nums text-slate-700">
                      {formatRupiah(h.fine_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
