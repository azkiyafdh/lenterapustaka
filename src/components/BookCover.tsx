import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { Book } from '../types';

interface BookCoverProps {
  book: Pick<Book, 'title' | 'author' | 'category' | 'cover_url' | 'cover_accent' | 'shelf_location'>;
  className?: string;
}

export function BookCover({ book, className = '' }: BookCoverProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(book.cover_url) && !imgFailed;

  if (showImage) {
    return (
      <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
        <img
          src={book.cover_url}
          alt={`Sampul buku ${book.title}`}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden flex flex-col justify-between p-4 text-white select-none ${className}`}
      style={{
        backgroundColor: book.cover_accent || '#1E3A5F',
        backgroundImage:
          'radial-gradient(circle at 85% 15%, rgba(255,255,255,0.14), transparent 55%)',
      }}
    >
      <div className="flex items-center justify-between text-[11px] text-white/75 font-mono">
        <span>{book.shelf_location}</span>
        <BookOpen className="w-3.5 h-3.5 text-white/75" />
      </div>
      <div className="my-auto py-2">
        <div className="text-[11px] text-white/70 mb-1.5">{book.category}</div>
        <div className="font-editorial text-base font-semibold leading-snug text-white line-clamp-3">
          {book.title}
        </div>
      </div>
      <div className="pt-2 border-t border-white/20 text-xs text-white/85 truncate">
        {book.author}
      </div>
    </div>
  );
}
