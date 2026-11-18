import { formatDate } from '@/utils/date';
import { groupDigits } from '@/utils/formatNumber';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
import './expenses.css';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useOptions } from '../../hooks/useOptions';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { normalizePaginated } from '../../utils/normalizePaginated';
import { fetchAllPages } from '../../api/fetchAllPages';
import AccessNotice from '@/components/AccessNotice';
import { usePermission } from '../../hooks/usePermission';

interface Branch {
  id: number;
  name_uz: string;
  name_ru?: string | null;
  name_en?: string | null;
  address?: string;
}

interface Named {
  id: number;
  name_uz: string;
  name_ru?: string;
  name_en?: string;
}

interface Cashier {
  id: number;
  full_name: string;
}

interface Expense {
  id: number;
  amount: string;
  expense_date: string;
  /** Izoh backendda `info_uz` / `info_ru` / `info_en` (eski `info` ustuni 2026-04 da ko'p tilli qilingan). */
  info_uz?: string | null;
  info_ru?: string | null;
  info_en?: string | null;
  /** Bor bo'lsa — jamg'armadan chiqim: faqat kategoriya/podkategoriya/izoh tahrirlanadi. */
  jamgarma_id?: number | null;
  /** `cash` | `non_cash` */
  source?: string | null;
  total?: string | number | null;
  total_amount?: string | number | null;
  user_id?: number | null;
  branch_id?: number | null;
  created_at: string;
  updated_at: string;
  category?: Named;
  subcategory?: Named;
  cashier?: Cashier;
  branch?: Branch;
}

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

