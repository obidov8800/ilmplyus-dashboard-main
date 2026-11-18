import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { API } from '../../api/api';
import { fetchAllPages } from '../../api/fetchAllPages';
import '../users/users.css';
import './academic-years.css';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import PaginationBar from '../../components/Pagination/PaginationBar';
import RecordViewModal from '../../components/RecordViewModal/RecordViewModal';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import ConfirmModal from '../../components/ConfirmModal';
import DateInput from '../../components/DateInput';
import StatusBadge from '../../components/StatusBadge';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import { usePermission } from '../../hooks/usePermission';
import { formatDate, formatDateTime } from '../../utils/date';
import { omitEmpty } from '../../utils/payload';
import { notifyWarning } from '../../utils/notify';
import type { AcademicYear, AcademicYearPayload, AcademicYearStatus } from '../../types';

interface FormState {
  name: string;
  start_date: string;
  end_date: string;
  /** Faqat yaratishda: «darhol faol qilish». */
  activateNow: boolean;
}

// Yuklanguncha bir xil (barqaror) bo'sh massiv — useMemo bog'liqliklari har renderda o'zgarib ketmasin.
const NO_YEARS: AcademicYear[] = [];

const emptyForm = (): FormState => ({ name: '', start_date: '', end_date: '', activateNow: false });

type View = 'list' | 'archive';
type StatusFilter = '' | AcademicYearStatus;

interface TrashResponse {
  data?: { data?: AcademicYear[]; last_page?: number };
}

/**
 * O'chirilgan o'quv yillari. `GET /academic-years` o'chirilganlarni qaytarmaydi, ular faqat umumiy
 * arxivda (`GET /trash?type=academic_years`, Laravel paginatori) turadi — tiklash esa o'quv yili endpointi
 * orqali (`POST /academic-years/{id}/restore`).
 */
async function fetchTrashedYears(): Promise<AcademicYear[]> {
  const load = (page: number) =>
    API.get<TrashResponse>('/trash', {
      params: { type: 'academic_years', per_page: 100, page },
      silentError: true,
    }).then((res) => res.data?.data);

  const first = await load(1);
  const lastPage = Math.min(first?.last_page ?? 1, 20);
  const rest = await Promise.all(Array.from({ length: Math.max(0, lastPage - 1) }, (_, i) => load(i + 2)));
  return [first, ...rest].flatMap((chunk) => chunk?.data ?? []);
}

