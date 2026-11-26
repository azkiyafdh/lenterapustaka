import { useEffect, useState } from 'react';
import { MessageSquare, Send, Star, ThumbsUp, X, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Book, Loan, Review, UserProfile } from '../types';
import { apiRequest, formatTanggalID } from '../lib/api';
import { BookCover } from './BookCover';
import { QrCodeDisplay } from './QrCodeDisplay';

interface BookDetailModalProps {
  book: Book;
  user: UserProfile | null;
  myLoans: Loan[];
  onClose: () => void;
  onRequireAuth: () => void;
  onChanged: () => void;
  wsTick: number;
}

export function BookDetailModal({
  book,
  user,
  myLoans,
  onClose,
  onRequireAuth,
  onChanged,
  wsTick,
}: BookDetailModalProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const [loanMode, setLoanMode] = useState<'standard_7' | 'standard_14' | 'test_due_soon' | 'test_overdue'>('standard_7');
  const [borrowBusy, setBorrowBusy] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const activeLoan = myLoans.find((l) => l.book_id === book.id && l.status !== 'returned');

  useEffect(() => {
    let mounted = true;
    setLoadingReviews(true);
    apiRequest<{ reviews: Review[] }>(`/api/books/${book.id}/reviews`)
      .then((res) => {
        if (mounted) setReviews(res.reviews);
      })
      .catch(() => {
        if (mounted) setReviews([]);
      })
      .finally(() => {
        if (mounted) setLoadingReviews(false);
      });
    return () => {
      mounted = false;
    };
  }, [book.id, wsTick]);

  async function handleBorrow() {
    if (!user) {
      onRequireAuth();
      return;
    }
    setBorrowBusy(true);
    setActionBanner(null);
    try {
      const res = await apiRequest<{ loan: Loan }>('/api/loans/borrow', {
        method: 'POST',
        body: JSON.stringify({ qr_code: book.qr_code, loan_mode: loanMode }),
      });
      setActionBanner({
        type: 'success',
        text: `Buku dipinjam dengan kode tiket ${res.loan.loan_qr_code}. Jatuh tempo ${formatTanggalID(res.loan.due_date)}.`,
      });
      onChanged();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal meminjam buku.',
      });
    } finally {
      setBorrowBusy(false);
    }
  }

  async function handleReturn() {
    if (!activeLoan) return;
    setBorrowBusy(true);
    setActionBanner(null);
    try {
      await apiRequest('/api/loans/return', {
        method: 'POST',
        body: JSON.stringify({ qr_code: activeLoan.loan_qr_code }),
      });
      setActionBanner({
        type: 'success',
        text: 'Buku berhasil dikembalikan dan stok katalog diperbarui secara real-time.',
      });
      onChanged();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mengembalikan buku.',
      });
    } finally {
      setBorrowBusy(false);
    }
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    if (comment.trim().length < 4) {
      setActionBanner({ type: 'error', text: 'Tuliskan ulasan minimal 4 karakter.' });
      return;
    }
    setSubmittingReview(true);
    setActionBanner(null);
    try {
      const res = await apiRequest<{ reviews: Review[] }>(`/api/books/${book.id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment: comment.trim() }),
      });
      setReviews(res.reviews);
      setComment('');
      setRating(5);
      onChanged();
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mengirim ulasan.',
      });
    } finally {
      setSubmittingReview(false);
    }
  }

  async function handleSubmitReply(reviewId: string) {
    if (!user) {
      onRequireAuth();
      return;
    }
    const text = (replyDrafts[reviewId] || '').trim();
    if (text.length < 2) return;
    try {
      const res = await apiRequest<{ reviews: Review[] }>(`/api/reviews/${reviewId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ reply_text: text }),
      });
      setReviews(res.reviews);
      setReplyDrafts((prev) => ({ ...prev, [reviewId]: '' }));
      setOpenReplyId(null);
    } catch (err) {
      setActionBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal mengirim balasan.',
      });
    }
  }

  async function handleHelpful(reviewId: string) {
    if (!user) {
      onRequireAuth();
      return;
    }
    try {
      const res = await apiRequest<{ reviews: Review[] }>(`/api/reviews/${reviewId}/helpful`, {
        method: 'POST',
      });
      setReviews(res.reviews);
    } catch {
      // silent
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-detail-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-4">
          <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
            <span>{book.category}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{book.isbn}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{book.shelf_location}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup detail buku"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          {actionBanner && (
            <div
              className={`p-3.5 rounded-lg border text-sm flex items-start gap-2.5 ${
                actionBanner.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {actionBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-700" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-700" />
              )}
              <span>{actionBanner.text}</span>
            </div>
          )}

          {/* Book Overview Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-4 space-y-4 flex flex-col items-center md:items-stretch">
              <BookCover book={book} className="w-48 md:w-full aspect-[3/4] rounded-lg border border-slate-200" />
              <div className="flex justify-center">
                <QrCodeDisplay value={book.qr_code} label="Pindai untuk pinjam buku" size={128} />
              </div>
            </div>

            <div className="md:col-span-8 space-y-5">
              <div>
                <h2 id="book-detail-title" className="font-editorial text-2xl sm:text-3xl font-semibold text-slate-900">
                  {book.title}
                </h2>
                <div className="text-sm text-slate-600 mt-1.5 flex flex-wrap items-center gap-2">
                  <span>{book.author}</span>
                  <span aria-hidden="true">·</span>
                  <span>{book.publisher}, {book.year}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-slate-800 font-medium tabular-nums">
                    <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                    {book.avg_rating > 0 ? book.avg_rating.toFixed(1) : 'Belum ada rating'} ({reviews.length} ulasan)
                  </span>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-slate-700">{book.synopsis}</p>

              <div className="grid grid-cols-3 gap-4 py-3.5 border-y border-slate-200 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Ketersediaan</div>
                  <div
                    className={`font-semibold tabular-nums mt-0.5 ${
                      book.available_copies > 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {book.available_copies} / {book.total_copies} eksemplar
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Lokasi Rak</div>
                  <div className="font-mono font-medium text-slate-900 mt-0.5">{book.shelf_location}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Kode QR Buku</div>
                  <div className="font-mono font-medium text-slate-900 mt-0.5">{book.qr_code}</div>
                </div>
              </div>

              {/* Borrow / Return Controls */}
              {activeLoan ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Sedang Anda Pinjam ({activeLoan.loan_qr_code})
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5 tabular-nums">
                        Jatuh tempo: {formatTanggalID(activeLoan.due_date)}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={borrowBusy}
                      onClick={handleReturn}
                      className="px-4 py-2 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      {borrowBusy ? 'Memproses...' : 'Kembalikan Buku'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                  <div className="flex-1">
                    <label htmlFor="detail-loan-mode" className="block text-xs font-medium text-slate-700 mb-1">
                      Durasi Peminjaman QR
                    </label>
                    <select
                      id="detail-loan-mode"
                      value={loanMode}
                      onChange={(e) => setLoanMode(e.target.value as typeof loanMode)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                    >
                      <option value="standard_7">Reguler (7 Hari)</option>
                      <option value="standard_14">Riset & Studi (14 Hari)</option>
                      <option value="test_due_soon">Simulasi Pengingat (12 Jam)</option>
                      <option value="test_overdue">Simulasi Keterlambatan (Tes Email & WA)</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={borrowBusy || book.available_copies < 1}
                    onClick={handleBorrow}
                    className="px-5 py-2.5 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {!user
                      ? 'Masuk untuk Pinjam'
                      : book.available_copies < 1
                        ? 'Stok Habis'
                        : borrowBusy
                          ? 'Memproses...'
                          : 'Pinjam via QR'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Reader Reviews & Interactive Discussion */}
          <div className="pt-6 border-t border-slate-200 space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Ulasan & Diskusi Pembaca</h3>
              <p className="text-sm text-slate-600 mt-0.5">
                Bagikan kesan bacaan Anda dan berdiskusi langsung dengan anggota perpustakaan lain.
              </p>
            </div>

            {/* Write Review Form */}
            <form onSubmit={handleSubmitReview} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">Tulis Ulasan Anda</span>
                <div className="flex items-center gap-1" role="group" aria-label="Pilih rating bintang">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      aria-label={`Beri rating ${star} bintang`}
                      className="p-1 rounded hover:bg-slate-200/70 transition-colors"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          star <= rating ? 'fill-amber-500 text-amber-500' : 'text-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  user
                    ? 'Bagaimana pendapat Anda mengenai isi, gaya penulisan, atau relevansi buku ini?'
                    : 'Silakan masuk sebagai anggota untuk menulis ulasan dan berdiskusi.'
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submittingReview}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{user ? (submittingReview ? 'Mengirim...' : 'Kirim Ulasan') : 'Masuk & Ulas'}</span>
                </button>
              </div>
            </form>

            {/* Reviews List */}
            {loadingReviews ? (
              <div className="text-sm text-slate-500 py-4">Memuat ulasan pembaca...</div>
            ) : reviews.length === 0 ? (
              <div className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                Belum ada ulasan untuk buku ini. Jadilah pembaca pertama yang memulai diskusi.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {reviews.map((rev) => (
                  <div key={rev.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-slate-900">{rev.user_name}</span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-xs text-slate-500">
                          {rev.user_role === 'librarian' ? 'Petugas' : 'Anggota'}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-xs text-slate-500 tabular-nums">{formatTanggalID(rev.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-0.5" aria-label={`Rating ${rev.rating} dari 5`}>
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`w-3.5 h-3.5 ${
                              s <= rev.rating ? 'fill-amber-500 text-amber-500' : 'text-slate-200'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <p className="text-sm text-slate-700 leading-relaxed">{rev.comment}</p>

                    <div className="flex items-center gap-4 text-xs text-slate-600">
                      <button
                        type="button"
                        onClick={() => handleHelpful(rev.id)}
                        className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span className="tabular-nums">Membantu ({rev.helpful_count})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenReplyId(openReplyId === rev.id ? null : rev.id)}
                        className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="tabular-nums">Balas ({rev.replies.length})</span>
                      </button>
                    </div>

                    {/* Replies */}
                    {rev.replies.length > 0 && (
                      <div className="ml-6 pl-4 border-l border-slate-200 space-y-2.5 pt-1">
                        {rev.replies.map((rep) => (
                          <div key={rep.id} className="text-sm space-y-0.5">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-semibold text-slate-800">{rep.user_name}</span>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">{formatTanggalID(rep.created_at)}</span>
                            </div>
                            <p className="text-slate-700 text-sm">{rep.reply_text}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {openReplyId === rev.id && (
                      <div className="ml-6 flex gap-2 pt-1">
                        <input
                          type="text"
                          value={replyDrafts[rev.id] || ''}
                          onChange={(e) =>
                            setReplyDrafts((prev) => ({ ...prev, [rev.id]: e.target.value }))
                          }
                          placeholder="Tulis tanggapan untuk pembaca ini..."
                          className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                        />
                        <button
                          type="button"
                          onClick={() => handleSubmitReply(rev.id)}
                          className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg whitespace-nowrap shrink-0"
                        >
                          Kirim Balasan
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
