import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { buildNavGroups, canSeeNavChild } from './Aside';
import Loading from './Loading';
import NoAccess from './NoAccess';
import { useNavAccess } from '../hooks/useNavAccess';

/**
 * Bosh sahifa (`/`). Admin panelda dashboard YO'Q: kirgach (yoki `/` ochilganda) foydalanuvchi yon paneldagi
 * BIRINCHI ruxsat berilgan sahifaga o'tadi. Ruxsat qoidasi va tartib yon panel bilan aynan bir xil
 * (`buildNavGroups` + `useNavAccess`), shuning uchun menyuda ko'ringan sahifa hech qachon "yopiq" chiqmaydi.
 * Birorta ham sahifaga ruxsat bo'lmasa — tushunarli xabar (`NoAccess`).
 */
const HomeRedirect = () => {
  const { t } = useTranslation();
  const { hasPermission, ready } = useNavAccess();

  if (!ready) return <Loading />;

  const first = buildNavGroups(t)
    .flatMap((group) => group.children)
    .find((child) => canSeeNavChild(child, hasPermission));

  if (!first) return <NoAccess />;

  // `fromHome` — PermissionRoute shu yo'naltirishdan keyin yana `/` ga qaytarmasin (cheksiz sikl bo'lmasin).
  return <Navigate to={first.path} replace state={{ fromHome: true }} />;
};

export default HomeRedirect;
