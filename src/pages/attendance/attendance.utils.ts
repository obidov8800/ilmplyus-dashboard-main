import { API } from '../../api/api';
import type { FlatAttendanceRecord } from '../../types/attendance.types';

export const STATUS_CODES = ['+', 'K', 'F', 'NB', 'S'] as const;
export type StatusCode = (typeof STATUS_CODES)[number];

const BACKEND_TO_CODE: Record<string, StatusCode> = {
  present: '+',
  late: 'K',
  no_uniform: 'F',
  absent: 'NB',
  excused: 'S',
  '+': '+',
  K: 'K',
  F: 'F',
  NB: 'NB',
  S: 'S',
};

const CODE_TO_BACKEND: Record<StatusCode, string> = {
  '+': 'present',
  K: 'late',
  F: 'no_uniform',
  NB: 'absent',
  S: 'excused',
};

const CODE_TO_CLASS: Record<StatusCode, string> = {
  '+': 'status-plus',
  K: 'status-k',
  F: 'status-f',
  NB: 'status-nb',
  S: 'status-s',
};

export const toStatusCode = (raw: string | null): StatusCode | null =>
  raw ? (BACKEND_TO_CODE[raw] ?? null) : null;

export const toBackendStatus = (code: StatusCode): string => CODE_TO_BACKEND[code];

export const statusClass = (code: StatusCode): string => CODE_TO_CLASS[code];

const CODE_TO_LABEL_KEY: Record<StatusCode, string> = {
  '+': 'attendance.legend.present',
  K: 'attendance.legend.late',
  F: 'attendance.legend.noUniform',
  NB: 'attendance.legend.absentNoExcuse',
  S: 'attendance.legend.absentWithExcuse',
};

/** Status kodining i18n kaliti — jadvalda belgi emas, matn ko'rsatish uchun */
export const statusLabelKey = (code: StatusCode): string => CODE_TO_LABEL_KEY[code];

/** "14:48:07" → "14:48" */
export const shortTime = (time?: string | null): string => (time ? time.slice(0, 5) : '');

/**
 * "2026-07" → { from: "2026-07-01", to: "2026-07-31" }.
 * Backend /attendances oyni `month` emas, `from`/`to` oralig'i bilan filtrlaydi.
 */
export const monthRange = (month: string): { from: string; to: string } => {
  const [y, m] = month.split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
};

/** Bitta so'rovda so'raladigan yozuvlar soni (oylik so'rov uchun) — pastroqda nega ekanini o'qing. */
const ATTENDANCE_PAGE_SIZE = 200;
/** Xavfsizlik chegarasi — backend `meta` bermasa ham cheksiz tsiklga tushib qolmasin. */
const ATTENDANCE_MAX_PAGES = 30;
/** Bir vaqtda ketadigan sahifa so'rovlari soni (standart). */
const DEFAULT_CONCURRENCY = 4;

export interface AttendanceFetchOptions {
  /** Bitta sahifadagi yozuvlar soni. Bir kunlik so'rov uchun kattaroq bersa bo'ladi. */
  pageSize?: number;
  /** Bir vaqtda nechta sahifa so'rovi ketishi. */
  concurrency?: number;
  /** Faqat shu xodim yozuvlari (backend `employee_id` filtrini qo'llasa). */
  employeeId?: string | number;
}

/** Vazifalarni `concurrency` tadan bo'lib bajaradi (hammasini birdan yubormaydi). */
async function runPool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  let failed = false;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (!failed && next < tasks.length) {
      const index = next++;
      try {
        results[index] = await tasks[index]();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

const toList = (data: unknown): FlatAttendanceRecord[] => {
  if (Array.isArray(data)) return data as FlatAttendanceRecord[];
  const nested = (data as { data?: unknown } | null)?.data;
  return Array.isArray(nested) ? (nested as FlatAttendanceRecord[]) : [];
};

/**
 * `from`–`to` oralig'idagi davomat yozuvlarini yuklaydi.
 *
 * Oldin sahifa ham, xodim sahifasi ham HAR DOIM butun OYNING hamma xodimlari
 * yozuvlarini (ming-minglab) yuklardi, hatto bitta kun ko'rsatilayotgan
 * bo'lsa ham — sahifa shu sabab sekin ochilardi. Endi chaqiruvchi kerakli
 * oraliqni so'raydi (bitta kun / bitta xodim).
 *
 * Katta oraliq `per_page=1000` bilan bitta so'rovda olinsa backendda 500 xatosi
 * va sekinlik bo'lardi, shuning uchun kichik sahifalarga bo'linadi: birinchi
 * sahifa jami sahifa sonini (`meta.last_page`) beradi, qolganlari esa
 * `concurrency` tadan bo'lib so'raladi (hammasini birdan yuborib brauzer
 * ulanishlarini band qilib qo'ymaslik uchun). `meta` kelmasa, qisqa sahifa
 * kelgunicha ketma-ket so'raladi.
 */
export async function fetchAttendanceRange(
  from: string,
  to: string,
  options: AttendanceFetchOptions = {},
): Promise<FlatAttendanceRecord[]> {
  const pageSize = options.pageSize ?? ATTENDANCE_PAGE_SIZE;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const baseParams = {
    from,
    to,
    per_page: pageSize,
    ...(options.employeeId ? { employee_id: options.employeeId } : {}),
  };

  const { data: first } = await API.get('/attendances', { params: { ...baseParams, page: 1 } });

  // Backend ba'zan tekis massiv qaytaradi (paginatsiyasiz) — hammasi shu javobda.
  if (Array.isArray(first)) return first;

  const firstChunk = toList(first);
  const lastPage: number | undefined = first?.meta?.last_page;

  if (lastPage && lastPage <= 1) return firstChunk;

  if (lastPage) {
    const cappedLastPage = Math.min(lastPage, ATTENDANCE_MAX_PAGES);
    const restPages = await runPool(
      Array.from({ length: Math.max(0, cappedLastPage - 1) }, (_, i) => () =>
        API.get('/attendances', { params: { ...baseParams, page: i + 2 } }).then((res) =>
          toList(res.data),
        ),
      ),
      concurrency,
    );
    return [firstChunk, ...restPages].flat();
  }

  if (firstChunk.length < pageSize) return firstChunk;

  // `meta` kelmadi, lekin birinchi sahifa to'liq — yana yozuv bo'lishi mumkin.
  const all = [...firstChunk];
  for (let page = 2; page <= ATTENDANCE_MAX_PAGES; page += 1) {
    const { data } = await API.get('/attendances', { params: { ...baseParams, page } });
    const chunk = toList(data);
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

/** Butun oy yozuvlari. */
export const fetchMonthAttendances = (month: string, options?: AttendanceFetchOptions) => {
  const { from, to } = monthRange(month);
  return fetchAttendanceRange(from, to, options);
};

/** Ikki vaqt orasidagi farq, "8s 12d" ko'rinishida */
export const durationBetween = (from?: string | null, to?: string | null): string => {
  if (!from || !to) return '-';
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const diff = toMinutes(to) - toMinutes(from);
  if (diff <= 0) return '-';
  return `${Math.floor(diff / 60)}s ${diff % 60}d`;
};
