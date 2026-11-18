import { useBulkDelete } from '@/hooks/useBulkDelete';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageTitle from '@/components/PageTitle';
import { notifications } from '@mantine/notifications';
import { useOptions } from '@/hooks/useOptions';
import { usePermission } from '@/hooks/usePermission';
import ConfirmModal from '@/components/ConfirmModal';
import FilterBar, { type FilterBarField } from '@/components/FilterBar';
import { type FilterBarValues } from '@/components/FilterBar/filterBar.utils';
import PaginationBar from '@/components/Pagination/PaginationBar';
import { formatDate } from '@/utils/date';
import { getApiErrorMessage } from '@/utils/apiError';
import { formatMoney, monthI18nKey } from '../payroll-sheets/helpers';
import {
  PER_PAGE,
  isBackendMissing,
  useDeleteDistribution,
  useDistributionAction,
  useDistributionRequests,
  type DistributionRequest,
  type DistributionStatus,
} from './api';
import './payrollDistributionRequests.css';
import StatusBadge from '@/components/StatusBadge';

/* ------------------------------------------------------------------ *
 * Oylik taqsimlash so'rovlari — Moliya bo'limi.
 *
 * Backendning HAQIQIY kontrakti (User paneldagi sahifa bilan bir xil):
 * saqlangan taqsimlash QORALAMA (`draft`) bo'ladi; tasdiqlangandan keyingina
 * (`approved`) oylik vedomostga tushadi. Tugmalar statusga + ruxsatga qarab chiqadi:
 *   draft    → «Tasdiqlash»          `payroll_distributions.approve`  (POST …/approve)
 *   approved → «Tasdiqdan qaytarish» `payroll_distributions.revert`   (POST …/revert)
 *   `is_editable` + `payroll_distributions.delete` (yoki `.edit`) → «O'chirish»
 * (Avval bu sahifa taklif qilingan ikki bosqichli — direktor/bosh admin — shartnomaga
 * yozilgan edi; backend uni hech qachon amalga oshirmagan: `director-approve`,
 * `admin-approve`, `reject` endpointlari YO'Q, 404.)
 * ------------------------------------------------------------------ */

type FilterKey = 'period' | 'branch_id' | 'department_id' | 'last_name';

const EMPTY_FILTERS: FilterBarValues<FilterKey> = {
  period: '',
  branch_id: '',
  department_id: '',
  last_name: '',
};

const STATUS_TABS: ('' | DistributionStatus)[] = ['', 'draft', 'approved'];

const STATUS_TONE: Record<DistributionStatus, 'warning' | 'success'> = {
  draft: 'warning',
  approved: 'success',
};

/** Faqat nolmas summalar — taqsimlash sxemasiga qarab har xil to'plam keladi. */
function amountLines(row: DistributionRequest, t: (key: string) => string) {
  const all: [string, number][] = [
    [t('payrollDistributionRequests.amounts.totalCashless'), row.total_cashless],
    [t('payrollDistributionRequests.amounts.advanceCashless'), row.advance_cashless],
    [t('payrollDistributionRequests.amounts.advanceCash'), row.advance_cash],
    [t('payrollDistributionRequests.amounts.payoutCashless'), row.payout_cashless],
    [t('payrollDistributionRequests.amounts.payoutCash'), row.payout_cash],
    [t('payrollDistributionRequests.amounts.privileged'), row.privileged_amount],
  ];
  return all.filter(([, value]) => value !== 0);
}

type ConfirmKind = 'approve' | 'revert' | 'delete';
type ConfirmState = { id: number; kind: ConfirmKind; name: string } | null;