const Expenses = () => {
  const { isVisible, visibleColumns } = useTableColumns('expenses');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<Expense | null>(null);
  const [viewItem, setViewItem] = useState<Expense | null>(null);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [formData, setFormData] = useState({
    jamgarma_id: '',
    expense_category_id: '',
    expense_subcategory_id: '',
    user_id: '',
    amount: '',
    expense_date: '',
    branch_id: '',
    info: '',
    created_at: '',
    updated_at: '',
  });

  // Chiqim naqddanmi yoki naqdsizdanmi — backend `cash_amount`/`non_cash_amount`
  // dan aynan bittasini (ikkinchisi 0) va `source` maydonini talab qiladi.
  const [paymentKind, setPaymentKind] = useState<'cash' | 'non_cash'>('cash');

  // `/expenses` hamma yozuvni bir yo'la qaytaradi — filtr va saralash BUTUN ro'yxatga qo'llanadi, sahifalash
  // esa shundan keyin (ilgari filtr faqat joriy sahifadagi 20 ta qatorga ishlardi).
  const { data: allExpenses, isLoading } = useQuery<Expense[]>({
    queryKey: ['expenses'],
    queryFn: () => fetchAllPages<Expense>('/expenses'),
    placeholderData: keepPreviousData,
  });

  const { data: jamgarmas } = useOptions('jamgarmas');
  const { data: categories } = useOptions('expense-categories');
  const { data: subcategories } = useOptions('expense-subcategories');
  const { data: cashiers } = useOptions('users');
  const { data: branches } = useOptions('branches');

  const filteredExpenses = (allExpenses ?? [])
    .filter((e) => {
      const matchCategory = categoryFilter ? String(e.category?.id) === categoryFilter : true;

      const matchSubcategory = subcategoryFilter
        ? String(e.subcategory?.id) === subcategoryFilter
        : true;

      // `expense_date` ISO vaqt bilan kelishi mumkin ("2026-10-12T00:00:00Z"): faqat kunini solishtiramiz,
      // aks holda "gacha" chegarasidagi kun ro'yxatdan tushib qolardi.
      const day = String(e.expense_date ?? '').slice(0, 10);
      const matchDate =
        (!fromDate && !toDate) ||
        (!!day && (!fromDate || day >= fromDate) && (!toDate || day <= toDate));

      const matchBranch = branchFilter ? String(e.branch?.id) === branchFilter : true;

      return matchCategory && matchSubcategory && matchDate && matchBranch;
    })
    .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));

  // Filtr o'zgarib sahifa soni kamaysa, bo'sh sahifada qolmaslik uchun.
  const safePage = Math.min(page, Math.max(1, Math.ceil(filteredExpenses.length / pageSize)));
  const {
    items: pagedExpenses,
    total: expensesTotal,
    totalPages: expensesTotalPages,
  } = normalizePaginated<Expense>(filteredExpenses, safePage, pageSize);

  /*
   * Chiqim formasi bosqichma-bosqich to'ldiriladi — keyingi maydon oldingisi tanlanmaguncha ochilmaydi:
   *   Filial → Jamg'arma (faqat shu filialniki) → Kategoriya (faqat shu jamg'armaga biriktirilganlar) →
   *   Podkategoriya (faqat shu kategoriyaniki). Kassir — faqat shu filialga biriktirilgan xodimlar.
   * Oldingi maydon o'zgarsa, undan keyingilar tozalanadi.
   */
  const fundOptions = !formData.branch_id
    ? []
    : (jamgarmas ?? []).filter((j) => String(j.branch_id) === formData.branch_id);

  const handleBranchChange = (branchId: string) =>
    setFormData((prev) => ({
      ...prev,
      branch_id: branchId,
      jamgarma_id: '',
      expense_category_id: '',
      expense_subcategory_id: '',
      user_id: '',
    }));
  const handleFundChange = (fundId: string) =>
    setFormData((prev) => ({
      ...prev,
      jamgarma_id: fundId,
      expense_category_id: '',
      expense_subcategory_id: '',
    }));

  // Kategoriyalar: tanlangan jamg'armaga biriktirilganlarigina (server `?jamgarma_id=` bo'yicha filtrlaydi).
  // Jamg'armasiz (eski) chiqimni tahrirlashda esa hammasi ko'rinadi.
  const legacyEdit = !!editingItem && !editingItem.jamgarma_id;
  const { data: fundCategories } = useOptions(
    'expense-categories',
    { jamgarma_id: formData.jamgarma_id },
    { enabled: !!formData.jamgarma_id },
  );
  const fallbackFundCategories = (categories ?? []).filter((category) => {
    const linkedFunds = category.jamgarma_ids;
    return !Array.isArray(linkedFunds) || linkedFunds.length === 0 ||
      linkedFunds.some((id) => String(id) === formData.jamgarma_id);
  });
  const formCategories = legacyEdit
    ? (categories ?? [])
    : formData.jamgarma_id
      ? (fundCategories?.length ? fundCategories : fallbackFundCategories)
      : [];

  // Kassir: tanlangan filialga biriktirilgan foydalanuvchilar (`GET /users?branch_id=`). `users.view` ruxsati
  // bo'lmasa shu ro'yxat so'ralmaydi (403 chiqmasin) — shunda umumiy xodimlar ro'yxati ko'rsatiladi.
  const canViewUsers = usePermission('users.view');
  const { data: branchUsers } = useQuery<Cashier[]>({
    queryKey: ['expense-branch-users', formData.branch_id],
    queryFn: () => fetchAllPages<Cashier>('/users', { branch_id: formData.branch_id }),
    enabled: showAddModal && !!formData.branch_id && canViewUsers,
    staleTime: 15 * 1000,
  });
  const cashierOptions = !formData.branch_id
    ? []
    : canViewUsers
      ? (branchUsers ?? []).map((u) => ({ id: u.id, label: u.full_name }))
      : (cashiers ?? []);

  // Jamg'armadan qilingan chiqimni tahrirlashda faqat kategoriya/podkategoriya/izoh o'zgaradi (backend qoidasi).
  const lockFund = !!editingItem?.jamgarma_id;

  /*
   * YANGI chiqim (jamg'armadan): backend `amount` emas, `cash_amount` + `non_cash_amount` + `source` kutadi
   * (tanlanmagan tur `0` bilan ketadi, aks holda "cash_amount field is required..." xatosi qaytadi).
   * Izoh `info` emas, `info_uz`.
   */
  const buildCreatePayload = (): Record<string, unknown> => ({
    jamgarma_id: Number(formData.jamgarma_id),
    branch_id: Number(formData.branch_id),
    expense_category_id: Number(formData.expense_category_id),
    expense_subcategory_id: Number(formData.expense_subcategory_id),
    user_id: Number(formData.user_id),
    cash_amount: paymentKind === 'cash' ? Number(formData.amount) : 0,
    non_cash_amount: paymentKind === 'non_cash' ? Number(formData.amount) : 0,
    source: paymentKind,
    expense_date: formData.expense_date,
    info_uz: formData.info,
  });

  /*
   * TAHRIRLASH — backend (`ExpenseController::update`) ikki xil ishlaydi:
   *  - jamg'armadan chiqim: FAQAT kategoriya, podkategoriya va izoh. `cash_amount`/`non_cash_amount` yuborilsa
   *    HAR DOIM 422 ("summani o'zgartirib bo'lmaydi") — ilgari forma ularni doim yuborardi, shu sabab tahrirlash
   *    hech qachon saqlanmasdi; sana/filial/kassir esa e'tiborsiz qolardi;
   *  - oddiy chiqim: `amount` + `source` (cash_amount EMAS), sana, filial, kassir.
   */
  const buildUpdatePayload = (): Record<string, unknown> => {
    const base = {
      expense_category_id: Number(formData.expense_category_id),
      expense_subcategory_id: Number(formData.expense_subcategory_id),
      info_uz: formData.info,
    };
    if (lockFund) return base;
    return {
      ...base,
      user_id: Number(formData.user_id),
      branch_id: Number(formData.branch_id),
      amount: Number(formData.amount),
      source: paymentKind,
      expense_date: formData.expense_date,
    };
  };

  const createMutation = useMutation({
    mutationFn: async () => API.post('/expenses', buildCreatePayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      API.put(`/expenses/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`/expenses/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const openEditModal = (item: Expense) => {
    setEditingItem(item);
    setFormData({
      jamgarma_id: item.jamgarma_id ? String(item.jamgarma_id) : '',
      expense_category_id: String(item.category?.id || ''),
      expense_subcategory_id: String(item.subcategory?.id || ''),
      user_id: String(item.cashier?.id || item.user_id || ''),
      amount: String(item.total ?? item.total_amount ?? item.amount ?? ''),
      expense_date: String(item.expense_date ?? '').slice(0, 10),
      branch_id: String(item.branch?.id || item.branch_id || ''),
      // Forma UZ matnni tahrirlaydi (saqlashda `info_uz` yoziladi).
      info: item.info_uz ?? '',
      created_at: toLocalDateTimeInput(item.created_at),
      updated_at: toLocalDateTimeInput(item.updated_at),
    });
    // Chiqim turi (naqd/naqdsiz) javobdagi `source` maydonidan olinadi (ilgari doim "naqd" deb taxmin qilinardi).
    setPaymentKind(item.source === 'non_cash' ? 'non_cash' : 'cash');
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingItem(null);
    setFormData({
      jamgarma_id: '',
      expense_category_id: '',
      expense_subcategory_id: '',
      user_id: '',
      amount: '',
      expense_date: '',
      branch_id: '',
      info: '',
      created_at: '',
      updated_at: '',
    });
    setPaymentKind('cash');
  };

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    }

    if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
    }

    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? pagedExpenses.map((e) => e.id) : []);

  const toggleOne = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const filteredSubcategories = subcategories?.filter(
    (s) => String(s.expense_category_id) === formData.expense_category_id,
  );

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: Expense, colId: string) => {
    switch (colId) {
      case 'category':
        return item.category ? getLocalized(item.category, 'name', i18n.language) : '-';
      case 'subcategory':
        return item.subcategory ? getLocalized(item.subcategory, 'name', i18n.language) : '-';
      case 'cashier':
        return item.cashier?.full_name || '-';
      case 'amount': {
        // `750000.00` → `750 000` (ilgari backend qatori o'zgarishsiz chiqardi)
        const n = Number(item.amount);
        return Number.isFinite(n) ? groupDigits(n) : (item.amount ?? '-');
      }
      case 'expense_date':
        return formatDate(item.expense_date, '-');
      case 'branch':
        return item.branch
          ? getLocalized(item.branch, 'name', i18n.language) || item.branch.name_uz
          : '-';
      case 'info':
        return getLocalized(item, 'info', i18n.language);
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
      <h1 className="main-title">{t('expenses.expenseTitle')}</h1>
      <AccessNotice kind="branch" />

      {showAddModal && (
        <div className="modal-overlay">
          <div className="expenses-create">
            <h1>{editingItem ? t('expenses.editExpense') : t('expenses.addNewExpense')}</h1>
            {lockFund && (
              <div>
                <InfoHint withLabel text={t('expenses.fundExpenseLockedHint')} />
              </div>
            )}

            <form
              className="expenses-create-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingItem) {
                  const payload = buildUpdatePayload();
                  updateMutation.mutate({
                    id: editingItem.id,
                    payload,
                  });
                } else {
                  createMutation.mutate();
                }
              }}
            >
              <div className="create-form">
                <div className="form-group">
                  <label>{t('expenses.branch')}</label>
                  <select
                    value={formData.branch_id}
                    className="create-form-input"
                    onChange={(e) => handleBranchChange(e.target.value)}
                    required
                    disabled={lockFund}
                  >
                    <option value="">{t('expenses.choose')}</option>
                    {branches?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('expenses.fund')}</label>
                  <select
                    className="create-form-input"
                    value={formData.jamgarma_id}
                    onChange={(e) => handleFundChange(e.target.value)}
                    required={!editingItem}
                    disabled={lockFund || !formData.branch_id}
                  >
                    <option value="">{t('expenses.chooseFund')}</option>
                    {fundOptions.map((j) => (
                      <option key={j.id} value={j.id}>
                        {/* Ro'yxat tanlangan filialniki — nomga filial qo'shilmaydi. */}
                        {j.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="create-form">
                <div className="form-group">
                  <label>{t('expenses.expenseCategory')}</label>
                  <select
                    className="create-form-input"
                    value={formData.expense_category_id}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        expense_category_id: e.target.value,
                        expense_subcategory_id: '',
                      })
                    }
                    required
                    disabled={!formData.jamgarma_id && !legacyEdit}
                  >
                    <option value="">{t('expenses.choose')}</option>
                    {formCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('expenses.expenseSubCategory')}</label>
                  <select
                    className="create-form-input"
                    value={formData.expense_subcategory_id}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        expense_subcategory_id: e.target.value,
                      })
                    }
                    required
                    disabled={!formData.expense_category_id}
                  >
                    <option value="">{t('expenses.choose')}</option>
                    {filteredSubcategories?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="create-form">
                <div className="form-group">
                  <label>{t('expenses.cashier')}</label>
                  <select
                    value={formData.user_id}
                    className="create-form-input"
                    onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                    required
                    disabled={lockFund || !formData.branch_id}
                  >
                    <option value="">{t('expenses.choose')}</option>
                    {cashierOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('expenses.amount')}</label>
                  <input
                    type="number"
                    className="create-form-input"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    required
                    disabled={lockFund}
                  />
                </div>
              </div>

              <div className="create-form">
                <div className="form-group">
                  <label>{t('expenses.paymentKind')}</label>
                  <div className="payment-kind">
                    <button
                      type="button"
                      className={`payment-kind__btn${
                        paymentKind === 'cash' ? ' payment-kind__btn--active' : ''
                      }`}
                      onClick={() => setPaymentKind('cash')}
                      disabled={lockFund}
                    >
                      {t('expenses.cash')}
                    </button>
                    <button
                      type="button"
                      className={`payment-kind__btn${
                        paymentKind === 'non_cash' ? ' payment-kind__btn--active' : ''
                      }`}
                      onClick={() => setPaymentKind('non_cash')}
                      disabled={lockFund}
                    >
                      {t('expenses.nonCash')}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label>{t('expenses.date')}</label>
                  <input
                    type="date"
                    className="create-form-input"
                    value={formData.expense_date}
                    onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                    required
                    disabled={lockFund}
                  />
                </div>
              </div>

              <div className="form-group comment">
                <label>{t('expenses.comment')}</label>
                <input
                  value={formData.info}
                  className="expenses-comment"
                  onChange={(e) => setFormData({ ...formData, info: e.target.value })}
                />
              </div>

              <div className="modal-actions">
                <button
                  className="primary"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t('expenses.saving')
                    : t('expenses.save')}
                </button>
                <button type="button" className="cancel" onClick={closeModal}>
                  {t('expenses.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.expense')}
          fields={[
            { label: t('columns.category'), value: renderCell(viewItem, 'category') },
            { label: t('columns.subcategory'), value: renderCell(viewItem, 'subcategory') },
            { label: t('columns.branch'), value: renderCell(viewItem, 'branch') },
            { label: t('columns.cashier'), value: renderCell(viewItem, 'cashier') },
            { label: t('columns.amount'), value: renderCell(viewItem, 'amount') },
            { label: t('columns.expense_date'), value: renderCell(viewItem, 'expense_date') },
            { label: t('columns.info'), value: renderCell(viewItem, 'info') },
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
        <Protected permission="expenses.create">
          <button className="add-new-user" onClick={() => setShowAddModal(true)}>
            {t('expenses.addBtn')}
          </button>
        </Protected>

        <Protected permission="expenses.delete">
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

        {/* Filial filtri hamma jadvalli sahifalarda birinchi filtr sifatida
            turadi (boshqa sahifalar bilan bir xil tartib). */}
        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('expenses.branch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setSubcategoryFilter('');
            setPage(1);
          }}
        >
          <option value="">{t('expenses.category')}</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        <select value={subcategoryFilter} onChange={(e) => setSubcategoryFilter(e.target.value)}>
          <option value="">{t('expenses.subCategory')}</option>
          {subcategories
            ?.filter((s) => !categoryFilter || String(s.expense_category_id) === categoryFilter)
            ?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
        </select>

        <input
          className="expense-date-filter"
          type="date"
          aria-label={t('expenses.fromDate')}
          title={t('expenses.fromDate')}
          value={fromDate}
          max={toDate || undefined}
          onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
        />
        <input
          className="expense-date-filter"
          type="date"
          aria-label={t('expenses.toDate')}
          title={t('expenses.toDate')}
          value={toDate}
          min={fromDate || undefined}
          onChange={(e) => { setToDate(e.target.value); setPage(1); }}
        />
        <button
          type="button"
          className="expense-filters-clear"
          onClick={() => {
            setBranchFilter('');
            setCategoryFilter('');
            setSubcategoryFilter('');
            setFromDate('');
            setToDate('');
            setPage(1);
          }}
        >
          {t('expenses.clearFilters')}
        </button>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === pagedExpenses.length && pagedExpenses.length > 0}
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
            ) : pagedExpenses.length ? (
              pagedExpenses.map((item) => (
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
                    <Protected permission="expenses.show">
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
                    <Protected permission="expenses.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>

                    <Protected permission="expenses.delete">
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
              <EmptyState colSpan={colCount} message={t('expenses.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={safePage}
        totalPages={expensesTotalPages}
        total={expensesTotal}
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

export default Expenses;
