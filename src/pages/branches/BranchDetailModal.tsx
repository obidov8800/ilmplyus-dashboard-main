import { useTranslation } from 'react-i18next';
import { getLocalized } from '../../utils/getLocalized';
import { formatDateTime } from '../../utils/date';
import { formatPhone } from '../../utils/phone';
import type { Branch } from './branch.types';
import StatusBadge, { ActiveBadge } from '@/components/StatusBadge';
import { branchTypeLabelKey, normalizeBranchType } from '../../utils/branchType';

interface Props {
  branch: Branch;
  onClose: () => void;
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="brd-item">
      <span className="brd-label">{label}</span>
      <span className="brd-value">{value}</span>
    </div>
  );
}

/**
 * Backend faqat `name_uz` / `address_uz` ni to'ldiradi, ru/en ustunlari ko'pincha `null`.
 * Jadvalda bu "-" bo'lib chiqaveradi, lekin detalda bo'sh qiymat foydasiz —
 * shuning uchun tanlangan til bo'sh bo'lsa uz variantiga qaytamiz.
 */
function localizedWithFallback(branch: Branch, field: 'name' | 'address' | 'legal_address', lang: string): string {
  const localized = getLocalized(branch, field, lang);
  if (localized !== '-') return localized;
  const uz = (branch as unknown as Record<string, unknown>)[`${field}_uz`];
  return typeof uz === 'string' && uz.trim() !== '' ? uz : '-';
}

const dash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? '-' : String(value);

export default function BranchDetailModal({ branch, onClose }: Props) {
  const { t, i18n } = useTranslation();

  return (
    <div className="branch-modal-overlay" onClick={onClose}>
      <div className="branch-modal brd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="brd-header">
          <h2 className="brd-title">
            {t('branches.viewTitle')} <span className="brd-id">#{branch.id}</span>
          </h2>
          <button type="button" className="brd-close" onClick={onClose} aria-label={t('branches.cancel')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="brd-body">
          <section className="brd-section">
            <h3 className="brd-section-title">
              <i className="fa-solid fa-circle-info" /> {t('branches.sectionGeneral')}
            </h3>
            <div className="brd-grid">
              <DetailItem
                label={t('branches.branchName')}
                value={localizedWithFallback(branch, 'name', i18n.language)}
              />
              <DetailItem label={t('branches.branchCode')} value={dash(branch.branch_code)} />
              <DetailItem
                label={t('branches.type')}
                value={
                  <StatusBadge tone={normalizeBranchType(branch.type) === 'preschool' ? 'info' : 'neutral'}>
                    {t(branchTypeLabelKey(branch.type))}
                  </StatusBadge>
                }
              />
              <DetailItem label={t('branches.city')} value={dash(branch.city)} />
              <DetailItem
                label={t('branches.address')}
                value={localizedWithFallback(branch, 'address', i18n.language)}
              />
              <DetailItem label={t('branches.director')} value={dash(branch.director_name)} />
              <DetailItem
                label={t('branches.phoneNumber')}
                value={branch.phone ? formatPhone(branch.phone) : '-'}
              />
              <DetailItem
                label={t('branches.status')}
                value={
                  <ActiveBadge
                    active={branch.is_active === 1}
                    activeLabel={t('branches.active')}
                    inactiveLabel={t('branches.inactive')}
                  />
                }
              />
              <DetailItem
                label={t('branches.hasContract')}
                value={branch.has_contract === 1 ? t('branches.yes') : t('branches.no')}
              />
            </div>
          </section>

          <section className="brd-section">
            <h3 className="brd-section-title">
              <i className="fa-solid fa-file-contract" /> {t('branches.sectionLegal')}
            </h3>
            <div className="brd-grid">
              <DetailItem label={t('branches.legalName')} value={dash(branch.legal_name)} />
              <DetailItem label={t('branches.organizationInn')} value={dash(branch.inn)} />
              <DetailItem
                label={t('branches.legalAddress')}
                value={localizedWithFallback(branch, 'legal_address', i18n.language)}
              />
              <DetailItem label={t('branches.index')} value={dash(branch.postal_code)} />
            </div>
          </section>

          <section className="brd-section">
            <h3 className="brd-section-title">
              <i className="fa-solid fa-building-columns" /> {t('branches.sectionBank')}
            </h3>
            <div className="brd-grid">
              <DetailItem label={t('branches.bankName')} value={dash(branch.bank_name)} />
              <DetailItem label={t('branches.accountNumber')} value={dash(branch.account_number)} />
              <DetailItem label={t('branches.mfo')} value={dash(branch.mfo)} />
              <DetailItem label={t('branches.oked')} value={dash(branch.oked)} />
            </div>
          </section>

          <section className="brd-section">
            <h3 className="brd-section-title">
              <i className="fa-solid fa-clock" /> {t('branches.sectionDates')}
            </h3>
            <div className="brd-grid">
              <DetailItem label={t('branches.createdAt')} value={formatDateTime(branch.created_at)} />
              <DetailItem label={t('branches.updatedAt')} value={formatDateTime(branch.updated_at)} />
            </div>
          </section>
        </div>

        <div className="branch-modal-buttons">
          <button type="button" className="branch-save-btn" onClick={onClose}>
            {t('branches.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
