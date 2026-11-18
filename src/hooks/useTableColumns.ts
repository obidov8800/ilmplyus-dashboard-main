import { useMemo } from 'react';
import { TABLE_PAGES_CONFIG } from '../pages/settings/config';
import { mergeColumnOrder, useTableSettingsStore } from '../store/useTableSettingsStore';

export interface TableColumnsApi {
  /** Ustun ko'rinadimi. Sozlamada yo'q ustun — ko'rinadi (yangi ustun default true). */
  isVisible: (colId: string) => boolean;
  /**
   * Drag qilinadigan ustunlar joriy tartibda. `id` va `alwaysVisible`
   * ustunlar bu ro'yxatga kirmaydi — ular jadvalda qat'iy joyda turadi.
   */
  orderedColumns: string[];
  /** `orderedColumns` ichidan faqat ko'rinadiganlari — thead/tbody uchun tayyor. */
  visibleColumns: string[];
}

/**
 * Jadval sahifalari uchun yagona kirish nuqtasi: ustun ko'rinishi va tartibini
 * TABLE_PAGES_CONFIG (default) + backend sozlamasi (store) asosida hisoblaydi.
 *
 * Default tartib config'dan olinadi, shuning uchun sahifada ustunlar ro'yxatini
 * ikkinchi marta yozish shart emas — config va jadval bir joydan boshqariladi.
 */
export function useTableColumns(pageId: string): TableColumnsApi {
  const settings = useTableSettingsStore((state) => state.settings);
  const columnOrders = useTableSettingsStore((state) => state.columnOrders);

  const defaultColumns = useMemo(() => {
    const pageConfig = TABLE_PAGES_CONFIG.find((page) => page.id === pageId);
    if (!pageConfig) {
      if (import.meta.env.DEV) {
        console.warn(
          `[useTableColumns] "${pageId}" TABLE_PAGES_CONFIG ichida topilmadi — ` +
            'jadval sozlanmaydi.'
        );
      }
      return [];
    }
    return pageConfig.columns
      .filter((col) => !col.alwaysVisible && col.id !== 'id')
      .map((col) => col.id);
  }, [pageId]);

  const orderedColumns = useMemo(
    () => mergeColumnOrder(columnOrders[pageId], defaultColumns, pageId),
    [columnOrders, pageId, defaultColumns]
  );

  const pageSettings = settings[pageId];

  return useMemo(() => {
    const isVisible = (colId: string) => pageSettings?.[colId] ?? true;
    return {
      isVisible,
      orderedColumns,
      visibleColumns: orderedColumns.filter(isVisible),
    };
  }, [pageSettings, orderedColumns]);
}
