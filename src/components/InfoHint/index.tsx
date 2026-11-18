import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import './infoHint.css';

interface Props {
  /** Bosilganda ko'rinadigan matn (uzun izoh). `children` berilsa — o'rniga tuzilgan (sarlavha, ro'yxat…) mazmun chiqadi. */
  text?: string;
  children?: ReactNode;
  /** `true` — ikonka yoniga «Izoh» yozuvi ham chiqadi (yorliqqa bog'lanmagan, mustaqil izohlar uchun). */
  withLabel?: boolean;
  /** `true` — keng oyna (uzun, ko'p qatorli matn: yangi qator `
` saqlanadi). */
  wide?: boolean;
}

const POPOVER_WIDTH = 320;
const POPOVER_WIDTH_WIDE = 440;

/**
 * Modal/formadagi uzun tushuntirish matni o'rniga — undov belgili tugma; bosilganda matn qalqib chiqadi
 * (tashqariga bosish yoki Esc bilan yopiladi). Forma ixcham qoladi, izoh esa kerak bo'lganda ko'rinadi.
 */
export default function InfoHint({ text, children, withLabel = false, wide = false }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(wide ? POPOVER_WIDTH_WIDE : POPOVER_WIDTH, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const below = window.innerHeight - rect.bottom;
    // Pastda joy kam bo'lsa — tugma ustida ochiladi.
    setStyle(
      below < 170 && rect.top > below
        ? { left, width, bottom: window.innerHeight - rect.top + 8 }
        : { left, width, top: rect.bottom + 8 },
    );
  };

  const toggle = (e: MouseEvent) => {
    // Yorliq (`<label>`) ichida turganda checkbox/inputni bosib yubormasin, modal overlay yopilmasin.
    e.preventDefault();
    e.stopPropagation();
    if (!open) place();
    setOpen((value) => !value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`ihint-btn${withLabel ? ' ihint-btn--labeled' : ''}${open ? ' ihint-btn--open' : ''}`}
        aria-label={t('infoHint.label')}
        aria-expanded={open}
        onClick={toggle}
      >
        <i className="fa-solid fa-circle-exclamation" />
        {withLabel && <span>{t('infoHint.label')}</span>}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className={`ihint-pop${wide ? ' ihint-pop--wide' : ''}${children ? ' ihint-pop--rich' : ''}`}
            role="tooltip"
            style={style}
            onClick={(e) => e.stopPropagation()}
          >
            {children ?? text}
          </div>,
          document.body,
        )}
    </>
  );
}
