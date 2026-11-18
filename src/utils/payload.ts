/**
 * TAHRIRLASH (PUT) so'rovi uchun: bo'sh maydonlarni olib tashlaydi.
 *
 * Nega kerak: backend Update qoidalarining ko'pi `sometimes|string` yoki `sometimes|required` (nullable EMAS).
 * Laravel bo'sh qatorni `null`ga aylantiradi, shu sabab bo'sh maydon yuborilsa butun saqlash 422
 * ("must be a string" / "is required") bilan rad etiladi — NULL ustunli eski yozuvni (masalan, shahar,
 * direktor yoki pasport ma'lumoti kiritilmagan filial/xodim) tahrirlab bo'lmaydi. Yuborilmagan maydon
 * (`sometimes`) esa tekshirilmaydi va bazadagi qiymat o'zgarmay qoladi.
 *
 * `keys` berilsa — faqat shu maydonlar tekshiriladi (qolganlari, masalan `nullable` maydonlar, bo'sh bo'lsa ham yuboriladi).
 */
export function omitEmpty<T extends object>(payload: T, keys?: ReadonlyArray<keyof T>): Partial<T> {
  const source = payload as Record<string, unknown>;
  const check = new Set<string>(keys ? keys.map(String) : Object.keys(source));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (empty && check.has(key)) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}
