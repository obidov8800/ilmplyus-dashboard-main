import { useTranslation } from 'react-i18next';
import InfoHint from '../InfoHint';
import { GENERAL_RULES, GENERAL_RULES_HINT } from '../../permissions/permissionCatalog';

/** Qoida matniga mos belgi (ikonka). */
const RULE_ICONS = ['fa-bolt', 'fa-bars', 'fa-link', 'fa-eye', 'fa-crown', 'fa-building', 'fa-file-contract', 'fa-eye-slash'];

/**
 * Sahifa tepasidagi undov (!): ruxsatlar qanday ishlashi — qisqa qoidalar.
 * O'zbekcha — batafsil ro'yxat; boshqa tillarda avvalgi umumiy matn.
 */
export default function PermissionLegend() {
  const { t, i18n } = useTranslation();
  const detailed = (i18n.resolvedLanguage || i18n.language).toLowerCase().startsWith('uz');

  if (!detailed) return <InfoHint wide text={t('roles.permissionGuide', GENERAL_RULES_HINT)} />;

  return (
    <InfoHint wide>
      <div className="pinfo">
        <b className="pinfo__title">{t('roles.guide.legendTitle')}</b>
        <ul className="pinfo__rules pinfo__notes">
          {GENERAL_RULES.map((rule, index) => (
            <li key={rule}>
              <i className={`fa-solid ${RULE_ICONS[index] ?? 'fa-circle-info'}`} aria-hidden="true" />
              <span>{rule}</span>
            </li>
          ))}
        </ul>

      </div>
    </InfoHint>
  );
}
