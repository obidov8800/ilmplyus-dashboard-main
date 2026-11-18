import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  rejectionReasonAPI,
  type RejectionReason,
  type RejectionReasonPayload,
} from '../../api/rejection-reason.api';
import '../users/users.css';
import '../expenses/expenses.css';
import { useTranslation } from 'react-i18next';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { useTableColumns } from '../../hooks/useTableColumns';

interface FormData {
  name: string;
  name_ru: string;
  name_en: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

const emptyForm: FormData = {
  name: '',
  name_ru: '',
  name_en: '',
  comment: '',
  created_at: '',
  updated_at: '',
};

const formatDateTime = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toLocalDateTimeInput = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const RefusalReasons = () => {
  const { t } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('refusalReasons');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<RejectionReason | null>(null);
  const [viewItem, setViewItem] = useState<RejectionReason | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formData, setFormData] = useState<FormData>(emptyForm);

  const { data: reasons, isLoading } = useQuery<RejectionReason[]>({
    queryKey: ['rejection-reasons'],
    queryFn: rejectionReasonAPI.getAll,
  });

  const filteredReasons = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return reasons ?? [];
    return (reasons ?? []).filter((item) =>
      [item.name_uz, item.name_ru, item.name_en, item.comment]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(term)),
    );
  }, [reasons, search]);

  const sorted = useMemo(
    () => filteredReasons.slice().sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id)),
    [filteredReasons, sortAsc],
  );

  const reasonsTotal = sorted.length;
  const reasonsTotalPages = Math.max(1, Math.ceil(reasonsTotal / pageSize));
  const pagedReasons = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const createMutation = useMutation({
    mutationFn: () => {
      const payload: RejectionReasonPayload = {
        name_uz: formData.name,
        name_ru: formData.name_ru.trim() || '',
        name_en: formData.name_en.trim() || '',
        comment: formData.comment || undefined,
      };
      return rejectionReasonAPI.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rejection-reasons'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FormData }) => {
      const payload: RejectionReasonPayload = {
        name_uz: data.name,
        name_ru: data.name_ru.trim() || '',
        name_en: data.name_en.trim() || '',
        comment: data.comment || undefined,
      };
      if (data.created_at) {
        const base = data.created_at.replace('T', ' ');
        payload.created_at = base.length === 16 ? base + ':00' : base;
      }
      if (data.updated_at) {
        const base = data.updated_at.replace('T', ' ');
        payload.updated_at = base.length === 16 ? base + ':00' : base;
      }
      return rejectionReasonAPI.update(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rejection-reasons'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: rejectionReasonAPI.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rejection-reasons'] });
    },
  });

  const openEditModal = (item: RejectionReason) => {
    setEditingItem(item);
    setFormData({
      name: item.name_uz || '',
      name_ru: item.name_ru || '',
      name_en: item.name_en || '',
      comment: item.comment || '',
      created_at: toLocalDateTimeInput(item.created_at),
      updated_at: toLocalDateTimeInput(item.updated_at),
    });
    setShowAddModal(true);
  };

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    } else if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((p) => p.filter((x) => x !== deleteTarget));
    }
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const toggleAll = (checked: boolean) =>
    setSelected((current) => {
      const visibleIds = new Set(sorted.map((r) => r.id));
      return checked
        ? [...new Set([...current, ...visibleIds])]
        : current.filter((id) => !visibleIds.has(id));
    });

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const resetForm = () => {
    setShowAddModal(false);
    setEditingItem(null);
    setFormData(emptyForm);
  };

  return (
    <section className="users container">
      <h1 className="main-title">{t('refusalReasons.title')}</h1>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory">
            <h1>{editingItem ? t('refusalReasons.editTitle') : t('refusalReasons.addTitle')}</h1>

            <form
              className="subcategory-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingItem) {
                  updateMutation.mutate({ id: editingItem.id, data: formData });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="subcategory-form-group">
                <label>{t('refusalReasons.name')} (UZ)</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('refusalReasons.name')}
                  required
                />
              </div>

              {editingItem && (
                <>
                  <div className="subcategory-form-group">
                    <label>{t('refusalReasons.name')} (RU)</label>
                    <input
                      type="text"
                      value={formData.name_ru}
                      onChange={(e) => setFormData({ ...formData, name_ru: e.target.value })}
                      placeholder={t('refusalReasons.name')}
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('refusalReasons.name')} (EN)</label>
                    <input
                      type="text"
                      value={formData.name_en}
                      onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
                      placeholder={t('refusalReasons.name')}
                    />
                  </div>
                </>
              )}

              <div className="subcategory-form-group">
                <label>{t('refusalReasons.comment')}</label>
                <input
                  type="text"
                  value={formData.comment}
                  onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                  placeholder={t('refusalReasons.comment')}
                />
              </div>

              {editingItem && (
                <>
                  <div className="subcategory-form-group">
                    <label>{t('refusalReasons.createdAt')}</label>
                    <input
                      type="datetime-local"
                      value={formData.created_at}
                      onChange={(e) => setFormData({ ...formData, created_at: e.target.value })}
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('refusalReasons.updatedAt')}</label>
                    <input
                      type="datetime-local"
                      value={formData.updated_at}
                      onChange={(e) => setFormData({ ...formData, updated_at: e.target.value })}
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
                    ? t('refusalReasons.saving')
                    : t('refusalReasons.save')}
                </button>

                <button type="button" className="cancel" onClick={resetForm}>
                  {t('refusalReasons.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.refusalReason')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name_uz },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
            { label: t('columns.comment'), value: viewItem.comment },
            { label: t('columns.created_at'), value: formatDateTime(viewItem.created_at) },
            { label: t('columns.updated_at'), value: formatDateTime(viewItem.updated_at) },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('refusalReasons.confirmDelete')}</h3>

            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('refusalReasons.delete')}
              </button>

              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('refusalReasons.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="users-filters">
        <input
          type="search"
          value={search}
          placeholder={t('refusalReasons.searchPlaceholder')}
          aria-label={t('refusalReasons.searchPlaceholder')}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Protected permission="rejection_reasons.create">
          <button className="add-new-user" onClick={() => setShowAddModal(true)}>
            {t('refusalReasons.addBtn')}
          </button>
        </Protected>

        <Protected permission="rejection_reasons.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('refusalReasons.delete')}
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
                  checked={sorted.length > 0 && sorted.every((r) => selected.includes(r.id))}
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
              <th>{t('refusalReasons.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : sorted.length ? (
              pagedReasons.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleOne(item.id)}
                    />
                  </td>
                  {isVisible('id') && <td>{item.id}</td>}
                  {visibleColumns.map((colId) => {
                    switch (colId) {
                      case 'name':
                        return <td key={colId}>{item.name_uz}</td>;
                      case 'comment':
                        return <td key={colId}>{item.comment || '-'}</td>;
                      case 'created_at':
                        return <td key={colId}>{formatDateTime(item.created_at)}</td>;
                      case 'updated_at':
                        return <td key={colId}>{formatDateTime(item.updated_at)}</td>;
                      default:
                        return <td key={colId}>-</td>;
                    }
                  })}

                  <td className="actions">
                    <Protected permission="rejection_reasons.show">
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
                    <Protected permission="rejection_reasons.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>

                    <Protected permission="rejection_reasons.delete">
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
              <EmptyState colSpan={colCount} message={t('refusalReasons.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={reasonsTotalPages}
        total={reasonsTotal}
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

export default RefusalReasons;
