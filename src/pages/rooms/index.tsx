import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
import '../expenses/expenses.css';
import { useTranslation } from 'react-i18next';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { useTableColumns } from '../../hooks/useTableColumns';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { useOptions, type OptionItem } from '../../hooks/useOptions';

/** Backend filialni nom (string) yoki obyekt sifatida qaytarishi mumkin. */
type RoomBranch = string | { id?: number; label?: string; name?: string; name_uz?: string } | null;

interface Room {
  id: number;
  name: string;
  /** /rooms javobida bo'lmasligi mumkin — bunda id `branch` dan aniqlanadi. */
  branch_id?: number | string | null;
  capacity: number;
  floor: number;
  branch?: RoomBranch;
}

interface RoomFormData {
  name: string;
  branch_id: string;
  capacity: string;
  floor: string;
}

const branchLabel = (branch: RoomBranch | undefined): string => {
  if (!branch) return '';
  if (typeof branch === 'string') return branch;
  return branch.label || branch.name_uz || branch.name || '';
};

/**
 * Tahrirlash formasi uchun filial id'si: javobda `branch_id` bo'lmasa,
 * filial nomi bo'yicha /options/branches ro'yxatidan topiladi.
 */
const resolveBranchId = (item: Room, branches: OptionItem[] | undefined): string => {
  if (item.branch_id !== undefined && item.branch_id !== null && item.branch_id !== '')
    return String(item.branch_id);
  if (typeof item.branch === 'object' && item.branch?.id) return String(item.branch.id);
  const label = branchLabel(item.branch).trim();
  if (!label) return '';
  const match = (branches ?? []).find((b) => b.label?.trim() === label);
  return match ? String(match.id) : '';
};

