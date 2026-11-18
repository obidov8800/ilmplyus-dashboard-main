// Uzbekiston telefon raqamlari uchun umumiy yordamchi funksiyalar.
// Format: +998 + 9 ta raqam  ->  masalan  +998901234567

export const PHONE_PREFIX = '+998';

// Prefiksdan keyingi majburiy raqamlar soni (Uzbekiston milliy raqami)
export const PHONE_LOCAL_LENGTH = 9;

/**
 * Foydalanuvchi kiritgan qiymatni +998XXXXXXXXX ko'rinishiga keltiradi.
 * - Har doim +998 bilan boshlanadi (o'chirib bo'lmaydi).
 * - Faqat 9 tagacha raqam qabul qiladi, ortig'i kesiladi.
 * - Bo'sh joy, harf va boshqa belgilar tashlab yuboriladi.
 */
export function formatPhone(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  let local: string;

  if (raw.startsWith('+')) {
    // Qiymatda prefiks bor: "+998..." — undan keyingi qism lokal raqam.
    const rest = raw.slice(1).replace(/\D/g, '');
    // Prefiks qisman o'chirilgan bo'lsa ("+99", "+9"), lokal qism bo'sh deb olinadi —
    // shunday qilib +998 ni backspace bilan buzib bo'lmaydi.
    local = rest.startsWith('998') ? rest.slice(3) : '';
  } else {
    const digits = raw.replace(/\D/g, '');
    // "+" siz to'liq raqam joylashtirilgan bo'lsa (998901234567) davlat kodi olib tashlanadi.
    local =
      digits.startsWith('998') && digits.length > PHONE_LOCAL_LENGTH
        ? digits.slice(3)
        : digits;
  }

  return PHONE_PREFIX + local.slice(0, PHONE_LOCAL_LENGTH);
}

/**
 * Backendga yuborishdan oldin normallashtiradi: +998901234567
 */
export function normalizePhone(input: string | null | undefined): string {
  return formatPhone(input);
}

/**
 * Telefon raqami to'g'ri formatdami? (+998 va aynan 9 ta raqam)
 */
export function isValidUzPhone(input: string | null | undefined): boolean {
  return /^\+998\d{9}$/.test(normalizePhone(input));
}
