import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import useAuthStore from '../store/useAuthStore';
import type { User } from '@/types/users.types';
import { meQueryOptions } from '../services/account';

/**
 * Foydalanuvchi ma'lumoti (ROL VA RUXSATLAR) — `services/account.ts` dagi yagona `/me` so'rovi:
 *  - sahifa ochilganda / yangilanganda serverdan olinadi va store DARHOL (marshrut tekshiruvidan OLDIN) yangilanadi —
 *    brauzerda saqlangan ESKI ruxsat bilan yangi berilgan sahifadan otib yuborish yo'q;
 *  - TINMASDAN (har 15 soniyada) so'ralmaydi — server yuki odam soniga qarab o'sib ketardi. Qayta so'raladi:
 *    oynaga qaytganda (ma'lumot 5 daqiqadan eski bo'lsa), internet qayta ulanganda, o'z rol/foydalanuvchi o'zgartirishidan
 *    keyin (`dataSync`) va backend 403 qaytarganda (`utils/meRefresh.ts`);
 *  - boshqa oynada (tab) yangilangan foydalanuvchi shu oynaga ham darhol o'tadi (`storage` hodisasi).
 *
 * `ProtectedRoute`da BIR marta chaqiriladi. Ism/rol/profil ma'lumoti uchun — `useAccount()` (`services/account.ts`).
 */
export function useMeSync() {
  const isAuth = useAuthStore((state) => state.isAuth);

  const query = useQuery(meQueryOptions(isAuth));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'user' && e.newValue) {
        try {
          useAuthStore.setState({ user: JSON.parse(e.newValue) as User });
        } catch {
          /* buzilgan yozuv — keyingi /me tuzatadi */
        }
      } else if (e.key === 'access' && !e.newValue) {
        // Boshqa oynada chiqib ketilgan.
        useAuthStore.getState().logout();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return query;
}
