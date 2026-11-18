import { Navigate, Outlet } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';
import Loading from './Loading';
import { useTableSettingsSync } from '../hooks/useTableSettingsSync';
import { useMeSync } from '../hooks/useMeSync';

const ProtectedRoute = () => {
  const isAuth = useAuthStore((state) => state.isAuth);

  // Jadval ustunlari sozlamasini backenddan yuklab, store'ni to'ldiradi.
  useTableSettingsSync();

  // Rol/ruxsatlar: sahifa chizilishidan OLDIN serverdan olinadi (brauzerdagi eski nusxa bilan marshrut
  // tekshirilmaydi). Keyin tinmasdan so'ralmaydi — qarang `hooks/useMeSync.ts`.
  const { isLoading } = useMeSync();

  if (!isAuth) {
    return <Navigate to="/login" replace />;
  }

  if (isLoading) {
    return <Loading />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
