import { useMemo } from 'react';
import './pagination.css';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * Umumiy sahifalash (pagination) tugmalari — raqamli sahifalar +
 * oldingi/keyingi. Ilgari faqat `pages/lid/index.tsx` ichida lokal
 * komponent sifatida bor edi; endi boshqa jadval sahifalari ham shu
 * bitta komponentdan foydalanadi (bir xil ko'rinish/xatti-harakat).
 */
export default function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  const pages = useMemo((): (number | '...')[] => {
    if (totalPages <= 6) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (currentPage <= 3) return [1, 2, 3, '...', totalPages];
    if (currentPage >= totalPages - 2)
      return [1, '...', totalPages - 2, totalPages - 1, totalPages];
    return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
  }, [currentPage, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <div className="db-pagination__pages">
      <button
        type="button"
        className="db-pagination__btn db-pagination__btn--nav"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Oldingi sahifa"
      >
        <i className="fa-solid fa-chevron-left" />
      </button>
      {pages.map((page, idx) =>
        page === '...' ? (
          <span key={`ellipsis-${idx}`} className="db-pagination__ellipsis">
            ...
          </span>
        ) : (
          <button
            key={page}
            type="button"
            className={`db-pagination__btn${currentPage === page ? ' db-pagination__btn--active' : ''}`}
            onClick={() => onPageChange(page as number)}
            aria-label={`${page}-sahifa`}
            aria-current={currentPage === page ? 'page' : undefined}
          >
            {page}
          </button>
        ),
      )}
      <button
        type="button"
        className="db-pagination__btn db-pagination__btn--nav"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="Keyingi sahifa"
      >
        <i className="fa-solid fa-chevron-right" />
      </button>
    </div>
  );
}
