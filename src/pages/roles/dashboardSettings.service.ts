import { API } from '@/api/api';

/**
 * `/dashboard-settings` — rollar bo'yicha erkin sozlamalar hujjati (backendda bitta JSON).
 *
 * Admin panelda dashboard sahifasi YO'Q (olib tashlangan), lekin shu hujjat hanuz ishlatiladi:
 *  • `pagePermissions` / `features` — backend `/permissions` jadvaliga qo'shib bo'lmaydigan "virtual"
 *    sahifa ruxsatlari (masalan IP-telefoniya): yon panel (`Aside`) va marshrutlar (`usePermission`)
 *    shu yerdan o'qiydi;
 *  • `roleVisibility` / `tabNames` / `widgetVisibility` — foydalanuvchi (staff) ilovasidagi dashboard
 *    bo'limlari va vidjetlarining rollar bo'yicha ko'rinishi: ularni «Rollar» sahifasi boshqaradi.
 */

/** Foydalanuvchi (staff) ilovasi dashboardining bo'limlari — Rollar sahifasida ko'rinish sozlanadi. */
export type MainTab = 'umumiy' | 'sotuv' | 'oquvchi' | 'oqituvchi' | 'moliya';

export const ALL_TABS: MainTab[] = ['umumiy', 'sotuv', 'oquvchi', 'oqituvchi', 'moliya'];

export interface DashboardSettings {
  tabNames: Record<string, string>;
  roleVisibility: Record<string, string[]>;
  pagePermissions: Record<string, string[]>;
  features?: string[];
  /**
   * `rol -> ko'rsatiladigan vidjet id'lari`. Rol bu yerda yo'q bo'lsa — o'sha rolga barcha vidjetlar
   * ochiq. Vidjet ruxsatlari backenddagi `/permissions` jadvaliga qo'shilmaydi (u ro'yxat migratsiya
   * bilan seed qilingan), shu sabab ular shu erkin hujjat ichida saqlanadi.
   */
  widgetVisibility?: Record<string, string[]>;
}

export async function fetchDashboardSettings(): Promise<DashboardSettings> {
  const { data } = await API.get<DashboardSettings>('/dashboard-settings');
  return {
    tabNames: data.tabNames ?? {},
    roleVisibility: data.roleVisibility ?? {},
    pagePermissions: data.pagePermissions ?? {},
    features: Array.isArray(data.features) ? data.features : [],
    widgetVisibility: data.widgetVisibility ?? {},
  };
}

export async function saveDashboardSettings(settings: DashboardSettings): Promise<void> {
  await API.put('/dashboard-settings', settings);
}
