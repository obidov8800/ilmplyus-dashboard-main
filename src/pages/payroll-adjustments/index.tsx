import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageTitle from '@/components/PageTitle';
import { notifications } from '@mantine/notifications';
import { API } from '@/api/api';
import { useOptions } from '@/api/options';
import { Protected } from '@/components/Protected';
import { usePermission } from '@/hooks/usePermission';
import { useTableColumns } from '@/hooks/useTableColumns';
import ConfirmModal from '@/components/ConfirmModal';
import PaginationBar from '@/components/Pagination/PaginationBar';
import FilterBar, { type FilterBarField } from '@/components/FilterBar';
import { type FilterBarValues } from '@/components/FilterBar/filterBar.utils';
import { formatDate } from '@/utils/date';
import { getApiErrorMessage } from '@/utils/apiError';
import './payrollAdjustments.css';

/* ------------------------------------------------------------------ *
 * Ish haqqi tuzatishlar — Moliya bo'limi.
 * GET /payroll/adjustments (filtrlar bilan), approve/reject amallari.
 * Amallar tugmalari statusga + ruxsatga qarab ko'rinadi.
 * ------------------------------------------------------------------ */

type FilterKey =
  | 'period'
  | 'branch_id'
  | 'employee_id'
  | 'last_name'
  | 'first_name'
  | 'middle_name'
  | 'department_id';

/** Maydon nomlari jonli API javobi bilan tekshirilgan (2026-07-17). */
interface Adjustment {
  id: number;
  employee_id?: number;
  status?: string;
  type?: string;
  date?: string | null;
  hours?: number | string | null;
  /** Izoh — backend `note` deb qaytaradi ("comment" emas). */
  note?: string | null;
  /** Tasdiqlagan/rad etgan shaxs — `approved_by` emas. */
  reviewed_by?: { full_name?: string } | string | null;
  reviewed_at?: string | null;
  created_by?: { full_name?: string } | string | null;
  created_at?: string | null;
  substituted_for?: { id?: number; full_name?: string } | null;
  /**
   * DIQQAT: "Kechikish soatlari" / "Erta ketish soatlari" ustunlari UI'da bor,
   * lekin backend bu maydonlarni QAYTARMAYDI — ustunlar doim 0 ko'rsatadi.
   * Spetsifikatsiyada ham bu ustunlar yo'q. Ustunlarni olib tashlash yoki
   * backendga qo'shish — hal qilinmagan savol.
   */
  late_hours?: number | string | null;
  early_leave_hours?: number | string | null;
  employee?: {
    id?: number;
    full_name?: string;
    department?: string | null;
    position?: string | null;
  };
}

