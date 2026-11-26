export type UserRole = 'member' | 'librarian';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  member_code: string;
  role: UserRole;
  created_at: string;
}

export type BookCategory =
  | 'Sejarah & Budaya'
  | 'Teknologi & Rekayasa'
  | 'Sains & Alam'
  | 'Desain & Arsitektur'
  | 'Sastra & Fiksi'
  | 'Ekonomi & Bisnis';

export interface Book {
  id: string;
  isbn: string;
  qr_code: string;
  title: string;
  author: string;
  category: BookCategory;
  publisher: string;
  year: number;
  shelf_location: string;
  total_copies: number;
  available_copies: number;
  synopsis: string;
  cover_url: string;
  cover_accent: string;
  avg_rating: number;
  review_count: number;
  active_loan_count: number;
  created_at: string;
  updated_at: string;
}

export type LoanStatus = 'borrowed' | 'overdue' | 'returned';

export interface Loan {
  id: string;
  loan_qr_code: string;
  book_id: string;
  user_id: string;
  book_title: string;
  book_author: string;
  book_isbn: string;
  book_qr_code: string;
  book_shelf: string;
  book_cover_url: string;
  member_name: string;
  member_email: string;
  member_phone: string;
  member_code: string;
  borrowed_at: string;
  due_date: string;
  returned_at: string | null;
  status: LoanStatus;
  fine_amount: number;
  overdue_days: number;
  last_reminded_at: string | null;
}

export interface ReviewReply {
  id: string;
  review_id: string;
  user_id: string;
  user_name: string;
  user_role: UserRole;
  reply_text: string;
  created_at: string;
}

export interface Review {
  id: string;
  book_id: string;
  user_id: string;
  user_name: string;
  user_role: UserRole;
  rating: number;
  comment: string;
  helpful_count: number;
  created_at: string;
  replies: ReviewReply[];
}

export type NotificationChannel = 'email' | 'whatsapp' | 'system';

export interface ReminderLog {
  id: string;
  loan_id: string | null;
  user_id: string;
  member_name?: string;
  book_title?: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  message: string;
  status: 'sent' | 'logged_sandbox' | 'failed';
  gateway_detail: string;
  created_at: string;
  is_read: number;
}

export interface MonthlyBucket {
  month: string; // YYYY-MM
  label: string; // e.g., "Nov 2026"
  borrowed: number;
  returned: number;
  overdue: number;
}

export interface CategoryStat {
  category: string;
  book_count: number;
  loan_count: number;
}

export interface PopularBookStat {
  id: string;
  title: string;
  author: string;
  category: string;
  loan_count: number;
  avg_rating: number;
}

export interface AdminAnalytics {
  summary: {
    total_titles: number;
    total_copies: number;
    available_copies: number;
    active_loans: number;
    overdue_loans: number;
    loans_this_month: number;
    on_time_rate: number;
    total_fines_outstanding: number;
    reminders_sent_month: number;
    total_members: number;
  };
  monthly_series: MonthlyBucket[];
  category_breakdown: CategoryStat[];
  popular_books: PopularBookStat[];
}

export interface GatewayStatus {
  smtp_configured: boolean;
  whatsapp_configured: boolean;
  smtp_from: string;
}

export interface AuthStatus {
  hasLibrarian: boolean;
  envPasscodeConfigured: boolean;
}