const Rooms = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('rooms');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: Room, colId: string) => {
    switch (colId) {
      case 'branch':
        return branchLabel(item.branch) || '-';
      case 'floor':
        return item.floor;
      case 'name':
        return item.name;
      case 'capacity':
        return item.capacity;
      default:
        return '-';
    }
  };

  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<Room | null>(null);
  const [viewItem, setViewItem] = useState<Room | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [formData, setFormData] = useState<RoomFormData>({
    name: '',
    branch_id: '',
    capacity: '',
    floor: '',
  });

  const { data: rooms, isLoading } = useQuery<Room[]>({
    queryKey: ['rooms'],
    queryFn: async () => {
      const { data } = await API.get('/rooms');
      // Massiv ham, `{ data: [...] }` ham bo'lishi mumkin; `undefined` qaytsa react-query xato beradi va ro'yxat bo'sh qoladi.
      return (Array.isArray(data) ? data : (data?.data ?? [])) as Room[];
    },
  });

  const { data: branches } = useOptions('branches');

  const [branchFilter, setBranchFilter] = useState('');

  const sortedRooms = useMemo(() => {
    // `/rooms` javobida `branch_id` yo'q — faqat `branch` (nom, string).
    // Shu sabab filial id'sini `resolveBranchId` orqali nomdan aniqlaymiz.
    return (rooms || [])
      .filter((r) => !branchFilter || resolveBranchId(r, branches) === branchFilter)
      .slice()
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  }, [rooms, branchFilter, sortAsc, branches]);

  const roomsTotal = sortedRooms.length;
  const roomsTotalPages = Math.max(1, Math.ceil(roomsTotal / pageSize));
  const pagedRooms = useMemo(
    () => sortedRooms.slice((page - 1) * pageSize, page * pageSize),
    [sortedRooms, page, pageSize],
  );

  const createMutation = useMutation({
    mutationFn: async () =>
      API.post('/rooms', {
        name: formData.name,
        branch_id: Number(formData.branch_id),
        capacity: Number(formData.capacity),
        floor: Number(formData.floor),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      setShowAddModal(false);
      setEditingItem(null);
      setFormData({ name: '', branch_id: '', capacity: '', floor: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: RoomFormData }) =>
      API.put(`/rooms/${id}`, {
        name: payload.name,
        branch_id: Number(payload.branch_id),
        capacity: Number(payload.capacity),
        floor: Number(payload.floor),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
      setShowAddModal(false);
      setEditingItem(null);
      setFormData({ name: '', branch_id: '', capacity: '', floor: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`/rooms/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
  });

  const openEditModal = (item: Room) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      branch_id: resolveBranchId(item, branches),
      capacity: String(item.capacity),
      floor: String(item.floor),
    });
    setShowAddModal(true);
  };

  // Filial ro'yxati modal ochilgandan keyin yuklansa, tanlangan filialni qayta aniqlaymiz.
  // Bu — tashqi manba (`/options/branches`) yuklanganda bir martalik sinxronizatsiya;
  // `formData.branch_id` guard qayta ishga tushishni to'sadi.
  useEffect(() => {
    if (!editingItem || formData.branch_id) return;
    const resolved = resolveBranchId(editingItem, branches);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (resolved) setFormData((prev) => ({ ...prev, branch_id: resolved }));
  }, [editingItem, branches, formData.branch_id]);

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

  const toggleAll = (checked: boolean) => setSelected(checked ? rooms?.map((r) => r.id) || [] : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className="users container">
      <h1 className="main-title">{t('rooms.rooms')}</h1>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory">
            <h1>{t('rooms.rooms')}</h1>

            <form
              className="subcategory-form"
              onSubmit={(e) => {
                e.preventDefault();

                if (editingItem) {
                  updateMutation.mutate({
                    id: editingItem.id,
                    payload: formData,
                  });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="subcategory-form-group">
                <label>{t('rooms.branch')}</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      branch_id: e.target.value,
                    })
                  }
                  required
                >
                  <option value="">{t('rooms.choose')}</option>
                  {branches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="subcategory-form-group">
                <label>{t('rooms.roomName')}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="subcategory-form-group">
                <label>{t('rooms.capacity')}</label>
                <input
                  type="number"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                  required
                />
              </div>

              <div className="subcategory-form-group">
                <label>{t('rooms.floor')}</label>
                <input
                  type="number"
                  value={formData.floor}
                  onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t('users.saving')
                    : t('rooms.save')}
                </button>

                <button
                  type="button"
                  className="cancel"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingItem(null);
                    setFormData({
                      name: '',
                      branch_id: '',
                      capacity: '',
                      floor: '',
                    });
                  }}
                >
                  {t('rooms.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.room')}
          fields={[
            { label: t('columns.name'), value: renderCell(viewItem, 'name') },
            { label: t('columns.branch'), value: renderCell(viewItem, 'branch') },
            { label: t('columns.capacity'), value: renderCell(viewItem, 'capacity') },
            { label: t('columns.floor'), value: renderCell(viewItem, 'floor') },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('rooms.confirmDelete')}</h3>

            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('rooms.delete')}
              </button>

              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('rooms.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="users-filters">
        <Protected permission="rooms.create">
          <button className="add-new-user" onClick={() => setShowAddModal(true)}>
            {t('rooms.addBtn')}
          </button>
        </Protected>

        <Protected permission="rooms.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('rooms.delete')}
          </button>
        </Protected>

        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('rooms.branch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === (rooms?.length || 0) && (rooms?.length || 0) > 0}
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
              <th>{t('rooms.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : sortedRooms.length ? (
              pagedRooms.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleOne(item.id)}
                    />
                  </td>

                  {isVisible('id') && <td>{item.id}</td>}
                  {visibleColumns.map((colId) => (
                    <td key={colId}>{renderCell(item, colId)}</td>
                  ))}

                  <td className="actions">
                    <Protected permission="rooms.show">
                      <button
                        type="button"
                        className="user-view-btn"
                        title={t('viewModal.view')}
                        aria-label={t('viewModal.view')}
                        onClick={() => setViewItem(item)}
                      >
                        <i className="fa-solid fa-eye"></i>
                      </button>
                    </Protected>
                    <Protected permission="rooms.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>

                    <Protected permission="rooms.delete">
                      <button
                        className="user-delete-btn"
                        onClick={() => {
                          setDeleteTarget(item.id);
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
              <EmptyState colSpan={colCount} message={t('rooms.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={roomsTotalPages}
        total={roomsTotal}
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

export default Rooms;
