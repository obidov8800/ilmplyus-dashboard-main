/**
 * Backend javoblari turlicha shaklda kelishi mumkin:
 *  1) tekis massiv — `[...]` (sahifalashsiz, hammasi bir yo'la)
 *  2) `{ data: [...], meta: { total, last_page, ... } }` (JSON:API uslubi)
 *  3) `{ data: [...], total, last_page, ... }` (Laravel'ning standart
 *     `paginate()` chiqishi — maydonlar `data` bilan bir qatorda, tekis)
 *
 * Ko'plab sahifalarda oldin faqat (1)-holat kutilardi (`res.data` to'g'ridan
 * -to'g'ri massiv sifatida ishlatilardi) — agar backend aslida sahifalab
 * qaytarsa (2/3), yoki hatto (1) holatida ham backend odatiy holda faqat
 * birinchi N (masalan 50) ta yozuvni qaytarsa, foydalanuvchi qolgan
 * ma'lumotlarni ko'ra olmay qolardi ("sahifani yangilamagunicha
 * ko'rinmaydi" muammosi shundan).
 *
 * Bu funksiya uchala holatni ham bir xil natijaga keltiradi:
 *  - (2)/(3) bo'lsa — backend sahifalagan ma'lumotni ishlatadi.
 *  - (1) bo'lsa — hammasi bitta javobda kelgan deb hisoblab, RO'YXATNI
 *    O'ZI (klient tomonda) sahifalarga bo'lib chiqaradi — hech bo'lmasa
 *    foydalanuvchi "Keyingi" tugmasi bilan qolganini ko'ra oladi.
 */
export interface NormalizedPage<T> {
  items: T[];
  total: number;
  totalPages: number;
}

export function normalizePaginated<T>(
  raw: unknown,
  currentPage: number,
  perPage: number,
): NormalizedPage<T> {
  if (Array.isArray(raw)) {
    const total = raw.length;
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, perPage)));
    const start = (currentPage - 1) * perPage;
    return { items: raw.slice(start, start + perPage) as T[], total, totalPages };
  }

  const obj = (raw ?? {}) as Record<string, unknown>;
  const items: T[] = Array.isArray(obj.data) ? (obj.data as T[]) : [];
  const meta = (obj.meta ?? obj) as Record<string, unknown>;
  const total = Number(meta?.total ?? items.length) || items.length;
  const totalPagesRaw = meta?.last_page;
  const totalPages =
    typeof totalPagesRaw === 'number' && totalPagesRaw > 0
      ? totalPagesRaw
      : Math.max(1, Math.ceil(total / Math.max(1, perPage)));

  return { items, total, totalPages };
}
