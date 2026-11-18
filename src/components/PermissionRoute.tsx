import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { usePagePermission } from '../hooks/usePermission';
import { useNavAccess } from '../hooks/useNavAccess';
import NoAccess from './NoAccess';

interface PermissionRouteProps {
  permission?: string;
  /** Bir nechta ruxsatdan biri yetarli bo'lgan sahifalar uchun (masalan taqsimlash formasi: ko'rish | qo'shish | tahrirlash). */
  anyOf?: string[];
}

const PermissionRoute = ({ permission, anyOf }: PermissionRouteProps) => {
  const hasSingle = usePagePermission(permission);
  const { hasPermission: hasNavPermission } = useNavAccess();
  const hasPermission = anyOf ? anyOf.some((p) => hasNavPermission(p)) : hasSingle;
  const location = useLocation();

  if (!hasPermission) {
    // `/` (HomeRedirect) bizni shu sahifaga yo'naltirgan bo'lsa, yana `/` ga qaytish cheksiz sikl bo'lardi —
    // bunday holda xabar ko'rsatamiz.
    if ((location.state as { fromHome?: boolean } | null)?.fromHome) return <NoAccess />;
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default PermissionRoute;
