import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './confirmDeleteModal.css';

/* ------------------------------------------------------------------ *
 * O'chirishni tasdiqlash modali — `window.confirm` o'rniga.
 * Butun adminda bir xil ko'rinish: markazlashgan kichik oyna,
 * qizil "O'chirish" + kulrang "Bekor qilish".
 * ------------------------------------------------------------------ */

interface ConfirmDeleteModalProps {
  open: boolean;
  /** Asosiy savol matni. Berilmasa — `common.confirmDelete`. */
  title?: string;
  /** Ixtiyoriy qo'shimcha izoh (mayda, kulrang). */
  message?: string;
  /** Tasdiqlash tugmasi matni. Berilmasa — `common.delete`. */
  confirmLabel?: string;
  /** Bekor qilish tugmasi matni. Berilmasa — `common.cancel`. */
  cancelLabel?: string;
  /** So'rov ketayotganda ikkala tugma ham bloklanadi. */
  busy?: boolean;
  /** `danger` (qizil, o'chirish) — odatiy; `primary` (ko'k) — o'chirmaydigan tasdiqlash (masalan, SMS yuborish). */
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDeleteModal = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy = false,
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDeleteModalProps) => {
  const { t } = useTranslation();

  // Escape bilan yopish + fon scroll'ini bloklash.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="cdm-overlay"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        className="cdm-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="cdm-title">
          {title ?? t('common.confirmDelete', { defaultValue: t('users.confirmDelete') })}
        </h3>
        {message && <p className="cdm-message">{message}</p>}

        <div className="cdm-actions">
          <button
            type="button"
            className={`cdm-btn cdm-btn--${tone}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.delete')}
          </button>
          <button
            type="button"
            className="cdm-btn cdm-btn--cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteModal;
