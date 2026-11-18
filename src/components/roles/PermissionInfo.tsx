import { useTranslation } from 'react-i18next';
import { GROUP_INFO, describeAction } from '../../permissions/permissionCatalog';
import { actionLabel } from './permissionLabels';

interface Props {
  moduleName: string;
  moduleTitle: string;
  actions: string[];
  /** `true` — o'zbekcha batafsil matnlar (katalog o'zbekcha yozilgan); aks holda umumiy matn. */
  detailed: boolean;
}

const ORDER = ['view', 'show', 'create', 'edit', 'delete'];
const orderOf = (action: string) => {
  const i = ORDER.indexOf(action);
  if (i >= 0) return i;
  return action === 'view_all' ? 98 : 10;
};

/**
 * Bo'lim yonidagi undov (!) oynasi: nima uchun, qayerda chiqadi, har bir ruxsat nima qiladi va eslatmalar
 * (filial, shartnoma). Boshqa bo'limning ruxsati kerak emas — «bir sahifa, bir ruxsat».
 */
export default function PermissionInfo({ moduleName, moduleTitle, actions, detailed }: Props) {
  const { t } = useTranslation();
  const info = GROUP_INFO[moduleName];
  const sorted = [...actions].sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));
  const notes: { icon: string; text: string }[] = [];
  if (detailed) {
    if (info?.branch) notes.push({ icon: 'fa-building', text: info.branch });
    if (info?.contract) notes.push({ icon: 'fa-file-contract', text: info.contract });
    if (info?.needs) notes.push({ icon: 'fa-link', text: info.needs });
  }

  return (
    <div className="pinfo">
      <div className="pinfo__head">
        <b className="pinfo__title">{moduleTitle}</b>
        {detailed && info?.where && (
          <span className="pinfo__where">
            <i className="fa-solid fa-location-dot" aria-hidden="true" /> {info.where}
          </span>
        )}
      </div>

      <p className="pinfo__summary">
        {detailed ? (info ? info.summary : `«${moduleName}» bo‘limi.`) : t('roles.permissionGroupHint', { module: moduleTitle })}
      </p>

      <h4 className="pinfo__h">{t('roles.guide.rights')}</h4>
      <ul className="pinfo__rights">
        {sorted.map((action) => (
          <li key={action}>
            <span className="pinfo__tag">{actionLabel(t, moduleName, action)}</span>
            {detailed && <span className="pinfo__text">{describeAction(moduleName, action)}</span>}
          </li>
        ))}
      </ul>

      {notes.length > 0 && (
        <>
          <h4 className="pinfo__h">{t('roles.guide.notes')}</h4>
          <ul className="pinfo__notes">
            {notes.map((note) => (
              <li key={note.text}>
                <i className={`fa-solid ${note.icon}`} aria-hidden="true" />
                <span>{note.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