const PayrollDistributionRequests = () => {
  const { t } = useTranslation();
  const canApprove = usePermission('payroll_distributions.approve');
  const canRevert = usePermission('payroll_distributions.revert');
  const canDeletePermission = usePermission('payroll_distributions.delete');
  const canEditPermission = usePermission('payroll_distributions.edit');
  const canDelete = canDeletePermission || canEditPermission;

  const [filters, setFilters] = useState<FilterBarValues<FilterKey>>(EMPTY_FILTERS);
  const [status, setStatus] = useState<'' | DistributionStatus>('');
  const [page, setPage] = useState(1);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [detail, setDetail] = useState<DistributionRequest | null>(null);

  const { data: branchOptions = [] } = useOptions('branches');
  const { data: departmentOptions = [] } = useOptions('departments');

  const fields: FilterBarField<FilterKey>[] = [
    { key: 'period', label: t('payrollDistributionRequests.filters.period'), type: 'date' },
    {
      key: 'branch_id',
      label: t('payrollDistributionRequests.filters.branch'),
      type: 'select',
      placeholder: t('payrollDistributionRequests.filters.all'),
      options: branchOptions.map((o) => ({ value: o.id, label: o.label })),
    },
    {
      key: 'department_id',
      label: t('payrollDistributionRequests.filters.department'),
      type: 'select',
      placeholder: t('payrollDistributionRequests.filters.all'),
      options: departmentOptions.map((o) => ({ value: o.id, label: o.label })),
    },
    {
      key: 'last_name',
      label: t('payrollDistributionRequests.filters.lastName'),
      type: 'text',
      placeholder: t('payrollDistributionRequests.filters.lastName'),
    },
  ];

  // "Davr" sanasidan period_year / period_month ajratiladi.
  const requestFilters = useMemo(() => {
    const period = filters.period ?? '';
    const [year, month] = period ? period.split('-') : [];
    return {
      status,
      period_year: year ?? '',
      period_month: month ? String(Number(month)) : '',
      branch_id: filters.branch_id ?? '',
      department_id: filters.department_id ?? '',
      last_name: filters.last_name ?? '',
    };
  }, [filters, status]);

  const { data, isLoading, isError, error } = useDistributionRequests(requestFilters, page);
  const action = useDistributionAction();
  const remove = useDeleteDistribution();
  const busy = action.isPending || remove.isPending;

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, data?.lastPage ?? 1);

  // Sahifalar soni kamayib qolsa oxirgi mavjud sahifaga qaytamiz (render fazasida).
  const [seenLastPage, setSeenLastPage] = useState(lastPage);
  if (lastPage !== seenLastPage) {
    setSeenLastPage(lastPage);
    if (page > lastPage) setPage(lastPage);
  }

  const canRemove = (row: DistributionRequest) => row.is_editable && canDelete;

  const bulk = useBulkDelete({ rows, allowed: canDelete, scope: JSON.stringify([page, requestFilters]), eligible: canRemove, remove: row => remove.mutateAsync(row.id), refresh: () => {} });
  const runConfirmed = () => {
    if (!confirmState) return;
    const { id, kind } = confirmState;
    const done = (message: string | undefined, fallbackKey: string) => {
      notifications.show({
        title: t('payrollDistributionRequests.savedTitle'),
        message: message || t(fallbackKey),
        color: kind === 'approve' ? 'green' : 'orange',
      });
      setDetail(null);
    };
    const fail = (err: unknown) =>
      notifications.show({
        title: t('payrollDistributionRequests.errorTitle'),
        message: getApiErrorMessage(err, t('payrollDistributionRequests.actionError')),
        color: 'red',
      });

    if (kind === 'delete') {
      remove.mutate(id, {
        onSuccess: (res) => done(res?.message, 'payrollDistributionRequests.deletedMessage'),
        onError: fail,
        onSettled: () => setConfirmState(null),
      });
      return;
    }
    action.mutate(
      { id, action: kind },
      {
        onSuccess: (res) =>
          done(
            res?.message,
            kind === 'approve'
              ? 'payrollDistributionRequests.approvedMessage'
              : 'payrollDistributionRequests.revertedMessage',
          ),
        onError: fail,
        onSettled: () => setConfirmState(null),
      },
    );
  };

  const periodLabel = (row: DistributionRequest) =>
    row.period_year && row.period_month
      ? `${t(monthI18nKey(row.period_month))} ${row.period_year}`
      : '—';
  const kindLabel = (kind: string) =>
    ['advance', 'salary', 'combined'].includes(kind)
      ? t(`payrollDistributionRequests.kind.${kind}`)
      : kind || '—';

  /** Tasdiq ma'lumoti: kim va qachon tasdiqlagan (yoki kutilmoqda). */
  const approvalView = (row: DistributionRequest) =>
    row.status === 'approved' ? (
      <>
        <span className="pdr-name">{row.approved_by || '—'}</span>
        {row.approved_at && <span className="pdr-sub">{formatDate(row.approved_at, '')}</span>}
      </>
    ) : (
      <span className="pdr-sub">{t('payrollDistributionRequests.approval.waiting')}</span>
    );

  const actionButtons = (row: DistributionRequest) => {
    const name = row.employee_name || '-';
    return (
      <>
        {row.status === 'draft' && canApprove && (
          <button
            type="button"
            className="pdr-btn pdr-btn--success"
            disabled={busy}
            onClick={() => setConfirmState({ id: row.id, kind: 'approve', name })}
          >
            {t('payrollDistributionRequests.actions.approve')}
          </button>
        )}
        {row.status === 'approved' && canRevert && (
          <button
            type="button"
            className="pdr-btn pdr-btn--warning"
            disabled={busy}
            onClick={() => setConfirmState({ id: row.id, kind: 'revert', name })}
          >
            {t('payrollDistributionRequests.actions.revert')}
          </button>
        )}
        {canRemove(row) && (
          <button
            type="button"
            className="pdr-btn pdr-btn--ghost-danger"
            disabled={busy}
            onClick={() => setConfirmState({ id: row.id, kind: 'delete', name })}
          >
            {t('payrollDistributionRequests.actions.delete')}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="pdr-container container">
      <div className="pdr-header">
        <PageTitle title={t('payrollDistributionRequests.title')} icon="fa-share-nodes" spaced={false} />
        <p className="pdr-subtitle">{t('payrollDistributionRequests.subtitle')}</p>
      </div>

      <div className="pdr-card">
        <div className="pdr-tabs" role="tablist">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab || 'all'}
              type="button"
              role="tab"
              aria-selected={status === tab}
              className={`pdr-tab ${status === tab ? 'pdr-tab--active' : ''}`}
              onClick={() => {
                setStatus(tab);
                setPage(1);
              }}
            >
              {tab ? t(`payrollDistributionRequests.status.${tab}`) : t('payrollDistributionRequests.tabs.all')}
            </button>
          ))}
        </div>

        {bulk.modal}
        <div className="pdr-card-filters">
          {bulk.button}
          <FilterBar
            fields={fields}
            values={filters}
            onChange={(v) => {
              setFilters(v);
              setPage(1);
            }}
            onReset={() => {
              setFilters(EMPTY_FILTERS);
              setStatus('');
              setPage(1);
            }}
            ariaLabel={t('payrollDistributionRequests.title')}
          />
        </div>

        <div className="pdr-table-scroll">
          <table className="pdr-table">
            <thead>
              <tr>
                {bulk.header}
                <th>{t('payrollDistributionRequests.table.employee')}</th>
                <th>{t('payrollDistributionRequests.table.period')}</th>
                <th>{t('payrollDistributionRequests.table.amounts')}</th>
                <th>{t('payrollDistributionRequests.table.approval')}</th>
                <th>{t('payrollDistributionRequests.table.status')}</th>
                <th>{t('payrollDistributionRequests.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6 + bulk.columnCount} className="pdr-empty">
                    {t('payrollDistributionRequests.loading')}
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={6 + bulk.columnCount} className="pdr-empty">
                    {isBackendMissing(error)
                      ? t('payrollDistributionRequests.backendMissing')
                      : getApiErrorMessage(error, t('payrollDistributionRequests.error'))}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6 + bulk.columnCount} className="pdr-empty">
                    {t('payrollDistributionRequests.noData')}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    {bulk.cell(row)}
                    <td>
                      <span className="pdr-name">{row.employee_name || '-'}</span>
                      <span className="pdr-sub">
                        {[row.department_name, row.position_name].filter(Boolean).join(' · ') ||
                          '—'}
                      </span>
                      {row.branch_name && <span className="pdr-sub">{row.branch_name}</span>}
                    </td>
                    <td>
                      <span className="pdr-name">{periodLabel(row)}</span>
                      <span className="pdr-badge">{kindLabel(row.kind)}</span>
                    </td>
                    <td>
                      <ul className="pdr-amounts">
                        {amountLines(row, t).map(([label, value]) => (
                          <li key={label}>
                            <span>{label}</span>
                            <b>{formatMoney(value)}</b>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>{approvalView(row)}</td>
                    <td>
                      <StatusBadge tone={STATUS_TONE[row.status] ?? 'neutral'}>
                        {t(`payrollDistributionRequests.status.${row.status}`)}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className="pdr-actions">
                        <button
                          type="button"
                          className="pdr-btn pdr-btn--ghost"
                          onClick={() => setDetail(row)}
                        >
                          {t('payrollDistributionRequests.actions.view')}
                        </button>
                        {actionButtons(row)}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && total > 0 && (
          <PaginationBar
            page={page}
            totalPages={lastPage}
            total={total}
            pageSize={PER_PAGE}
            onPageChange={setPage}
          />
        )}
      </div>

      {detail && (
        <div className="pdr-overlay" onClick={() => setDetail(null)}>
          <div
            className="pdr-modal"
            role="dialog"
            aria-modal="true"
            aria-label={detail.employee_name}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pdr-modal-head">
              <h2>{detail.employee_name || '-'}</h2>
              <button
                type="button"
                className="pdr-modal-close"
                onClick={() => setDetail(null)}
                aria-label={t('payrollDistributionRequests.actions.close')}
              >
                ×
              </button>
            </div>
            <div className="pdr-modal-body">
              <dl className="pdr-info">
                {[
                  [
                    t('payrollDistributionRequests.detail.deptPosition'),
                    [detail.department_name, detail.position_name].filter(Boolean).join(' · ') ||
                      '—',
                  ],
                  [t('payrollDistributionRequests.detail.branch'), detail.branch_name || '—'],
                  [t('payrollDistributionRequests.table.period'), periodLabel(detail)],
                  [t('payrollDistributionRequests.detail.kind'), kindLabel(detail.kind)],
                  ...amountLines(detail, t).map(
                    ([label, value]) => [label, `${formatMoney(value)} ${t('payrollSheets.soum')}`],
                  ),
                  [
                    t('payrollDistributionRequests.detail.createdBy'),
                    [detail.created_by, detail.created_at ? formatDate(detail.created_at, '') : '']
                      .filter(Boolean)
                      .join(' · ') || '—',
                  ],
                  ...(detail.status === 'approved'
                    ? [
                        [
                          t('payrollDistributionRequests.detail.approvedBy'),
                          [
                            detail.approved_by,
                            detail.approved_at ? formatDate(detail.approved_at, '') : '',
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—',
                        ],
                      ]
                    : []),
                  ...(detail.note ? [[t('payrollDistributionRequests.detail.note'), detail.note]] : []),
                ].map(([label, value]) => (
                  <div className="pdr-info-row" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="pdr-modal-actions">{actionButtons(detail)}</div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmState}
        title={t(`payrollDistributionRequests.confirm.${confirmState?.kind ?? 'approve'}Title`)}
        message={t(`payrollDistributionRequests.confirm.${confirmState?.kind ?? 'approve'}Message`, {
          name: confirmState?.name ?? '',
        })}
        confirmLabel={t(`payrollDistributionRequests.actions.${confirmState?.kind ?? 'approve'}`)}
        cancelLabel={t('payrollDistributionRequests.confirm.cancel')}
        tone={confirmState?.kind === 'delete' ? 'danger' : confirmState?.kind === 'revert' ? 'primary' : 'success'}
        busy={busy}
        onConfirm={runConfirmed}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
};

export default PayrollDistributionRequests;
