import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import { notifications } from '@mantine/notifications';
import { API } from '@/api/api';
import { useOptions } from '@/api/options';
import { getApiErrorMessage } from '@/utils/apiError';
import DcrModal from './Modal';

/* «Smenani yopish» — POST /daily-cash-reports/close-shift
   Kunlik smena: DOIMO bugungi kun uchun (`report_date` yuborilmaydi — backend bugungi sanani
   o'zi oladi). Bir filialga bir kunda faqat bitta hisobot, bugun to'lov bo'lmasa ham smena
   yopilmaydi — backend 422 qaytaradi va xabar shu yerda ko'rsatiladi. */

/** Bugungi sana `DD.MM.YYYY` (mahalliy vaqt bo'yicha) — faqat ko'rsatish uchun. */
const todayLabel = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

interface Props {
  onClose: () => void;
}

const CloseShiftModal = ({ onClose }: Props) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [branchId, setBranchId] = useState('');

  const { data: branchOptions = [] } = useOptions('branches');
  // Filial bitta bo'lsa — avtomatik tanlanadi.
  const effectiveBranchId = branchId || (branchOptions.length === 1 ? String(branchOptions[0].id) : '');

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await API.post('/daily-cash-reports/close-shift', {
        branch_id: Number(effectiveBranchId),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-cash-reports'] });
      notifications.show({
        title: t('dailyCashReports.savedTitle'),
        message: t('dailyCashReports.done.closeShift'),
        color: 'green',
      });
      onClose();
    },
    onError: (error) => {
      notifications.show({
        title: t('dailyCashReports.errorTitle'),
        message: getApiErrorMessage(error, t('dailyCashReports.actionErrorMessage')),
        color: 'red',
      });
    },
  });

  const canSubmit = !!effectiveBranchId && !mutation.isPending;

  return (
    <DcrModal
      title={t('dailyCashReports.closeShiftModal.title')}
      subtitle={t('dailyCashReports.closeShiftModal.subtitle')}
      busy={mutation.isPending}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="dcr-btn dcr-btn--ghost dcr-btn--lg"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            {t('dailyCashReports.confirm.cancel')}
          </button>
          <button
            type="button"
            className="dcr-btn dcr-btn--accent dcr-btn--lg"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {t('dailyCashReports.closeShift')}
          </button>
        </>
      }
    >
      <div className="dcr-form">
        <div className="dcr-field">
          <label htmlFor="dcr-close-branch">
            {t('dailyCashReports.filters.branch')}
            <span className="dcr-req">*</span>
          </label>
          <select
            id="dcr-close-branch"
            value={effectiveBranchId}
            disabled={mutation.isPending}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">{t('dailyCashReports.filters.chooseBranch')}</option>
            {branchOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="dcr-field">
          <label htmlFor="dcr-close-date">{t('dailyCashReports.closeShiftModal.reportDate')}</label>
          <input
            id="dcr-close-date"
            type="text"
            readOnly
            tabIndex={-1}
            value={`${todayLabel()} (${t('dailyCashReports.closeShiftModal.today')})`}
          />
        </div>
      </div>

      <p className="dcr-hint">
        <InfoHint withLabel text={t('dailyCashReports.closeShiftModal.hint')} />
      </p>
    </DcrModal>
  );
};

export default CloseShiftModal;