const AcademicYears = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('academicYears');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });

  const canSeeGroups = usePermission('groups.edit');
  const canSeeArchive = usePermission('trash.view');

  const [view, setView] = useState<View>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<number[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicYear | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [viewItem, setViewItem] = useState<AcademicYear | null>(null);
  const [activateTarget, setActivateTarget] = useState<AcademicYear | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | 'selected' | null>(null);

  const { data: years = NO_YEARS, isLoading } = useQuery<AcademicYear[]>({
    queryKey: ['academic-years'],
    queryFn: () => fetchAllPages<AcademicYear>('/academic-years'),
  });

  const { data: trashedYears = NO_YEARS, isLoading: isLoadingTrash } = useQuery<AcademicYear[]>({
    queryKey: ['academic-years', 'trash'],
    queryFn: fetchTrashedYears,
    enabled: view === 'archive' && canSeeArchive,
  });

  const activeYear = years.find((y) => y.status === 'active') ?? null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['academic-years'] });
    queryClient.invalidateQueries({ queryKey: ['options', 'academic_years'] });
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
  };

  const createMutation = useMutation({
    mutationFn: (payload: AcademicYearPayload) => API.post('/academic-years', payload),
    onSuccess: () => {
      refresh();
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AcademicYearPayload }) =>
      API.put(`/academic-years/${id}`, omitEmpty(payload)),
    onSuccess: () => {
      refresh();
      closeForm();
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => API.post(`/academic-years/${id}/activate`),
    onSettled: () => setActivateTarget(null),
    onSuccess: refresh,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => API.delete(`/academic-years/${id}`),
    onSuccess: refresh,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => API.post(`/academic-years/${id}/restore`),
    onSuccess: refresh,
  });

  const isDeletable = (year: AcademicYear) => year.status !== 'active' && !(year.groups_count && year.groups_count > 0);

  const deleteBlockedReason = (year: AcademicYear) => {
    if (year.status === 'active') return t('academicYears.cannotDeleteActive');
    if (year.groups_count && year.groups_count > 0) return t('academicYears.cannotDeleteWithGroups');
    return t('common.delete');
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return years
      .filter((y) => !term || y.name.toLowerCase().includes(term))
      .filter((y) => !statusFilter || y.status === statusFilter)
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  }, [years, search, statusFilter, sortAsc]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const deletableIds = filtered.filter(isDeletable).map((y) => y.id);
  const allDeletableSelected =
    deletableIds.length > 0 && deletableIds.every((id) => selected.includes(id));

  const toggleAll = (checked: boolean) => setSelected(checked ? deletableIds : []);
  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (year: AcademicYear) => {
    setEditing(year);
    setForm({
      name: year.name,
      start_date: year.start_date?.slice(0, 10) ?? '',
      end_date: year.end_date?.slice(0, 10) ?? '',
      activateNow: false,
    });
    setFormOpen(true);
  };

  const submitForm = () => {
    const name = form.name.trim();
    if (!name || !form.start_date || !form.end_date) {
      notifyWarning(t('academicYears.fillAll'));
      return;
    }
    // Backend ham tekshiradi (`end_date after:start_date`); shu yerda esa xabar darhol, so'rovsiz chiqadi.
    if (form.end_date <= form.start_date) {
      notifyWarning(t('academicYears.endBeforeStart'));
      return;
    }
    const payload: AcademicYearPayload = { name, start_date: form.start_date, end_date: form.end_date };
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(form.activateNow ? { ...payload, status: 'active' } : payload);
    }
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

  const statusBadge = (status: AcademicYearStatus) => (
    <StatusBadge tone={status === 'active' ? 'success' : 'neutral'}>
      {t(status === 'active' ? 'academicYears.active' : 'academicYears.inactive')}
    </StatusBadge>
  );

  const renderCell = (year: AcademicYear, colId: string) => {
    switch (colId) {
      case 'name':
        return year.name;
      case 'start_date':
        return formatDate(year.start_date, '-');
      case 'end_date':
        return formatDate(year.end_date, '-');
      case 'groups_count': {
        const count = year.groups_count ?? 0;
        if (count > 0 && canSeeGroups) {
          return (
            <button
              type="button"
              className="ay-groups-link"
              title={t('academicYears.showGroups')}
              onClick={() => navigate(`/groups?academic_year_id=${year.id}`)}
            >
              {count}
            </button>
          );
        }
        return count;
      }
      case 'status':
        return statusBadge(year.status);
      case 'created_at':
        return formatDateTime(year.created_at, '-');
      case 'updated_at':
        return formatDateTime(year.updated_at, '-');
      default:
        return '-';
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <section className="users container ay-page">
      <h1 className="main-title">{t('academicYears.listTitle')}</h1>

      {formOpen && (
        <div className="modal-overlay">
          <div className="modal ay-modal" role="dialog" aria-modal="true">
            <h3 className="ay-modal-title">
              {editing ? t('academicYears.editTitle') : t('academicYears.addTitle')}
            </h3>

            <form
              className="ay-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitForm();
              }}
            >
              <div className="form-group">
                <label>{t('academicYears.name')}</label>
                <input
                  type="text"
                  value={form.name}
                  maxLength={50}
                  placeholder={t('academicYears.namePlaceholder')}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  autoFocus
                />
              </div>

              <div className="ay-form-row">
                <div className="form-group">
                  <label>{t('columns.start_date')}</label>
                  <DateInput
                    value={form.start_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>{t('columns.end_date')}</label>
                  <DateInput
                    value={form.end_date}
                    min={form.start_date || undefined}
                    onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                  />
                </div>
              </div>

              {!editing && (
                <label className="ay-check">
                  <input
                    type="checkbox"
                    checked={form.activateNow}
                    onChange={(e) => setForm((prev) => ({ ...prev, activateNow: e.target.checked }))}
                  />
                  <span>
                    {t('academicYears.activateNow')}
                    {activeYear && form.activateNow && (
                      <em className="ay-hint">
                        {t('academicYears.activateNowHint', { name: activeYear.name })}
                      </em>
                    )}
                  </span>
                </label>
              )}

              <div className="modal-actions">
                <button className="primary" type="submit" disabled={isSaving}>
                  {isSaving ? t('common.saving') : t('common.save')}
                </button>
                <button type="button" className="cancel" onClick={closeForm}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.academicYear')}
          fields={[
            { label: t('academicYears.name'), value: viewItem.name },
            { label: t('columns.status'), value: statusBadge(viewItem.status) },
            { label: t('columns.start_date'), value: renderCell(viewItem, 'start_date') },
            { label: t('columns.end_date'), value: renderCell(viewItem, 'end_date') },
            { label: t('columns.groups_count'), value: viewItem.groups_count ?? 0 },
            { label: 'ID', value: `#${viewItem.id}` },
            { label: t('columns.created_at'), value: renderCell(viewItem, 'created_at') },
            { label: t('columns.updated_at'), value: renderCell(viewItem, 'updated_at') },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      <ConfirmModal
        open={activateTarget !== null}
        tone="success"
        title={t('academicYears.activateTitle')}
        message={
          activateTarget
            ? activeYear && activeYear.id !== activateTarget.id
              ? t('academicYears.activateMessageSwitch', { name: activateTarget.name, current: activeYear.name })
              : t('academicYears.activateMessage', { name: activateTarget.name })
            : ''
        }
        confirmLabel={t('academicYears.activate')}
        cancelLabel={t('common.cancel')}
        busy={activateMutation.isPending}
        onConfirm={() => activateTarget && activateMutation.mutate(activateTarget.id)}
        onCancel={() => setActivateTarget(null)}
      />

      <ConfirmDeleteModal
        open={deleteTarget !== null}
        message={t('academicYears.deleteMessage')}
        busy={deleteMutation.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <div
        className="users-filters"
        style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}
      >
        <div className="trash-tabs">
          <button
            type="button"
            className={`trash-tab${view === 'list' ? ' active' : ''}`}
            onClick={() => setView('list')}
          >
            {t('academicYears.tabList')}
            <span className="trash-tab-count">{years.length}</span>
          </button>
          {canSeeArchive && (
            <button
              type="button"
              className={`trash-tab${view === 'archive' ? ' active' : ''}`}
              onClick={() => setView('archive')}
            >
              {t('academicYears.tabArchive')}
            </button>
          )}
        </div>
      </div>

      {view === 'list' ? (
        <>
          <div className="users-filters">
            <Protected permission="academic_years.create">
              <button className="add-new-user" onClick={openCreate}>
                {t('academicYears.addNew')}
              </button>
            </Protected>
            <Protected permission="academic_years.delete">
              <button
                className="delete-all"
                disabled={!selected.length}
                onClick={() => setDeleteTarget('selected')}
              >
                {t('common.delete')}
              </button>
            </Protected>
            <select
              value={statusFilter}
              aria-label={t('columns.status')}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(1);
              }}
            >
              <option value="">{t('academicYears.allStatuses')}</option>
              <option value="active">{t('academicYears.active')}</option>
              <option value="inactive">{t('academicYears.inactive')}</option>
            </select>
            <input
              placeholder={t('academicYears.search')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="users-table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allDeletableSelected}
                      disabled={deletableIds.length === 0}
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
                  <th>{t('academicYears.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <TableSkeleton rowCount={6} columnCount={colCount} />
                ) : paged.length > 0 ? (
                  paged.map((year) => (
                    <tr key={year.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(year.id)}
                          disabled={!isDeletable(year)}
                          title={isDeletable(year) ? undefined : deleteBlockedReason(year)}
                          onChange={() => toggleOne(year.id)}
                        />
                      </td>
                      {isVisible('id') && <td>{year.id}</td>}
                      {visibleColumns.map((colId) => (
                        <td key={colId}>{renderCell(year, colId)}</td>
                      ))}
                      <td className="actions">
                        <Protected permission="academic_years.show">
                          <button
                            type="button"
                            className="user-view-btn"
                            title={t('viewModal.view')}
                            aria-label={t('viewModal.view')}
                            onClick={() => setViewItem(year)}
                          >
                            <i className="fa-solid fa-eye" />
                          </button>
                        </Protected>
                        <Protected permission="academic_years.edit">
                          {year.status !== 'active' && (
                            <button
                              type="button"
                              className="ay-activate-btn"
                              title={t('academicYears.activate')}
                              aria-label={t('academicYears.activate')}
                              onClick={() => setActivateTarget(year)}
                            >
                              <i className="fa-solid fa-circle-check" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="user-edit-btn"
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                            onClick={() => openEdit(year)}
                          >
                            <i className="fa-solid fa-pen" />
                          </button>
                        </Protected>
                        <Protected permission="academic_years.delete">
                          <button
                            type="button"
                            className="user-delete-btn"
                            title={deleteBlockedReason(year)}
                            aria-label={t('common.delete')}
                            disabled={!isDeletable(year)}
                            onClick={() => setDeleteTarget(year.id)}
                          >
                            <i className="fa-solid fa-trash" />
                          </button>
                        </Protected>
                      </td>
                    </tr>
                  ))
                ) : (
                  <EmptyState colSpan={colCount} message={t('academicYears.notFound')} />
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
                <th>{t('columns.name')}</th>
                <th>{t('columns.start_date')}</th>
                <th>{t('columns.end_date')}</th>
                <th>{t('academicYears.deletedAt')}</th>
                <th>{t('academicYears.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingTrash ? (
                <TableSkeleton rowCount={4} columnCount={6} />
              ) : trashedYears.length > 0 ? (
                trashedYears.map((year) => (
                  <tr key={year.id}>
                    <td>{year.id}</td>
                    <td>{year.name}</td>
                    <td>{formatDate(year.start_date, '-')}</td>
                    <td>{formatDate(year.end_date, '-')}</td>
                    <td>{formatDateTime(year.deleted_at, '-')}</td>
                    <td className="actions">
                      <Protected permission="academic_years.delete">
                        <button
                          type="button"
                          className="archive-restore-btn"
                          title={t('academicYears.restore')}
                          aria-label={t('academicYears.restore')}
                          disabled={restoreMutation.isPending}
                          onClick={() => restoreMutation.mutate(year.id)}
                        >
                          <i className="fa-solid fa-rotate-left" />
                        </button>
                      </Protected>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyState colSpan={6} message={t('academicYears.archiveEmpty')} />
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default AcademicYears;
