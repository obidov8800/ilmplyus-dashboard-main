import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/* Kunlik kassa hisobotlari modallari uchun umumiy qobiq.
   ConfirmModal'dan farqi: ixtiyoriy kenglik va erkin `children` (jadval, forma). */

interface ModalProps {
  title: string;
  subtitle?: string;
  /** Keng jadvalli modal uchun `wide`. */
  size?: 'md' | 'wide';
  busy?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}

const DcrModal = ({
  title,
  subtitle,
  size = 'md',
  busy = false,
  footer,
  children,
  onClose,
}: ModalProps) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  return (
    <div className="dcr-overlay" onClick={() => !busy && onClose()}>
      <div
        className={`dcr-modal dcr-modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dcr-modal-header">
          <div>
            <h2 className="dcr-modal-title">{title}</h2>
            {subtitle && <p className="dcr-modal-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="dcr-modal-close"
            disabled={busy}
            onClick={onClose}
            aria-label={t('modalPattern.close')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="dcr-modal-body">{children}</div>

        {footer && <div className="dcr-modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

export default DcrModal;
