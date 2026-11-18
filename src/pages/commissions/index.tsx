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
import { useOptions } from '../../hooks/useOptions';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { ActiveBadge } from '@/components/StatusBadge';

interface Commission {
  id: number;
  branch_id: number;
  payment_method: string;
  commission_percent: string | number;
  effective_date: string;
  expired_date: string | null;
  notes: string | null;
  is_active: boolean;
  // Backend stores this as a 1/0 column, so it can arrive as a number or a boolean.
  show_on_site: boolean | number;
  created_at: string;
  updated_at: string;
}

interface FormData {
  /** Yangi komissiya qaysi filialga qo'shilishi (tahrirlashda o'zgarmaydi). */
  branch_id: string;
  payment_method: string;
  commission_percent: string;
  effective_date: string;
  expired_date: string;
  notes: string;
  is_active: boolean;
  show_on_site: boolean;
  created_at: string;
  updated_at: string;
}

const emptyForm: FormData = {
  branch_id: '',
  payment_method: '',
  commission_percent: '',
  effective_date: '',
  expired_date: '',
  notes: '',
  is_active: true,
  show_on_site: true,
  created_at: '',
  updated_at: '',
};

const toBool = (value: boolean | number | string | null | undefined) =>
  value === true || value === 1 || value === '1';

const PAYMENT_METHODS = ['cash', 'card', 'bank', 'click', 'paynet'];

