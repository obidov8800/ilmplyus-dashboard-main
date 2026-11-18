import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
import './expenses.css';
import '../finance/finance.css';
import { useTranslation } from 'react-i18next';
import { clampCell } from '@/utils/clampCell';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { getLocalized } from '../../utils/getLocalized';
import { jamgarmaLabelWithBranch } from '../../utils/jamgarmaLabel';
import MultiPicker from '@/components/MultiPicker';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useOptions } from '../../hooks/useOptions';

interface Jamgarma {
  id: number;
  name_uz: string;
  name_ru?: string;
  name_en?: string;
  status: string;
}

interface ExpenseCategory {
  id: number;
  name_uz: string;
  name_ru?: string;
  name_en?: string;
  created_at: string;
  updated_at: string;
  jamgarmas?: Jamgarma[];
}

interface FormData {
  name: string;
  name_ru: string;
  name_en: string;
  jamgarma_ids: number[];
  created_at: string;
  updated_at: string;
}

const emptyForm: FormData = {
  name: '',
  name_ru: '',
  name_en: '',
  jamgarma_ids: [],
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

const toApiDateTime = (dt: string) => {
  if (!dt) return undefined;
  const base = dt.replace('T', ' ');
  return base.length === 16 ? base + ':00' : base;
};

const ExpensesCategory = () => {
  const { isVisible, visibleColumns } = useTableColumns('expenseCategories');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<ExpenseCategory | null>(null);
  const [viewItem, setViewItem] = useState<ExpenseCategory | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [nameFilter, setNameFilter] = useState('');

  const { data: jamgarmas } = useOptions('jamgarmas');
  const { data: branches } = useOptions('branches');
  // Bir xil nomli jamg'arma har filialda bor — ro'yxatda filial nomi bilan ajratiladi.
  const jamgarmaOptionLabel = (j: { label: string; branch_id?: unknown }) =>
    jamgarmaLabelWithBranch(j.label, j.branch_id as number | undefined, branches);

  const { data: categories, isLoading } = useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data } = await API.get('/expense-categories');
      return data.data ?? data;
    },
  });


  const createMutation = useMutation({
    mutationFn: async () =>
      API.post('/expense-categories', {
        name_uz: formData.name,
        name_ru: formData.name_ru.trim() || '',
        name_en: formData.name_en.trim() || '',
        jamgarma_ids: formData.jamgarma_ids,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const payload: Record<string, unknown> = {
        name_uz: formData.name,
        name_ru: formData.name_ru.trim() || '',
        name_en: formData.name_en.trim() || '',
        jamgarma_ids: formData.jamgarma_ids,
      };
      if (formData.created_at) payload.created_at = toApiDateTime(formData.created_at);
      if (formData.updated_at) payload.updated_at = toApiDateTime(formData.updated_at);
      return API.put(`/expense-categories/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`/expense-categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
    },
  });

  const resetForm = () => {
    setShowAddModal(false);
    setEditingItem(null);
    setFormData(emptyForm);
  };

  const openEditModal = (item: ExpenseCategory) => {
    setEditingItem(item);
    setFormData({
      name: item.name_uz,
      name_ru: item.name_ru || '',
      name_en: item.name_en || '',
      jamgarma_ids: item.jamgarmas?.map((j) => j.id) ?? [],
      created_at: toLocalDateTimeInput(item.created_at),
      updated_at: toLocalDateTimeInput(item.updated_at),
    });
    setShowAddModal(true);
  };

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

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? categories?.map((c) => c.id) || [] : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const getJamgarmaName = (j: Jamgarma) =>
    getLocalized(j, 'name', i18n.language) || j.name_uz || '-';

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: ExpenseCategory, colId: string) => {
    switch (colId) {
      case 'name':
        return getLocalized(item, 'name', i18n.language);
      case 'fund':
        return item.jamgarmas && item.jamgarmas.length > 0
          ? item.jamgarmas.map((j) => getJamgarmaName(j)).join(', ')
          : '-';
      case 'created_at':
        return formatDateTime(item.created_at);
      case 'updated_at':
        return formatDateTime(item.updated_at);
      default:
        return '-';
    }
  };

  return (
    <section className="users container">
      <h1 className="main-title">{t('expenses.expenseCategory')}</h1>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory">
            <h1>{editingItem ? t('expenses.editCategory') : t('expenses.expenseCategory')}</h1>

            <form
              className="subcategory-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingItem) {
                  updateMutation.mutate({ id: editingItem.id });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="subcategory-form-group">
                <label>{t('expenses.fund')}</label>
                <MultiPicker
                  options={(jamgarmas ?? []).map((j) => ({ value: j.id, label: jamgarmaOptionLabel(j) }))}
                  value={formData.jamgarma_ids}
                  onChange={(ids) => setFormData((prev) => ({ ...prev, jamgarma_ids: ids }))}
                  placeholder={t('expenses.chooseFund')}
                />
              </div>

              <div className="subcategory-form-group">
                <label>{t('expenses.expenseCategoryName')} (UZ)</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              {editingItem && (
                <>
                  <div className="subcategory-form-group">
                    <label>{t('expenses.expenseCategoryName')} (RU)</label>
                    <input
                      type="text"
                      value={formData.name_ru}
                      onChange={(e) => setFormData({ ...formData, name_ru: e.target.value })}
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('expenses.expenseCategoryName')} (EN)</label>
                    <input
                      type="text"
                      value={formData.name_en}
                      onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('expenses.createdAt')}</label>
                    <input
                      type="datetime-local"
                      value={formData.created_at}
                      onChange={(e) => setFormData({ ...formData, created_at: e.target.value })}
                    />
                  </div>
                  <div className="subcategory-form-group">
                    <label>{t('expenses.updatedAt')}</label>
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
                    ? t('expenses.saving')
                    : t('expenses.save')}
                </button>
                <button type="button" className="cancel" onClick={resetForm}>
                  {t('expenses.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.expenseCategory')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name_uz },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
            { label: t('columns.fund'), value: renderCell(viewItem, 'fund') },
            { label: t('columns.created_at'), value: renderCell(viewItem, 'created_at') },
            { label: t('columns.updated_at'), value: renderCell(viewItem, 'updated_at') },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('expenses.confirmDelete')}</h3>
            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('expenses.delete')}
              </button>
              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('expenses.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="users-filters">
        <input type="search" value={nameFilter} placeholder={t('expenses.expenseCategory')} aria-label={t('expenses.expenseCategory')} onChange={(e) => setNameFilter(e.target.value)} />
        <Protected permission="expense_categories.create">
          <button className="add-new-user" onClick={() => setShowAddModal(true)}>
            {t('expenses.addBtn')}
          </button>
        </Protected>
        <Protected permission="expense_categories.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('expenses.delete')}
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
                  checked={
                    selected.length === (categories?.length || 0) && (categories?.length || 0) > 0
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
              <th>{t('expenses.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : categories?.some((item) => !nameFilter || [item.name_uz, item.name_ru, item.name_en].some((name) => name?.toLocaleLowerCase().includes(nameFilter.trim().toLocaleLowerCase()))) ? (
              [...(categories || [])]
                .filter((item) => !nameFilter || [item.name_uz, item.name_ru, item.name_en].some((name) => name?.toLocaleLowerCase().includes(nameFilter.trim().toLocaleLowerCase())))
                .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id))
                .map((item) => (
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
                      <td key={colId}>{clampCell(renderCell(item, colId))}</td>
                    ))}
                    <td className="actions">
                      <Protected permission="expense_categories.show">
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
                      <Protected permission="expense_categories.edit">
                        <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                          <i className="fa-solid fa-pen"></i>
                        </button>
                      </Protected>
                      <Protected permission="expense_categories.delete">
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
              <EmptyState colSpan={colCount} message={t('expenses.categoryNotFound')} />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default ExpensesCategory;
