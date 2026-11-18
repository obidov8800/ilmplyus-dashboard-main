import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import '../users/users.css';
import '@/styles/preschool.css';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import PaginationBar from '../../components/Pagination/PaginationBar';
import RecordViewModal from '../../components/RecordViewModal/RecordViewModal';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import ConfirmModal from '../../components/ConfirmModal';
import StatusBadge from '../../components/StatusBadge';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import { usePermission } from '../../hooks/usePermission';
import { useOptions } from '@/api/options';
import {
  PRICE_STATUSES,
  PRICE_STATUS_PERMISSION,
  changePreschoolPriceStatus,
  createPreschoolPrice,
  deletePreschoolPrice,
  fetchPreschoolPrices,
  fetchTrashedPreschoolPrices,
  formatSum,
  isPriceActive,
  priceStatus,
  restorePreschoolPrice,
  updatePreschoolPrice,
  type PreschoolPrice,
  type PreschoolPricePayload,
  type PreschoolPriceStatus,
} from '@/api/preschool';
import PriceStatusModal from '../../components/PriceStatusModal';
import { getLocalized } from '../../utils/getLocalized';
import { formatDateTime } from '../../utils/date';
import { notifyWarning } from '../../utils/notify';
import type { StatusTone } from '../../utils/statusTone';

interface FormState {
  academic_year_id: string;
  /** Bo'sh — shu o'quv yilidagi barcha maktabga tayyorlov filiallar uchun umumiy narx. */
  branch_id: string;
  monthly_price: string;
  description: string;
  is_active: boolean;
}

const NO_PRICES: PreschoolPrice[] = [];

/** Backend tavsiyasi: kutilmoqda — sariq, tasdiqlangan — yashil, tasdiqlanmagan — qizil, bekor qilingan — kulrang. */
const PRICE_TONE: Record<PreschoolPriceStatus, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

type View = 'list' | 'archive';

