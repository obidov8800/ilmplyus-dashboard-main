import { useQuery } from '@tanstack/react-query';
import useAuthStore from '../store/useAuthStore';
import { fetchDashboardSettings } from '../pages/roles/dashboardSettings.service';
import { hasPermissionBypass } from '../utils/fullAccess';

/**
 * Yon panel (`Aside`) va bosh sahifa yo'naltirgichi (`HomeRedirect`) uchun yagona qoida:
 * foydalanuvchi shu menyu bandini (sahifani) ko'ra oladimi?
 *
 *  1) admin — hammasi ochiq;
 *  2) IP-telefoniya — `/dashboard-settings` → `features` bo'yicha;
 *  3) backend ruxsati (`<modul>.view`) rolda bor bo'lsa — ochiq;
 *  4) aks holda — "virtual" sahifa ruxsatlari (`pagePermissions[rol]`).
 *
 * `ready` — qaror chiqarish uchun hamma ma'lumot (joriy foydalanuvchi va, admin bo'lmasa, sozlamalar hujjati)
 * kelib bo'lganmi. Undan oldin "ruxsat yo'q" deb xulosa chiqarmang.
 */
export function useNavAccess() {
  const user = useAuthStore((state) => state.user);

  const isAdmin = hasPermissionBypass(user);

  const { data: dashboardSettings, isFetched } = useQuery({
    queryKey: ['dashboard-settings'],
    queryFn: fetchDashboardSettings,
    // Sozlamalar kamdan-kam o'zgaradi: tinmasdan (har 30 soniyada) so'ralmaydi — sahifa ochilganda va oynaga qaytganda
    // (5 daqiqadan eski bo'lsa) yangilanadi; rollar sahifasida saqlanganda esa darhol (`setQueryData`).
    staleTime: 5 * 60 * 1000,
    enabled: !!user && !isAdmin,
  });

  const hasPermission = (permission?: string): boolean => {
    if (!permission) return true;
    if (isAdmin) return true;
    if (!user?.roles) return false;

    if (permission === 'ip-telephone.view' || permission === 'ip_telephone.view') {
      if (dashboardSettings?.features !== undefined) {
        return dashboardSettings.features.includes('ip_telephone.view');
      }
    }

    const hasBackendPerm = user.roles.some((role) =>
      role.permissions?.some((p) => p.name === permission),
    );
    if (hasBackendPerm) return true;

    const roleName = user.roles[0]?.name;
    if (!roleName || !dashboardSettings) return false;
    const virtualPerms = dashboardSettings.pagePermissions?.[roleName] ?? [];
    return virtualPerms.includes(permission);
  };

  const ready = !!user && (isAdmin || isFetched);

  return { hasPermission, isAdmin, ready };
}