/** Status tablari: bo'sh = barchasi. Qiymatlar backend `status` bilan bir xil. */
const STATUS_TABS = ['', 'new', 'approved', 'rejected'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

/** Yangi tuzatish `new`, ba'zan `pending`/bo'sh keladi — hammasi «Yangi» tabiga tushadi. */
const matchesStatusTab = (status: string | undefined, tab: StatusTab): boolean => {
  if (!tab) return true;
  const key = (status || '').toLowerCase();
  return tab === 'new' ? key === '' || key === 'new' || key === 'pending' : key === tab;
};

/** Tasdiqlash modali holati: qaysi tuzatish uchun qaysi amal so'ralmoqda. */
type ConfirmState = { id: number; action: 'approve' | 'reject'; name: string } | null;

/** Server `meta.per_page` bermasa shu qiymat ishlatiladi (backend defaulti = 30). */
const FALLBACK_PER_PAGE = 30;

/** Laravel paginator javobi: { data, links, meta }. */
interface PaginatedResponse {
  rows: Adjustment[];
  total: number;
  perPage: number;
  lastPage: number;
}

const EMPTY_FILTERS: FilterBarValues<FilterKey> = {
  period: '',
  branch_id: '',
  employee_id: '',
  last_name: '',
  first_name: '',
  middle_name: '',
  department_id: '',
};

/** Bo'sh filtrlarni so'rovga qo'shmaymiz. */
const cleanParams = (obj: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );

/** created_by/approved_by matn ham, obyekt ham bo'lishi mumkin. */
const personName = (v: Adjustment['created_by']): string => {
  if (!v) return '-';
  if (typeof v === 'string') return v || '-';
  return v.full_name || '-';
};

const PayrollAdjustments = () => {
  const { t } = useTranslation();

  const { visibleColumns } = useTableColumns('payrollAdjustments');
  const colCount = 1 + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canView = usePermission('payroll_adjustments.view');

  const [filters, setFilters] = useState<FilterBarValues<FilterKey>>(EMPTY_FILTERS);
  const [status, setStatus] = useState<StatusTab>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // Tasdiqlash modali: qaysi qator uchun qanday amal so'ralayotgani.
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const { data: branchOptions = [] } = useOptions('branches');
  const { data: departmentOptions = [] } = useOptions('departments');

  const fields: FilterBarField<FilterKey>[] = [
    { key: 'period', label: t('payrollAdjustments.filters.period'), type: 'date' },
    {
      key: 'branch_id',
      label: t('payrollAdjustments.filters.branch'),
      type: 'select',
      placeholder: t('payrollAdjustments.filters.all'),
      options: branchOptions.map((o) => ({ value: o.id, label: o.label })),
    },
    {
      key: 'employee_id',
      label: t('payrollAdjustments.filters.employeeId'),
      type: 'text',
      placeholder: t('payrollAdjustments.filters.employeeIdPlaceholder'),
    },
    {
      key: 'last_name',
      label: t('payrollAdjustments.filters.lastName'),
      type: 'text',
      placeholder: t('payrollAdjustments.filters.lastName'),
    },
    {
      key: 'first_name',
      label: t('payrollAdjustments.filters.firstName'),
      type: 'text',
      placeholder: t('payrollAdjustments.filters.firstName'),
    },
    {
      key: 'middle_name',
      label: t('payrollAdjustments.filters.middleName'),
      type: 'text',
      placeholder: t('payrollAdjustments.filters.middleName'),
    },
    {
      key: 'department_id',
      label: t('payrollAdjustments.filters.department'),
      type: 'select',
      placeholder: t('payrollAdjustments.filters.all'),
      options: departmentOptions.map((o) => ({ value: o.id, label: o.label })),
    },
  ];

  // "Davr" sanasidan period_year / period_month ajratiladi.
  const params = useMemo(() => {
    const period = filters.period ?? '';
    const [year, month] = period ? period.split('-') : [];
    return cleanParams({
      period_year: year,
      period_month: month ? String(Number(month)) : '',
      branch_id: filters.branch_id,
      employee_id: filters.employee_id,
      last_name: filters.last_name,
      first_name: filters.first_name,
      middle_name: filters.middle_name,
      department_id: filters.department_id,
      status,
      per_page: pageSize,
    });
  }, [filters, pageSize, status]);

  // Sahifalash server tomonda: `page` yuboriladi, jami/oxirgi sahifa `meta`dan olinadi.
  // Ilgari butun ro'yxat client'da kesilardi — backend 30 tadan qaytargani uchun
  // 31-yozuvdan keyingilariga umuman yetib bo'lmasdi.
  const { data, isLoading, isError } = useQuery<PaginatedResponse>({
    queryKey: ['payroll-adjustments', params, page],
    queryFn: async () => {
      const { data } = await API.get('/payroll/adjustments', {
        params: { ...params, page },
      });
      // Paginator bo'lmasa (oddiy massiv) — hammasi bitta sahifa deb qaraladi.
      const rows: Adjustment[] = Array.isArray(data) ? data : (data?.data ?? []);
      const meta = data?.meta;
      return {
        // Backend `status` filtrini bilmasa ham tab to'g'ri ko'rinsin.
        rows: (Array.isArray(rows) ? rows : []).filter((r) => matchesStatusTab(r.status, status)),
        total: meta?.total ?? rows.length,
        perPage: meta?.per_page ?? FALLBACK_PER_PAGE,
        lastPage: meta?.last_page ?? 1,
      };
    },
    // Sahifa almashganda jadval bo'shab ketmasin — eski sahifa ko'rinib turadi.
    placeholderData: (previous) => previous,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: canView,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.lastPage ?? 1);

  // Sahifalar soni kamayib qolsa (masalan yozuvlar o'chirilgan bo'lsa) oxirgi
  // mavjud sahifaga qaytamiz. Effekt emas, render fazasida — React shu naqshni
  // tavsiya qiladi: https://react.dev/learn/you-might-not-need-an-effect
  const [lastSeenTotalPages, setLastSeenTotalPages] = useState(totalPages);
  if (totalPages !== lastSeenTotalPages) {
    setLastSeenTotalPages(totalPages);
    if (page > totalPages) setPage(totalPages);
  }

  const decisionMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      reason,
    }: {
      id: number;
      action: 'approve' | 'reject';
      reason?: string;
    }) => {
      // Rad etishda `reject_reason` majburiy — yuborilmasa backend 422 qaytaradi.
      const body = action === 'reject' ? { reject_reason: reason } : undefined;
      const { data } = await API.patch(`/payroll/adjustments/${id}/${action}`, body);
      return data;
    },
    onSuccess: (_d, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-adjustments'] });
      notifications.show({
        title: t('payrollAdjustments.savedTitle'),
        message:
          action === 'approve'
            ? t('payrollAdjustments.approvedMessage')
            : t('payrollAdjustments.rejectedMessage'),
        color: action === 'approve' ? 'green' : 'red',
      });
    },
    // A.1: xato jim yutilmasin — ilgari onError yo'q edi va amal bajarilmaganda
    // foydalanuvchi hech qanday belgi ko'rmasdi.
    onError: (error) => {
      notifications.show({
        title: t('payrollAdjustments.errorTitle'),
        message: getApiErrorMessage(error, t('payrollAdjustments.decisionErrorMessage')),
        color: 'red',
      });
    },
    onSettled: () => setConfirmState(null),
  });

  const statusLabel = (status?: string) => {
    const key = (status || '').toLowerCase();
    if (key === 'approved') return t('payrollAdjustments.status.approved');
    if (key === 'rejected') return t('payrollAdjustments.status.rejected');
    if (key === 'new' || key === 'pending') return t('payrollAdjustments.status.new');
    return status || '-';
  };

  const statusClass = (status?: string) => {
    const key = (status || '').toLowerCase();
    if (key === 'approved') return 'pa-status--approved';
    if (key === 'rejected') return 'pa-status--rejected';
    return 'pa-status--new';
  };

  /** Faqat "yangi"/"kutilmoqda" tuzatish tahrirlanadi va tasdiqlanadi. */
  const isPending = (status?: string) => {
    const key = (status || '').toLowerCase();
    return key === '' || key === 'new' || key === 'pending';
  };

  if (!canView) return null;

  return (
    <div className="pa-container container">
      <div className="pa-header">
        <PageTitle title={t('aside.payrollAdjustments')} icon="fa-sliders" spaced={false} />
        <Protected permission="payroll_adjustments.create">
          <button
            className="pa-btn pa-btn--primary"
            onClick={() => navigate('/payroll-adjustments/create')}
          >
            {t('payrollAdjustments.newBtn')}
          </button>
        </Protected>
      </div>

      <div className="pa-card">
        <div className="pa-tabs" role="tablist">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab || 'all'}
              type="button"
              role="tab"
              aria-selected={status === tab}
              className={`pa-tab ${status === tab ? 'pa-tab--active' : ''}`}
              onClick={() => {
                setStatus(tab);
                setPage(1);
              }}
            >
              {tab ? t(`payrollAdjustments.status.${tab}`) : t('payrollAdjustments.filters.all')}
            </button>
          ))}
        </div>

        <div className="pa-card-filters">
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
            ariaLabel={t('payrollAdjustments.title')}
          />
        </div>

        <div className="pa-table-scroll">
          <table className="pa-table">
            <thead>
              <tr>
                {visibleColumns.map((colId) => (
                  <th key={colId}>{columnHeader(colId)}</th>
                ))}
                <th>{t('payrollAdjustments.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={colCount} className="pa-empty">
                    {t('payrollAdjustments.loading')}
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={colCount} className="pa-empty">
                    {t('payrollAdjustments.error')}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="pa-empty">
                    {t('payrollAdjustments.noData')}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const emp = row.employee || {};
                  const pending = isPending(row.status);
                  // A.3: faqat shu qatorning tugmalari bloklanadi — ilgari
                  // umumiy `decisionMutation.isPending` butun jadvalni o'chirardi.
                  const rowBusy =
                    decisionMutation.isPending && decisionMutation.variables?.id === row.id;
                  return (
                    <tr key={row.id}>
                      {visibleColumns.map((colId) => {
                        switch (colId) {
                          case 'employee_id':
                            return <td key={colId}>{emp.id ?? row.employee_id ?? '-'}</td>;
                          case 'full_name':
                            return (
                              <td key={colId} className="pa-emp-name">
                                {emp.full_name || '-'}
                              </td>
                            );
                          case 'department_position':
                            return (
                              <td key={colId}>
                                <div className="pa-dept">{emp.department || '-'}</div>
                                <div className="pa-position">{emp.position || '-'}</div>
                              </td>
                            );
                          case 'late_hours':
                            return <td key={colId}>{row.late_hours ?? 0}</td>;
                          case 'early_leave_hours':
                            return <td key={colId}>{row.early_leave_hours ?? 0}</td>;
                          case 'adjustments':
                            return (
                      <td key={colId}>
                        <div className="pa-adj-cell">
                          <span>
                            {t('payrollAdjustments.table.statusLabel')}{' '}
                            <span className={`pa-status ${statusClass(row.status)}`}>
                              {statusLabel(row.status)}
                            </span>
                          </span>
                          <span>
                            {t('payrollAdjustments.table.createdBy')} {personName(row.created_by)}
                          </span>
                          <span className="pa-adj-meta">{formatDate(row.created_at, '-')}</span>
                          <span>
                            {t('payrollAdjustments.table.approvedBy')} {personName(row.reviewed_by)}
                          </span>
                          <span className="pa-adj-meta">{formatDate(row.reviewed_at, '-')}</span>
                          <span>
                            {row.hours ?? 0} {t('payrollAdjustments.table.hours')}{' '}
                            {formatDate(row.date, '-')}
                          </span>
                          <span>
                            {t('payrollAdjustments.table.commentLabel')} {row.note || ''}
                          </span>
                        </div>
                      </td>
                            );
                          default:
                            return <td key={colId}>-</td>;
                        }
                      })}
                      <td>
                        <div className="pa-actions">
                          {pending && (
                            <Protected permission="payroll_adjustments.edit">
                              <button
                                className="pa-btn pa-btn--primary"
                                onClick={() => navigate(`/payroll-adjustments/${row.id}/edit`)}
                              >
                                {t('payrollAdjustments.actions.edit')}
                              </button>
                            </Protected>
                          )}

                          <Protected permission="payroll_adjustments.view">
                            <button
                              className="pa-btn pa-btn--primary"
                              onClick={() => navigate(`/payroll-adjustments/${row.id}`)}
                            >
                              {t('payrollAdjustments.actions.view')}
                            </button>
                          </Protected>

                          {pending && (
                            <>
                              <Protected permission="payroll_adjustments.reject">
                                <button
                                  className="pa-btn pa-btn--danger"
                                  disabled={rowBusy}
                                  onClick={() =>
                                    setConfirmState({
                                      id: row.id,
                                      action: 'reject',
                                      name: emp.full_name || '-',
                                    })
                                  }
                                >
                                  {t('payrollAdjustments.actions.reject')}
                                </button>
                              </Protected>
                              <Protected permission="payroll_adjustments.approve">
                                <button
                                  className="pa-btn pa-btn--success"
                                  disabled={rowBusy}
                                  onClick={() =>
                                    setConfirmState({
                                      id: row.id,
                                      action: 'approve',
                                      name: emp.full_name || '-',
                                    })
                                  }
                                >
                                  {t('payrollAdjustments.actions.approve')}
                                </button>
                              </Protected>
                            </>
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

      <ConfirmModal
        open={!!confirmState}
        title={t(
          confirmState?.action === 'reject'
            ? 'payrollAdjustments.confirm.rejectTitle'
            : 'payrollAdjustments.confirm.approveTitle',
        )}
        message={t(
          confirmState?.action === 'reject'
            ? 'payrollAdjustments.confirm.rejectMessage'
            : 'payrollAdjustments.confirm.approveMessage',
          { name: confirmState?.name ?? '' },
        )}
        confirmLabel={t(
          confirmState?.action === 'reject'
            ? 'payrollAdjustments.actions.reject'
            : 'payrollAdjustments.actions.approve',
        )}
        cancelLabel={t('payrollAdjustments.confirm.cancel')}
        tone={confirmState?.action === 'reject' ? 'danger' : 'success'}
        busy={decisionMutation.isPending}
        // Rad etish sababi backendda majburiy — shu yerda so'raladi.
        reasonRequired={confirmState?.action === 'reject'}
        reasonLabel={t('payrollAdjustments.confirm.reasonLabel')}
        onConfirm={(reason) =>
          confirmState &&
          decisionMutation.mutate({ id: confirmState.id, action: confirmState.action, reason })
        }
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
};

export default PayrollAdjustments;
