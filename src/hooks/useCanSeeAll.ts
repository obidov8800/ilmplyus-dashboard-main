import useAuthStore from '../store/useAuthStore';
import { canSeeAll, ownEmployeeId } from '../permissions/scope';
import { hasPermissionBypass } from '../utils/fullAccess';

/**
 * Qamrov: bo'limda hamma yozuvlar (true) yoki faqat o'ziniki (false). Qaror BITTA joyda — `permissions/scope.ts`;
 * sahifalar rol nomiga qarab o'zi hal qilmaydi.
 */
export function useCanSeeAll(module: string): boolean {
  const user = useAuthStore((state) => state.user);
  const permissions = new Set((user?.roles ?? []).flatMap((role) => role.permissions?.map((p) => p.name) ?? []));
  // `usePermission` bilan bir xil: to'liq huquqli `admin` rolida ruxsat nomi tekshirilmaydi.
  return canSeeAll(module, { fullAccess: hasPermissionBypass(user), has: (name) => permissions.has(name) });
}

/** Joriy hisobning xodim id si («o'z guruhlari» uchun). */
export function useOwnEmployeeId(): number | undefined {
  const user = useAuthStore((state) => state.user);
  return ownEmployeeId(user as Parameters<typeof ownEmployeeId>[0]);
}
