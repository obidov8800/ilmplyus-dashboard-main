import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uzJson from './messages/uz.json';
import { normalizeUzbekText } from './utils/uzbekTypography';

type SupportedLng = 'uz' | 'ru' | 'en';

/*
 * Tarjima bo'laklarini kerak bo'lganda yuklash (User ilovasidagi `i18n.ts` bilan bir xil yondashuv).
 *
 * Ilgari uchala til (`uz`/`ru`/`en`, jami ~530 kB) ilova ishga tushishi bilan statik import qilinardi — asosiy
 * (entry) fayl ~1 MB edi, foydalanuvchi esa bir vaqtda faqat bitta tildan foydalanadi. Endi faqat `uz` (zaxira til)
 * darhol yuklanadi, `ru`/`en` — faqat tanlanganda (yoki saqlangan til shu bo'lsa) dinamik import bilan.
 *
 * Tanlangan til endi SAQLANADI: ilgari `LanguageSelect` `localStorage.lang` ga yozardi, lekin ilova uni hech qachon
 * o'qimasdi (`lng: 'uz'`) — sahifa yangilanganda til har safar o'zbekchaga qaytardi.
 */
const dynamicLoaders: Record<Exclude<SupportedLng, 'uz'>, () => Promise<{ default: object }>> = {
  ru: () => import('./messages/ru.json'),
  en: () => import('./messages/en.json'),
};

const SUPPORTED: SupportedLng[] = ['uz', 'ru', 'en'];

const isSupported = (value: string | null): value is SupportedLng =>
  value !== null && (SUPPORTED as string[]).includes(value);

/** Tarjima daraxtidagi har matnni o'zbek tipografiyasiga keltiradi (ro'yxatlar ro'yxatligicha qoladi). */
const normalizeUzbekTranslations = (value: unknown): unknown => {
  if (typeof value === 'string') return normalizeUzbekText(value);
  if (Array.isArray(value)) return value.map(normalizeUzbekTranslations);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeUzbekTranslations(entry)]));
  }
  return value;
};

const readSavedLanguage = (): string | null => {
  try {
    // `i18nextLng` — yangi kalit (`utils/netText.ts` ham shuni o'qiydi); `lang` — eski `LanguageSelect` yozgan kalit.
    return localStorage.getItem('i18nextLng') ?? localStorage.getItem('lang');
  } catch {
    return null;
  }
};

const savedLanguage = readSavedLanguage();
const initialLanguage: SupportedLng = isSupported(savedLanguage) ? savedLanguage : 'uz';

const resources: Partial<Record<SupportedLng, { translation: object }>> = {
  uz: { translation: normalizeUzbekTranslations(uzJson) as object },
};

/*
 * `main.tsx` render qilishdan oldin shu promise'ni kutadi — saqlangan til `ru`/`en` bo'lsa, birinchi render
 * to'g'ridan-to'g'ri shu tilda chiqadi (avval o'zbekcha ko'rinib, keyin almashib qolmaydi). Bo'lak yuklanmasa
 * (tarmoq uzilgan) — o'zbekcha bilan davom etadi.
 */
const initialLoad: Promise<SupportedLng> =
  initialLanguage === 'uz'
    ? Promise.resolve('uz')
    : dynamicLoaders[initialLanguage]()
        .then((mod): SupportedLng => {
          resources[initialLanguage] = { translation: mod.default };
          return initialLanguage;
        })
        .catch((): SupportedLng => 'uz');

export const i18nReady = initialLoad.then((lng) =>
  i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: 'uz',
    interpolation: {
      escapeValue: false,
    },
  }),
);

/** Til bo'lagini (hali yuklanmagan bo'lsa) dinamik import bilan qo'shib, keyin shu tilga o'tkazadi. */
export async function loadLanguage(lng: string): Promise<void> {
  if (!isSupported(lng)) return;
  if (lng !== 'uz' && !i18n.hasResourceBundle(lng, 'translation')) {
    const mod = await dynamicLoaders[lng]();
    i18n.addResourceBundle(lng, 'translation', mod.default);
  }
  await i18n.changeLanguage(lng);
}

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('i18nextLng', lng);
    localStorage.setItem('lang', lng);
  } catch {
    /* saqlash imkoni yo'q (maxfiy rejim) — til shu sessiyada amal qiladi */
  }
});

export default i18n;
