import axios from 'axios';
import useAuthStore from '../store/useAuthStore';
import { queryClient } from '../main';
import { scheduleDataSync } from '../utils/dataSync';
import { requestMeRefresh } from '../utils/meRefresh';
import { notifications } from '@mantine/notifications';
import { API_BASE_URL } from './baseUrl';
import { normalizeUzbekFields } from '../utils/uzbekTypography';
import { confirmNetworkFailure, isOffline, reportNetworkOk } from '../utils/netState';
import { networkErrorToast } from '../utils/netText';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /**
     * `true` bo'lsa, xatolik yuz berganda qizil toast ko'rsatilmaydi.
     * Foydalanuvchi so'ramagan fon so'rovlari uchun (masalan badge sanoqlari),
     * ular uzilganda ekranga xatolik chiqishi shart emas.
     */
    silentError?: boolean;
    /** `true` bo'lsa, bu yozuvchi so'rov ma'lumot sinxronini (`utils/dataSync.ts`) qo'zg'amaydi. */
    skipDataSync?: boolean;
  }
}

export const API = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    /*
     * `Accept: application/json` shart — bo'lmasa, backend (Laravel)
     * so'rovni AJAX/API emas, oddiy brauzer so'rovi deb hisoblab, JSON xato
     * o'rniga login sahifasiga 302 redirect qaytaradi (JSON body'siz).
     * Natijada login/so'rovlar "sessiya tugadi"ga o'xshash tushunarsiz
     * xatolik bilan muvaffaqiyatsiz tugardi.
     */
    Accept: 'application/json',
  },
});

/**
 * Hikvision qurilmalari bilan ishlaydigan amallar (sync / clear) har bir xodimni
 * qurilmaga birma-bir yuboradi va 15 soniyalik umumiy timeout'ga sig'maydi.
 * Shu sababli ular uchun alohida uzun timeout ishlatiladi.
 */
export const LONG_REQUEST_TIMEOUT = 5 * 60 * 1000;

let isNotifying = false;

API.interceptors.request.use((config) => {
  config.data = normalizeUzbekFields(config.data);
  config.params = normalizeUzbekFields(config.params);
  const { token, expiresAt, logout } = useAuthStore.getState();

  if (expiresAt && Date.now() > expiresAt) {
    logout();
    return config;
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * Some stored text (question text, lookup names, notes) was saved with a
 * broken encoding: the Uzbek apostrophe (the o`/g` okina and the
 * glottal-stop mark) was lost and replaced by U+FFFD ("replacement
 * character", renders as a black diamond) when the source was imported
 * from a mis-encoded CSV/Excel file. The original character is gone from
 * the data, but is recoverable from context: a U+FFFD right after o/g is
 * the okina (U+2018), otherwise it is the glottal-stop apostrophe
 * (U+2019). Every response string is repaired here before it reaches the
 * UI. The real fix belongs in the database; this is a display-only guard.
 */
function repairEncoding(value: unknown): unknown {
  if (typeof value === 'string') {
    if (!value.includes('\uFFFD')) return value;
    return value.replace(/([oOgG])\uFFFD/g, '$1\u2018').replace(/\uFFFD/g, '\u2019');
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = repairEncoding(value[i]);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) record[key] = repairEncoding(record[key]);
    return value;
  }
  return value;
}

API.interceptors.response.use(
  (res) => {
    // Javob keldi — internet bor (offline sahifasini yopadi).
    reportNetworkOk();
    // U+FFFD kabi buzuq kodlashli matnlarni UI oldidan tuzatib beramiz.
    if (res.data && typeof res.data === 'object') {
      res.data = normalizeUzbekFields(repairEncoding(res.data));
    }
    // Yozuvchi so'rov (POST/PUT/PATCH/DELETE) muvaffaqiyatli tugadi — ekrandagi hamma ma'lumot F5 siz
    // yangilanadi (batafsil: utils/dataSync.ts).
    scheduleDataSync(res.config);
    return res;
  },
  (error) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    const status = error?.response?.status;

    const isTimeout = error?.code === 'ECONNABORTED';
    // Javob umuman kelmadi — aloqa tekshiriladi; internet yo'q bo'lsa butun ekranli «Internet aloqasi yo'q» sahifasi chiqadi.
    if (error?.code === 'ERR_NETWORK') confirmNetworkFailure();
    // Backend xatoni turli kalitda qaytaradi: `message` (Laravel validatsiya/abort), `error` (ba'zi
    // controller'lar `['error' => ...]`), `errors` (maydonlar bo'yicha). Avval faqat `message` o'qilardi —
    // `error` kelsa foydalanuvchiga tushunarsiz "Xatolik yuz berdi" chiqardi.
    const data = error?.response?.data;
    const firstFieldError = data?.errors
      ? (Object.values(data.errors as Record<string, unknown>)
          .flat()
          .find((v) => typeof v === 'string') as string | undefined)
      : undefined;
    const message = isTimeout
      ? 'So‘rov vaqti tugadi. Amal serverda davom etayotgan bo‘lishi mumkin, biroz kutib qayta tekshiring.'
      : (typeof data?.message === 'string' && data.message) ||
        (typeof data?.error === 'string' && data.error) ||
        firstFieldError;

    // Ruxsat xatosi (403) — rol/ruxsat o'zgargan bo'lishi mumkin: `/me` (30 soniyada ko'pi bilan bir marta) qayta so'raladi.
    if (status === 403 && error?.config?.url !== '/me') requestMeRefresh(queryClient);

    if (status === 401) {
      logoutAndRedirect();
      return Promise.reject(error);
    }

    if (error?.config?.silentError) {
      return Promise.reject(error);
    }

    // Internet yo'q (butun ekranli sahifa aytadi, har so'rovga xabar kerak emas) yoki server xatosi (5xx) — tushunarli xabar.
    const net = isTimeout ? null : networkErrorToast(error, isOffline());
    if (net?.silent) return Promise.reject(error);

    if (!isNotifying) {
      isNotifying = true;

      notifications.clean();

      notifications.show({
        color: 'red',
        title: net?.title ?? 'Xatolik',
        message: net
          ? net.message
          : status === 403
            ? 'Sahifaga kirishga ruxsat y‘q'
            : message || 'Xatolik yuz berdi',
      });

      setTimeout(() => {
        isNotifying = false;
      }, 2000);
    }

    return Promise.reject(error);
  },
);

function logoutAndRedirect() {
  const { logout } = useAuthStore.getState();
  logout();

  queryClient?.clear();
}
