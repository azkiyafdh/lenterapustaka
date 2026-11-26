import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, QrCode, Upload, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Book, Loan, UserProfile } from '../types';
import { apiRequest, formatRupiah, formatTanggalID } from '../lib/api';
import { QrCodeDisplay } from './QrCodeDisplay';

interface QrScannerPanelProps {
  user: UserProfile | null;
  books: Book[];
  myLoans: Loan[];
  onRequireAuth: () => void;
  onActionSuccess: () => void;
}

export function QrScannerPanel({
  user,
  books,
  myLoans,
  onRequireAuth,
  onActionSuccess,
}: QrScannerPanelProps) {
  const [codeInput, setCodeInput] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<{ book: Book | null; loan: Loan | null } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [loanMode, setLoanMode] = useState<'standard_7' | 'standard_14' | 'test_due_soon' | 'test_overdue'>('standard_7');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string; createdLoan?: Loan } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  function stopCamera() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  async function startCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
          scanVideoFrame();
        }
      });
    } catch {
      setCameraError(
        'Kamera tidak tersedia atau izin kamera ditolak. Anda dapat mengunggah gambar QR atau memilih/mengetik kode QR secara langsung.'
      );
      setCameraActive(false);
    }
  }

  function scanVideoFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height);
        if (qr?.data) {
          stopCamera();
          setCodeInput(qr.data);
          void performLookup(qr.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanVideoFrame);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLookupError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(imageData.data, imageData.width, imageData.height);
        if (qr?.data) {
          setCodeInput(qr.data);
          void performLookup(qr.data);
        } else {
          setLookupError('Gambar tidak mengandung kode QR yang terbaca.');
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function performLookup(code: string) {
    const clean = code.trim();
    if (!clean) return;
    setLookupError(null);
    setFeedback(null);
    try {
      const data = await apiRequest<{ book: Book | null; loan: Loan | null }>(
        `/api/books/lookup?code=${encodeURIComponent(clean)}`
      );
      setLookupResult(data);
    } catch (err) {
      setLookupResult(null);
      setLookupError(err instanceof Error ? err.message : 'Kode QR tidak ditemukan.');
    }
  }

  async function handleBorrow() {
    if (!user) {
      onRequireAuth();
      return;
    }
    if (!lookupResult?.book) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ loan: Loan }>('/api/loans/borrow', {
        method: 'POST',
        body: JSON.stringify({
          qr_code: lookupResult.book.qr_code,
          loan_mode: loanMode,
        }),
      });
      setFeedback({
        type: 'success',
        text: `Berhasil meminjam "${res.loan.book_title}". Simpan tiket QR peminjaman di bawah ini.`,
        createdLoan: res.loan,
      });
      onActionSuccess();
      void performLookup(lookupResult.book.qr_code);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memproses peminjaman.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn(targetQr: string) {
    if (!user) {
      onRequireAuth();
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ loan: Loan }>('/api/loans/return', {
        method: 'POST',
        body: JSON.stringify({ qr_code: targetQr }),
      });
      setFeedback({
        type: 'success',
        text:
          res.loan.fine_amount > 0
            ? `Buku "${res.loan.book_title}" telah dikembalikan dengan catatan denda keterlambatan ${formatRupiah(res.loan.fine_amount)}.`
            : `Buku "${res.loan.book_title}" telah dikembalikan tepat waktu. Terima kasih!`,
      });
      onActionSuccess();
      void performLookup(targetQr);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Gagal memproses pengembalian.',
      });
    } finally {
      setBusy(false);
    }
  }

  const userActiveLoanForBook = lookupResult?.book
    ? myLoans.find((l) => l.book_id === lookupResult.book!.id && l.status !== 'returned')
    : undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left: Camera & Manual QR Scanner */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Pemindai QR Sirkulasi</h2>
            <p className="text-sm text-slate-600 mt-1">
              Pindai kode QR pada sampul buku untuk meminjam, atau pindai QR tiket pinjaman untuk mengembalikan.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {cameraActive ? (
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <CameraOff className="w-4 h-4" />
                <span>Matikan Kamera</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Camera className="w-4 h-4" />
                <span>Aktifkan Kamera</span>
              </button>
            )}
            <label className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
              <Upload className="w-4 h-4" />
              <span>Unggah Gambar QR</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {cameraActive && (
          <div className="relative bg-slate-950 rounded-lg overflow-hidden aspect-video flex items-center justify-center">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-52 h-52 border-2 border-white/80 rounded-xl shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {cameraError && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
            {cameraError}
          </div>
        )}

        {/* Direct QR code entry */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void performLookup(codeInput);
          }}
          className="space-y-2"
        >
          <label htmlFor="qr-manual-input" className="block text-sm font-medium text-slate-700">
            Atau masukkan Kode QR Buku / Tiket Pinjaman
          </label>
          <div className="flex gap-2">
            <input
              id="qr-manual-input"
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Contoh: LIB-BK-001 atau LOAN-2026-12345"
              className="flex-1 min-w-0 px-3.5 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>Periksa QR</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        {/* Quick pick sample QR codes from live catalog */}
        <div className="pt-4 border-t border-slate-100">
          <div className="text-xs font-medium text-slate-500 mb-2.5">
            Pilih cepat QR Buku dari koleksi aktif:
          </div>
          <div className="flex flex-wrap gap-2">
            {books.slice(0, 6).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setCodeInput(b.qr_code);
                  void performLookup(b.qr_code);
                }}
                className="px-3 py-1.5 text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md text-slate-700 transition-colors text-left"
              >
                <span className="font-mono font-medium text-slate-900">{b.qr_code}</span>
                <span className="text-slate-400 mx-1.5">·</span>
                <span className="truncate max-w-[160px] inline-block align-bottom">{b.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Scan Result & Borrow / Return Action */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2 text-slate-900">
          <QrCode className="w-5 h-5 text-[#1E3A5F]" />
          <h3 className="text-base font-semibold">Hasil Pemindaian & Transaksi</h3>
        </div>

        {lookupError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-sm text-red-900">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-700" />
            <span>{lookupError}</span>
          </div>
        )}

        {feedback && (
          <div
            className={`p-4 rounded-lg border text-sm space-y-3 ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-700" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-700" />
              )}
              <span>{feedback.text}</span>
            </div>
            {feedback.createdLoan && (
              <div className="pt-2 flex justify-center">
                <QrCodeDisplay
                  value={feedback.createdLoan.loan_qr_code}
                  label={`Jatuh tempo ${formatTanggalID(feedback.createdLoan.due_date)}`}
                  size={132}
                />
              </div>
            )}
          </div>
        )}

        {!lookupResult && !lookupError && (
          <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg px-4">
            Arahkan kamera ke kode QR buku atau pilih salah satu kode QR koleksi di sebelah kiri untuk memulai peminjaman atau pengembalian.
          </div>
        )}

        {lookupResult?.loan && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="text-xs font-mono text-slate-500">{lookupResult.loan.loan_qr_code}</div>
              <div className="font-editorial text-lg font-semibold text-slate-900">
                {lookupResult.loan.book_title}
              </div>
              <div className="text-xs text-slate-600">
                Peminjam: {lookupResult.loan.member_name} ({lookupResult.loan.member_code})
              </div>
              <div className="text-xs text-slate-600 tabular-nums">
                Jatuh tempo: {formatTanggalID(lookupResult.loan.due_date)}
                {lookupResult.loan.overdue_days > 0 && (
                  <span className="text-red-700 font-medium ml-2">
                    · Terlambat {lookupResult.loan.overdue_days} hari ({formatRupiah(lookupResult.loan.fine_amount)})
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleReturn(lookupResult.loan!.loan_qr_code)}
              className="w-full py-2.5 px-4 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg transition-colors"
            >
              {busy ? 'Memproses...' : 'Konfirmasi Pengembalian Buku'}
            </button>
          </div>
        )}

        {lookupResult?.book && !lookupResult.loan && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 font-mono">
                <span>{lookupResult.book.qr_code}</span>
                <span>{lookupResult.book.shelf_location}</span>
              </div>
              <div className="font-editorial text-lg font-semibold text-slate-900">
                {lookupResult.book.title}
              </div>
              <div className="text-sm text-slate-600">{lookupResult.book.author}</div>
              <div className="text-xs text-slate-600 tabular-nums pt-1">
                Ketersediaan:{' '}
                <span
                  className={
                    lookupResult.book.available_copies > 0
                      ? 'font-semibold text-emerald-700'
                      : 'font-semibold text-red-700'
                  }
                >
                  {lookupResult.book.available_copies} dari {lookupResult.book.total_copies} eksemplar
                </span>
              </div>
            </div>

            {userActiveLoanForBook ? (
              <div className="space-y-3">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                  Anda sedang meminjam buku ini (Tiket{' '}
                  <span className="font-mono font-medium">{userActiveLoanForBook.loan_qr_code}</span>).
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleReturn(userActiveLoanForBook.loan_qr_code)}
                  className="w-full py-2.5 px-4 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {busy ? 'Memproses...' : 'Kembalikan Buku Sekarang'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label htmlFor="loan-duration-select" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Durasi & Mode Peminjaman
                  </label>
                  <select
                    id="loan-duration-select"
                    value={loanMode}
                    onChange={(e) => setLoanMode(e.target.value as typeof loanMode)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                  >
                    <option value="standard_7">Reguler — 7 Hari</option>
                    <option value="standard_14">Ekstensi Riset — 14 Hari</option>
                    <option value="test_due_soon">Simulasi Pengingat — Jatuh Tempo 12 Jam</option>
                    <option value="test_overdue">Simulasi Keterlambatan — Terlambat 2 Hari (Tes Notifikasi)</option>
                  </select>
                </div>

                <button
                  type="button"
                  disabled={busy || lookupResult.book.available_copies < 1}
                  onClick={handleBorrow}
                  className="w-full py-2.5 px-4 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg transition-colors"
                >
                  {!user
                    ? 'Masuk untuk Meminjam via QR'
                    : lookupResult.book.available_copies < 1
                      ? 'Stok Sedang Habis'
                      : busy
                        ? 'Memproses...'
                        : 'Pinjam Buku dengan QR'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
