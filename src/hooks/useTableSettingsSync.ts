import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import useAuthStore from '../store/useAuthStore';
import { usePermission } from './usePermission';
import { useTableSettingsStore } from '../store/useTableSettingsStore';
import {
  fetchTableSettings,
  replaceTableSettings,
  type TableSettingsDoc,
} from '../pages/settings/settings.service';

export const TABLE_SETTINGS_KEY = ['table-settings'] as const;

/** localStorage'dan backendga bir martalik ko'chirish bajarilganini belgilovchi kalit. */
const MIGRATED_FLAG = 'table-settings-migrated';

const isEmptyDoc = (doc: TableSettingsDoc) =>
  Object.keys(doc.settings).length === 0 && Object.keys(doc.columnOrders).length === 0;

/**
 * So'rov javobini darhol store'ga yozadi — effect'da emas, chunki effectlar
 * bola → ota tartibida ishlaydi va jadval sahifalari eski qiymatni o'qib qolishi mumkin.
 * Backend bo'sh hujjat qaytarsa mahalliy sozlama o'chirilmaydi (migratsiya uchun kerak).
 */
export async function fetchAndHydrateTableSettings(): Promise<TableSettingsDoc> {
  const doc = await fetchTableSettings();
  if (!isEmptyDoc(doc)) {
    useTableSettingsStore.getState().hydrate(doc);
  }
  return doc;
}

/**
 * Jadval sozlamalarini backend bilan sinxronlaydi:
 * 1. GET /table-settings → zustand store'ga hydrate qilinadi (backend — source of truth).
 * 2. Backend bo'sh, lekin brauzerda eski localStorage sozlamasi bor bo'lsa —
 *    bir marta PUT /table-settings orqali ko'chiriladi (faqat yozish huquqi borlar uchun).
 *
 * ProtectedRoute ichida bir marta chaqiriladi.
 */
export function useTableSettingsSync() {
  const isAuth = useAuthStore((state) => state.isAuth);
  const queryClient = useQueryClient();
  // Migratsiya faqat sozlamani yozishga haqli foydalanuvchi uchun — aks holda
  // har kirishda 403 va qizil xabar chiqadi. (Admin uchun usePermission — true.)
  const canWrite = usePermission('settings.update');
  const migrationTried = useRef(false);

  const { data } = useQuery({
    queryKey: TABLE_SETTINGS_KEY,
    queryFn: fetchAndHydrateTableSettings,
    enabled: isAuth,
    // Jadval sozlamasi o'zi saqlaganda yangilanadi — tinmasdan (har daqiqada) so'ralmaydi.
    staleTime: 5 * 60 * 1000,
  });

  // Store'ni to'ldirish queryFn ichida bajariladi; bu yerda faqat bir martalik
  // localStorage → backend migratsiyasi qoladi.
  useEffect(() => {
    if (!data || !isEmptyDoc(data)) return;

    // Backendda hali hech narsa yo'q — mahalliy sozlamani o'chirib yubormaymiz.
    const { settings, columnOrders } = useTableSettingsStore.getState();
    const hasLocal = Object.keys(settings).length > 0 || Object.keys(columnOrders).length > 0;

    if (
      !hasLocal ||
      !canWrite ||
      migrationTried.current ||
      localStorage.getItem(MIGRATED_FLAG) === '1'
    ) {
      return;
    }

    migrationTried.current = true;
    replaceTableSettings({ settings, columnOrders })
      .then((saved) => {
        localStorage.setItem(MIGRATED_FLAG, '1');
        if (saved) {
          queryClient.setQueryData(TABLE_SETTINGS_KEY, saved);
        } else {
          queryClient.invalidateQueries({ queryKey: TABLE_SETTINGS_KEY });
        }
      })
      .catch(() => {
        // Yozib bo'lmadi (huquq/tarmoq) — mahalliy sozlama o'z holicha ishlayveradi,
        // keyingi sessiyada yana urinib ko'riladi.
      });
  }, [data, canWrite, queryClient]);
}
