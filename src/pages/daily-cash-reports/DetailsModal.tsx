import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { API } from '@/api/api';
import { formatDate, formatDateTime } from '@/utils/date';
import DcrModal from './Modal';
import {
  type DailyCashReport,
  type DetailsResponse,
  type ReportLog,
  formatMoney,
  personName,
} from './dailyCashReports.types';

/* «Batafsil» modali — spetsifikatsiyadagi uchta ko'rinish bitta modalga yig'ilgan:
     balance   → «Баланс»  (jamg'armalarning chiqimdan oldingi holati)
     expenses  → «Чиқим»   (kun bo'yicha chiqimlar ro'yxati)
     remainder → «Қолдиқ»  (jamg'armalarning chiqimdan keyingi holati)
   Ustiga audit jurnali (`/logs`) alohida tab sifatida qo'shilgan. */

type Tab = 'balance' | 'expenses' | 'remainder' | 'logs';

const TABS: Tab[] = ['balance', 'expenses', 'remainder', 'logs'];

interface Props {
  reportId: number;
  onClose: () => void;
}

const DailyCashReportDetails = ({ reportId, onClose }: Props) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('balance');

  const { data: report } = useQuery<DailyCashReport | null>({
    queryKey: ['daily-cash-report', reportId],
    queryFn: async () => {
      const { data } = await API.get(`/daily-cash-reports/${reportId}`);
      return data?.data ?? data ?? null;
    },
    staleTime: 60 * 1000,
  });

  const {
    data: details,
    isLoading,
    isError,
  } = useQuery<DetailsResponse>({
    queryKey: ['daily-cash-report-details', reportId],
    queryFn: async () => {
      const { data } = await API.get(`/daily-cash-reports/${reportId}/details`);
      const payload = data?.data ?? data ?? {};
      return {
        balance: Array.isArray(payload.balance) ? payload.balance : [],
        expenses: Array.isArray(payload.expenses) ? payload.expenses : [],
        remainder: Array.isArray(payload.remainder) ? payload.remainder : [],
        totals: payload.totals ?? {},
      };
    },
    staleTime: 60 * 1000,
  });

  // Jurnal faqat o'sha tab ochilganda yuklanadi.
  const { data: logs = [], isLoading: logsLoading } = useQuery<ReportLog[]>({
    queryKey: ['daily-cash-report-logs', reportId],
    queryFn: async () => {
      const { data } = await API.get(`/daily-cash-reports/${reportId}/logs`);
      const rows = Array.isArray(data) ? data : (data?.data ?? []);
      return Array.isArray(rows) ? rows : [];
    },
    enabled: tab === 'logs',
    staleTime: 60 * 1000,
  });

  const totals = details?.totals ?? {};

  const subtitle = report
    ? `${report.report_number ?? `#${reportId}`} · ${formatDate(report.report_date, '-')}`
    : `#${reportId}`;

  /** Jamg'armalar jadvali — «Баланс» va «Қолдиқ» bir xil ustunlarga ega. */
  const renderJamgarmaTable = (rows: DetailsResponse['balance']) => (
    <table className="dcr-inner-table">
      <thead>
        <tr>
          <th>{t('dailyCashReports.details.jamgarma')}</th>
          <th className="dcr-num-col">{t('dailyCashReports.details.cash')}</th>
          <th className="dcr-num-col">{t('dailyCashReports.details.nonCash')}</th>
          <th className="dcr-num-col">{t('dailyCashReports.details.total')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={4} className="dcr-empty">
              {t('dailyCashReports.details.noRows')}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            <tr key={row.jamgarma_id ?? i}>
              <td>{row.jamgarma_name || '-'}</td>
              <td className="dcr-num">{formatMoney(row.cash)}</td>
              <td className="dcr-num">{formatMoney(row.non_cash)}</td>
              <td className="dcr-num dcr-strong">{formatMoney(row.total)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  return (
    <DcrModal
      title={t('dailyCashReports.details.title')}
      subtitle={subtitle}
      size="wide"
      onClose={onClose}
    >
      {report && (
        <div className="dcr-summary">
          <div className="dcr-summary-item">
            <span className="dcr-summary-label">{t('dailyCashReports.table.branch')}</span>
            <span className="dcr-summary-value">
              {report.branch?.name_uz || report.branch?.name || '-'}
            </span>
          </div>
          <div className="dcr-summary-item">
            <span className="dcr-summary-label">{t('dailyCashReports.table.cashier')}</span>
            <span className="dcr-summary-value">{personName(report.cashier)}</span>
          </div>
          <div className="dcr-summary-item">
            <span className="dcr-summary-label">{t('dailyCashReports.details.totalIncome')}</span>
            <span className="dcr-summary-value">{formatMoney(report.total_income)}</span>
          </div>
          <div className="dcr-summary-item">
            <span className="dcr-summary-label">{t('dailyCashReports.details.totalExpense')}</span>
            <span className="dcr-summary-value">{formatMoney(report.total_expense)}</span>
          </div>
          <div className="dcr-summary-item">
            <span className="dcr-summary-label">{t('dailyCashReports.table.status')}</span>
            <span className={`dcr-status dcr-status--${report.status || 'created'}`}>
              {t(`dailyCashReports.status.${report.status}`, {
                defaultValue: report.status || '-',
              })}
            </span>
          </div>
        </div>
      )}

      <div className="dcr-tabs" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`dcr-tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {t(`dailyCashReports.details.tabs.${key}`)}
          </button>
        ))}
      </div>

      {isLoading && tab !== 'logs' ? (
        <p className="dcr-empty">{t('dailyCashReports.loading')}</p>
      ) : isError && tab !== 'logs' ? (
        <p className="dcr-empty">{t('dailyCashReports.error')}</p>
      ) : (
        <div className="dcr-tab-panel">
          {tab === 'balance' && renderJamgarmaTable(details?.balance ?? [])}
          {tab === 'remainder' && renderJamgarmaTable(details?.remainder ?? [])}

          {tab === 'expenses' && (
            <table className="dcr-inner-table">
              <thead>
                <tr>
                  <th>{t('dailyCashReports.details.date')}</th>
                  <th>{t('dailyCashReports.details.jamgarma')}</th>
                  <th>{t('dailyCashReports.details.category')}</th>
                  <th>{t('dailyCashReports.details.subcategory')}</th>
                  <th>{t('dailyCashReports.details.info')}</th>
                  <th className="dcr-num-col">{t('dailyCashReports.details.cash')}</th>
                  <th className="dcr-num-col">{t('dailyCashReports.details.nonCash')}</th>
                  <th className="dcr-num-col">{t('dailyCashReports.details.amount')}</th>
                  <th>{t('dailyCashReports.details.employee')}</th>
                </tr>
              </thead>
              <tbody>
                {(details?.expenses ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={9} className="dcr-empty">
                      {t('dailyCashReports.details.noRows')}
                    </td>
                  </tr>
                ) : (
                  (details?.expenses ?? []).map((row, i) => (
                    <tr key={i}>
                      <td>{formatDate(row.expense_date, '-')}</td>
                      <td>{row.jamgarma || '-'}</td>
                      <td>{row.category || '-'}</td>
                      <td>{row.subcategory || '-'}</td>
                      <td>{row.info || '-'}</td>
                      <td className="dcr-num">{formatMoney(row.cash_amount)}</td>
                      <td className="dcr-num">{formatMoney(row.non_cash_amount)}</td>
                      <td className="dcr-num dcr-strong">{formatMoney(row.amount)}</td>
                      <td>{row.employee || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === 'logs' &&
            (logsLoading ? (
              <p className="dcr-empty">{t('dailyCashReports.loading')}</p>
            ) : (
              <table className="dcr-inner-table">
                <thead>
                  <tr>
                    <th>{t('dailyCashReports.logs.action')}</th>
                    <th>{t('dailyCashReports.logs.fromStatus')}</th>
                    <th>{t('dailyCashReports.logs.toStatus')}</th>
                    <th>{t('dailyCashReports.logs.note')}</th>
                    <th>{t('dailyCashReports.logs.user')}</th>
                    <th>{t('dailyCashReports.logs.date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="dcr-empty">
                        {t('dailyCashReports.details.noRows')}
                      </td>
                    </tr>
                  ) : (
                    logs.map((log, i) => (
                      <tr key={log.id ?? i}>
                        <td>{log.action || '-'}</td>
                        <td>
                          {log.from_status
                            ? t(`dailyCashReports.status.${log.from_status}`, {
                                defaultValue: log.from_status,
                              })
                            : '-'}
                        </td>
                        <td>
                          {log.to_status
                            ? t(`dailyCashReports.status.${log.to_status}`, {
                                defaultValue: log.to_status,
                              })
                            : '-'}
                        </td>
                        <td>{log.note || '-'}</td>
                        <td>{personName(log.user)}</td>
                        <td>{formatDateTime(log.created_at, '-')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ))}
        </div>
      )}

      {tab !== 'logs' && (
        <div className="dcr-totals">
          <span>
            {t('dailyCashReports.table.expenseBalance')}:{' '}
            <b>{formatMoney(totals.expense_balance_total)}</b>
          </span>
          <span>
            {t('dailyCashReports.table.cashExpense')}: <b>{formatMoney(totals.cash_expense)}</b>
          </span>
          <span>
            {t('dailyCashReports.details.nonCashExpense')}:{' '}
            <b>{formatMoney(totals.non_cash_expense)}</b>
          </span>
          <span>
            {t('dailyCashReports.details.totalExpense')}: <b>{formatMoney(totals.total_expense)}</b>
          </span>
          <span>
            {t('dailyCashReports.table.remainder')}: <b>{formatMoney(totals.remainder_total)}</b>
          </span>
        </div>
      )}
    </DcrModal>
  );
};

export default DailyCashReportDetails;