const formatDateTime = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toLocalDateTimeInput = (iso: string | null) => {
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

const Commissions = () => {
  const { t } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('commissions');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const queryClient = useQueryClient();

  const [branchId, setBranchId] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<Commission | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [selected, setSelected] = useState<number[]>([]);
  const [viewItem, setViewItem] = useState<Commission | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Commission | 'all' | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: branches } = useOptions('branches');

  // Filial tanlanmagan bo'lsa — sahifaga kirganda darhol barcha filiallar
  // ma'lumotlari ko'rinadi (backend faqat bitta filial bo'yicha beradi,
  // shuning uchun har biridan alohida so'rov qilib birlashtiramiz). Filial
  // tanlansa — odatdagidek faqat o'shanikini olib kelamiz.
  const { data: commissions, isLoading } = useQuery<Commission[]>({
    queryKey: ['commissions', branchId, (branches ?? []).map((b) => b.id).join(',')],
    queryFn: async () => {
      if (branchId) {
        const { data } = await API.get(`/branches/${branchId}/commissions`);
        const list: Commission[] = data.data ?? data;
        return (list ?? []).map((c) => ({ ...c, branch_id: c.branch_id ?? Number(branchId) }));
      }
      const results = await Promise.all(
        (branches ?? []).map(async (b) => {
          const { data } = await API.get(`/branches/${b.id}/commissions`);
          const list: Commission[] = data.data ?? data;
          return (list ?? []).map((c) => ({ ...c, branch_id: c.branch_id ?? Number(b.id) }));
        }),
      );
      return results.flat();
    },
    enabled: branchId ? true : (branches?.length ?? 0) > 0,
  });

  const getCommissionMutation = useMutation({
    mutationFn: async (item: Commission) => {
      const { data } = await API.get(`/branches/${item.branch_id}/commissions/${item.id}`);
      return (data.data ?? data) as Commission;
    },
    onSuccess: (item) => {
      setEditingItem(item);
      setFormData({
        branch_id: String(item.branch_id),
        payment_method: item.payment_method,
        commission_percent: String(item.commission_percent ?? ''),
        effective_date: toLocalDateTimeInput(item.effective_date),
        expired_date: toLocalDateTimeInput(item.expired_date),
        notes: item.notes || '',
        is_active: item.is_active,
        show_on_site: toBool(item.show_on_site),
        created_at: toLocalDateTimeInput(item.created_at),
        updated_at: toLocalDateTimeInput(item.updated_at),
      });
      setShowModal(true);
    },
  });

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      payment_method: formData.payment_method,
      commission_percent: Number(formData.commission_percent),
      effective_date: toApiDateTime(formData.effective_date),
      expired_date: formData.expired_date ? toApiDateTime(formData.expired_date) : null,
      notes: formData.notes,
      is_active: formData.is_active,
      // Backend column is a 1/0 flag.
      show_on_site: formData.show_on_site ? 1 : 0,
    };
    if (formData.created_at) payload.created_at = toApiDateTime(formData.created_at);
    if (formData.updated_at) payload.updated_at = toApiDateTime(formData.updated_at);
    return payload;
  };

  const createMutation = useMutation({
    // Filial formadagi tanlovdan olinadi (sahifa filtri "barcha filiallar" bo'lsa ham qo'shish ishlaydi).
    mutationFn: async () => API.post(`/branches/${formData.branch_id}/commissions`, buildPayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    // Filial holatidan (filtr) emas, tahrirlanayotgan yozuvning O'ZINING
    // filialidan olinadi — "barcha filiallar" ko'rinishida filtr bo'sh
    // bo'lishi mumkin, lekin yozuv baribir muayyan filialga tegishli.
    mutationFn: async ({ id, branch_id }: { id: number; branch_id: number }) =>
      API.put(`/branches/${branch_id}/commissions/${id}`, buildPayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, branch_id }: { id: number; branch_id: number }) =>
      API.delete(`/branches/${branch_id}/commissions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commissions'] });
    },
  });

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => {
        const item = (commissions ?? []).find((c) => c.id === id);
        if (item) deleteMutation.mutate({ id: item.id, branch_id: item.branch_id });
      });
      setSelected([]);
    } else if (deleteTarget) {
      deleteMutation.mutate({ id: deleteTarget.id, branch_id: deleteTarget.branch_id });
      setSelected((p) => p.filter((x) => x !== deleteTarget.id));
    }
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const resetForm = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData(emptyForm);
  };

  const openAddModal = () => {
    setEditingItem(null);
    // Filtrda filial tanlangan bo'lsa — o'sha, yagona filial bo'lsa — o'sha; aks holda formada tanlanadi.
    const defaultBranch = branchId || (branches?.length === 1 ? String(branches[0].id) : '');
    setFormData({ ...emptyForm, branch_id: defaultBranch });
    setShowModal(true);
  };

  const openEditModal = (item: Commission) => {
    getCommissionMutation.mutate(item);
  };

  const paymentMethodLabel = (method: string) => {
    const key = PAYMENT_METHODS.includes(method) ? method : null;
    return key ? t(`commissions.methods.${key}`) : method;
  };

  const sortedCommissions = [...(commissions || [])].sort((a, b) =>
    sortAsc ? a.id - b.id : b.id - a.id,
  );

  // Backend `/branches/{id}/commissions` sahifalashni qo'llab-quvvatlamaydi
  // (hammasi bir yo'la keladi) — shu sabab bu yerda klient tomonda
  // sahifalanadi.
  const commissionsTotal = sortedCommissions.length;
  const commissionsTotalPages = Math.max(1, Math.ceil(commissionsTotal / pageSize));
  const pagedCommissions = sortedCommissions.slice((page - 1) * pageSize, page * pageSize);

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? sortedCommissions.map((c) => c.id) : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
                  updateMutation.mutate({ id: editingItem.id, branch_id: editingItem.branch_id });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="subcategory-form-group">
                <label>{t('commissions.branch')}</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                  disabled={!!editingItem}
                  required
                >
                  <option value="">{t('commissions.choose')}</option>
                  {branches?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="subcategory-form-group">
                <label>{t('commissions.paymentType')}</label>
                <select
                  value={formData.payment_method}
                  onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
                  required
                >
                  <option value="">{t('commissions.choose')}</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`commissions.methods.${m}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="subcategory-form-group">
                <label>{t('commissions.commissionPercent')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.commission_percent}
                  onChange={(e) => setFormData({ ...formData, commission_percent: e.target.value })}
                  required
                />
              </div>

              <div className="subcategory-form-group">
                <label>{t('commissions.effectiveDate')}</label>
                <input
                  type="datetime-local"
                  value={formData.effective_date}
                  onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                  required
                />
              </div>

              <div className="subcategory-form-group">
                <label>{t('commissions.expiredDate')}</label>
                <input
                  type="datetime-local"
                  value={formData.expired_date}
                  onChange={(e) => setFormData({ ...formData, expired_date: e.target.value })}
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

              {editingItem && (
                <>
                  <div className="subcategory-form-group">
                    <label>{t('commissions.createdAt')}</label>
                    <input
                      type="datetime-local"
                      value={formData.created_at}
                      onChange={(e) => setFormData({ ...formData, created_at: e.target.value })}
                    />
                  </div>
                  <div className="subcategory-form-group">
                    <label>{t('commissions.updatedAt')}</label>
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
                    ? t('commissions.saving')
                    : t('commissions.save')}
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

            <div style={{ display: 'flex', marginBottom: 24 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('commissions.effectiveDate')}:
                </p>
                <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                  {formatDateTime(viewItem.effective_date)}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('commissions.expiredDate')}:
                </p>
                <p style={{ color: '#003366', fontWeight: 500, fontSize: 16 }}>
                  {formatDateTime(viewItem.expired_date)}
                </p>
              </div>
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

        <select
          value={branchId}
          onChange={(e) => {
            setBranchId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('commissions.chooseBranch')}</option>
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
                      case 'branch':
                        return (
                          <td key={colId}>
                            {branches?.find((b) => b.id === item.branch_id)?.label ?? '-'}
                          </td>
                        );
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
