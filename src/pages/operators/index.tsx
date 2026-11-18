import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
// Modal `.expenses-subcategory` / `.subcategory-form*` klasslarini ishlatadi,
// lekin ular shu faylda emas — `expenses.css`da e'lon qilingan. Import
// qilinmagani uchun modal uslubsiz (overlap, bo'sh joysiz) chiqardi.
import '../expenses/expenses.css';
import { useTranslation } from 'react-i18next';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { useTableColumns } from '../../hooks/useTableColumns';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { useOptions } from '../../hooks/useOptions';
import { formatDateTime } from '@/utils/date';

export interface IpTelefonOperator {
  id: number;
  branch_id?: number | null;
  user_id: number;
  login: string | number;
  password?: string;
  /** Backenddan keladigan xom qiymat, masalan "receptionist" / "call_center". */
  role?: string;
  /** Backenddan keladigan tarjima qilingan nom, masalan "Qabulxonachi". */
  role_label?: string;
  branch?: {
    id: number;
    name_uz: string;
    name_ru?: string | null;
    name_en?: string | null;
    [key: string]: unknown;
  };
  user?: {
    id: number;
    full_name: string;
    username: string;
    phone: string;
    [key: string]: unknown;
  };
  created_at?: string;
  updated_at?: string;
}

export interface IpTelefonOperatorPayload {
  branch_id: number | null;
  user_id: number;
  login: string | number;
  password?: string;
}

// const formatDate = (dateString: string) => {
//   const date = new Date(dateString);
//   const day = String(date.getDate()).padStart(2, "0");
//   const month = String(date.getMonth() + 1).padStart(2, "0");
//   const year = date.getFullYear();
//   return `${day}.${month}.${year}`;
// };

