import { API, LONG_REQUEST_TIMEOUT } from '../../api/api';
import type { Employee } from '../../types/employee.types';
import type {
  HikvisionDevice,
  HikvisionSyncBatchStatus,
  HikvisionSyncQueuedResponse,
} from '../../types/hikvision.types';

export interface SyncProgressState {
  total: number;
  processed: number;
  failed: number;
  finished: boolean;
}

export function syncProgressPercent(state: SyncProgressState | null): number {
  if (!state || state.total === 0) return 0;
  return Math.round((state.processed / state.total) * 100);
}

/**
 * Xodimlarni BITTALAB, navbat bilan qurilmaga yuboradi — backend `sync-all`
 * endpointiga tayanmaydi. Sabab: `sync-all` filial bo'yicha filtrlamay,
 * TIZIMDAGI BARCHA xodimlarni yuborib yuborayotgan edi. Shu yerda esa
 * qaysi xodimlar yuborilishini frontend to'liq nazorat qiladi — chaqiruvchi
 * faqat shu qurilma filialiga tegishli xodimlarni beradi.
 */
export async function syncEmployeesToDevice(
  device: HikvisionDevice,
  employees: Employee[],
  onProgress: (state: SyncProgressState) => void,
): Promise<SyncProgressState> {
  const total = employees.length;
  let processed = 0;
  let failed = 0;
  onProgress({ total, processed, failed, finished: false });

  for (const employee of employees) {
    try {
      await API.post<HikvisionSyncQueuedResponse>(
        `/hikvision-devices/${device.id}/employees/${employee.id}/sync`,
        undefined,
        { timeout: LONG_REQUEST_TIMEOUT, silentError: true },
      );
    } catch {
      failed += 1;
    }
    processed += 1;
    onProgress({ total, processed, failed, finished: false });
  }

  const final: SyncProgressState = { total, processed, failed, finished: true };
  onProgress(final);
  return final;
}

export interface SingleSyncResult {
  success: boolean;
  message?: string;
  /** `true` — `batch_id` orqali chin natija (finished) kuzatib tasdiqlandi. */
  confirmed?: boolean;
  /** `true` — natija hali noaniq, kutish vaqti tugadi (jarayon davom etmoqda). */
  timedOut?: boolean;
}

/**
 * Bitta xodimni qurilmaga yuboradi. Javobda `batch_id` bo'lsa, chin natija
 * ma'lum bo'lguncha (`finished`) kutadi — foydalanuvchi "navbatga qo'yildi"
 * degan taxminiy xabar emas, haqiqiy muvaffaqiyat/xato natijasini ko'radi.
 * `batch_id` kelmasa (eski/soddaroq backend xatti-harakati) — darhol
 * qaytadi, chaqiruvchi taxminiy xabar ko'rsatadi.
 */
export async function syncSingleEmployee(
  device: HikvisionDevice,
  employee: Employee,
): Promise<SingleSyncResult> {
  const { data } = await API.post<HikvisionSyncQueuedResponse>(
    `/hikvision-devices/${device.id}/employees/${employee.id}/sync`,
    undefined,
    { timeout: LONG_REQUEST_TIMEOUT },
  );

  if (!data?.batch_id) {
    return { success: true, message: data?.message };
  }

  const batchId = data.batch_id;
  const maxWaitMs = 30_000;
  const pollEveryMs = 1500;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
    try {
      const { data: status } = await API.get<HikvisionSyncBatchStatus>(
        `/hikvision-devices/sync-batches/${batchId}`,
        { silentError: true },
      );
      if (status.finished) {
        return { success: status.failed === 0, message: data?.message, confirmed: true };
      }
    } catch {
      // tarmoq xatosi — keyingi urinishda davom etamiz
    }
  }

  // Kutish vaqti tugadi — jarayon backendda davom etayotgan bo'lishi mumkin.
  return { success: true, message: data?.message, timedOut: true };
}
