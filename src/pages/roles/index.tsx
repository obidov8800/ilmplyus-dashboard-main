import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import './roles.css';
import { useTranslation } from 'react-i18next';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import { useNavigate } from 'react-router-dom';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import type { Role } from '../../types/common.types';
import { useTableColumns } from '../../hooks/useTableColumns';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import { fetchDashboardSettings, saveDashboardSettings } from './dashboardSettings.service';
import { notifications } from '@mantine/notifications';
import { formatDateTime } from '@/utils/date';
import { useOptions } from '@/hooks/useOptions';

const Roles = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('roles');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (role: Role, colId: string) => {
    switch (colId) {
      case 'name':
        return role.name;
      case 'position':
        return role.position?.name_uz || positions.find((item) => item.id === role.position_id)?.label || '-';
      case 'permissions_count':
        return role.permissions?.length ?? 0;
      case 'created_at':
        return formatDateTime(role.created_at, '-');
      case 'updated_at':
        return formatDateTime(role.updated_at, '-');
      default:
        return '-';
    }
  };
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [viewItem, setViewItem] = useState<Role | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [roleName, setRoleName] = useState('');
  const [positionId, setPositionId] = useState('');
  const { data: positions = [] } = useOptions('positions');
  const [pendingDelete, setPendingDelete] = useState<
    { type: 'one'; id: number } | { type: 'many' } | null
  >(null);

  const { data: roles, isLoading } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data } = await API.get('/roles');
      return Array.isArray(data) ? data : data?.data || [];
    },
  });

  // Dashboard visibility and virtual page permissions are keyed by role NAME,
  // so a rename has to carry those entries over or the role loses them.
  const renameDashboardSettingsKey = async (oldName: string, newName: string) => {
    const settings = await queryClient.fetchQuery({
      queryKey: ['dashboard-settings'],
      queryFn: fetchDashboardSettings,
    });

    const moveKey = (map: Record<string, string[]>) => {
      if (!(oldName in map)) return map;
      const { [oldName]: value, ...rest } = map;
      return { ...rest, [newName]: value };
    };

    const payload = {
      tabNames: settings.tabNames,
      roleVisibility: moveKey(settings.roleVisibility),
      pagePermissions: moveKey(settings.pagePermissions),
    };

    await saveDashboardSettings(payload);
    queryClient.setQueryData(['dashboard-settings'], payload);
  };

  const updateRoleMutation = useMutation({
    mutationFn: async ({ role, name, positionId }: { role: Role; name: string; positionId: string }) => {
      await API.put(`/roles/${role.id}`, { name, position_id: positionId ? Number(positionId) : null });
      if (role.name !== name) {
        await renameDashboardSettingsKey(role.name, name);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['role'] });

      notifications.show({
        title: 'Muvaffaqiyatli',
        message: 'Rol muvaffaqiyatli yangilandi.',
        color: 'green',
      });

      closeEditModal();
    },
  });

  const openEditModal = (role: Role) => {
    setEditingRole(role);
    setRoleName(role.name);
    setPositionId(role.position_id ? String(role.position_id) : '');
  };

  const closeEditModal = () => {
    setEditingRole(null);
    setRoleName('');
    setPositionId('');
  };

  const handleUpdateRole = () => {
    if (!editingRole || !roleName.trim()) return;
    updateRoleMutation.mutate({ role: editingRole, name: roleName.trim(), positionId });
  };

  const deleteRoleMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  const sortedRoles = [...(roles || [])]
    .filter((role) => role.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  const rolesTotal = sortedRoles.length;
  const rolesTotalPages = Math.max(1, Math.ceil(rolesTotal / pageSize));
  const pagedRoles = sortedRoles.slice((page - 1) * pageSize, page * pageSize);

  const toggleAll = (checked: boolean) => setSelected(checked ? sortedRoles.map((r) => r.id) : []);

  const toggleOne = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const handleBatchDelete = () => {
    setPendingDelete({ type: 'many' });
  };

  const confirmPendingDelete = () => {
    if (pendingDelete?.type === 'one') {
      deleteRoleMutation.mutate(pendingDelete.id);
    } else if (pendingDelete?.type === 'many') {
      selected.forEach((id) => deleteRoleMutation.mutate(id));
      setSelected([]);
    }
    setPendingDelete(null);
  };

  return (
    <section className="role-container container">
      <h1 className="role-page-title">{t('roles.listTitle')}</h1>

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.role')}
          fields={[
            { label: t('columns.name'), value: renderCell(viewItem, 'name') },
            { label: t('columns.position'), value: renderCell(viewItem, 'position') },
            { label: t('columns.permissions_count'), value: renderCell(viewItem, 'permissions_count') },
            { label: t('columns.created_at'), value: renderCell(viewItem, 'created_at') },
            { label: t('columns.updated_at'), value: renderCell(viewItem, 'updated_at') },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title={
          pendingDelete?.type === 'many'
            ? t('roles.confirmBatchDelete', 'Tanlanganlarni haqiqatan ham o‘chirmoqchimisiz?')
            : t('roles.confirmDelete')
        }
        busy={deleteRoleMutation.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmPendingDelete}
      />

      {editingRole && (
        <div className="role-modal-overlay" onClick={closeEditModal}>
          <div className="role-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="role-modal-heading">{t('roles.editRole', 'Ro‘lni tahrirlash')}</h3>

            <div className="role-input-group">
              <label htmlFor="role-name-input">{t('roles.roleName', 'Ro‘l nomi')}</label>
              <input
                id="role-name-input"
                type="text"
                autoFocus
                placeholder={t('roles.rolePlaceholder', 'Ro‘l nomini kiriting')}
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUpdateRole();
                  if (e.key === 'Escape') closeEditModal();
                }}
              />
            </div>

            <div className="role-input-group">
              <label htmlFor="role-position-input">{t('roles.position', 'Lavozim')}</label>
              <select id="role-position-input" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                <option value="">{t('roles.noPosition', 'Lavozim biriktirilmagan')}</option>
                {positions.map((position) => <option key={position.id} value={position.id}>{position.label}</option>)}
              </select>
            </div>

            <div className="role-modal-buttons">
              <button
                className="role-save-btn"
                onClick={handleUpdateRole}
                disabled={updateRoleMutation.isPending || !roleName.trim()}
              >
                {updateRoleMutation.isPending
                  ? t('roles.saving', 'Saqlanmoqda...')
                  : t('roles.save', 'Saqlash')}
              </button>
              <button className="role-cancel-btn" onClick={closeEditModal}>
                {t('roles.cancel', 'Bekor qilish')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="role-header-actions">
        <input
          className="role-search"
          type="search"
          value={search}
          placeholder={t('roles.searchPlaceholder', 'Ro‘l nomi bo‘yicha qidirish')}
          aria-label={t('roles.searchPlaceholder', 'Ro‘l nomi bo‘yicha qidirish')}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div style={{ display: 'flex', gap: '10px' }}>
          <Protected permission="roles.create">
            <button className="role-add-btn" onClick={() => navigate('/roles/create')}>
              {t('roles.add')}
            </button>
          </Protected>

          <Protected permission="roles.delete">
            <button
              className="delete-all"
              disabled={!selected.length}
              onClick={handleBatchDelete}
            >
              {t('roles.delete')}
            </button>
          </Protected>
        </div>
      </div>

      <div className="role-table-container">
        <table className="role-data-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    sortedRoles.length > 0 &&
                    sortedRoles.every((role) => selected.includes(role.id))
                  }
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
              <th>{t('roles.harakatlar')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={5} columnCount={colCount} />
            ) : sortedRoles.length > 0 ? (
              pagedRoles.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(role.id)}
                        onChange={() => toggleOne(role.id)}
                      />
                    </td>
                    {isVisible('id') && <td>{role.id}</td>}
                    {visibleColumns.map((colId) => (
                      <td key={colId}>
                        {colId === 'name' || colId === 'position' ? (
                          <span className="role-cell-clamp">{renderCell(role, colId)}</span>
                        ) : renderCell(role, colId)}
                      </td>
                    ))}
                    <td className="role-action-cell">
                      <Protected permission="roles.show">
                        <button
                          type="button"
                          className="role-view-icon"
                          title={t('viewModal.view')}
                          aria-label={t('viewModal.view')}
                          onClick={() => setViewItem(role)}
                        >
                          <i className="fa-solid fa-eye"></i>
                        </button>
                      </Protected>
                      <Protected permission="roles.edit">
                        <button
                          className="role-edit-icon"
                          onClick={() => openEditModal(role)}
                          title={t('roles.edit', 'Tahrirlash')}
                        >
                          <i className="fa-solid fa-pen"></i>
                        </button>
                      </Protected>
                      <Protected permission="roles.delete">
                        <button
                          className="role-delete-icon"
                          onClick={() => setPendingDelete({ type: 'one', id: role.id })}
                          title={t('roles.delete')}
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </Protected>
                      <button
                        className="role-permission-icon"
                        onClick={() => navigate(`/roles/${role.id}/permissions`)}
                        title={t('roles.assignPermissions')}
                      >
                        <i className="fa-solid fa-shield-halved"></i>
                      </button>
                    </td>
                  </tr>
                ))
            ) : (
              <EmptyState colSpan={colCount} message={t('roles.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={rolesTotalPages}
        total={rolesTotal}
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

export default Roles;
