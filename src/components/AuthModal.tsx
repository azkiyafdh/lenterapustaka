import { useEffect, useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import type { AuthStatus, UserProfile } from '../types';
import { apiRequest, setAuthToken } from '../lib/api';

interface AuthModalProps {
  initialMode?: 'login' | 'register' | 'claim_librarian';
  onClose: () => void;
  onAuthenticated: (user: UserProfile) => void;
}

export function AuthModal({
  initialMode = 'login',
  onClose,
  onAuthenticated,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'claim_librarian'>(initialMode);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<AuthStatus>('/api/auth/status')
      .then(setAuthStatus)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let res: { token: string; user: UserProfile };
      if (mode === 'login') {
        res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
      } else if (mode === 'register') {
        res = await apiRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, phone, password }),
        });
      } else {
        res = await apiRequest('/api/auth/claim-librarian', {
          method: 'POST',
          body: JSON.stringify({ name, email, phone, password, passcode }),
        });
      }
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Autentikasi gagal.');
    } finally {
      setBusy(false);
    }
  }

  const canClaimLibrarian =
    authStatus && (!authStatus.hasLibrarian || authStatus.envPasscodeConfigured);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="auth-modal-title" className="font-editorial text-xl font-semibold text-slate-900">
            {mode === 'login'
              ? 'Masuk ke Lentera Pustaka'
              : mode === 'register'
                ? 'Daftar Anggota Perpustakaan'
                : 'Aktivasi Akun Petugas'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup jendela masuk"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Segmented Mode Switcher */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 px-2 rounded-md transition-colors whitespace-nowrap ${
                mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-2 px-2 rounded-md transition-colors whitespace-nowrap ${
                mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daftar Anggota
            </button>
            {canClaimLibrarian && (
              <button
                type="button"
                onClick={() => {
                  setMode('claim_librarian');
                  setError(null);
                }}
                className={`flex-1 py-2 px-2 rounded-md transition-colors whitespace-nowrap ${
                  mode === 'claim_librarian'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Aktivasi Petugas
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-xs text-red-900">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-700 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'claim_librarian' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 leading-relaxed">
              {authStatus?.envPasscodeConfigured
                ? 'Masukkan kode otorisasi petugas dari konfigurasi server untuk mendaftarkan akun pengelola baru.'
                : 'Belum ada petugas terdaftar di sistem. Buat akun petugas pengelola pertama untuk mengakses dasbor statistik bulanan dan manajemen koleksi.'}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== 'login' && (
              <div>
                <label htmlFor="auth-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Lengkap
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Aulia Pratama"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 mb-1">
                Alamat Email (untuk pengingat otomatis)
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            {mode !== 'login' && (
              <div>
                <label htmlFor="auth-phone" className="block text-xs font-medium text-slate-700 mb-1">
                  Nomor WhatsApp Aktif
                </label>
                <input
                  id="auth-phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+6281234567890"
                  className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700 mb-1">
                Kata Sandi
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
              />
            </div>

            {mode === 'claim_librarian' && authStatus?.envPasscodeConfigured && (
              <div>
                <label htmlFor="auth-passcode" className="block text-xs font-medium text-slate-700 mb-1">
                  Kode Otorisasi Petugas
                </label>
                <input
                  id="auth-passcode"
                  type="password"
                  required
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Masukkan kode otorisasi server"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] disabled:opacity-50 rounded-lg transition-colors"
            >
              {busy
                ? 'Memproses...'
                : mode === 'login'
                  ? 'Masuk'
                  : mode === 'register'
                    ? 'Buat Akun Anggota'
                    : 'Aktifkan Akun Petugas'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
