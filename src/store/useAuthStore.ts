import { create } from "zustand";
import type { User } from "@/types/users.types";
import { storeWithoutSensitive, withoutSensitive } from "@/utils/sensitiveFields";

interface AuthState {
  token: string | null;
  user: User | null;
  isAuth: boolean;
  expiresAt: number | null;

  setAuth: (token: string, user: User) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * `localStorage`dagi JSON buzilgan bo'lsa (qo'lda tahrir, to'liq yozilmay qolgan
 * yozuv, eski versiya) `JSON.parse` modul yuklanishida xato tashlab, butun ilovani
 * oq ekranga aylantirardi. Bunday holda qiymat shunchaki yo'q deb hisoblanadi.
 */
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

/** Saqlangan foydalanuvchi — nozik maydonlarsiz (eski keshda PINFL qolgan bo'lsa, darhol tozalanadi). */
function readStoredUser(): User | null {
  const stored = readJson<User>("user");
  if (!stored) return null;
  const clean = withoutSensitive(stored);
  if (JSON.stringify(clean) !== JSON.stringify(stored)) storeWithoutSensitive("user", clean);
  return clean;
}

const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("access"),
  user: readStoredUser(),
  isAuth: !!localStorage.getItem("access"),
  expiresAt: Number(localStorage.getItem("expiresAt")) || null,

  setAuth: (token, user) => {
    const expiresAt = Date.now() + SIX_HOURS;

    localStorage.setItem("access", token);
    // PINFL, balans kabi maydonlar keshga yozilmaydi — faqat xotirada (`utils/sensitiveFields`).
    storeWithoutSensitive("user", user);
    localStorage.setItem("expiresAt", String(expiresAt));

    set({ token, user, expiresAt, isAuth: true });
  },

  setUser: (user) => {
    // PINFL, balans kabi maydonlar keshga yozilmaydi — faqat xotirada (`utils/sensitiveFields`).
    storeWithoutSensitive("user", user);
    set({ user });
  },

  logout: () => {
    localStorage.removeItem("access");
    localStorage.removeItem("user");
    localStorage.removeItem("expiresAt");

    set({ token: null, user: null, expiresAt: null, isAuth: false });
  },
}));

export default useAuthStore;
