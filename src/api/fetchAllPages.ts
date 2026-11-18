import { API } from './api';

/**
 * Backend ro'yxatni uch xil shaklda qaytaradi: `T[]`, `{ data: T[] }` yoki Laravel paginatori
 * (`{ data, last_page, ... }`, resurs to'plamida esa `meta.last_page`).
 */
type RawList<T> =
  | T[]
  | {
      data?: T[];
      last_page?: number;
      meta?: { last_page?: number };
    }
  | null
  | undefined;

function listOf<T>(raw: RawList<T>): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw.data) ? raw.data : [];
}

function lastPageOf<T>(raw: RawList<T>): number {
  if (!raw || Array.isArray(raw)) return 1;
  const root = raw.last_page;
  if (typeof root === 'number') return root;
  const meta = raw.meta?.last_page;
  return typeof meta === 'number' ? meta : 1;
}

/**
 * Sahifalangan endpointning BARCHA sahifalarini olib, bitta massivga birlashtiradi.
 *
 * Nega kerak: ba'zi endpointlar sahifalaydi (`/users` — 20 tadan, `/students` — 100 tadan, ikkalasi
 * ham `per_page`ni qabul qilmaydi), sahifa esa faqat 1-sahifani olib, uni to'liq ro'yxat deb
 * ishlatardi: select'larda eski yozuvlar (yoki, tartibga qarab, YANGI qo'shilganlar) ko'rinmasdi,
 * guruh davomatida 100 tadan keyingi o'quvchilar tushib qolardi.
 *
 * 1-sahifa olinadi, `last_page` o'qiladi; >1 bo'lsa qolganlari parallel yuklanadi.
 */
export async function fetchAllPages<T>(
  url: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const first = await API.get(url, { params: { ...params, page: 1 } }).then((r) => r.data as RawList<T>);
  const firstList = listOf(first);
  const lastPage = lastPageOf(first);
  if (lastPage <= 1) return firstList;

  // Himoya: juda ko'p sahifa bo'lsa ham 50 tadan oshirmaymiz.
  const capped = Math.min(lastPage, 50);
  const rest = await Promise.all(
    Array.from({ length: capped - 1 }, (_, i) =>
      API.get(url, { params: { ...params, page: i + 2 } }).then((r) => listOf(r.data as RawList<T>)),
    ),
  );
  return [firstList, ...rest].flat();
}