const Operators = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<IpTelefonOperator | null>(null);
  const [formError, setFormError] = useState('');
  const [viewItem, setViewItem] = useState<IpTelefonOperator | null>(null);
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Form state
  const [formData, setFormData] = useState({
    branch_id: '',
    user_id: '',
    login: '',
    password: '',
  });

  const { isVisible, visibleColumns } = useTableColumns('operators');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: IpTelefonOperator, colId: string) => {
    switch (colId) {
      case 'full_name':
        return item.user?.full_name || '-';
      case 'phone':
        return item.user?.phone || '-';
      case 'branch':
        return item.branch ? getLocalized(item.branch, 'name', i18n.language) : '-';
      case 'role':
        return item.role_label || item.role || (item.branch_id ? 'Reception' : 'Call-center');
      case 'login':
        return item.login;
      case 'password':
        // Parol backenddan KELMAYDI (faqat o'z yozuvingda) — jadvalda yashirin belgi; o'zgartirish tahrirlash oynasida.
        return '••••••';
      case 'created_at':
        return formatDateTime(item.created_at, '-');
      case 'updated_at':
        return formatDateTime(item.updated_at, '-');
      default:
        return '-';
    }
  };

  const { data: operators, isLoading } = useQuery<IpTelefonOperator[]>({
    queryKey: ['ip-telefon-operators'],
    queryFn: async () => {
      const { data } = await API.get<IpTelefonOperator[]>('/ip-telefon-operators');
      return Array.isArray(data) ? data : (data as { data?: IpTelefonOperator[] } | null)?.data || [];
    },
    placeholderData: keepPreviousData,
  });

  const { data: branchesData } = useOptions('branches');

  const { data: usersData = [], isLoading: usersLoading } = useOptions('users');

  const createMutation = useMutation({
    mutationFn: async (payload: IpTelefonOperatorPayload) =>
      API.post('/ip-telefon-operators', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ip-telefon-operators'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (params: { id: number; payload: IpTelefonOperatorPayload }) =>
      API.put(`/ip-telefon-operators/${params.id}`, params.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ip-telefon-operators'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`/ip-telefon-operators/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ip-telefon-operators'] });
    },
  });

  const availableOperators = usersData;

  const resetForm = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({ branch_id: '', user_id: '', login: '', password: '' });
    setFormError('');
  };

  const openEditModal = (item: IpTelefonOperator) => {
    setEditingItem(item);
    setFormData({
      branch_id: item.branch_id?.toString() || '',
      user_id: item.user_id?.toString() || '',
      login: item.login?.toString() || '',
      // Mavjud parol ko'rsatilmaydi: bo'sh qoldirilsa o'zgarmaydi, yozilsa yangilanadi.
      password: '',
    });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const userId = Number(formData.user_id);
    if (usersLoading || isLoading) {
      setFormError('Foydalanuvchilar yoki operatorlar ro‘yxati yuklanmoqda.');
      return;
    }
    if ((operators ?? []).some((operator) => operator.user_id === userId && operator.id !== editingItem?.id)) {
      setFormError('Bu foydalanuvchiga operator allaqachon biriktirilgan.');
      return;
    }
    if (!/^\d{4}$/.test(formData.login)) {
      setFormError('Login 4 xonali son bo‘lishi kerak.');
      return;
    }
    if ((operators ?? []).some((operator) => String(operator.login) === formData.login && operator.id !== editingItem?.id)) {
      setFormError('Bu login boshqa operatorga biriktirilgan.');
      return;
    }
    setFormError('');
    const payload: IpTelefonOperatorPayload = {
      // Filial tanlanmasa — null yuboriladi, backend buni call-center
      // operatori (barcha filiallarga yo'naltiruvchi) sifatida oladi.
      branch_id: formData.branch_id ? Number(formData.branch_id) : null,
      user_id: userId,
      login: formData.login,
      // Tahrirlashda bo'sh parol yuborilmaydi (backend `min:4` talab qiladi va mavjud parolni saqlab qoladi).
      ...(formData.password ? { password: formData.password } : {}),
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, payload });
    } else {
      createMutation.mutate(payload);
    }
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

  const filteredOperators = [...(operators || [])]
    .filter((o) => !branchFilter || String(o.branch_id) === branchFilter)
    .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  const operatorsTotal = filteredOperators.length;
  const operatorsTotalPages = Math.max(1, Math.ceil(operatorsTotal / pageSize));
  const pagedOperators = filteredOperators.slice((page - 1) * pageSize, page * pageSize);

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? (operators?.map((c) => c.id) ?? []) : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className="users container">
      <h1 className="main-title">{t('aside.operators', 'Operatorlar')}</h1>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory" style={{ minWidth: 480 }}>
            <h1>{editingItem ? t('common.edit', 'Tahrirlash') : t('users.addNew', 'Qo‘shish')}</h1>

            <form className="subcategory-form" onSubmit={handleSubmit}>
              {editingItem && (
                <div className="subcategory-form-group">
                  <label>Rol</label>
                  <select
                    value={formData.branch_id ? 'reception' : 'call_center'}
                    onChange={(e) => {
                      if (e.target.value === 'call_center') {
                        setFormData((prev) => ({ ...prev, branch_id: '' }));
                      }
                      // "Reception" tanlanganda filial pastdagi Filial
                      // ro'yxatidan tanlanadi.
                    }}
                  >
                    <option value="call_center">Call-center</option>
                    <option value="reception">Reception (filial qabulxonachisi)</option>
                  </select>
                </div>
              )}

              <div className="subcategory-form-group">
                <label>{t('payments.branch', 'Filial')}</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      branch_id: e.target.value,
                    });
                  }}
                >
                  <option value="">Tanlanmagan</option>
                  {branchesData?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="subcategory-form-group">
                <label>{t('aside.operators', 'Operator')}</label>
                <select
                  value={formData.user_id}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      user_id: e.target.value,
                    }))
                  }
                  required
                >
                  <option value="">{t('common.choose', 'Tanlang')}</option>
                  {availableOperators.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                  {editingItem &&
                    editingItem.user &&
                    formData.user_id === editingItem.user_id?.toString() &&
                    !availableOperators.some((u) => u.id === editingItem.user_id) && (
                      <option value={editingItem.user_id}>
                        {editingItem.user.full_name}
                      </option>
                    )}
                </select>
                {formError && <span role="alert" style={{ color: 'red', fontSize: 12 }}>{formError}</span>}
                {availableOperators.length === 0 && !editingItem && (
                  <span
                    style={{
                      fontSize: 12,
                      color: 'red',
                      marginTop: 4,
                      display: 'block',
                    }}
                  >
                    Operator topilmadi
                  </span>
                )}
              </div>

              <div className="subcategory-form-group">
                <label>{t('users.loginText', 'Login')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]{4}"
                  value={formData.login}
                  onChange={(e) => setFormData((prev) => ({ ...prev, login: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  required
                />
              </div>

              <div className="subcategory-form-group">
                <label>{t('users.password', 'Password')}</label>
                <input
                  type="text"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  required={!editingItem}
                  placeholder={editingItem ? t('operators.passwordKeep', 'O‘zgartirmaslik uchun bo‘sh qoldiring') : undefined}
                  autoComplete="new-password"
                />
              </div>

              <div className="modal-actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t('common.saving', 'Saqlanmoqda...')
                    : t('common.save', 'Saqlash')}
                </button>
                <button type="button" className="cancel" onClick={resetForm}>
                  {t('common.cancel', 'Bekor qilish')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('users.confirmDelete', 'O‘chirishni tasdiqlaysizmi?')}</h3>
            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('common.delete', 'O‘chirish')}
              </button>

              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('common.cancel', 'Bekor qilish')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewItem && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 600, padding: 32, borderRadius: 8 }}>
            <h2
              style={{
                textAlign: 'center',
                marginBottom: 32,
                color: '#003b73',
              }}
            >
              {t('aside.operators', 'Operatorlar')}
            </h2>

            <div style={{ display: 'flex', marginBottom: 24 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('users.fish', 'F.I.SH')}:
                </p>
                <p style={{ color: '#003b73', fontWeight: 500, fontSize: 16 }}>
                  {viewItem.user?.full_name || '-'}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('payments.branch', 'Filial')}:
                </p>
                <p style={{ color: '#003b73', fontWeight: 500, fontSize: 16 }}>
                  {viewItem.branch ? getLocalized(viewItem.branch, 'name', i18n.language) : '-'}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', marginBottom: 32 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('users.loginText', 'Login')}:
                </p>
                <p style={{ color: '#003b73', fontWeight: 500, fontSize: 16 }}>
                  {viewItem.login || '-'}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>ID:</p>
                <p style={{ color: '#003b73', fontWeight: 500, fontSize: 16 }}>#{viewItem.id}</p>
              </div>
            </div>

            <button
              onClick={() => setViewItem(null)}
              style={{
                border: '1px solid #003b73',
                background: 'transparent',
                color: '#003b73',
                padding: '8px 32px',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                width: '100%',
              }}
            >
              {t('common.cancel', 'Ortga')}
            </button>
          </div>
        </div>
      )}

      <div className="users-filters">
        <Protected permission="ip_telefon_operators.create">
          <button className="add-new-user" onClick={() => setShowModal(true)}>
            {t('users.addNew', 'Q‘shish')}
          </button>
        </Protected>
        <Protected permission="ip_telefon_operators.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('common.delete', 'O‘chirish')}
          </button>
        </Protected>
        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('operators.branch', 'Filial')}</option>
          {branchesData?.map((b) => (
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
                    (operators?.length ?? 0) > 0 && selected.length === (operators?.length ?? 0)
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
              <th>{t('courses.actions', 'Harakatlar')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : operators && operators.length > 0 ? (
              pagedOperators.map((item) => (
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
                      {/* «Ko'rish» (ko'z) — `ip_telefon_operators.show` ruxsati bilan (Rollar sahifasidagi «Ko'rish» katakchasi). */}
                      <Protected permission="ip_telefon_operators.show">
                        <button className="user-view-btn" onClick={() => setViewItem(item)}>
                          <i className="fa-solid fa-eye"></i>
                        </button>
                      </Protected>
                      <Protected permission="ip_telefon_operators.edit">
                        <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                          <i className="fa-solid fa-pen"></i>
                        </button>
                      </Protected>
                      <Protected permission="ip_telefon_operators.delete">
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
              <EmptyState colSpan={colCount} message={t('common.noData', "Ma'lumot topilmadi")} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={operatorsTotalPages}
        total={operatorsTotal}
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

export default Operators;
