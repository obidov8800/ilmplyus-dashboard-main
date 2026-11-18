// Backenddan kelgan obyekt ichidan kerakli tildagi maydonni ajratib beradi.
// Masalan: obj = { name_uz: "Salom", name_ru: null } bo'lsa:
//   getLocalized(obj, 'name', 'ru') -> "Salom"  (RU bo'sh — o'zbekcha matn; avval "-" chiqardi)
//
// Tartib: so'ralgan til -> `_uz` -> oddiy maydon (`name`) -> "-".
// Nega: backend matnlarni asosan `<maydon>_uz` ga yozadi, RU/EN esa keyin avtomatik tarjima job'i bilan
// to'ladi (yoki umuman to'lmaydi); ba'zi javoblar (masalan xonalar) esa faqat oddiy `name` qaytaradi.
// Aks holda RU/EN interfeysda (yoki tarjima kechikkanda) hamma nom "-" bo'lib qolardi.
export const getLocalized = (obj: unknown, fieldName: string, lang: string): string => {
  if (!obj || typeof obj !== 'object') return '-';
  const record = obj as Record<string, unknown>;

  // Faqat til kodining dastlabki ikki harfi ("ru-RU" -> "ru")
  const shortLang = lang?.substring(0, 2).toLowerCase() || 'uz';

  const pick = (key: string): string | null => {
    const value = record[key];
    return value != null && String(value).trim() !== '' ? String(value) : null;
  };

  return pick(`${fieldName}_${shortLang}`) ?? pick(`${fieldName}_uz`) ?? pick(fieldName) ?? '-';
};
