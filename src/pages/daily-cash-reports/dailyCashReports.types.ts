/* Kunlik kassa hisobotlari — umumiy tiplar va formatlash yordamchilari.
   Backend pul maydonlarini string qilib qaytaradi ("1000000.00"), shuning uchun
   hamma summa maydonlari `string | number` deb belgilangan. */

export type DailyCashReportStatus =
  | 'created'
  | 'sent'
  | 'assistant_accepted'
  | 'accountant_approved'
  | 'returned'
  | 'finalized';

export type Money = string | number | null | undefined;

export interface Person {
  id?: number;
  full_name?: string | null;
  name?: string | null;
}

export interface ReportBranch {
  id?: number;
  name?: string | null;
  name_uz?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
}

export interface DailyCashReport {
  id: number;
  report_number?: string | null;
  branch_id?: number;
  report_date?: string | null;
  /** Zanjir: created → sent → assistant_accepted → accountant_approved; returned/finalized — tuzatish oqimi. */
  status?: DailyCashReportStatus | string;

  cash_income?: Money;
  card_income?: Money;
  /** QR-code bank = click to'lov usuli (backendda shunday hisoblanadi). */
  qr_income?: Money;
  bank_income?: Money;
  paynet_income?: Money;
  total_income?: Money;

  expense_balance_total?: Money;
  cash_expense?: Money;
  non_cash_expense?: Money;
  total_expense?: Money;
  remainder_total?: Money;

  branch?: ReportBranch | null;
  cashier?: Person | string | null;
  assistant?: Person | string | null;
  accountant?: Person | string | null;
  creator?: Person | string | null;
}

/** `/daily-cash-reports/{id}/details` — «Баланс» va «Қолдиқ» jadval qatori. */
export interface JamgarmaRow {
  jamgarma_id?: number;
  jamgarma_name?: string | null;
  cash?: Money;
  non_cash?: Money;
  total?: Money;
}

/** `/daily-cash-reports/{id}/details` — «Чиқим» jadval qatori. */
export interface ExpenseRow {
  expense_date?: string | null;
  jamgarma?: string | null;
  category?: string | null;
  subcategory?: string | null;
  info?: string | null;
  cash_amount?: Money;
  non_cash_amount?: Money;
  amount?: Money;
  employee?: string | null;
}

export interface DetailsTotals {
  expense_balance_total?: Money;
  cash_expense?: Money;
  non_cash_expense?: Money;
  total_expense?: Money;
  remainder_total?: Money;
}

export interface DetailsResponse {
  balance: JamgarmaRow[];
  expenses: ExpenseRow[];
  remainder: JamgarmaRow[];
  totals: DetailsTotals;
}

/** `/daily-cash-reports/{id}/logs` — audit jurnali qatori. */
export interface ReportLog {
  id?: number;
  action?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  note?: string | null;
  user?: Person | string | null;
  created_at?: string | null;
}

/**
 * Pul summasini o'qish uchun formatlaydi: "1000000.00" → "1 000 000".
 * Kasr qismi nolga teng bo'lsa tushirib qoldiriladi.
 */
export function formatMoney(value: Money): string {
  if (value === null || value === undefined || value === '') return '0';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Foydalanuvchi maydoni matn ham, obyekt ham bo'lishi mumkin. */
export function personName(value: Person | string | null | undefined): string {
  if (!value) return '-';
  if (typeof value === 'string') return value || '-';
  return value.full_name || value.name || '-';
}
