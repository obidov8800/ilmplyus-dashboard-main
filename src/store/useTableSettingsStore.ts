import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isLegacyDefaultOrder } from '../pages/settings/config';

interface TableSettings {
  [page: string]: {
    [columnKey: string]: boolean;
  };
}

interface ColumnOrder {
  [page: string]: string[];
}

/**
 * Saqlangan tartibni joriy ustunlar ro'yxatiga moslaydi:
 * saqlangan tartib saqlanadi, yangi ustunlar oxiriga qo'shiladi,
 * endi mavjud bo'lmagan ("chiqindi") kalitlar tashlab yuboriladi.
 * Backend noma'lum kalitlarni o'chirmagani uchun filtrlash shu yerda bo'ladi.
 *
 * `pageId` berilsa va saqlangan tartib sahifaning ESKI default tartibi bilan bir xil bo'lsa
 * (foydalanuvchi uni o'zgartirmagan), yangi default qaytariladi — `LEGACY_DEFAULT_ORDERS`.
 */
export function mergeColumnOrder(
  stored: string[] | undefined,
  defaultColumns: string[],
  pageId?: string
): string[] {
  if (!stored || stored.length === 0) return defaultColumns;
  if (pageId && isLegacyDefaultOrder(pageId, stored)) return defaultColumns;

  const combined = [...stored];
  defaultColumns.forEach((col) => {
    if (!combined.includes(col)) combined.push(col);
  });

  return combined.filter((col) => defaultColumns.includes(col));
}

interface TableSettingsState {
  settings: TableSettings;
  columnOrders: ColumnOrder;
  toggleColumn: (page: string, columnKey: string) => void;
  setColumnVisibility: (page: string, columnKey: string, isVisible: boolean) => void;
  saveSettings: (page: string, columns: { [key: string]: boolean }) => void;
  saveColumnOrder: (page: string, order: string[]) => void;
  getColumnOrder: (page: string, defaultColumns: string[]) => string[];
  /** Backenddan kelgan hujjat bilan butun holatni almashtirish (source of truth — backend). */
  hydrate: (doc: { settings?: TableSettings | null; columnOrders?: ColumnOrder | null }) => void;
}

export const useTableSettingsStore = create<TableSettingsState>()(
  persist(
    (set, get) => ({
      settings: {},
      columnOrders: {},
      toggleColumn: (page, columnKey) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [page]: {
              ...(state.settings[page] || {}),
              [columnKey]: !(state.settings[page]?.[columnKey] ?? true),
            },
          },
        })),
      setColumnVisibility: (page, columnKey, isVisible) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [page]: {
              ...(state.settings[page] || {}),
              [columnKey]: isVisible,
            },
          },
        })),
      // Backend semantikasi bilan bir xil: sahifaning butun `columns` obyekti
      // almashtiriladi (merge emas), aks holda o'chirilgan ustunning eski
      // `true` qiymati qolib ketadi.
      saveSettings: (page, columns) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [page]: { ...columns },
          },
        })),
      saveColumnOrder: (page, order) =>
        set((state) => ({
          columnOrders: {
            ...state.columnOrders,
            [page]: order,
          },
        })),
      getColumnOrder: (page, defaultColumns) =>
        mergeColumnOrder(get().columnOrders[page], defaultColumns, page),
      hydrate: (doc) =>
        set({
          settings: doc.settings ?? {},
          columnOrders: doc.columnOrders ?? {},
        }),
    }),
    {
      // localStorage endi manba emas, faqat kesh: backend javobi kelguncha
      // jadval oxirgi ma'lum ko'rinishda chizilib turadi (default'ga sakramaydi).
      name: 'table-settings',
    }
  )
);
