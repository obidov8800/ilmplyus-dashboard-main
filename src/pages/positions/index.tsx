import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
import '../levels/levels.css';
import './positions.css';
import { useTranslation } from 'react-i18next';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import type { PositionItem, PositionPayload } from '../../types';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useOptions } from '../../hooks/useOptions';

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
};

const Positions = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('positions');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: PositionItem, colId: string) => {
    switch (colId) {
      case 'department':
        return item.department ? getLocalized(item.department, 'name', i18n.language) : '-';
      case 'name':
        return getLocalized(item, 'name', i18n.language);
      case 'created_at':
        return item.created_at ? formatDate(item.created_at) : '-';
      default:
        return '-';
    }
  };

  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<PositionItem | null>(null);
  const [viewItem, setViewItem] = useState<PositionItem | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');

  const [formData, setFormData] = useState<PositionPayload>({
    name_uz: '',
    name_ru: '',
    name_en: '',
    department_id: 0,
  });

  const { data: positions, isLoading } = useQuery<PositionItem[]>({
    queryKey: ['positions'],
    queryFn: async () => {
      const { data } = await API.get<PositionItem[] | { data: PositionItem[] }>('/positions');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    placeholderData: keepPreviousData,
  });

  const { data: departments = [] } = useOptions('departments');

  const createMutation = useMutation({
    mutationFn: (payload: PositionPayload) => API.post('/positions', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (params: { id: number; payload: PositionPayload }) =>
      API.put(`/positions/${params.id}`, params.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => API.delete(`/positions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    },
  });

  const resetForm = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({ name_uz: '', name_ru: '', name_en: '', department_id: 0 });
  };

  const openEditModal = (item: PositionItem) => {
    setEditingItem(item);
    setFormData({
      name_uz: item.name_uz,
      name_ru: item.name_ru || '',
      name_en: item.name_en || '',
      department_id: item.department?.id ?? 0,
    });
    setShowModal(true);
  };

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    }

    if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((prev) => prev.filter((x) => x !== deleteTarget));
    }

    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const normalizedSearch = search.trim().toLocaleLowerCase(i18n.language);
  const sortedPositions = [...(positions || [])]
    .filter((item) => !departmentFilter || String(item.department?.id ?? '') === departmentFilter)
    .filter((item) => {
      if (!normalizedSearch) return true;
      return [item.name_uz, item.name_ru, item.name_en, item.department?.name_uz, item.department?.name_ru, item.department?.name_en, String(item.id)]
        .some((value) => String(value ?? '').toLocaleLowerCase(i18n.language).includes(normalizedSearch));
    })
    .sort((a, b) => sortAsc ? a.id - b.id : b.id - a.id);
  const positionsTotal = sortedPositions.length;
  const positionsTotalPages = Math.max(1, Math.ceil(positionsTotal / pageSize));
  const pagedPositions = sortedPositions.slice((page - 1) * pageSize, page * pageSize);

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? pagedPositions.map((position) => position.id) : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <section className="users container">
      <h1 className="main-title">{t('positions.mainTitle')}</h1>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory">
            <h1>{editingItem ? t('positions.editTitle') : t('positions.addTitle')}</h1>

            <form
              className="subcategory-form"
              onSubmit={(e) => {
                e.preventDefault();

                const payload: PositionPayload = {
                  name_uz: formData.name_uz.trim(),
                  name_ru: formData.name_ru?.trim() || '',
                  name_en: formData.name_en?.trim() || '',
                  department_id: formData.department_id,
                };

                if (editingItem) {
                  updateMutation.mutate({ id: editingItem.id, payload });
                } else {
                  createMutation.mutate(payload);
                }
              }}
            >
              {/* Department select */}
              <div className="subcategory-form-group">
                <label>{t('positions.department')}</label>
                <select
                  value={formData.department_id || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      department_id: Number(e.target.value),
                    }))
                  }
                  required
                >
                  <option value="">{t('positions.choose')}</option>
                  {departments?.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Position name inputs */}
              <div className="subcategory-form-group">
                <label>{t('positions.positionName')} (UZ)</label>
                <input
                  type="text"
                  value={formData.name_uz}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name_uz: e.target.value }))}
                  required
                />
              </div>

              {editingItem && (
                <>
                  <div className="subcategory-form-group">
                    <label>{t('positions.positionName')} (RU)</label>
                    <input
                      type="text"
                      value={formData.name_ru}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name_ru: e.target.value }))
                      }
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('positions.positionName')} (EN)</label>
                    <input
                      type="text"
                      value={formData.name_en}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name_en: e.target.value }))
                      }
                    />
                  </div>
                </>
              )}

              <div className="modal-actions">
                <button className="primary" type="submit" disabled={isPending}>
                  {isPending ? t('users.saving') : t('payments.save')}
                </button>

                <button type="button" className="cancel" onClick={resetForm}>
                  {t('payments.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.position')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name_uz },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
            { label: t('columns.department'), value: renderCell(viewItem, 'department') },
            { label: t('columns.created_at'), value: renderCell(viewItem, 'created_at') },
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
                {t('users.delete')}
              </button>

              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('users.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="users-filters">
        <input
          type="search"
          value={search}
          placeholder={t('positions.searchPlaceholder')}
          aria-label={t('positions.searchPlaceholder')}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
            setSelected([]);
          }}
        />
        <select
          value={departmentFilter}
          aria-label={t('positions.department')}
          onChange={(e) => {
            setDepartmentFilter(e.target.value);
            setPage(1);
            setSelected([]);
          }}
        >
          <option value="">{t('positions.allDepartments')}</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>{department.label}</option>
          ))}
        </select>
        {(search || departmentFilter) && (
          <button
            className="positions-clear-filters"
            onClick={() => {
              setSearch('');
              setDepartmentFilter('');
              setPage(1);
              setSelected([]);
            }}
          >
            {t('positions.clearFilters')}
          </button>
        )}
        <Protected permission="positions.create">
          <button className="add-new-user" onClick={() => setShowModal(true)}>
            {t('users.addNew')}
          </button>
        </Protected>

        <Protected permission="positions.delete">
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
      </div>

      {/* Table */}
      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    pagedPositions.length > 0 && pagedPositions.every((position) => selected.includes(position.id))
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
              <th>{t('positions.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : pagedPositions.length > 0 ? (
              pagedPositions.map((item) => (
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
                      <Protected permission="positions.show">
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
                      <Protected permission="positions.edit">
                        <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                          <i className="fa-solid fa-pen"></i>
                        </button>
                      </Protected>

                      <Protected permission="positions.delete">
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
              <EmptyState colSpan={colCount} message={t('positions.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={positionsTotalPages}
        total={positionsTotal}
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

export default Positions;
