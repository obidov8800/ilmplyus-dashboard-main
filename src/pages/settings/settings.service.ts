import { API } from '../../api/api';

/** Ustun ko'rinishi: { [columnId]: visible } */
export type ColumnVisibility = Record<string, boolean>;

/**
 * Backendda saqlanadigan to'liq hujjat (global — foydalanuvchiga bog'lanmagan).
 * `settings` va `columnOrders` dagi kalitlar to'plami ataylab bir xil emas:
 * `id` ustuni settings ichida bor, lekin hech qachon drag qilinmagani uchun
 * columnOrders ichida bo'lmaydi.
 */
export interface TableSettingsDoc {
  settings: Record<string, ColumnVisibility>;
  columnOrders: Record<string, string[]>;
  updated_at?: string | null;
}

export const EMPTY_TABLE_SETTINGS: TableSettingsDoc = {
  settings: {},
  columnOrders: {},
  updated_at: null,
};

/**
 * Backend `null` yoki kutilmagan shakl qaytarsa ham jadval buzilmasligi uchun
 * javobni doim bo'sh obyektlarga keltiramiz. Shakl umuman mos kelmasa `null`
 * qaytariladi — chaqiruvchi tomon keshni yangilash o'rniga qayta so'rov yuboradi.
 */
function normalizeDoc(data: unknown): TableSettingsDoc | null {
  if (!data || typeof data !== 'object') return null;

  const raw = data as Partial<TableSettingsDoc>;
  if (raw.settings === undefined && raw.columnOrders === undefined) return null;

  return {
    settings: raw.settings ?? {},
    columnOrders: raw.columnOrders ?? {},
    updated_at: raw.updated_at ?? null,
  };
}

/** GET /table-settings — barcha sahifalar sozlamasi (auth yetarli, permission talab qilinmaydi). */
export async function fetchTableSettings(): Promise<TableSettingsDoc> {
  const { data } = await API.get('/table-settings');
  return normalizeDoc(data) ?? EMPTY_TABLE_SETTINGS;
}

export interface TableSettingsPagePayload {
  /** Yuborilsa — o'sha sahifaning butun `columns` obyekti almashtiriladi. */
  columns?: ColumnVisibility;
  /** Yuborilsa — o'sha sahifaning butun tartib massivi almashtiriladi. */
  order?: string[];
}

/** PUT /table-settings/{page} — bitta sahifani saqlash (asosiy yozish usuli). */
export async function saveTableSettingsPage(
  page: string,
  payload: TableSettingsPagePayload,
): Promise<TableSettingsDoc | null> {
  const { data } = await API.put(`/table-settings/${encodeURIComponent(page)}`, payload);
  return normalizeDoc(data);
}

/** PUT /table-settings — butun hujjatni almashtirish (localStorage → backend migratsiyasi uchun). */
export async function replaceTableSettings(
  doc: Pick<TableSettingsDoc, 'settings' | 'columnOrders'>,
): Promise<TableSettingsDoc | null> {
  const { data } = await API.put('/table-settings', doc);
  return normalizeDoc(data);
}
