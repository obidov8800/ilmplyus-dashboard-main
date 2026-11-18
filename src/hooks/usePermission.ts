import { useQuery } from '@tanstack/react-query';
import useAuthStore from '../store/useAuthStore';
import { fetchDashboardSettings } from '../pages/roles/dashboardSettings.service';
import { hasPermissionBypass } from '../utils/fullAccess';

const isAdminUser = (user: ReturnType<typeof useAuthStore.getState>['user']) => hasPermissionBypass(user);

export const usePermission = (permissionName: string): boolean => {
  const user = useAuthStore((state) => state.user);

  if (!permissionName) return true;
  if (isAdminUser(user)) return true;

  const permissions = (user?.roles ?? []).flatMap(
    (role) => role.permissions?.map((p) => p.name) ?? [],
  );

  return permissions.includes(permissionName);
};

export const useFeaturePermission = (featureName: string): boolean => {
  const user = useAuthStore((state) => state.user);
  const isAdmin = isAdminUser(user);

  const { data: dashboardSettings } = useQuery({
    queryKey: ['dashboard-settings'],
    queryFn: fetchDashboardSettings,
    staleTime: 5 * 60 * 1000,
    enabled: !!user && !isAdmin && !!featureName,
  });

  if (!featureName) return true;
  if (isAdmin) return true;

  if (dashboardSettings?.features !== undefined) {
    return dashboardSettings.features.includes(featureName);
  }

  return true;
};

// Route-level permission check: also honors the virtual per-role page
// permissions configured in Dashboard settings (same source Aside.tsx
// uses to decide which menu items to show), so a route stays reachable
// whenever its menu item is visible.
export const usePagePermission = (permission?: string): boolean => {
  const user = useAuthStore((state) => state.user);
  const isAdmin = isAdminUser(user);
  const hasBackendPermission = usePermission(permission ?? '');

  const { data: dashboardSettings } = useQuery({
    queryKey: ['dashboard-settings'],
    queryFn: fetchDashboardSettings,
    staleTime: 5 * 60 * 1000,
    enabled: !!user && !isAdmin && !!permission,
  });

  if (!permission) return true;
  if (isAdmin) return true;

  if (permission === 'ip_telephone.view' || permission === 'ip-telephone.view') {
    if (dashboardSettings?.features !== undefined) {
      return dashboardSettings.features.includes('ip_telephone.view');
    }
  }

  if (hasBackendPermission) return true;

  const roleName = user?.roles?.[0]?.name;
  if (!roleName || !dashboardSettings) return false;

  const virtualPerms = dashboardSettings.pagePermissions?.[roleName] ?? [];
  return virtualPerms.includes(permission);
};
