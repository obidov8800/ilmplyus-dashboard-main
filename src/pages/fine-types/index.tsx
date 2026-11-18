import { useState, useMemo, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
import { useTranslation } from 'react-i18next';
import PageTitle from '@/components/PageTitle';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { useTableColumns } from '../../hooks/useTableColumns';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';

/**
 * Jarima turi. DIQQAT: backend ro'yxatda `name` (yoki `title`) qaytarishi
 * mumkin, lekin yozishda (`POST`/`PUT`) `name_uz` maydonini talab qiladi —
 * "The name_uz field is required" xatosi shundan kelib chiqadi.
 */
interface FineType {
  id: number;
  name: string;
  name_ru: string;
  name_en: string;
  /** Standart summa — jarima kiritilganda summa berilmasa shu olinadi. */
  amount: number;
}

interface FineTypeFormData {
  name: string;
  name_ru: string;
  name_en: string;
  amount: string;
}

const emptyForm: FineTypeFormData = { name: '', name_ru: '', name_en: '', amount: '' };

const langInputStyle: CSSProperties = {
  height: 44,
  padding: '0 14px',
  border: '1.5px solid #d0d9e6',
  borderRadius: 10,
  fontSize: 14,
  color: '#003366',
  background: '#fff',
  outline: 'none',
};

const formatAmount = (val: number) =>
  val.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const FineTypes = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('fineTypes');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });

  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<FineType | null>(null);
  const [viewItem, setViewItem] = useState<FineType | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [formData, setFormData] = useState<FineTypeFormData>(emptyForm);

  const { data: fineTypes, isLoading } = useQuery<FineType[]>({
    queryKey: ['fine-types'],
    queryFn: async () => {
      const { data } = await API.get('/fine-types');
      const list: Array<Record<string, unknown>> = Array.isArray(data) ? data : (data?.data ?? []);
      return list.map((raw) => ({
        id: Number(raw.id),
        // Ro'yxatda `name_uz` yoki tayyor `name`/`title` kelishi mumkin.
        name: String(raw.name_uz ?? raw.name ?? raw.title ?? ''),
        name_ru: String(raw.name_ru ?? ''),
        name_en: String(raw.name_en ?? ''),
        amount: Number(raw.amount ?? raw.default_amount ?? 0),
      }));
    },
  });

  const filteredFineTypes = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return fineTypes ?? [];
    return (fineTypes ?? []).filter((item) =>
      [item.name, item.name_ru, item.name_en, String(item.amount)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(term)),
    );
  }, [fineTypes, search]);

  const sorted = useMemo(
    () => filteredFineTypes.slice().sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id)),
    [filteredFineTypes, sortAsc],
  );

  const fineTypesTotal = sorted.length;
  const fineTypesTotalPages = Math.max(1, Math.ceil(fineTypesTotal / pageSize));
  const pagedFineTypes = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const resetForm = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData(emptyForm);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      // MUHIM: backend `name` emas, `name_uz` maydonini talab qiladi.
      const { data } = await API.post('/fine-types', {
        name_uz: formData.name.trim(),
        name_ru: formData.name_ru.trim() || '',
        name_en: formData.name_en.trim() || '',
        amount: Number(formData.amount),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fine-types'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const { data } = await API.put(`/fine-types/${id}`, {
        name_uz: formData.name.trim(),
        name_ru: formData.name_ru.trim() || '',
        name_en: formData.name_en.trim() || '',
        amount: Number(formData.amount),
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fine-types'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/fine-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fine-types'] });
    },
  });

  const openEditModal = (item: FineType) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      name_ru: item.name_ru,
      name_en: item.name_en,
      amount: String(item.amount),
    });
    setShowModal(true);
  };

  const formInvalid = !formData.name.trim() || formData.amount === '' || Number(formData.amount) < 0;

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
    setSelected((current) => {
      const visibleIds = new Set(sorted.map((f) => f.id));
      return checked
        ? [...new Set([...current, ...visibleIds])]
        : current.filter((id) => !visibleIds.has(id));
    });

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const renderCell = (item: FineType, colId: string) => {
    switch (colId) {
      case 'name':
        return item.name;
      case 'amount':
        return `${formatAmount(item.amount)} ${t('fineTypes.soum')}`;
      default:
        return '-';
    }
  };

  return (
    <section className="users container">
      <PageTitle title={t('fineTypes.title')} icon="fa-gavel" />

      {showModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 400 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 22,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: '#fef3e2',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                <i className="fa-solid fa-triangle-exclamation" />
              </div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#003366' }}>
                {editingItem ? t('fineTypes.editTitle') : t('fineTypes.addTitle')}
              </h2>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (formInvalid) return;
                if (editingItem) {
                  updateMutation.mutate({ id: editingItem.id });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#003366' }}>
                    {t('fineTypes.name')} (UZ)
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={t('fineTypes.namePlaceholder')}
                    autoFocus
                    required
                    style={langInputStyle}
                  />
                </div>

                {editingItem && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <label style={{ fontSize: 13, fontWeight: 500, color: '#003366' }}>
                        {t('fineTypes.name')} (RU)
                      </label>
                      <input
                        type="text"
                        value={formData.name_ru}
                        onChange={(e) => setFormData({ ...formData, name_ru: e.target.value })}
                        placeholder={t('fineTypes.namePlaceholder')}
                        style={langInputStyle}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <label style={{ fontSize: 13, fontWeight: 500, color: '#003366' }}>
                        {t('fineTypes.name')} (EN)
                      </label>
                      <input
                        type="text"
                        value={formData.name_en}
                        onChange={(e) => setFormData({ ...formData, name_en: e.target.value })}
                        placeholder={t('fineTypes.namePlaceholder')}
                        style={langInputStyle}
                      />
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: '#003366' }}>
                    {t('fineTypes.amount')}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      min="0"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="0"
                      required
                      style={{
                        width: '100%',
                        height: 44,
                        padding: '0 56px 0 14px',
                        border: '1.5px solid #d0d9e6',
                        borderRadius: 10,
                        fontSize: 14,
                        color: '#003366',
                        background: '#fff',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        right: 14,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 13,
                        color: '#7a8fa6',
                        fontWeight: 500,
                        pointerEvents: 'none',
                      }}
                    >
                      {t('fineTypes.soum')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: 0 }}>
                <button
                  className="primary"
                  type="submit"
                  disabled={formInvalid || createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t('fineTypes.saving')
                    : t('fineTypes.save')}
                </button>
                <button type="button" className="cancel" onClick={resetForm}>
                  {t('fineTypes.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.fineType')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
            { label: t('columns.amount'), value: renderCell(viewItem, 'amount') },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small" style={{ width: 360 }}>
            <h2 className="modal-title" style={{ marginTop: 0 }}>
              {t('fineTypes.delete')}
            </h2>
            <p style={{ textAlign: 'center', color: '#444', marginBottom: 0 }}>
              {t('fineTypes.confirmDelete')}
            </p>

            <div className="modal-actions">
              <button
                className="danger"
                style={{ background: '#c90000', color: '#fff' }}
                onClick={confirmDelete}
              >
                {t('fineTypes.delete')}
              </button>
              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('fineTypes.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="users-filters">
        <input
          type="search"
          value={search}
          placeholder={t('fineTypes.searchPlaceholder')}
          aria-label={t('fineTypes.searchPlaceholder')}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Protected permission="fine_types.create">
          <button className="add-new-user" onClick={() => setShowModal(true)}>
            {t('fineTypes.addBtn')}
          </button>
        </Protected>

        <Protected permission="fine_types.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('fineTypes.delete')}
          </button>
        </Protected>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th style={{ width: 46 }}>
                <input
                  type="checkbox"
                  checked={sorted.length > 0 && sorted.every((f) => selected.includes(f.id))}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              {isVisible('id') && (
                <th className="th-sortable" onClick={() => setSortAsc((p) => !p)}>
                  ID {sortAsc ? '↑' : '↓'}
                </th>
              )}
              {visibleColumns.map((colId) => (
                <th key={colId} style={colId === 'name' ? { textAlign: 'left' } : undefined}>
                  {columnHeader(colId)}
                </th>
              ))}
              <th>{t('fineTypes.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={6} columnCount={colCount} />
            ) : sorted.length > 0 ? (
              pagedFineTypes.map((item) => (
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
                    <td key={colId} style={colId === 'name' ? { textAlign: 'left' } : undefined}>
                      {renderCell(item, colId)}
                    </td>
                  ))}

                  <td className="actions">
                    <Protected permission="fine_types.show">
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
                    <Protected permission="fine_types.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                        <i className="fa-solid fa-pen" />
                      </button>
                    </Protected>

                    <Protected permission="fine_types.delete">
                      <button
                        className="user-delete-btn"
                        onClick={() => {
                          setDeleteTarget(item.id);
                          setShowDeleteModal(true);
                        }}
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('fineTypes.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={fineTypesTotalPages}
        total={fineTypesTotal}
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

export default FineTypes;
