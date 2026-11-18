import type { ReactNode } from 'react';
import type { StatusTone } from '@/utils/statusTone';

/**
 * Jadvallardagi «Holati» belgisi — Admin bo'ylab BIR XIL ko'rinish (`styles/consistency.css`, `.st-pill`).
 *
 * Avval har sahifa holatni o'zicha chizardi: oddiy matn, rangli matn, turli radius va o'lchamdagi
 * "pill"lar (ba'zilari hatto boshqa sahifaning global `.status-badge` qoidasi bilan buzilardi).
 * Backend holat satrini rangga o'girish — `utils/statusTone.ts`.
 */
interface StatusBadgeProps {
  tone?: StatusTone;
  children: ReactNode;
  title?: string;
}

export default function StatusBadge({ tone = 'neutral', children, title }: StatusBadgeProps) {
  return (
    <span className={`st-pill st-pill--${tone}`} title={title}>
      {children}
    </span>
  );
}

interface ActiveBadgeProps {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}

/** `is_active` kabi mantiqiy holat: faol — yashil, nofaol — qizil. */
export function ActiveBadge({ active, activeLabel, inactiveLabel }: ActiveBadgeProps) {
  return (
    <StatusBadge tone={active ? 'success' : 'danger'}>{active ? activeLabel : inactiveLabel}</StatusBadge>
  );
}
