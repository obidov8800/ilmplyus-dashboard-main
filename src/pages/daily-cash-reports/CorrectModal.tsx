import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import { notifications } from '@mantine/notifications';
import { API } from '@/api/api';
import { formatDate } from '@/utils/date';
import { getApiErrorMessage } from '@/utils/apiError';
import DcrModal from './Modal';
import { type DailyCashReport } from './dailyCashReports.types';

/* «Tuzatish» (admin) — POST /daily-cash-reports/{id}/correct
   Faqat `returned` holatidagi hisobot uchun. Hamma maydonlar ixtiyoriy:
   o'zgarmagan maydonlar so'rovga umuman qo'shilmaydi. */

/** Formaga chiqadigan summa maydonlari — backend so'ragan nomlar bilan bir xil. */
const MONEY_FIELDS = [
  'cash_income',
  'card_income',
  'qr_income',
  'bank_income',
  'paynet_income',
  'cash_expense',
  'non_cash_expense',
] as const;

type MoneyField = (typeof MONEY_FIELDS)[number];

interface Props {
  report: DailyCashReport;
  onClose: () => void;
}

/** Backend "1000000.00" qaytaradi — input uchun kasr nollarini olib tashlaymiz. */
const toInputValue = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  return Number.isFinite(amount) ? String(amount) : String(value);
};

const CorrectModal = ({ report, onClose }: Props) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [values, setValues] = useState<Record<MoneyField, string>>(() =>
    MONEY_FIELDS.reduce(
      (acc, key) => ({ ...acc, [key]: toInputValue(report[key]) }),
      {} as Record<MoneyField, string>,
    ),
  );
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      // Faqat haqiqatan o'zgargan maydonlar yuboriladi.
      const payload: Record<string, unknown> = {};
      MONEY_FIELDS.forEach((key) => {
        const next = values[key].trim();
        if (next !== '' && next !== toInputValue(report[key])) payload[key] = Number(next);
      });
      if (note.trim()) payload.note = note.trim();

      const { data } = await API.post(`/daily-cash-reports/${report.id}/correct`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-cash-reports'] });
      queryClient.invalidateQueries({ queryKey: ['daily-cash-report', report.id] });
      queryClient.invalidateQueries({ queryKey: ['daily-cash-report-details', report.id] });
      notifications.show({
        title: t('dailyCashReports.savedTitle'),
        message: t('dailyCashReports.done.correct'),
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

  return (
    <DcrModal
      title={t('dailyCashReports.correctModal.title')}
      subtitle={`${report.report_number ?? `#${report.id}`} · ${formatDate(report.report_date, '-')}`}
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
            className="dcr-btn dcr-btn--primary dcr-btn--lg"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('dailyCashReports.correctModal.save')}
          </button>
        </>
      }
    >
      <div className="dcr-form dcr-form--grid">
        {MONEY_FIELDS.map((key) => (
          <div className="dcr-field" key={key}>
            <label htmlFor={`dcr-correct-${key}`}>{t(`dailyCashReports.fields.${key}`)}</label>
            <input
              id={`dcr-correct-${key}`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={values[key]}
              disabled={mutation.isPending}
              onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="dcr-field">
        <label htmlFor="dcr-correct-note">{t('dailyCashReports.fields.note')}</label>
        <textarea
          id="dcr-correct-note"
          value={note}
          disabled={mutation.isPending}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <p className="dcr-hint">
        <InfoHint withLabel text={t('dailyCashReports.correctModal.hint')} />
      </p>
    </DcrModal>
  );
};

export default CorrectModal;
