import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import './RecordViewModal.css';

export interface ViewField {
  label: string;
  value: ReactNode;
  /** Uzun matn (izoh, manzil) — ikkala ustunni egallaydi. */
  wide?: boolean;
}

interface Props {
  title: string;
  fields: ViewField[];
  onClose: () => void;
}

/** Bo'sh qiymat jadvaldagidek "-" bo'lib chiqadi. */
const display = (value: ReactNode): ReactNode =>
  value === null || value === undefined || value === '' || value === false ? '-' : value;

/**
 * Ro'yxat sahifalaridagi «Ko'rish» (ko'z ikonkasi) oynasi — faqat o'qish uchun.
 * Dizayni Operatorlar / Komissiyalar / Kurslar oynalari bilan bir xil (`RecordViewModal.css`).
 * Escape yoki fonni bosish bilan yopiladi.
 */
export default function RecordViewModal({ title, fields, onClose }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="rvm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rvm" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="rvm-title">{title}</h2>

        <div className="rvm-grid">
          {fields.map((field, i) => (
            <div key={`${field.label}-${i}`} className={field.wide ? 'rvm-item--wide' : undefined}>
              <p className="rvm-label">{field.label}:</p>
              <div className="rvm-value">{display(field.value)}</div>
            </div>
          ))}
        </div>

        <button type="button" className="rvm-close" onClick={onClose}>
          {t('viewModal.close')}
        </button>
      </div>
    </div>
  );
}
