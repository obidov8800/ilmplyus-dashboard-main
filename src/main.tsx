import { createRoot, type Root } from "react-dom/client";
import { unstable_HistoryRouter as HistoryRouter } from "react-router-dom";
import { appHistory } from "./utils/prettyHistory";
import { MantineProvider, createTheme } from "@mantine/core";
import App from "./App.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Notifications } from "@mantine/notifications";
import { i18nReady } from "./i18n";
import useAuthStore from "./store/useAuthStore";
import "./index.css";
import "./styles/consistency.css";
import NetworkStatus from "./components/NetworkStatus";
import { registerOfflineWorker } from "./utils/registerOfflineWorker";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 15 * 60 * 1000,
      // MA'LUMOT YANGILIGI ("kiritgan ma'lumotim sahifani yangilamaguncha chiqmaydi" muammosi) — TINMASDAN SO'ROV YO'Q
      // (ilgari har 15–60 soniyada hamma ochiq so'rovlar qayta yuborilardi: foydalanuvchi ko'paygan sari backend sekinlashardi):
      //  1) o'zgartiruvchi so'rov (POST/PUT/PATCH/DELETE) muvaffaqiyatli bo'lgach HAMMA ma'lumot darhol
      //     yangilanadi — `utils/dataSync.ts` (`api/api.ts` interceptor'idan chaqiriladi): ochiq turgan
      //     jadvallar, selectlar, hisoblagichlar qayta yuklanadi, boshqa sahifalar keshi eskirgan deb belgilanadi;
      //  2) boshqa foydalanuvchilar kiritgan ma'lumot: sahifa ochilganda (`refetchOnMount`), oyna qayta
      //     fokus olganda va internet qayta ulanganda — FAQAT ma'lumot 1 daqiqadan eski bo'lsa — qayta tortiladi
      //     (stale-while-revalidate: avval keshdagisi ko'rinadi, keyin yangisi o'zi almashadi);
      //  3) `/me` (rol/ruxsat) — o'z siyosati bilan: `services/account.ts`.
      // Og'ir ro'yxatlar (`fetchAllPages`) o'z `staleTime`i bilan (5 daqiqa) — har safar ko'p so'rov ketmasin.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      retry: (failureCount: number, error: unknown) => {
        const err = error as { response?: { status?: number } };
        if (err?.response?.status === 403) return false;
        return failureCount < 2;
      },
    },
  },
});

/*
 * Og'ir ro'yxatlar (`fetchAllPages` — barcha sahifani yig'adi, ko'p so'rov ketadi): umumiy `staleTime` (1 daqiqa)
 * ular uchun juda qisqa — sahifaga qaytganda har safar o'nlab so'rov ketmasin. Yozuvchi so'rovdan keyin esa ular
 * `staleTime`dan qat'i nazar darhol yangilanadi (`utils/dataSync.ts`).
 */
const HEAVY_LIST_KEYS = [['users'], ['expenses'], ['tests'], ['demo-lessons']] as const;
for (const key of HEAVY_LIST_KEYS) queryClient.setQueryDefaults(key, { staleTime: 5 * 60 * 1000 });

// Chiqishda (logout) kesh tozalanadi: boshqa foydalanuvchi kirganda oldingi
// foydalanuvchining ro'yxatlari, ruxsatlari va filial ma'lumotlari 5–10 daqiqa
// davomida ko'rinib qolmasin.
useAuthStore.subscribe((state, prev) => {
  if (prev.isAuth && !state.isAuth) queryClient.clear();
});

/**
 * Butun admin uchun yagona shrift — Noto Sans JP (brendbook). Mantine
 * v8 barcha komponent (Modal, Select, Menu, TextInput, Accordion,
 * bildirishnomalar...) shriftini shu `theme`dan oladi; `theme` berilmasa
 * ular tizim shriftida chiqib, sahifa bo'ylab shriftlar har xil ko'rinardi.
 * Stek `index.css`dagi `--app-font` bilan bir xil.
 */
const APP_FONT =
  "'Noto Sans JP', 'Segoe UI', Roboto, Arial, 'Helvetica Neue', sans-serif";

const theme = createTheme({
  fontFamily: APP_FONT,
  fontFamilyMonospace: "'Noto Sans JP', ui-monospace, 'SFMono-Regular', Menlo, monospace",
  headings: { fontFamily: APP_FONT },
});

const container = document.getElementById("root")!;
const globalForRoot = globalThis as unknown as { __reactRoot?: Root };
const root = globalForRoot.__reactRoot ?? (globalForRoot.__reactRoot = createRoot(container));

registerOfflineWorker();

// Render qilishdan oldin tarjima tayyor bo'lishini kutamiz: saqlangan til `ru`/`en` bo'lsa, uning bo'lagi shu yerda
// yuklanadi (`i18n.ts`) — ilova avval o'zbekcha chiqib, keyin almashib qolmaydi. `uz` uchun kutish deyarli nol.
void i18nReady.then(() => {
  root.render(
    <QueryClientProvider client={queryClient}>
      {/* Adres satrida chiroyli o'zbekcha manzillar (`/tolovlar`), ilova ichida avvalgi yo'llar: utils/prettyPaths.ts */}
      <HistoryRouter history={appHistory}>
        <MantineProvider theme={theme}>
          <App />
          <NetworkStatus />
          <Notifications position="top-right" />
        </MantineProvider>
      </HistoryRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>,
  );
});
