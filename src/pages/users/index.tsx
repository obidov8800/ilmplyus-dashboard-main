import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '../../api/api';
import './users.css';
import { useTranslation } from 'react-i18next';
import { clampCell } from '@/utils/clampCell';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import WorkScheduleModal from '../../components/WorkScheduleModal';
import PaginationBar from '../../components/Pagination/PaginationBar';
import type { User, UsersResponse } from '../../types';
import { useTableColumns } from '../../hooks/useTableColumns';
import { Protected } from '../../components/Protected';
import { useOptions } from '../../hooks/useOptions';
import { formatDateTime } from '@/utils/date';
import { ActiveBadge } from '@/components/StatusBadge';

const Users = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [workTimeId, setWorkTimeId] = useState<number | null>(null);
  const [viewItem, setViewItem] = useState<User | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { isVisible, visibleColumns } = useTableColumns('users');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const getColumnHeader = (colId: string): string =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCellValue = (u: User, colId: string) => {
    switch (colId) {
      case 'full_name':
        return u.full_name;
      case 'phone':
        return u.phone;
      case 'role':
        return u.roles?.map((r) => r.name).join(', ') || '-';
      case 'status':
        return (
          <ActiveBadge
            active={!!u.is_active}
            activeLabel={t('users.active')}
            inactiveLabel={t('users.inactive')}
          />
        );
      case 'sms_verified':
        return u.sms_verified ? t('users.yes') : t('users.no');
      case 'branch':
        return u.branches && u.branches.length > 0
          ? u.branches.map((b) => getLocalized(b, 'name', i18n.language)).join(', ')
          : u.branch
            ? getLocalized(u.branch, 'name', i18n.language)
            : '-';
      case 'username':
        return u.username;
      case 'pinfl':
        return u.pinfl || '-';
      case 'department':
        return u.departments && u.departments.length > 0
          ? u.departments.map((d) => getLocalized(d, 'name', i18n.language)).join(', ')
          : '-';
      case 'created_at':
        return formatDateTime(u.created_at, '-');
      case 'updated_at':
        return formatDateTime(u.updated_at, '-');
      default:
        return '-';
    }
  };

  // `/users` `per_page`ni e'tiborsiz qoldiradi (har doim 20 tadan) va faqat `page`ni
  // hisobga oladi. Filtr/qidiruv butun ro'yxatga ishlashi (va pastdagi "Jami …" bilan
  // sahifa tugmalari filtrlangan natijaga mos bo'lishi) uchun barcha sahifalarni bir
  // marta yig'ib olamiz, so'ng klient tomonda filtr + sahifalash qilamiz.
  const { data: allUsers = [], isLoading } = useQuery<User[]>({
    queryKey: ['users', 'all'],
    queryFn: async () => {
      const first = (await API.get('/users', { params: { page: 1 } }).then(
        (r) => r.data,
      )) as UsersResponse;
      const firstList: User[] = Array.isArray(first) ? first : (first?.data ?? []);
      const lastPage =
        Number(
          (first as { last_page?: number; meta?: { last_page?: number } })?.last_page ??
            (first as { meta?: { last_page?: number } })?.meta?.last_page ??
            1,
        ) || 1;
      if (lastPage <= 1) return firstList;
      const rest = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, i) =>
          API.get('/users', { params: { page: i + 2 } }).then(
            (r) => (r.data?.data ?? r.data ?? []) as User[],
          ),
        ),
      );
      return [firstList, ...rest].flat();
    },
    placeholderData: keepPreviousData,
  });

  const { data: rolesData } = useOptions('roles');
  const { data: branchesData } = useOptions('branches');

  const roles = rolesData || [];
  const branches = branchesData || [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const filtered = useMemo(() => {
    return allUsers
      .filter((u) => {
        const matchSearch = u.full_name.toLowerCase().includes(search.toLowerCase());
        const matchRole = role ? u.roles?.some((r) => r.name === role) : true;
        const matchBranch = branchFilter
          ? (u.branches ?? []).some((b) => String(b.id) === branchFilter) ||
            String(u.branch?.id) === branchFilter
          : true;

        if (!matchSearch || !matchRole || !matchBranch) return false;

        return true;
      })
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  }, [allUsers, search, role, branchFilter, sortAsc]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  const toggleAll = (checked: boolean) => setSelected(checked ? pageRows.map((u) => u.id) : []);

  const toggleOne = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    }

    if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((p) => p.filter((x) => x !== deleteTarget));
    }

    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  return (
    <section className="users container">
      <h1 className="main-title">{t('users.listTitle')}</h1>
      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.user')}
          fields={[
            { label: t('columns.full_name'), value: renderCellValue(viewItem, 'full_name') },
            { label: t('columns.phone'), value: renderCellValue(viewItem, 'phone') },
            { label: t('columns.username'), value: renderCellValue(viewItem, 'username') },
            { label: t('columns.pinfl'), value: renderCellValue(viewItem, 'pinfl') },
            { label: t('columns.role'), value: renderCellValue(viewItem, 'role') },
            { label: t('columns.department'), value: renderCellValue(viewItem, 'department') },
            { label: t('columns.branch'), value: renderCellValue(viewItem, 'branch') },
            { label: t('columns.sms_verified'), value: renderCellValue(viewItem, 'sms_verified') },
            { label: t('columns.status'), value: renderCellValue(viewItem, 'status') },
            { label: t('columns.created_at'), value: renderCellValue(viewItem, 'created_at') },
            { label: t('columns.updated_at'), value: renderCellValue(viewItem, 'updated_at') },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('users.confirmDelete')}</h3>

            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('users.confirm')}
              </button>

              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('users.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {workTimeId !== null && (
        <WorkScheduleModal userId={workTimeId} onClose={() => setWorkTimeId(null)} />
      )}

      <div className="users-filters">
        <Protected permission="users.create">
          <button className="add-new-user" onClick={() => navigate('/users/add')}>
            {t('users.addNew')}
          </button>
        </Protected>

        <Protected permission="users.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('users.delete')}
          </button>
        </Protected>

        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('users.branch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>

        <select
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('users.employeeType')}</option>
          {roles?.map((r) => (
            <option key={r.id} value={r.label}>
              {r.label}
            </option>
          ))}
        </select>

        <input
          placeholder={t('users.search')}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="users-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === pageRows.length && pageRows.length > 0}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              {isVisible('id') && (
                <th className="th-sortable users-id-cell" onClick={() => setSortAsc((p) => !p)}>
                  ID {sortAsc ? '↑' : '↓'}
                </th>
              )}
              {visibleColumns.map((colId) => (
                <th key={colId} className={colId === 'full_name' ? 'col-fullname' : undefined}>
                  {getColumnHeader(colId)}
                </th>
              ))}
              <th>{t('users.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : pageRows.length > 0 ? (
              pageRows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(u.id)}
                      onChange={() => toggleOne(u.id)}
                    />
                  </td>

                  {isVisible('id') && <td className="users-id-cell">{u.id}</td>}

                  {visibleColumns.map((colId) => (
                    <td key={colId} className={colId === 'full_name' ? 'col-fullname' : undefined}>
                      {clampCell(renderCellValue(u, colId))}
                    </td>
                  ))}

                  <td className="actions">
                    <Protected permission="users.show">
                      <button
                        type="button"
                        className="user-view-btn"
                        title={t('viewModal.view')}
                        aria-label={t('viewModal.view')}
                        onClick={() => setViewItem(u)}
                      >
                        <i className="fa-solid fa-eye"></i>
                      </button>
                    </Protected>
                    <Protected permission="user_work_schedules.view">
                      <div style={{ position: 'relative' }}>
                        <button className="user-workTime-btn" onClick={() => setWorkTimeId(u.id)}>
                          <i className="fa-solid fa-clock"></i>
                        </button>
                      </div>
                    </Protected>

                    <Protected permission="users.edit">
                      <button
                        className="user-edit-btn"
                        onClick={() => navigate(`/users/${u.id}/edit`)}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>

                    <Protected permission="users.delete">
                      <button
                        className="user-delete-btn"
                        onClick={() => {
                          setDeleteTarget(u.id);
                          setShowDeleteModal(true);
                        }}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('users.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={safePage}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </section>
  );
};

export default Users;
