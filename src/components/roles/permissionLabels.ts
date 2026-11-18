import type { TFunction } from 'i18next';
import { humanizeKey } from '../../utils/humanizeKey';

/** Ruxsat amalining (`view`, `create`, `bypass`…) yorlig'i — joriy tilda; tarjimasi bo'lmasa o'qiladigan zaxira. */
export function actionLabel(t: TFunction, moduleName: string, action: string): string {
  if (moduleName === 'payments' && action === 'view_all') {
    return t('roles.permissionActions.payments_view_all');
  }
  if (moduleName === 'lookups' && action === 'view') {
    return t('roles.permissionActions.lookups_view', 'Tanlov ro‘yxatlarini ko‘rish');
  }
  return t(`roles.permissionActions.${action}`, humanizeKey(action));
}

/** Bo'lim yorlig'i. */
export function moduleLabel(t: TFunction, moduleName: string): string {
  return t(`modules.${moduleName}`, humanizeKey(moduleName));
}

/**
 * To'liq ruxsat kodi (`modul.amal`) uchun «Bo'lim → Amal» ko'rinishidagi yorliq. `fromModule` shu bo'limning o'zi
 * bo'lsa faqat amal nomi qaytariladi (kartochka ichida bo'lim nomini takrorlamaslik uchun).
 */
export function permissionLabel(t: TFunction, name: string, fromModule?: string): string {
  const [module, ...rest] = name.split('.');
  const action = rest.join('.');
  if (fromModule && fromModule === module) return actionLabel(t, module, action);
  return `${moduleLabel(t, module)} → ${actionLabel(t, module, action)}`;
}