const PreschoolPrices = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns: configuredColumns } = useTableColumns('preschoolPrices');
  const columnHeader = (colId: string) =>
    colId === 'status'
      ? t('preschoolPrices.statusLabel')
      : colId === 'is_active'
        ? t('preschoolPrices.activeLabel')
        : t(`columns.${colId}`, { defaultValue: colId });

  const canSeeArchive = usePermission('trash.view');
  const canChangeStatus = usePermission(PRICE_STATUS_PERMISSION);

  const [view, setView] = useState<View>('list');
  const [yearFilter, setYearFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<number[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PreschoolPrice | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [viewItem, setViewItem] = useState<PreschoolPrice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | 'selected' | null>(null);
  const [approveTarget, setApproveTarget] = useState<PreschoolPrice | null>(null);
  const [statusTarget, setStatusTarget] = useState<PreschoolPrice | null>(null);

  const { data: years } = useOptions('academic_years');
  const { data: activeYears } = useOptions('academic_years', { status: 'active' });
  const { data: branches } = useOptions('branches', { type: 'preschool' });

  const { data: prices = NO_PRICES, isLoading } = useQuery<PreschoolPrice[]>({
    queryKey: ['preschool-prices'],
    queryFn: fetchPreschoolPrices,
  });

  const { data: trashed = NO_PRICES, isLoading: isLoadingTrash } = useQuery<PreschoolPrice[]>({
    queryKey: ['preschool-prices', 'trash'],
    queryFn: fetchTrashedPreschoolPrices,
    enabled: view === 'archive' && canSeeArchive,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['preschool-prices'] });

  // Holat va «Faol» ustunlari faqat backend ularni bersa chiqadi (eski javobda yo'q)
  const hasWorkflow = prices.some((p) => priceStatus(p) !== null);
  const visibleColumns = configuredColumns.filter(
    (colId) => (colId !== 'status' && colId !== 'is_active') || hasWorkflow,
  );
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(null);
    setShowErrors(false);
  };

  const saveMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | null; payload: PreschoolPricePayload }) =>
      id ? updatePreschoolPrice(id, payload) : createPreschoolPrice(payload),
    onSuccess: () => {
      refresh();
      closeForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePreschoolPrice(id),
    onSuccess: refresh,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => changePreschoolPriceStatus(id, 'approved'),
    onSuccess: () => {
      setApproveTarget(null);
      refresh();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => restorePreschoolPrice(id),
    onSuccess: refresh,
  });

  const yearName = (p: PreschoolPrice) =>
    p.academic_year?.name ?? years?.find((y) => y.id === p.academic_year_id)?.label ?? '-';

  const branchName = (p: PreschoolPrice) => {
    if (!p.branch_id) return t('preschoolPrices.general');
    if (p.branch) return getLocalized(p.branch, 'name', i18n.language);
    return branches?.find((b) => b.id === p.branch_id)?.label ?? '-';
  };

  const filtered = useMemo(
    () =>
      prices
        .filter((p) => !yearFilter || String(p.academic_year_id) === yearFilter)
        .filter((p) =>
          !branchFilter ? true : branchFilter === 'general' ? !p.branch_id : String(p.branch_id) === branchFilter,
        )
        .filter((p) => !statusFilter || priceStatus(p) === statusFilter)
        .filter((p) => !activeFilter || (activeFilter === 'active') === isPriceActive(p))
        .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id)),
    [prices, yearFilter, branchFilter, statusFilter, activeFilter, sortAsc],
  );

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const toggleAll = (checked: boolean) => setSelected(checked ? filtered.map((p) => p.id) : []);
  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const openCreate = () => {
    setEditing(null);
    setForm({
      academic_year_id: activeYears?.[0] ? String(activeYears[0].id) : '',
      branch_id: '',
      monthly_price: '',
      description: '',
      is_active: true,
    });
    setFormOpen(true);
  };

  const openEdit = (p: PreschoolPrice) => {
    setEditing(p);
    setForm({
      academic_year_id: String(p.academic_year_id),
      branch_id: p.branch_id ? String(p.branch_id) : '',
      monthly_price: String(Math.round(Number(p.monthly_price))),
      description: p.description ?? '',
      is_active: isPriceActive(p),
    });
    setFormOpen(true);
  };

  const submitForm = () => {
    if (!form) return;
    if (!form.academic_year_id || form.monthly_price.trim() === '' || Number(form.monthly_price) < 0) {
      setShowErrors(true);
      notifyWarning(t('preschoolPrices.fillRequired'));
      return;
    }
    saveMutation.mutate({
      id: editing?.id ?? null,
      payload: {
        academic_year_id: Number(form.academic_year_id),
        branch_id: form.branch_id ? Number(form.branch_id) : null,
        monthly_price: Number(form.monthly_price),
        description: form.description.trim() || null,
        is_active: form.is_active,
      },
    });
  };

  const confirmDelete = () => {
    if (deleteTarget === 'selected') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    } else if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((prev) => prev.filter((x) => x !== deleteTarget));
    }
    setDeleteTarget(null);
  };

  const priceParams = (p: PreschoolPrice) => ({
    price: formatSum(p.monthly_price),
    year: yearName(p),
    branch: branchName(p),
  });

  const renderCell = (p: PreschoolPrice, colId: string) => {
    switch (colId) {
      case 'academic_year':
        return yearName(p);
      case 'branch':
        return branchName(p);
      case 'monthly_price':
        return (
          <span className="pp-money">
            {formatSum(p.monthly_price)} {t('preschoolPrices.currency')}
          </span>
        );
      case 'status': {
        const status = priceStatus(p);
        return status ? (
          <StatusBadge tone={PRICE_TONE[status]} title={p.status_reason ?? undefined}>
            {t(`preschoolPrices.statuses.${status}`)}
          </StatusBadge>
        ) : (
          '-'
        );
      }
      case 'is_active':
        return (
          <StatusBadge tone={isPriceActive(p) ? 'success' : 'neutral'}>
            {t(isPriceActive(p) ? 'preschoolPrices.active' : 'preschoolPrices.inactive')}
          </StatusBadge>
        );
      case 'description':
        return p.description || '-';
      case 'creator':
        return p.creator?.full_name || '-';
      case 'created_at':
        return formatDateTime(p.created_at, '-');
      case 'updated_at':
        return formatDateTime(p.updated_at, '-');
      default:
        return '-';
    }
  };

  const isSaving = saveMutation.isPending;

  return (
    <section className="users container">
      <h1 className="main-title">{t('preschoolPrices.listTitle')}</h1>

      {formOpen && form && (
        <div className="pp-overlay">
          <div className="pp-modal" role="dialog" aria-modal="true">
            <h3 className="pp-title">
              {editing ? t('preschoolPrices.editTitle') : t('preschoolPrices.addTitle')}
            </h3>

            <form
              className="pp-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitForm();
              }}
            >
              <div className={`pp-field${showErrors && !form.academic_year_id ? ' pp-field--invalid' : ''}`}>
                <label>{t('preschoolPrices.year')}</label>
                <select
                  value={form.academic_year_id}
                  onChange={(e) => setForm({ ...form, academic_year_id: e.target.value })}
                >
                  <option value="">{t('preschoolPrices.choose')}</option>
                  {(years ?? []).map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pp-field">
                <label>{t('preschoolPrices.branch')}</label>
                <select
                  value={form.branch_id}
                  onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                >
                  <option value="">{t('preschoolPrices.generalOption')}</option>
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <span className="pp-hint">
                  <InfoHint withLabel text={t('preschoolPrices.branchHint')} />
                </span>
              </div>

              <div
                className={`pp-field${showErrors && (form.monthly_price.trim() === '' || Number(form.monthly_price) < 0) ? ' pp-field--invalid' : ''}`}
              >
                <label>
                  {t('preschoolPrices.price')} ({t('preschoolPrices.currency')})
                </label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  value={form.monthly_price}
                  onChange={(e) => setForm({ ...form, monthly_price: e.target.value })}
                />
              </div>

              <div className="pp-field">
                <label>{t('preschoolPrices.description')}</label>
                <textarea
                  maxLength={2000}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="pp-check-row">
                <label>
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                  <span>{t('preschoolPrices.activeLabel')}</span>
                </label>
              </div>
              <span className="pp-hint">
                <InfoHint withLabel text={t('preschoolPrices.activeHint')} />
              </span>

              {editing && priceStatus(editing) !== null && priceStatus(editing) !== 'pending' && (
                <div className="pp-note">
                  <InfoHint withLabel text={t('preschoolPrices.editResetHint')} />
                </div>
              )}

              <div className="pp-actions">
                <button type="submit" className="pp-btn pp-btn--primary" disabled={isSaving}>
                  {isSaving ? t('common.saving') : t('common.save')}
                </button>
                <button type="button" className="pp-btn pp-btn--cancel" onClick={closeForm}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.preschoolPrice')}
          fields={[
            { label: t('columns.academic_year'), value: yearName(viewItem) },
            { label: t('columns.branch'), value: branchName(viewItem) },
            { label: t('columns.monthly_price'), value: renderCell(viewItem, 'monthly_price') },
            { label: t('columns.creator'), value: renderCell(viewItem, 'creator') },
            ...(priceStatus(viewItem) !== null
              ? [
                  { label: t('preschoolPrices.statusLabel'), value: renderCell(viewItem, 'status') },
                  { label: t('preschoolPrices.activeLabel'), value: renderCell(viewItem, 'is_active') },
                  { label: t('preschoolPrices.statusChangedBy'), value: viewItem.status_changer?.full_name || '-' },
                  { label: t('preschoolPrices.statusChangedAt'), value: formatDateTime(viewItem.status_changed_at, '-') },
                  { label: t('preschoolPrices.statusReason'), value: viewItem.status_reason, wide: true },
                ]
              : []),
            { label: t('columns.description'), value: viewItem.description, wide: true },
            { label: 'ID', value: `#${viewItem.id}` },
            { label: t('columns.created_at'), value: renderCell(viewItem, 'created_at') },
            { label: t('columns.updated_at'), value: renderCell(viewItem, 'updated_at') },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      <ConfirmModal
        open={approveTarget !== null}
        title={t('preschoolPrices.approveTitle')}
        message={approveTarget ? t('preschoolPrices.approveMessage', priceParams(approveTarget)) : ''}
        confirmLabel={t('preschoolPrices.approveAction')}
        cancelLabel={t('common.cancel')}
        tone="success"
        busy={approveMutation.isPending}
        onConfirm={() => approveTarget && approveMutation.mutate(approveTarget.id)}
        onCancel={() => setApproveTarget(null)}
      />

      {statusTarget && (
        <PriceStatusModal
          price={statusTarget}
          summary={`${priceParams(statusTarget).price} ${t('preschoolPrices.currency')} · ${priceParams(statusTarget).year} · ${priceParams(statusTarget).branch}`}
          onClose={() => setStatusTarget(null)}
          onSaved={() => {
            setStatusTarget(null);
            refresh();
          }}
        />
      )}

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        message={t('preschoolPrices.deleteMessage')}
        busy={deleteMutation.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {canSeeArchive && (
        <div className="users-filters" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div className="trash-tabs">
            <button
              type="button"
              className={`trash-tab${view === 'list' ? ' active' : ''}`}
              onClick={() => setView('list')}
            >
              {t('preschoolPrices.tabList')}
              <span className="trash-tab-count">{prices.length}</span>
            </button>
            <button
              type="button"
              className={`trash-tab${view === 'archive' ? ' active' : ''}`}
              onClick={() => setView('archive')}
            >
              {t('preschoolPrices.tabArchive')}
            </button>
          </div>
        </div>
      )}

      {view === 'list' ? (
        <>
          <div className="users-filters">
            <Protected permission="preschool_prices.create">
              <button className="add-new-user" onClick={openCreate}>
                {t('preschoolPrices.addNew')}
              </button>
            </Protected>
            <Protected permission="preschool_prices.delete">
              <button className="delete-all" disabled={!selected.length} onClick={() => setDeleteTarget('selected')}>
                {t('common.delete')}
              </button>
            </Protected>
            <select
              value={yearFilter}
              aria-label={t('preschoolPrices.year')}
              onChange={(e) => {
                setYearFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('preschoolPrices.allYears')}</option>
              {(years ?? []).map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                </option>
              ))}
            </select>
            <select
              value={branchFilter}
              aria-label={t('preschoolPrices.branch')}
              onChange={(e) => {
                setBranchFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('preschoolPrices.allBranches')}</option>
              <option value="general">{t('preschoolPrices.general')}</option>
              {(branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            {hasWorkflow && (
              <>
                <select
                  value={statusFilter}
                  aria-label={t('preschoolPrices.statusLabel')}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('preschoolPrices.allStatuses')}</option>
                  {PRICE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`preschoolPrices.statuses.${s}`)}
                    </option>
                  ))}
                </select>
                <select
                  value={activeFilter}
                  aria-label={t('preschoolPrices.activeLabel')}
                  onChange={(e) => {
                    setActiveFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('preschoolPrices.allActivity')}</option>
                  <option value="active">{t('preschoolPrices.active')}</option>
                  <option value="inactive">{t('preschoolPrices.inactive')}</option>
                </select>
              </>
            )}
          </div>

          <div className="users-table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selected.length === filtered.length}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  {isVisible('id') && (
                    <th className="th-sortable" onClick={() => setSortAsc((p) => !p)}>
                      ID {sortAsc ? '↑' : '↓'}
                    </th>
                  )}
                  {visibleColumns.map((colId) => (
                    <th key={colId}>{columnHeader(colId)}</th>
                  ))}
                  <th>{t('preschoolPrices.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <TableSkeleton rowCount={6} columnCount={colCount} />
                ) : paged.length > 0 ? (
                  paged.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          onChange={() => toggleOne(p.id)}
                        />
                      </td>
                      {isVisible('id') && <td>{p.id}</td>}
                      {visibleColumns.map((colId) => (
                        <td key={colId}>{renderCell(p, colId)}</td>
                      ))}
                      <td className="actions">
                        <Protected permission="preschool_prices.show">
                          <button
                            type="button"
                            className="user-view-btn"
                            title={t('viewModal.view')}
                            aria-label={t('viewModal.view')}
                            onClick={() => setViewItem(p)}
                          >
                            <i className="fa-solid fa-eye" />
                          </button>
                        </Protected>
                        {canChangeStatus && priceStatus(p) === 'pending' && (
                          <button
                            type="button"
                            className="pp-act pp-act--approve"
                            title={t('preschoolPrices.approveAction')}
                            aria-label={t('preschoolPrices.approveAction')}
                            onClick={() => setApproveTarget(p)}
                          >
                            <i className="fa-solid fa-check" />
                          </button>
                        )}
                        {canChangeStatus && priceStatus(p) !== null && (
                          <button
                            type="button"
                            className="pp-act pp-act--status"
                            title={t('preschoolPrices.statusAction')}
                            aria-label={t('preschoolPrices.statusAction')}
                            onClick={() => setStatusTarget(p)}
                          >
                            <i className="fa-solid fa-right-left" />
                          </button>
                        )}
                        <Protected permission="preschool_prices.edit">
                          <button
                            type="button"
                            className="user-edit-btn"
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                            onClick={() => openEdit(p)}
                          >
                            <i className="fa-solid fa-pen" />
                          </button>
                        </Protected>
                        <Protected permission="preschool_prices.delete">
                          <button
                            type="button"
                            className="user-delete-btn"
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                            onClick={() => setDeleteTarget(p.id)}
                          >
                            <i className="fa-solid fa-trash" />
                          </button>
                        </Protected>
                      </td>
                    </tr>
                  ))
                ) : (
                  <EmptyState colSpan={colCount} message={t('preschoolPrices.notFound')} />
                )}
              </tbody>
            </table>
          </div>

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
        </>
      ) : (
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('columns.academic_year')}</th>
                <th>{t('columns.branch')}</th>
                <th>{t('columns.monthly_price')}</th>
                <th>{t('preschoolPrices.deletedAt')}</th>
                <th>{t('preschoolPrices.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingTrash ? (
                <TableSkeleton rowCount={4} columnCount={6} />
              ) : trashed.length > 0 ? (
                trashed.map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{yearName(p)}</td>
                    <td>{branchName(p)}</td>
                    <td>{renderCell(p, 'monthly_price')}</td>
                    <td>{formatDateTime(p.deleted_at, '-')}</td>
                    <td className="actions">
                      <Protected permission="preschool_prices.delete">
                        <button
                          type="button"
                          className="archive-restore-btn"
                          title={t('preschoolPrices.restore')}
                          aria-label={t('preschoolPrices.restore')}
                          disabled={restoreMutation.isPending}
                          onClick={() => restoreMutation.mutate(p.id)}
                        >
                          <i className="fa-solid fa-rotate-left" />
                        </button>
                      </Protected>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyState colSpan={6} message={t('preschoolPrices.archiveEmpty')} />
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default PreschoolPrices;
