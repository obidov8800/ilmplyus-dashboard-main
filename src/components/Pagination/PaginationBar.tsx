import { useTranslation } from 'react-i18next';
import Pagination from './Pagination';
import './pagination.css';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

/**
 * Jadval sahifalarining pastki qismidagi "Jami: N ta, X-Y ko'rsatilmoqda"
 * matni + (ixtiyoriy) "Qatorlar" tanlovi + sahifa tugmalari — bitta joyda.
 * 24 ta jadval sahifasida bir xil qo'lda yozilgan kodni takrorlamaslik
 * uchun umumiy komponent qilib chiqarildi.
 */
export default function PaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
}: PaginationBarProps) {
  const { t } = useTranslation();

  // Ma'lumot umuman bo'lmasa — pagination qatori butunlay chiqmasin
  // ("Vazifalar topilmadi" kabi bo'sh holatларда "Jami: 0 ta" + tugmalar
  // ko'rinishi kerak emas).
  if (total <= 0) return null;

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="db-pagination">
      <span className="db-pagination__info">
        {t('pagination.info', { total, from, to })}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {onPageSizeChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label htmlFor="pagination-page-size" className="db-select__label">
              {t('pagination.rowsLabel')}:
            </label>
            <select
              id="pagination-page-size"
              className="db-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}

        {totalPages > 1 && (
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={onPageChange} />
        )}
      </div>
    </div>
  );
}
