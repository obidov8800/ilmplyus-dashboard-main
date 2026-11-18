import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageTitle from '@/components/PageTitle';
import { notifications } from '@mantine/notifications';
import { API } from '@/api/api';
import { useOptions } from '@/api/options';
import { Protected } from '@/components/Protected';
import { usePermission } from '@/hooks/usePermission';
import ConfirmModal from '@/components/ConfirmModal';
import PaginationBar from '@/components/Pagination/PaginationBar';
import FilterBar, { type FilterBarField } from '@/components/FilterBar';
import { type FilterBarValues } from '@/components/FilterBar/filterBar.utils';
import { formatDate, dateToIso } from '@/utils/date';
import { getLocalized } from '@/utils/getLocalized';
import { getApiErrorMessage } from '@/utils/apiError';
import DailyCashReportDetails from './DetailsModal';
import CorrectModal from './CorrectModal';
import CloseShiftModal from './CloseShiftModal';
import { type DailyCashReport, formatMoney, personName } from './dailyCashReports.types';
import './dailyCashReports.css';

/* ------------------------------------------------------------------ *
 * Kunlik kassa hisobotlari — Moliya bo'limi.
 *
 * Smena yakunida har bir filial bo'yicha hisobot shakllantiriladi va
 * status zanjiri bo'ylab o'tadi:
 *   created → sent → assistant_accepted → accountant_approved
 * Istalgan bosqichda `returned` ga qaytarilishi, tuzatilgach `finalized`
 * bo'lishi mumkin. Tugmalar status + ruxsatga qarab ko'rinadi.
 * ------------------------------------------------------------------ */

type FilterKey = 'view' | 'date' | 'branch_id' | 'status';

/** Status zanjiri — tugmalarni ko'rsatish shartlari shu kodlarga bog'liq. */
const STATUSES = [
  'created',
  'sent',
  'assistant_accepted',
  'accountant_approved',
  'returned',
  'finalized',
] as const;

/** Backend `per_page` bermasa shu qiymat ishlatiladi. */
const FALLBACK_PER_PAGE = 20;

/** Ko'rinish presetlari — sanani `date` yoki `date_from`/`date_to` ga aylantiradi. */
const VIEW_PRESETS = ['today', 'week', 'month', 'custom'] as const;

type WorkflowAction = 'send' | 'accept' | 'approve' | 'return';

/** Tasdiqlash modali holati: qaysi hisobot uchun qaysi amal so'ralmoqda. */
type ConfirmState = { id: number; action: WorkflowAction; label: string } | null;

interface PaginatedResponse {
  rows: DailyCashReport[];
  total: number;
  perPage: number;
  lastPage: number;
}

const EMPTY_FILTERS: FilterBarValues<FilterKey> = {
  view: '',
  date: '',
  branch_id: '',
  status: '',
};

/** Bo'sh filtrlarni so'rovga qo'shmaymiz. */
const cleanParams = (obj: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );

/** Joriy haftaning dushanbasi — backend haftani dushanbadan boshlaydi. */
function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  const shift = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - shift);
  return copy;
}

/**
 * "Ko'rinish" presetini so'rov parametrlariga aylantiradi.
 * `custom` da foydalanuvchi tanlagan aniq kun (`date`) yuboriladi.
 */
function periodParams(view: string, date: string): Record<string, string> {
  const today = new Date();
  if (view === 'today') return { date: dateToIso(today) };
  if (view === 'week') {
    // Backend haftani dushanba–shanba deb oladi.
    const monday = startOfWeek(today);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    return { date_from: dateToIso(monday), date_to: dateToIso(saturday) };
  }
  if (view === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { date_from: dateToIso(first), date_to: dateToIso(last) };
  }
  if (view === 'custom' && date) return { date };
  return {};
}

const LockIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const DailyCashReports = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || 'uz';
  const queryClient = useQueryClient();
  const canView = usePermission('daily_cash_reports.view');

  const [filters, setFilters] = useState<FilterBarValues<FilterKey>>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(FALLBACK_PER_PAGE);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [detailsId, setDetailsId] = useState<number | null>(null);
  const [correctReport, setCorrectReport] = useState<DailyCashReport | null>(null);
  const [closeShiftOpen, setCloseShiftOpen] = useState(false);

  const { data: branchOptions = [] } = useOptions('branches');

  const fields: FilterBarField<FilterKey>[] = [
    {
      key: 'view',
      label: t('dailyCashReports.filters.view'),
      type: 'select',
      placeholder: t('dailyCashReports.filters.view'),
      options: VIEW_PRESETS.map((v) => ({ value: v, label: t(`dailyCashReports.view.${v}`) })),
    },
    {
      // Faqat "Sana bo'yicha" tanlanganda ochiladi — qolgan presetlar sanani o'zi hisoblaydi.
      key: 'date',
      label: t('dailyCashReports.filters.date'),
      type: 'date',
      hidden: filters.view !== 'custom',
    },
    {
      key: 'branch_id',
      label: t('dailyCashReports.filters.branch'),
      type: 'select',
      placeholder: t('dailyCashReports.filters.allBranches'),
      options: branchOptions.map((o) => ({ value: o.id, label: o.label })),
    },
    {
      key: 'status',
      label: t('dailyCashReports.filters.status'),
      type: 'select',
      placeholder: t('dailyCashReports.filters.status'),
      options: STATUSES.map((s) => ({ value: s, label: t(`dailyCashReports.status.${s}`) })),
    },
  ];

  const params = useMemo(
    () =>
      cleanParams({
        ...periodParams(filters.view, filters.date),
        branch_id: filters.branch_id,
        status: filters.status,
        per_page: pageSize,
      }),
    [filters, pageSize],
  );

  const { data, isLoading, isError } = useQuery<PaginatedResponse>({
    queryKey: ['daily-cash-reports', params, page],
    queryFn: async () => {
      const { data } = await API.get('/daily-cash-reports', { params: { ...params, page } });
      // Paginator bo'lmasa (oddiy massiv) — hammasi bitta sahifa deb qaraladi.
      const rows: DailyCashReport[] = Array.isArray(data) ? data : (data?.data ?? []);
      const meta = data?.meta;
      return {
        rows: Array.isArray(rows) ? rows : [],
        total: meta?.total ?? rows.length,
        perPage: meta?.per_page ?? FALLBACK_PER_PAGE,
        lastPage: meta?.last_page ?? 1,
      };
    },
    // Sahifa almashganda jadval bo'shab ketmasin.
    placeholderData: (previous) => previous,
    staleTime: 2 * 60 * 1000,
    enabled: canView,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const perPage = data?.perPage ?? pageSize;
  const totalPages = Math.max(1, data?.lastPage ?? 1);
  const start = (page - 1) * perPage;

  // Sahifalar soni kamayib qolsa oxirgi mavjud sahifaga qaytamiz — effekt emas,
  // render fazasida: https://react.dev/learn/you-might-not-need-an-effect
  const [lastSeenTotalPages, setLastSeenTotalPages] = useState(totalPages);
  if (totalPages !== lastSeenTotalPages) {
    setLastSeenTotalPages(totalPages);
    if (page > totalPages) setPage(totalPages);
  }

  const workflowMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      reason,
    }: {
      id: number;
      action: WorkflowAction;
      reason?: string;
    }) => {
      // Qaytarishda `reason` majburiy — yuborilmasa backend 422 qaytaradi.
      const body = action === 'return' ? { reason } : undefined;
      const { data } = await API.post(`/daily-cash-reports/${id}/${action}`, body);
      return data;
    },
    onSuccess: (_d, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['daily-cash-reports'] });
      notifications.show({
        title: t('dailyCashReports.savedTitle'),
        message: t(`dailyCashReports.done.${action}`),
        color: action === 'return' ? 'orange' : 'green',
      });
    },
    onError: (error) => {
      notifications.show({
        title: t('dailyCashReports.errorTitle'),
        message: getApiErrorMessage(error, t('dailyCashReports.actionErrorMessage')),
        color: 'red',
      });
    },
    onSettled: () => setConfirmState(null),
  });

  const branchName = (report: DailyCashReport) => {
    const branch = report.branch;
    if (!branch) return '-';
    const localized = getLocalized(branch, 'name', lang);
    return localized !== '-' ? localized : (branch.name_uz ?? branch.name ?? '-');
  };

  if (!canView) return null;

  const colCount = 13;

  return (
    <div className="dcr-container container">
      <div className="dcr-header">
        <div className="dcr-heading">
          <PageTitle title={t('dailyCashReports.title')} icon="fa-cash-register" spaced={false} />
        </div>
      </div>

      <div className="dcr-filter-toolbar">
        <FilterBar
          fields={fields}
          values={filters}
          onChange={(v) => {
            // Preset almashganda eski aniq sana osilib qolmasin.
            const next = v.view === 'custom' ? v : { ...v, date: '' };
            setFilters(next);
            setPage(1);
          }}
          onReset={() => {
            setFilters(EMPTY_FILTERS);
            setPage(1);
          }}
          showReset={false}
          ariaLabel={t('dailyCashReports.title')}
        />
        {/* «Smenani yopish» — kassir bugungi kun uchun hisobot shakllantiradi (`daily_cash_reports.close_shift`). */}
        <Protected permission="daily_cash_reports.close_shift">
          <button
            type="button"
            className="dcr-btn dcr-btn--accent dcr-btn--lg dcr-close-btn"
            onClick={() => setCloseShiftOpen(true)}
          >
            <LockIcon />
            {t('dailyCashReports.closeShift')}
          </button>
        </Protected>
      </div>

      <div className="dcr-card">
        <div className="dcr-table-scroll">
          <table className="dcr-table">
            <thead>
              <tr>
                <th rowSpan={2}>{t('dailyCashReports.table.no')}</th>
                <th rowSpan={2}>{t('dailyCashReports.table.reportNumber')}</th>
                <th rowSpan={2}>{t('dailyCashReports.table.date')}</th>
                <th rowSpan={2}>{t('dailyCashReports.table.branch')}</th>
                <th rowSpan={2}>{t('dailyCashReports.table.cashier')}</th>
                <th colSpan={3} className="dcr-group dcr-group--income">
                  {t('dailyCashReports.table.income')}
                </th>
                <th colSpan={3} className="dcr-group dcr-group--expense">
                  {t('dailyCashReports.table.expense')}
                </th>
                <th rowSpan={2}>{t('dailyCashReports.table.status')}</th>
                <th rowSpan={2}>{t('dailyCashReports.table.actions')}</th>
              </tr>
              <tr>
                <th className="dcr-sub dcr-sub--income">{t('dailyCashReports.table.cash')}</th>
                <th className="dcr-sub dcr-sub--income">{t('dailyCashReports.table.card')}</th>
                <th className="dcr-sub dcr-sub--income">{t('dailyCashReports.table.qr')}</th>
                <th className="dcr-sub dcr-sub--expense">
                  {t('dailyCashReports.table.expenseBalance')}
                </th>
                <th className="dcr-sub dcr-sub--expense">
                  {t('dailyCashReports.table.cashExpense')}
                </th>
                <th className="dcr-sub dcr-sub--expense">
                  {t('dailyCashReports.table.remainder')}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={colCount} className="dcr-empty">
                    {t('dailyCashReports.loading')}
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={colCount} className="dcr-empty">
                    {t('dailyCashReports.error')}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="dcr-empty">
                    {t('dailyCashReports.noData')}
                  </td>
                </tr>
              ) : (
                rows.map((report, index) => {
                  const status = report.status ?? '';
                  const rowBusy =
                    workflowMutation.isPending && workflowMutation.variables?.id === report.id;
                  // Tugma ko'rinish shartlari — spetsifikatsiyadagi status zanjiri.
                  const canSend = status === 'created' || status === 'returned';
                  const canAccept = status === 'sent';
                  const canApprove = status === 'assistant_accepted';
                  const canReturn = status === 'sent' || status === 'assistant_accepted';
                  const canCorrect = status === 'returned';

                  return (
                    <tr key={report.id}>
                      <td>{start + index + 1}</td>
                      <td className="dcr-strong">{report.report_number || report.id}</td>
                      <td>{formatDate(report.report_date, '-')}</td>
                      <td>{branchName(report)}</td>
                      <td>{personName(report.cashier)}</td>
                      <td className="dcr-num dcr-num--income">{formatMoney(report.cash_income)}</td>
                      <td className="dcr-num dcr-num--income">{formatMoney(report.card_income)}</td>
                      <td className="dcr-num dcr-num--income">{formatMoney(report.qr_income)}</td>
                      <td className="dcr-num dcr-num--expense">
                        {formatMoney(report.expense_balance_total)}
                      </td>
                      <td className="dcr-num dcr-num--expense">
                        {formatMoney(report.cash_expense)}
                      </td>
                      <td className="dcr-num dcr-num--expense">
                        {formatMoney(report.remainder_total)}
                      </td>
                      <td>
                        <span className={`dcr-status dcr-status--${status || 'created'}`}>
                          {t(`dailyCashReports.status.${status}`, {
                            defaultValue: status || '-',
                          })}
                        </span>
                      </td>
                      <td>
                        <div className="dcr-actions">
                          <button
                            type="button"
                            className="dcr-btn dcr-btn--primary"
                            onClick={() => setDetailsId(report.id)}
                          >
                            {t('dailyCashReports.actions.details')}
                          </button>

                          {canSend && (
                            <Protected permission="daily_cash_reports.send">
                              <button
                                type="button"
                                className="dcr-btn dcr-btn--accent"
                                disabled={rowBusy}
                                onClick={() =>
                                  setConfirmState({
                                    id: report.id,
                                    action: 'send',
                                    label: report.report_number || String(report.id),
                                  })
                                }
                              >
                                {t('dailyCashReports.actions.send')}
                              </button>
                            </Protected>
                          )}

                          {canAccept && (
                            <Protected permission="daily_cash_reports.accept">
                              <button
                                type="button"
                                className="dcr-btn dcr-btn--success"
                                disabled={rowBusy}
                                onClick={() =>
                                  setConfirmState({
                                    id: report.id,
                                    action: 'accept',
                                    label: report.report_number || String(report.id),
                                  })
                                }
                              >
                                {t('dailyCashReports.actions.accept')}
                              </button>
                            </Protected>
                          )}

                          {canApprove && (
                            <Protected permission="daily_cash_reports.approve">
                              <button
                                type="button"
                                className="dcr-btn dcr-btn--success"
                                disabled={rowBusy}
                                onClick={() =>
                                  setConfirmState({
                                    id: report.id,
                                    action: 'approve',
                                    label: report.report_number || String(report.id),
                                  })
                                }
                              >
                                {t('dailyCashReports.actions.approve')}
                              </button>
                            </Protected>
                          )}

                          {canReturn && (
                            <Protected permission="daily_cash_reports.return_for_correction">
                              <button
                                type="button"
                                className="dcr-btn dcr-btn--danger"
                                disabled={rowBusy}
                                onClick={() =>
                                  setConfirmState({
                                    id: report.id,
                                    action: 'return',
                                    label: report.report_number || String(report.id),
                                  })
                                }
                              >
                                {t('dailyCashReports.actions.return')}
                              </button>
                            </Protected>
                          )}

                          {canCorrect && (
                            <Protected permission="daily_cash_reports.correct">
                              <button
                                type="button"
                                className="dcr-btn dcr-btn--primary"
                                onClick={() => setCorrectReport(report)}
                              >
                                {t('dailyCashReports.actions.correct')}
                              </button>
                            </Protected>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && total > 0 && (
          <PaginationBar
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>

      {detailsId !== null && (
        <DailyCashReportDetails reportId={detailsId} onClose={() => setDetailsId(null)} />
      )}


      {correctReport && (
        <CorrectModal report={correctReport} onClose={() => setCorrectReport(null)} />
      )}

      {closeShiftOpen && <CloseShiftModal onClose={() => setCloseShiftOpen(false)} />}

      <ConfirmModal
        open={!!confirmState}
        title={t(`dailyCashReports.confirm.${confirmState?.action ?? 'send'}Title`)}
        message={t(`dailyCashReports.confirm.${confirmState?.action ?? 'send'}Message`, {
          name: confirmState?.label ?? '',
        })}
        confirmLabel={t(`dailyCashReports.actions.${confirmState?.action ?? 'send'}`)}
        cancelLabel={t('dailyCashReports.confirm.cancel')}
        tone={confirmState?.action === 'return' ? 'danger' : 'success'}
        busy={workflowMutation.isPending}
        // Tuzatishga qaytarishda sabab backendda majburiy.
        reasonRequired={confirmState?.action === 'return'}
        reasonLabel={t('dailyCashReports.confirm.reasonLabel')}
        onConfirm={(reason) =>
          confirmState &&
          workflowMutation.mutate({ id: confirmState.id, action: confirmState.action, reason })
        }
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
};

export default DailyCashReports;
