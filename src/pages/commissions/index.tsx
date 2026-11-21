import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
// Tahrirlash/qo'shish modali `.expenses-subcategory` / `.subcategory-form*`
// klasslarini ishlatadi (expenseSubCategory.tsx'dan ko'chirilgan), lekin bu
// klasslar shu faylning o'zida emas — `expenses.css`da e'lon qilingan.
// Import qilinmagani uchun modal uslubsiz (overlap, bo'sh joysiz) chiqardi.
import '../expenses/expenses.css';
import { useTranslation } from 'react-i18next';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { ActiveBadge } from '@/components/StatusBadge';

/**
 * To'lov usuli komissiyasi — barcha filiallar uchun UMUMIY (2026-11-20 dan).
 *
 * Komissiya endi filialga bog'lanmaydi va muddati yo'q: har bir to'lov usuliga
 * bitta yozuv, yoqish/o'chirish faqat `is_active` bilan. Javobda `branch_id`,
 * `effective_date`, `expired_date` kelmaydi.
 */
interface Commission {
  id: number;
  payment_method: string;
  commission_percent: string | number;
  notes: string | null;
  is_active: boolean;
  // Backend stores this as a 1/0 column, so it can arrive as a number or a boolean.
  show_on_site: boolean | number;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface FormData {
  /** Ro'yxatdagi tanish usul kaliti yoki `OTHER_METHOD` (yangi usul qo'lda yoziladi). */
  payment_method: string;
  /** `payment_method === OTHER_METHOD` bo'lganda — yangi usulning kaliti (masalan `uzcard`). */
  custom_method: string;
  commission_percent: string;
  notes: string;
  is_active: boolean;
  show_on_site: boolean;
}

const emptyForm: FormData = {
  payment_method: '',
  custom_method: '',
  commission_percent: '',
  notes: '',
  is_active: true,
  show_on_site: false,
};

const BASE_URL = '/payment-gateway-commissions';
const QUERY_KEY = ['payment-gateway-commissions'] as const;

const toBool = (value: boolean | number | string | null | undefined) =>
  value === true || value === 1 || value === '1';

const PAYMENT_METHODS = ['cash', 'card', 'bank', 'click', 'paynet'];

/** «Boshqa usul» tanlovi — ro'yxatda yo'q yangi usul qo'shish uchun. */
const OTHER_METHOD = '__other__';

const formatDateTime = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 422 javobidagi `errors.payment_method[0]` — maydon ostida ko'rsatish uchun. */
const paymentMethodErrorOf = (error: unknown): string | null => {
  const errors = (error as { response?: { data?: { errors?: Record<string, unknown> } } })?.response
    ?.data?.errors;
  const fieldErrors = errors?.payment_method;
  if (Array.isArray(fieldErrors) && typeof fieldErrors[0] === 'string') return fieldErrors[0];
  if (typeof fieldErrors === 'string') return fieldErrors;
  return null;
};

const Commissions = () => {
  const { t } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('commissions');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const queryClient = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<Commission | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [methodError, setMethodError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [viewItem, setViewItem] = useState<Commission | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Commission | 'all' | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Ro'yxat bitta — barcha filiallar uchun umumiy.
  const { data: commissions, isLoading } = useQuery<Commission[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data } = await API.get(BASE_URL);
      const list: Commission[] = data?.data ?? data;
      return Array.isArray(list) ? list : [];
    },
  });

  const getCommissionMutation = useMutation({
    mutationFn: async (item: Commission) => {
      const { data } = await API.get(`${BASE_URL}/${item.id}`);
      return (data.data ?? data) as Commission;
    },
    onSuccess: (item) => {
      setEditingItem(item);
      setMethodError(null);
      setFormData({
        payment_method: item.payment_method,
        custom_method: '',
        commission_percent: String(item.commission_percent ?? ''),
        notes: item.notes || '',
        is_active: !!item.is_active,
        show_on_site: toBool(item.show_on_site),
      });
      setShowModal(true);
    },
  });

  /** Tahrirda faqat shu 4 maydon o'zgaradi — `payment_method` o'zgarmaydi. */
  const buildUpdatePayload = () => ({
    commission_percent: Number(formData.commission_percent),
    notes: formData.notes.trim() || null,
    is_active: formData.is_active,
    show_on_site: formData.show_on_site,
  });

  const resolvedPaymentMethod = () =>
    formData.payment_method === OTHER_METHOD
      ? formData.custom_method.trim().toLowerCase()
      : formData.payment_method;

  const createMutation = useMutation({
    mutationFn: async () =>
      API.post(BASE_URL, { payment_method: resolvedPaymentMethod(), ...buildUpdatePayload() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      resetForm();
    },
    onError: (error) => {
      // Bir usulga bitta yozuv: mavjud usul yuborilsa 422 `errors.payment_method`.
      setMethodError(paymentMethodErrorOf(error));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (id: number) => API.put(`${BASE_URL}/${id}`, buildUpdatePayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`${BASE_URL}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    } else if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id);
      setSelected((p) => p.filter((x) => x !== deleteTarget.id));
    }
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const resetForm = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData(emptyForm);
    setMethodError(null);
  };

  const openAddModal = () => {
    setEditingItem(null);
    setFormData(emptyForm);
    setMethodError(null);
    setShowModal(true);
  };

  const openEditModal = (item: Commission) => {
    getCommissionMutation.mutate(item);
  };

  const paymentMethodLabel = (method: string) => {
    const key = PAYMENT_METHODS.includes(method) ? method : null;
    return key ? t(`commissions.methods.${key}`) : method;
  };

  // Qo'shishda allaqachon yozuvi bor usullar ko'rsatilmaydi — ular uchun backend 422 qaytaradi.
  const existingMethods = new Set((commissions ?? []).map((c) => c.payment_method));
  const availableMethods = PAYMENT_METHODS.filter((m) => !existingMethods.has(m));

  const sortedCommissions = [...(commissions || [])].sort((a, b) =>
    sortAsc ? a.id - b.id : b.id - a.id,
  );

  // Backend sahifalashni qo'llab-quvvatlamaydi (hammasi bir yo'la keladi) —
  // shu sabab bu yerda klient tomonda sahifalanadi.
  const commissionsTotal = sortedCommissions.length;
  const commissionsTotalPages = Math.max(1, Math.ceil(commissionsTotal / pageSize));
  const pagedCommissions = sortedCommissions.slice((page - 1) * pageSize, page * pageSize);

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? sortedCommissions.map((c) => c.id) : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <section className="users container">
      <h1 className="main-title">{t('commissions.mainTitle')}</h1>

      {showModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory">
            <h1>{editingItem ? t('commissions.editTitle') : t('commissions.addTitle')}</h1>

            <form
              className="subcategory-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingItem) {
                  updateMutation.mutate(editingItem.id);
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="subcategory-form-group">
                <label>{t('commissions.paymentType')}</label>
                {editingItem ? (
                  // To'lov usuli tahrirda o'zgarmaydi — boshqa usul kerak bo'lsa yangisi qo'shiladi.
                  <>
                    <input type="text" value={paymentMethodLabel(editingItem.payment_method)} disabled />
                    <small style={{ color: '#6b7280', fontSize: 12 }}>
                      {t('commissions.methodLockedHint')}
                    </small>
                  </>
                ) : (
                  <select
                    value={formData.payment_method}
                    onChange={(e) => {
                      setFormData({ ...formData, payment_method: e.target.value });
                      setMethodError(null);
                    }}
                    required
                  >
                    <option value="">{t('commissions.choose')}</option>
                    {availableMethods.map((m) => (
                      <option key={m} value={m}>
                        {t(`commissions.methods.${m}`)}
                      </option>
                    ))}
                    <option value={OTHER_METHOD}>{t('commissions.otherMethod')}</option>
                  </select>
                )}
                {!editingItem && formData.payment_method === OTHER_METHOD && (
                  <input
                    type="text"
                    value={formData.custom_method}
                    onChange={(e) => {
                      setFormData({ ...formData, custom_method: e.target.value });
                      setMethodError(null);
                    }}
                    placeholder={t('commissions.customMethodPlaceholder')}
                    maxLength={50}
                    required
                  />
                )}
                {methodError && (
                  <small style={{ color: '#dc2626', fontSize: 12 }}>{methodError}</small>
                )}
              </div>

              <div className="subcategory-form-group">
                <label>{t('commissions.commissionPercent')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formData.commission_percent}
                  onChange={(e) => setFormData({ ...formData, commission_percent: e.target.value })}
                  required
                />
              </div>

              <div className="subcategory-form-group">
                <label>{t('commissions.notes')}</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>

              <div className="checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  />
                  {t('commissions.active')}
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={formData.show_on_site}
                    onChange={(e) => setFormData({ ...formData, show_on_site: e.target.checked })}
                  />
                  {t('commissions.showOnSite')}
                </label>
              </div>

              <div className="modal-actions">
                <button className="primary" type="submit" disabled={isSaving}>
                  {isSaving ? t('commissions.saving') : t('commissions.save')}
                </button>
                <button type="button" className="cancel" onClick={resetForm}>
                  {t('commissions.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('commissions.confirmDelete')}</h3>
            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('commissions.delete')}
              </button>
              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('commissions.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewItem && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 600, padding: 32, borderRadius: 8 }}>
            <h2 style={{ textAlign: 'center', marginBottom: 32, color: '#003366' }}>
              {t('commissions.viewTitle')}
            </h2>

            <div style={{ display: 'flex', marginBottom: 24 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('commissions.paymentType')}:
                </p>
                <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                  {paymentMethodLabel(viewItem.payment_method)}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('commissions.commissionPercent')}:
                </p>
                <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                  {viewItem.commission_percent}%
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', marginBottom: 24 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('commissions.status')}:
                </p>
                <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                  {viewItem.is_active ? t('commissions.active') : t('commissions.inactive')}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>ID:</p>
                <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>#{viewItem.id}</p>
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                {t('commissions.showOnSite')}:
              </p>
              <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                {toBool(viewItem.show_on_site) ? t('commissions.yes') : t('commissions.no')}
              </p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                {t('commissions.notes')}:
              </p>
              <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                {viewItem.notes || '-'}
              </p>
            </div>

            <div style={{ display: 'flex', marginBottom: 32 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('commissions.createdAt')}:
                </p>
                <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                  {formatDateTime(viewItem.created_at)}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('commissions.updatedAt')}:
                </p>
                <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                  {formatDateTime(viewItem.updated_at)}
                </p>
              </div>
            </div>

            <button
              onClick={() => setViewItem(null)}
              style={{
                border: '1px solid #003366',
                background: 'transparent',
                color: '#003366',
                padding: '8px 32px',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                width: '100%',
              }}
            >
              {t('commissions.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="users-filters">
        <Protected permission="payment_gateway_commissions.create">
          <button className="add-new-user" onClick={openAddModal}>
            {t('commissions.addBtn')}
          </button>
        </Protected>

        <Protected permission="payment_gateway_commissions.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('commissions.delete')}
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
                    selected.length === sortedCommissions.length && sortedCommissions.length > 0
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
              <th>{t('commissions.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : sortedCommissions.length ? (
              pagedCommissions.map((item) => (
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
                      case 'payment_type':
                        return <td key={colId}>{paymentMethodLabel(item.payment_method)}</td>;
                      case 'commission_percent':
                        return <td key={colId}>{item.commission_percent}%</td>;
                      case 'status':
                        return (
                          <td key={colId}>
                            <ActiveBadge
                              active={!!item.is_active}
                              activeLabel={t('commissions.active')}
                              inactiveLabel={t('commissions.inactive')}
                            />
                          </td>
                        );
                      case 'created_at':
                        return <td key={colId}>{formatDateTime(item.created_at)}</td>;
                      case 'updated_at':
                        return <td key={colId}>{formatDateTime(item.updated_at)}</td>;
                      default:
                        return <td key={colId}>-</td>;
                    }
                  })}
                  <td className="actions">
                    {/* «Ko'rish» ruxsatsiz: ro'yxatni ko'rgan kishi qatorni ham ko'radi (bazada bunday `.show` ruxsati yo'q edi — tugma hech kimga chiqmasdi) */}
                    <button className="user-view-btn" onClick={() => setViewItem(item)}>
                      <i className="fa-solid fa-eye"></i>
                    </button>
                    <Protected permission="payment_gateway_commissions.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>
                    <Protected permission="payment_gateway_commissions.delete">
                      <button
                        className="user-delete-btn"
                        onClick={() => {
                          setDeleteTarget(item);
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
              <EmptyState colSpan={colCount} message={t('commissions.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={commissionsTotalPages}
        total={commissionsTotal}
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

export default Commissions;
