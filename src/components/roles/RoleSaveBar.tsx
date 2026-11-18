import { useTranslation } from 'react-i18next';
import './permissionMatrix.css';

interface Props {
  /** Saqlanmagan o'zgarishlar soni (saqlangan holatdan farq). */
  changes: number;
  /** Hozir belgilangan ruxsatlar soni. */
  selected: number;
  saving: boolean;
  /** Saqlash tugmasi o'chiq bo'lsa (masalan, rol nomi bo'sh). */
  saveDisabled?: boolean;
  onSave: () => void;
  onBack: () => void;
  /** Berilsa — «O'zgarishlarni bekor qilish» tugmasi chiqadi (o'zgarish bo'lganda). */
  onDiscard?: () => void;
}

/** Sahifa pastida yopishib turadigan panel: nechta o'zgarish saqlanmagani va «Saqlash» tugmasi har doim ko'zga ko'rinadi. */
export default function RoleSaveBar({ changes, selected, saving, saveDisabled, onSave, onBack, onDiscard }: Props) {
  const { t } = useTranslation();
  return (
    <div className="pm-savebar" role="region" aria-label={t('roles.matrix.saveBar', 'Saqlash paneli')}>
      <div className="pm-savebar__info">
        {changes > 0 ? (
          <span className="pm-savebar__dirty">
            <b>{t('roles.matrix.unsaved', '{{count}} ta o‘zgarish saqlanmagan', { count: changes })}</b>
          </span>
        ) : (
          <span>{t('roles.matrix.noChanges', 'O‘zgarish yo‘q')}</span>
        )}
        {' · '}
        {t('roles.matrix.selectedTotal', 'jami {{count}} ta ruxsat belgilangan', { count: selected })}
      </div>
      <button type="button" className="role-cancel-btn" onClick={onBack}>
        {t('roles.back', 'Ortga')}
      </button>
      {onDiscard && changes > 0 && (
        <button type="button" className="role-cancel-btn" onClick={onDiscard} disabled={saving}>
          {t('roles.matrix.discard', 'Bekor qilish')}
        </button>
      )}
      <button type="button" className="role-save-btn" onClick={onSave} disabled={saving || saveDisabled}>
        {saving ? t('roles.saving', 'Saqlanmoqda...') : t('roles.save', 'Saqlash')}
      </button>
    </div>
  );
}
