import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, QrCode, Search, Star } from 'lucide-react';
import type { Book, BookCategory, Loan, ReminderLog, UserProfile } from './types';
import { apiRequest, setAuthToken } from './lib/api';
import { BookCover } from './components/BookCover';
import { BookDetailModal } from './components/BookDetailModal';
import { QrScannerPanel } from './components/QrScannerPanel';
import { MemberLoansView } from './components/MemberLoansView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { AuthModal } from './components/AuthModal';

type AppTab = 'catalog' | 'scanner' | 'loans' | 'admin';

const CATEGORIES: ('Semua' | BookCategory)[] = [
  'Semua',
  'Sejarah & Budaya',
  'Teknologi & Rekayasa',
  'Sains & Alam',
  'Desain & Arsitektur',
  'Sastra & Fiksi',
  'Ekonomi & Bisnis',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('catalog');
  const [books, setBooks] = useState<Book[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'Semua' | BookCategory>('Semua');
  const [sortBy, setSortBy] = useState<'newest' | 'rating' | 'popular'>('newest');

  const [user, setUser] = useState<UserProfile | null>(null);
  const [myLoans, setMyLoans] = useState<Loan[]>([]);
  const [myNotifications, setMyNotifications] = useState<ReminderLog[]>([]);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | 'claim_librarian' | null>(null);
  const [wsTick, setWsTick] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);

  const fetchBooks = useCallback(async () => {
    try {
      const res = await apiRequest<{ books: Book[] }>('/api/books');
      setBooks(res.books);
    } catch {
      // handled gracefully by empty/retry UI
    } finally {
      setLoadingBooks(false);
    }
  }, []);

  const fetchMemberData = useCallback(async (activeUser: UserProfile | null) => {
    if (!activeUser) {
      setMyLoans([]);
      setMyNotifications([]);
      return;
    }
    try {
      const [loansRes, notifRes] = await Promise.all([
        apiRequest<{ loans: Loan[] }>('/api/loans/my'),
        apiRequest<{ notifications: ReminderLog[] }>('/api/notifications/my'),
      ]);
      setMyLoans(loansRes.loans);
      setMyNotifications(notifRes.notifications);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void fetchBooks();
  }, [fetchBooks]);

  useEffect(() => {
    void fetchMemberData(user);
  }, [user, fetchMemberData, wsTick]);

  // Real-time WebSocket synchronization
  useEffect(() => {
    let closedByCleanup = false;
    let reconnectTimer: number | undefined;

    function connectWs() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = socket;

      socket.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as { event?: string };
          if (
            msg.event === 'books:updated' ||
            msg.event === 'loans:updated' ||
            msg.event === 'reviews:updated' ||
            msg.event === 'notifications:updated' ||
            msg.event === 'stats:updated'
          ) {
            void fetchBooks();
            setWsTick((t) => t + 1);
          }
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connectWs, 3000);
        }
      };
    }

    connectWs();
    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [fetchBooks]);

  const filteredBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = books.filter((b) => {
      const matchesCat = selectedCategory === 'Semua' || b.category === selectedCategory;
      const matchesQuery =
        !q ||
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.qr_code.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });

    if (sortBy === 'rating') {
      return [...list].sort((a, b) => b.avg_rating - a.avg_rating || b.review_count - a.review_count);
    }
    if (sortBy === 'popular') {
      return [...list].sort((a, b) => b.active_loan_count - a.active_loan_count || b.review_count - a.review_count);
    }
    return list;
  }, [books, searchQuery, selectedCategory, sortBy]);

  const selectedBook = useMemo(
    () => books.find((b) => b.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );

  const overdueCount = myLoans.filter((l) => l.status === 'overdue').length;
  const unreadNotifCount = myNotifications.filter((n) => !n.is_read).length;
  const memberAlertCount = overdueCount + unreadNotifCount;

  function handleLogout() {
    setAuthToken(null);
    setUser(null);
    setMyLoans([]);
    setMyNotifications([]);
    if (activeTab === 'admin') {
      setActiveTab('catalog');
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F9FA] text-slate-900">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className="font-editorial text-xl font-semibold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#1E3A5F] rounded"
          >
            Lentera Pustaka
          </button>

          {/* Zone 2: 4 Single-line Navigation Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600" aria-label="Navigasi utama">
            <button
              type="button"
              onClick={() => setActiveTab('catalog')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeTab === 'catalog'
                  ? 'text-slate-900 border-[#1E3A5F]'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Katalog Buku
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeTab === 'scanner'
                  ? 'text-slate-900 border-[#1E3A5F]'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Pindai QR
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('loans')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeTab === 'loans'
                  ? 'text-slate-900 border-[#1E3A5F]'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Pinjaman Saya{memberAlertCount > 0 ? ` (${memberAlertCount})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeTab === 'admin'
                  ? 'text-slate-900 border-[#1E3A5F]'
                  : 'border-transparent hover:text-slate-900'
              }`}
            >
              Dasbor Pengelola
            </button>
          </nav>

          {/* Zone 3: Single Primary Action / Account Control */}
          <div className="shrink-0">
            {user ? (
              <button
                type="button"
                onClick={handleLogout}
                title={`Masuk sebagai ${user.name} (${user.role === 'librarian' ? 'Petugas' : 'Anggota'})`}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span className="max-w-[140px] truncate">{user.name}</span>
                <LogOut className="w-3.5 h-3.5 text-slate-500" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalMode('login')}
                className="px-4 py-2 text-xs font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Masuk / Daftar
              </button>
            )}
          </div>
        </div>

        {/* Mobile navigation row */}
        <div className="md:hidden border-t border-slate-200 px-3 py-2 flex items-center gap-2 overflow-x-auto text-xs font-medium">
          {(
            [
              ['catalog', 'Katalog'],
              ['scanner', 'Pindai QR'],
              ['loans', `Pinjaman${memberAlertCount > 0 ? ` (${memberAlertCount})` : ''}`],
              ['admin', 'Pengelola'],
            ] as [AppTab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`px-3 py-1.5 rounded-md whitespace-nowrap shrink-0 ${
                activeTab === key
                  ? 'bg-[#1E3A5F] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {activeTab === 'catalog' && (
          <div className="space-y-8">
            {/* Hero Banner */}
            <section className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900">
              <img
                src="/src/assets/images/library_reading_room_1795675183468.jpg"
                alt="Ruang baca utama Lentera Pustaka"
                referrerPolicy="no-referrer"
                className="w-full h-[300px] sm:h-[340px] object-cover opacity-80"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/55 to-slate-950/20" />
              <div className="absolute inset-0 p-6 sm:p-10 flex flex-col justify-end">
                <div className="max-w-2xl space-y-3">
                  <h1 className="font-editorial text-2xl sm:text-4xl font-semibold text-white leading-tight">
                    Jelajahi Koleksi Digital & Sirkulasi QR Real-Time
                  </h1>
                  <p className="text-sm sm:text-base text-slate-200 leading-relaxed">
                    Temukan buku berdasarkan kategori, baca ulasan sesama pembaca, pinjam seketika dengan QR code, dan terima pengingat pengembalian otomatis melalui Email serta WhatsApp.
                  </p>
                </div>

                <div className="mt-5 flex flex-col sm:flex-row gap-3 max-w-2xl">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari judul buku, penulis, kategori, atau kode ISBN..."
                      aria-label="Cari buku di katalog"
                      className="w-full pl-10 pr-4 py-2.5 text-sm bg-white text-slate-900 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('scanner')}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#1E3A5F] hover:bg-[#162C49] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Pinjam / Kembalikan QR</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Category Filter & Sort Toolbar */}
            <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                      selectedCategory === cat
                        ? 'bg-[#1E3A5F] text-white'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between lg:justify-end gap-3 shrink-0">
                <span className="text-xs text-slate-500 tabular-nums">
                  Menampilkan {filteredBooks.length} buku
                </span>
                <select
                  aria-label="Urutkan katalog"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]"
                >
                  <option value="newest">Koleksi Terbaru</option>
                  <option value="rating">Rating Tertinggi</option>
                  <option value="popular">Sedang Banyak Dibaca</option>
                </select>
              </div>
            </section>

            {/* Book Grid */}
            {loadingBooks ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden animate-pulse"
                  >
                    <div className="aspect-[3/4] bg-slate-200" />
                    <div className="p-4 space-y-2.5">
                      <div className="h-3 bg-slate-200 rounded w-1/2" />
                      <div className="h-5 bg-slate-200 rounded w-3/4" />
                      <div className="h-3 bg-slate-200 rounded w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredBooks.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3">
                <div className="text-base font-semibold text-slate-900">
                  Tidak ada buku yang cocok dengan pencarian Anda
                </div>
                <p className="text-sm text-slate-600">
                  Coba ubah kata kunci pencarian atau pilih kategori "Semua".
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('Semua');
                  }}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#1E3A5F] rounded-lg"
                >
                  Reset Filter Pencarian
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {filteredBooks.map((book) => (
                  <article
                    key={book.id}
                    className="group bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col hover:border-slate-300 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedBookId(book.id)}
                      className="text-left focus-visible:outline-2 focus-visible:outline-[#1E3A5F]"
                    >
                      <BookCover
                        book={book}
                        className="w-full aspect-[3/4] border-b border-slate-200"
                      />
                    </button>

                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div className="space-y-1.5">
                        {/* Clean unboxed metadata (Zero-Pill Rule) */}
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 truncate">
                          <span className="truncate">{book.category}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono shrink-0">{book.shelf_location}</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedBookId(book.id)}
                          className="text-left block w-full"
                        >
                          <h3 className="font-editorial text-lg font-semibold text-slate-900 leading-snug group-hover:text-[#1E3A5F] transition-colors line-clamp-2">
                            {book.title}
                          </h3>
                        </button>
                        <div className="text-xs text-slate-600 truncate">{book.author}</div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="inline-flex items-center gap-1 text-slate-700 tabular-nums">
                          <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                          <span>
                            {book.avg_rating > 0 ? book.avg_rating.toFixed(1) : 'Baru'}
                          </span>
                          <span className="text-slate-400">({book.review_count})</span>
                        </span>

                        <span
                          className={`font-medium tabular-nums ${
                            book.available_copies > 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {book.available_copies > 0
                            ? `${book.available_copies}/${book.total_copies} tersedia`
                            : 'Dipinjam penuh'}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'scanner' && (
          <QrScannerPanel
            user={user}
            books={books}
            myLoans={myLoans}
            onRequireAuth={() => setAuthModalMode('login')}
            onActionSuccess={() => {
              void fetchBooks();
              void fetchMemberData(user);
            }}
          />
        )}

        {activeTab === 'loans' && (
          <MemberLoansView
            user={user}
            loans={myLoans}
            notifications={myNotifications}
            onRequireAuth={() => setAuthModalMode('login')}
            onActionSuccess={() => {
              void fetchBooks();
              void fetchMemberData(user);
            }}
          />
        )}

        {activeTab === 'admin' && (
          <AdminDashboardView
            user={user}
            books={books}
            wsTick={wsTick}
            onOpenAuth={(mode) => setAuthModalMode(mode)}
            onCatalogChanged={() => {
              void fetchBooks();
            }}
          />
        )}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>Lentera Pustaka — Sistem Perpustakaan Digital & Sirkulasi QR</div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('scanner')}
              className="hover:text-slate-900 transition-colors"
            >
              Peminjaman QR
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('loans')}
              className="hover:text-slate-900 transition-colors"
            >
              Notifikasi Pengembalian
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className="hover:text-slate-900 transition-colors"
            >
              Statistik Bulanan
            </button>
          </div>
        </div>
      </footer>

      {selectedBook && (
        <BookDetailModal
          book={selectedBook}
          user={user}
          myLoans={myLoans}
          wsTick={wsTick}
          onClose={() => setSelectedBookId(null)}
          onRequireAuth={() => setAuthModalMode('login')}
          onChanged={() => {
            void fetchBooks();
            void fetchMemberData(user);
          }}
        />
      )}

      {authModalMode && (
        <AuthModal
          initialMode={authModalMode}
          onClose={() => setAuthModalMode(null)}
          onAuthenticated={(authedUser) => {
            setUser(authedUser);
            setAuthModalMode(null);
            if (authedUser.role === 'librarian') {
              setActiveTab('admin');
            }
          }}
        />
      )}
    </div>
  );
}
