/**
 * Tarjimasi hali yozilmagan ruxsat/bo'lim kaliti uchun o'qiladigan zaxira matn:
 * `view_all` → «View all» (xom `view_all` o'rniga). Tarjima qo'shilgach bu ishlatilmaydi.
 */
export function humanizeKey(key: string): string {
  const text = key.replace(/[._]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}
