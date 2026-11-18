import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
import './levels.css';
import { useTranslation } from 'react-i18next';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import type { Level, LevelPayload } from '../../types';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import PaginationBar from '../../components/Pagination/PaginationBar';

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
};

const Levels = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('levels');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: Level, colId: string) => {
    switch (colId) {
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
  const [editingItem, setEditingItem] = useState<Level | null>(null);
  const [viewItem, setViewItem] = useState<Level | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [nameFilter, setNameFilter] = useState('');

  const [formData, setFormData] = useState<LevelPayload>({
    name_uz: '',
    name_ru: '',
    name_en: '',
  });

  const { data: levels, isLoading } = useQuery<Level[]>({
    queryKey: ['levels'],
    queryFn: async () => {
      const { data } = await API.get<Level[]>('/levels');
      return Array.isArray(data) ? data : ((data as { data?: Level[] })?.data ?? []);
    },
    placeholderData: keepPreviousData,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: LevelPayload) => API.post('/levels', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['levels'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (params: { id: number; payload: LevelPayload }) =>
      API.put(`/levels/${params.id}`, params.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['levels'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`/levels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['levels'] });
    },
  });

  const resetForm = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({ name_uz: '', name_ru: '', name_en: '' });
  };

  const openEditModal = (item: Level) => {
    setEditingItem(item);
    setFormData({
      name_uz: item.name_uz,
      name_ru: item.name_ru || '',
      name_en: item.name_en || '',
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

  const sortedLevels = [...(levels || [])]
    .filter((level) => !nameFilter || [level.name_uz, level.name_ru, level.name_en].some((name) => name?.toLocaleLowerCase().includes(nameFilter.trim().toLocaleLowerCase())))
    .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  const levelsTotal = sortedLevels.length;
  const levelsTotalPages = Math.max(1, Math.ceil(levelsTotal / pageSize));
  const pagedLevels = sortedLevels.slice((page - 1) * pageSize, page * pageSize);

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? (levels?.map((c) => c.id) ?? []) : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className="users container">
      <h1 className="main-title">{t('levels.mainTitle')}</h1>

      {showModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory">
            <h1>{t('levels.level')}</h1>

            <form
              className="subcategory-form"
              onSubmit={(e) => {
                e.preventDefault();

                const payload: LevelPayload = {
                  name_uz: formData.name_uz.trim(),
                  name_ru: formData.name_ru?.trim() || '',
                  name_en: formData.name_en?.trim() || '',
                };

                if (editingItem) {
                  updateMutation.mutate({ id: editingItem.id, payload });
                } else {
                  createMutation.mutate(payload);
                }
              }}
            >
              <div className="subcategory-form-group">
                <label>{t('levels.levelName')} (UZ)</label>
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
                    <label>{t('levels.levelName')} (RU)</label>
                    <input
                      type="text"
                      value={formData.name_ru}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name_ru: e.target.value }))
                      }
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('levels.levelName')} (EN)</label>
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
                <button
                  className="primary"
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t('users.saving')
                    : t('payments.save')}
                </button>
                <button type="button" className="cancel" onClick={resetForm}>
                  {t('payments.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.level')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name_uz },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
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

      <div className="users-filters">
        <input type="search" value={nameFilter} placeholder={t('levels.levelName')} aria-label={t('levels.levelName')} onChange={(e) => { setNameFilter(e.target.value); setPage(1); }} />
        <Protected permission="levels.create">
          <button className="add-new-user" onClick={() => setShowModal(true)}>
            {t('users.addNew')}
          </button>
        </Protected>

        <Protected permission="levels.delete">
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

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === (levels?.length ?? 0) && (levels?.length ?? 0) > 0}
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
              <th>{t('levels.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : levels && levels.length > 0 ? (
              pagedLevels.map((item) => (
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
                      <Protected permission="levels.show">
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
                      <Protected permission="levels.edit">
                        <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                          <i className="fa-solid fa-pen"></i>
                        </button>
                      </Protected>

                      <Protected permission="levels.delete">
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
              <EmptyState colSpan={colCount} message={t('levels.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={levelsTotalPages}
        total={levelsTotal}
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

export default Levels;
