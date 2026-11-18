import { useSearchParams } from 'react-router-dom';
import { usePermission } from '@/hooks/usePermission';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '../../api/api';
import './finance.css';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import MultiPicker from '@/components/MultiPicker';
import PageTitle from '@/components/PageTitle';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import type { Branch } from '../../types';
import { useOptions } from '../../hooks/useOptions';
import { formatDateTime } from '@/utils/date';
import StatusBadge from '@/components/StatusBadge';
import { statusTone } from '@/utils/statusTone';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Withdrawer {
  id: number;
  full_name: string;
  username?: string;
}

/** `/jamgarma-names` qatori (forma uchun: `available_for_branch`). */
interface JamgarmaNameOption {
  id: number;
  name?: string;
  name_uz?: string;
  name_ru?: string | null;
  name_en?: string | null;
  jamgarma_fund_type?: string;
  purpose?: 'operating' | 'payroll' | 'payroll_tax';
}

interface FundAccountRef {
  id: number;
  account_number: string;
  balance?: number | string;
}

interface Jamgarma {
  id: number;
  jamgarma_name_id?: number | null;
  name?: string;
  name_uz?: string;
  name_ru?: string;
  name_en?: string;
  section_uz?: string;
  jamgarma_fund_type?: string;
  /** Backend maqsadi: oddiy / ish haqi / ish haqi soliqlari jamg'armasi. */
  purpose?: 'operating' | 'payroll' | 'payroll_tax';
  status: 'active' | 'inactive' | 'frozen';
  cash_balance: number;
  non_cash_balance: number;
  total_balance: number;
  branch_id?: number;
  branch?: Branch;
  chart_of_accounts?: { id: number; account_number: string; account_type_name?: string };
  /** Filialning naqd (0001) va naqdsiz (0002) hisobi — o'tkazma shulardan qilinadi. */
  cash_account?: FundAccountRef | null;
  non_cash_account?: FundAccountRef | null;
  /** Naqd va naqdsiz chiqim qiluvchilar alohida saqlanadi. */
  withdrawers?: Withdrawer[];
  cash_withdrawers?: Withdrawer[];
  non_cash_withdrawers?: Withdrawer[];
  created_at?: string;
  updated_at?: string;
}

/** `/chart-of-accounts` qatori (ro'yxat javobida `branch_id` yo'q — faqat `branch` obyekti). */
interface BranchAccountRow {
  id: number;
  account_type: string;
  account_number: string;
  balance: number | string;
  branch?: { id?: number };
  branch_id?: number;
  status?: string;
  is_active?: boolean;
}

const SECTION_OPTIONS = [
  { value: 'harmless_point', label: 'Zararsiz ishlar nuqtasi' },
  { value: 'marginal_income', label: 'Marjinal daromad' },
  { value: 'adjusted_income', label: 'Muvofiqlashtirillgan daromad (MD)' },
];

// Sahifalash — umumiy `PaginationBar` (barcha jadval sahifalarida bir xil).

// ─── Main Component ───────────────────────────────────────────────────────────

const JamgarmaPage = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const nameFilter = searchParams.get('jamgarma_name_id') || '';


  // ── UI state ─────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [editingItem, setEditingItem] = useState<Jamgarma | null>(null);
  const [viewingItem, setViewingItem] = useState<Jamgarma | null>(null);
  const [deleteId, setDeleteId] = useState<number | "selected" | null>(null);
  const canBulkDelete = usePermission('jamgarmas.delete');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [purposeFilter, setPurposeFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [seenNameFilter, setSeenNameFilter] = useState(nameFilter);
  if (seenNameFilter !== nameFilter) {
    setSeenNameFilter(nameFilter);
    setPage(1);
    setSelectedIds([]);
  }

  // ── Form state ───────────────────────────────────────────────────
  // Jamg'arma nomi, bo'limi va turi «Jamg'arma nomlari» dan olinadi — formada faqat filial + nom + chiqim qiluvchilar + holat.
  const [form, setForm] = useState({
    branch_id: '',
    jamgarma_name_id: '',
    status: 'active',
  });
  const [selectedCashWithdrawerIds, setSelectedCashWithdrawerIds] = useState<number[]>([]);
  const [selectedNonCashWithdrawerIds, setSelectedNonCashWithdrawerIds] = useState<number[]>([]);

  // ── Status change state ──────────────────────────────────────────
  const [viewStatusChange, setViewStatusChange] = useState('');
  const [viewStatusNote, setViewStatusNote] = useState('');

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: jamgarmas = [], isLoading } = useQuery<Jamgarma[]>({
    queryKey: ['jamgarmas', { jamgarma_name_id: nameFilter }],
    queryFn: async () => {
      const { data } = await API.get('/jamgarmas', { params: nameFilter ? { jamgarma_name_id: nameFilter } : undefined });
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const { data: branches = [] } = useOptions('branches');
  const { data: users = [] } = useOptions('users');
  // Forma uchun nomlar: tanlangan filialga biriktirilgan, faol va unda hali jamg'armasi yo'q nomlar.
  // Nomga bog'langan jamg'arma tahrirlanganda nom o'zgarmaydi — ro'yxat faqat yaratishda va nomsiz (eski) jamg'armani
  // nomga bog'lashda kerak.
  const nameLookupBranch = editingItem?.jamgarma_name_id ? '' : form.branch_id;
  const { data: nameAvailability, isFetching: namesFetching, isSuccess: namesLoaded, isError: namesError } = useQuery<{ names: JamgarmaNameOption[]; attachedCount?: number }>({
    queryKey: ['jamgarma-names', 'available', nameLookupBranch],
    enabled: showCreate && !!nameLookupBranch,
    queryFn: async () => {
      const { data } = await API.get('/jamgarma-names', {
        params: { available_for_branch: nameLookupBranch },
      });
      return {
        names: Array.isArray(data) ? data : (data?.data ?? []),
        attachedCount: data?.meta?.attached_count,
      };
    },
  });
  const availableNames = nameAvailability?.names ?? [];
  const selectedName = availableNames.find((n) => String(n.id) === form.jamgarma_name_id);

  // Balans bloki uchun: `/options/chart-of-accounts` hisob balansini BERMAYDI, shu sabab to'liq ro'yxat o'qiladi
  // (`Hisobraqamlar` sahifasi bilan bir xil so'rov va kesh). Faqat `chart_of_accounts.view` bo'lsa so'raladi —
  // bo'lmasa blok balanssiz ko'rsatiladi (ruxsatsiz so'rov yuborilmaydi).
  const canViewAccounts = usePermission('chart_of_accounts.view');
  const { data: allAccounts = [] } = useQuery<BranchAccountRow[]>({
    queryKey: ['chart-of-accounts'],
    queryFn: async () => {
      const { data } = await API.get('/chart-of-accounts', { silentError: true });
      return Array.isArray(data) ? data : data?.data || [];
    },
    enabled: canViewAccounts,
    placeholderData: keepPreviousData,
  });

  // ─── Mutations ────────────────────────────────────────────────────────────

  // Ikki marta bosish: bir vaqtda ikkita so'rov ketmasin (ikkinchisi backendda 422 beradi va foydalanuvchi xato ko'radi).
  const inflight = useRef(false);

  const createMutation = useMutation({
    mutationFn: async (payload: object) => {
      const { data } = await API.post('/jamgarmas', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jamgarmas'] });
      queryClient.invalidateQueries({ queryKey: ['jamgarma-names'] });
      closeModal();
    },
    onSettled: () => {
      inflight.current = false;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: object }) => {
      const { data } = await API.put(`/jamgarmas/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jamgarmas'] });
      queryClient.invalidateQueries({ queryKey: ['jamgarma-names'] });
      closeModal();
    },
    onSettled: () => {
      inflight.current = false;
    },
  });

  const changeStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string; note: string }) => {
      const { data } = await API.put(`/jamgarmas/${id}`, { status });
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['jamgarmas'] });
      setViewingItem((prev) =>
        prev ? { ...prev, status: vars.status as Jamgarma['status'] } : prev,
      );
      setViewStatusChange('');
      setViewStatusNote('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (target: number | 'selected') => {
      const ids = target === 'selected' ? selectedIds : [target];
      for (const id of ids) {
        await API.delete(`/jamgarmas/${id}`);
        setSelectedIds(prev => prev.filter(value => value !== id));
      }
    },
    onSuccess: () => setDeleteId(null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jamgarmas'] }),
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const formatAmount = (val: number) =>
    Number(val)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Admin bo'ylab bir xil shakl: `DD.MM.YYYY HH:mm` (`utils/date.ts`).
  const formatDate = (dateStr?: string) => formatDateTime(dateStr, '-');

  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      active: t('jamgarma.statusActive'),
      inactive: t('jamgarma.statusInactive'),
      frozen: t('jamgarma.statusFrozen'),
    };
    return map[status] || status;
  };

  // Jamg'arma maqsadi — backend `purpose` maydoni (yo'q bo'lsa «oddiy»).
  const getPurpose = (item: Jamgarma) => item.purpose || 'operating';

  const getPurposeLabel = (purpose: string) => {
    const map: Record<string, string> = {
      operating: t('jamgarma.purpose.operating'),
      payroll: t('jamgarma.purpose.payroll'),
      payroll_tax: t('jamgarma.purpose.payroll_tax'),
    };
    return map[purpose] || purpose;
  };

  // `filtered` (qidiruv) shu funksiyani chaqiradi — u undan OLDIN e'lon qilinishi shart (const TDZ: aks holda
  // qidiruvga biror narsa yozilishi bilan sahifa «Qayta yuklash» xatosiga tushardi).
  const getSectionLabel = (value?: string) => {
    if (!value) return '-';
    return SECTION_OPTIONS.find((o) => o.value === value)?.label ?? value;
  };

  const getBranchLabel = (branch?: Branch) => {
    if (!branch) return '-';
    return getLocalized(branch, 'name', i18n.language) || branch.name_uz || '-';
  };

  const formatWithdrawerName = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const lastName = parts[0];
    const firstInitial = parts[1]?.[0] ?? '';
    return `${lastName} ${firstInitial}.`;
  };

  const getCashWithdrawers = (item: Jamgarma) => item.cash_withdrawers ?? item.withdrawers ?? [];
  const getNonCashWithdrawers = (item: Jamgarma) => item.non_cash_withdrawers ?? item.withdrawers ?? [];
  const selectedWithdrawerIds = [...new Set([...selectedCashWithdrawerIds, ...selectedNonCashWithdrawerIds])];

  const handleWithdrawerSelection = (ids: number[]) => {
    const next = new Set(ids);
    const current = new Set(selectedWithdrawerIds);
    const added = ids.filter((id) => !current.has(id));
    setSelectedCashWithdrawerIds((previous) => [...previous.filter((id) => next.has(id)), ...added]);
    setSelectedNonCashWithdrawerIds((previous) => [...previous.filter((id) => next.has(id)), ...added]);
  };

  const removeWithdrawer = (id: number) => {
    setSelectedCashWithdrawerIds((previous) => previous.filter((value) => value !== id));
    setSelectedNonCashWithdrawerIds((previous) => previous.filter((value) => value !== id));
  };

  const getWithdrawerBadges = (item: Jamgarma) => [
    ...getCashWithdrawers(item).map((w) => ({ id: w.id, type: 'cash' as const, name: formatWithdrawerName(w.full_name) })),
    ...getNonCashWithdrawers(item).map((w) => ({ id: w.id, type: 'non_cash' as const, name: formatWithdrawerName(w.full_name) })),
  ];

  const getName = (item: Jamgarma) =>
    getLocalized(item, 'name', i18n.language) || item.name_uz || '-';

  const todayStr = (() => {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
  })();

  // ─── Modal helpers ─────────────────────────────────────────────────────────

  const closeModal = () => {
    setShowCreate(false);
    setEditingItem(null);
    setForm({ branch_id: '', jamgarma_name_id: '', status: 'active' });
    setSelectedCashWithdrawerIds([]);
    setSelectedNonCashWithdrawerIds([]);
  };

  const openEdit = (item: Jamgarma) => {
    setEditingItem(item);
    setForm({
      branch_id: item.branch?.id
        ? String(item.branch.id)
        : item.branch_id
          ? String(item.branch_id)
          : '',
      jamgarma_name_id: '',
      status: item.status || 'active',
    });
    setSelectedCashWithdrawerIds(getCashWithdrawers(item).map((w) => w.id));
    setSelectedNonCashWithdrawerIds(getNonCashWithdrawers(item).map((w) => w.id));
    setShowCreate(true);
  };

  const handleSubmit = () => {
    if (inflight.current) return;
    if (editingItem) {
      // Filial va nom o'zgarmaydi (backend 422 beradi); nomsiz eski jamg'arma bir marta nomga bog'lanishi mumkin.
      inflight.current = true;
      updateMutation.mutate({
        id: editingItem.id,
        payload: {
          status: form.status,
          cash_withdrawer_ids: selectedCashWithdrawerIds,
          non_cash_withdrawer_ids: selectedNonCashWithdrawerIds,
          ...(!editingItem.jamgarma_name_id &&
            form.jamgarma_name_id && { jamgarma_name_id: Number(form.jamgarma_name_id) }),
        },
      });
      return;
    }
    if (!form.branch_id || !form.jamgarma_name_id) return;
    // Hisob raqam yuborilmaydi: o'tkazma filialning naqd va naqdsiz hisobidan qilinadi (backend `chart_of_accounts_id` ixtiyoriy).
    inflight.current = true;
    createMutation.mutate({
      branch_id: Number(form.branch_id),
      jamgarma_name_id: Number(form.jamgarma_name_id),
      cash_withdrawer_ids: selectedCashWithdrawerIds,
      non_cash_withdrawer_ids: selectedNonCashWithdrawerIds,
      status: form.status,
    });
  };

  const closeViewModal = () => {
    setViewingItem(null);
    setViewStatusChange('');
    setViewStatusNote('');
  };

  // ─── Filtered & paginated data ─────────────────────────────────────────────

  const filtered = (() => {
    // Newest first: recently added rows appear at the top of the table.
    const sorted = [...jamgarmas].sort((a, b) => {
      const at = a.created_at ? new Date(a.created_at).getTime() : a.id;
      const bt = b.created_at ? new Date(b.created_at).getTime() : b.id;
      return bt - at;
    });
    const byPurpose = purposeFilter
      ? sorted.filter((j) => (j.purpose || 'operating') === purposeFilter)
      : sorted;
    // Backend ro'yxatda `branch_id` bermaydi, faqat `branch` obyektini (`JamgarmaResource`) — ikkalasiga ham qaraymiz.
    const byBranch = branchFilter
      ? byPurpose.filter((j) => String(j.branch?.id ?? j.branch_id) === branchFilter)
      : byPurpose;
    if (!search) return byBranch;
    const q = search.toLowerCase();
    return byBranch.filter(
      (j) =>
        (j.name_uz || '').toLowerCase().includes(q) ||
        getSectionLabel(j.jamgarma_fund_type || j.section_uz)
          .toLowerCase()
          .includes(q) ||
        getBranchLabel(j.branch).toLowerCase().includes(q),
    );
  })();

  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, lastPage);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);


  // Nom ma'lumoti (bo'lim, tur): yaratishda tanlangan nomdan, tahrirlashda jamg'armaning o'zidan.
  const infoSection = selectedName?.jamgarma_fund_type ?? editingItem?.jamgarma_fund_type;
  const infoPurpose = selectedName?.purpose ?? (editingItem ? getPurpose(editingItem) : undefined);

  const displayCashBalance = editingItem?.cash_balance ?? 0;
  const displayNonCashBalance = editingItem?.non_cash_balance ?? 0;
  const displayTotalBalance = displayCashBalance + displayNonCashBalance;

  // Tanlangan filialning naqd (0001) va naqdsiz (0002) hisob raqami + balansi (filial tanlanishi bilan avtomatik).
  const branchAccountRows = form.branch_id
    ? allAccounts.filter(
        (a) =>
          String(a.branch?.id ?? a.branch_id) === form.branch_id &&
          a.status !== 'inactive' &&
          a.is_active !== false,
      )
    : [];
  const branchCash = branchAccountRows.find((a) => a.account_type === '0001');
  const branchNonCash = branchAccountRows.find((a) => a.account_type !== '0001');
  const branchTotal = (Number(branchCash?.balance) || 0) + (Number(branchNonCash?.balance) || 0);
  const branchAccountItems = [
    { key: 'cash', label: t('jamgarma.cashAccount'), account: branchCash },
    { key: 'noncash', label: t('jamgarma.nonCashAccount'), account: branchNonCash },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <section className="finances container">
      <PageTitle title={t('aside.jamgarma')} icon="fa-piggy-bank" />

      {/* ── Create / Edit Modal ──────────────────────────────────────────── */}
      {showCreate && (
        <div className="fin-modal-overlay" onClick={closeModal}>
          <div className="fin-modal fin-modal-jamgarma" onClick={(e) => e.stopPropagation()}>
            <h3 className="fin-modal-title">
              {editingItem ? t('jamgarma.edit') : t('jamgarma.create')}
            </h3>

            <div className="fin-form-group">
              <label>
                {t('jamgarma.branch')}
                <InfoHint
                  text={editingItem ? t('jamgarma.branchLocked') : t('jamgarma.branchAccountsNote')}
                />
              </label>
              <select
                value={form.branch_id}
                disabled={!!editingItem}
                onChange={(e) =>
                  setForm({ ...form, branch_id: e.target.value, jamgarma_name_id: '' })
                }
              >
                <option value="">{t('jamgarma.choose')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Nom: yaratishda ro'yxatdan; nomga bog'langan jamg'armada o'zgarmaydi */}
            {editingItem?.jamgarma_name_id ? (
              <div className="fin-form-group">
                <label>
                  {t('jamgarma.nameLabel')}
                  <InfoHint text={t('jamgarma.nameManagedNote')} />
                </label>
                <input type="text" readOnly value={getName(editingItem)} className="fin-readonly-input" />
              </div>
            ) : (
              <div className="fin-form-group">
                <label>{editingItem ? t('jamgarma.bindName') : t('jamgarma.nameLabel')}</label>
                {editingItem && (
                  <input type="text" readOnly value={getName(editingItem)} className="fin-readonly-input" />
                )}
                <select
                  value={form.jamgarma_name_id}
                  disabled={!form.branch_id}
                  onChange={(e) => setForm({ ...form, jamgarma_name_id: e.target.value })}
                >
                  <option value="">
                    {form.branch_id ? t('jamgarma.choose') : t('jamgarma.selectBranchFirst')}
                  </option>
                  {availableNames.map((n) => (
                    <option key={n.id} value={n.id}>
                      {getLocalized(n, 'name', i18n.language) || n.name_uz}
                    </option>
                  ))}
                </select>
                {form.branch_id && namesLoaded && !namesFetching && availableNames.length === 0 && (
                  <span className="fin-field-error">{t(nameAvailability?.attachedCount === 0 ? 'jamgarma.noAttachedNames' : (nameAvailability?.attachedCount ?? 0) > 0 ? 'jamgarma.allNamesUsed' : 'jamgarma.noAvailableNames')}</span>
                )}
              </div>
            )}

            {namesError && <p role="alert" className="fin-field-error">{t('jamgarma.namesLoadError')}</p>}

            {(infoSection || infoPurpose) && (
              <div className="fin-name-info">
                {infoSection && (
                  <span>
                    {t('jamgarma.section')}: <b>{getSectionLabel(infoSection)}</b>
                  </span>
                )}
                {infoPurpose && (
                  <span>
                    {t('jamgarma.purposeLabel')}:{' '}
                    <span className={`fin-purpose-badge fin-purpose-badge--${infoPurpose}`}>
                      {getPurposeLabel(infoPurpose)}
                    </span>
                  </span>
                )}
              </div>
            )}

            {/* Xodim tanlovi bitta; har bir xodim uchun naqd/naqdsiz ruxsat alohida. */}
            <div className="fin-form-group">
              <label>
                {t('jamgarma.withdrawers')}
                <InfoHint text={t('jamgarma.withdrawersNote')} />
              </label>
              <MultiPicker
                options={users.map((u) => ({ value: u.id, label: u.label }))}
                value={selectedWithdrawerIds}
                onChange={handleWithdrawerSelection}
                placeholder={t('jamgarma.choose')}
              />
              {selectedWithdrawerIds.length > 0 && (
                <div className="fin-withdrawer-user-cards">
                  {selectedWithdrawerIds.map((id) => {
                    const name = users.find((user) => user.id === id)?.label ?? String(id);
                    return (
                      <div key={id} className="fin-withdrawer-user-card">
                        <div className="fin-withdrawer-user-card-name-group">
                          <span className="fin-withdrawer-user-card-name">{name}</span>
                        </div>
                        <label className="fin-withdrawer-type-inline">
                          <input
                            type="checkbox"
                            checked={selectedCashWithdrawerIds.includes(id)}
                            onChange={(event) => setSelectedCashWithdrawerIds((previous) =>
                              event.target.checked
                                ? [...previous, id]
                                : previous.filter((value) => value !== id),
                            )}
                          />
                          <span className="fin-withdrawer-type-label">{t('jamgarma.cashShort')}</span>
                        </label>
                        <label className="fin-withdrawer-type-inline">
                          <input
                            type="checkbox"
                            checked={selectedNonCashWithdrawerIds.includes(id)}
                            onChange={(event) => setSelectedNonCashWithdrawerIds((previous) =>
                              event.target.checked
                                ? [...previous, id]
                                : previous.filter((value) => value !== id),
                            )}
                          />
                          <span className="fin-withdrawer-type-label">{t('jamgarma.nonCashShort')}</span>
                        </label>
                        <button
                          type="button"
                          className="fin-withdrawer-user-card-remove"
                          aria-label={t('multiPicker.remove')}
                          onClick={() => removeWithdrawer(id)}
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tanlangan filialning naqd / naqdsiz hisob raqami va balansi — filial tanlanishi bilan avtomatik */}
            {form.branch_id && (
              <div className="fin-balance-row">
                <span className="fin-balance-title">{t('jamgarma.branchAccountsTitle')}</span>
                {branchAccountItems.map((item) => (
                  <div key={item.key} className="fin-balance-item">
                    <span className="fin-balance-label">
                      {item.label}
                      {item.account && (
                        <small className="fin-balance-acc">{item.account.account_number}</small>
                      )}
                    </span>
                    {item.account ? (
                      <span className="fin-balance-value fin-text-green">
                        {formatAmount(Number(item.account.balance) || 0)} UZS
                      </span>
                    ) : (
                      <span className="fin-balance-none">{t('jamgarma.noAccountShort')}</span>
                    )}
                  </div>
                ))}
                <div className="fin-balance-item fin-balance-total">
                  <span className="fin-balance-label">{t('jamgarma.branchTotalBalance')}</span>
                  <span className="fin-balance-value fin-text-green">
                    {formatAmount(branchTotal)} UZS
                  </span>
                </div>
              </div>
            )}

            {/* Jamg'armaning o'z balansi — faqat mavjud jamg'arma tahrirlanganda mantiqli (yaratishda doim 0) */}
            {editingItem && (
              <div className="fin-balance-row">
                <span className="fin-balance-title">{t('jamgarma.fundBalanceTitle')}</span>
                <div className="fin-balance-item">
                  <span className="fin-balance-label">{t('jamgarma.cashBalance')}</span>
                  <span className="fin-balance-value fin-text-green">
                    {formatAmount(displayCashBalance)} UZS
                  </span>
                </div>
                <div className="fin-balance-item">
                  <span className="fin-balance-label">{t('jamgarma.nonCashBalance')}</span>
                  <span className="fin-balance-value fin-text-green">
                    {formatAmount(displayNonCashBalance)} UZS
                  </span>
                </div>
                <div className="fin-balance-item fin-balance-total">
                  <span className="fin-balance-label">{t('jamgarma.totalBalance')}</span>
                  <span className="fin-balance-value fin-text-green">
                    {formatAmount(displayTotalBalance)} UZS
                  </span>
                </div>
              </div>
            )}

            <div className="fin-form-group">
              <label>{t('jamgarma.statusLabel')}</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">{t('jamgarma.statusActive')}</option>
                <option value="inactive">{t('jamgarma.statusInactive')}</option>
                <option value="frozen">{t('jamgarma.statusFrozen')}</option>
              </select>
            </div>

            <div className="fin-modal-actions">
              <button
                className="fin-btn-save"
                onClick={handleSubmit}
                disabled={
                  (!editingItem && (!form.branch_id || !form.jamgarma_name_id)) ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
              >
                {createMutation.isPending || updateMutation.isPending
                  ? t('jamgarma.saving')
                  : t('jamgarma.save')}
              </button>
              <button className="fin-btn-cancel" onClick={closeModal} type="button">
                {t('jamgarma.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────────────────────── */}
      {deleteId !== null && (
        <div className="fin-modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="fin-modal fin-modal-sm" onClick={(e) => e.stopPropagation()}>
                {deleteMutation.isError && <p role="alert">{t('common.deleteError', 'O‘chirish amalga oshmadi. Qolgan yozuvlar uchun qayta urinib ko‘ring.')}</p>}
            <p className="fin-confirm-text">{t('jamgarma.confirmDelete')}</p>
            <div className="fin-modal-actions">
              <button
                className="fin-btn-danger"
                onClick={() => deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
              >
                {t('jamgarma.confirm')}
              </button>
              <button className="fin-btn-cancel" onClick={() => setDeleteId(null)}>
                {t('jamgarma.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View / Detail Modal ───────────────────────────────────────────── */}
      {viewingItem && (
        <div className="fin-modal-overlay" onClick={closeViewModal}>
          <div className="fin-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fin-detail-header">
              <h3>{t('jamgarma.details')}</h3>
            </div>

            <div className="fin-detail-rows">
              <div className="fin-detail-row">
                <span>{t('jamgarma.idLabel')}</span>
                <span>{viewingItem.id}</span>
              </div>
              <div className="fin-detail-row">
                <span>{t('jamgarma.name')}</span>
                <span>{getName(viewingItem)}</span>
              </div>
              {(viewingItem.jamgarma_fund_type || viewingItem.section_uz) && (
                <div className="fin-detail-row">
                  <span>{t('jamgarma.section')}</span>
                  <span>
                    {getSectionLabel(viewingItem.jamgarma_fund_type || viewingItem.section_uz)}
                  </span>
                </div>
              )}
              <div className="fin-detail-row">
                <span>{t('jamgarma.branch')}</span>
                <span>{getBranchLabel(viewingItem.branch)}</span>
              </div>
              <div className="fin-detail-row">
                <span>{t('jamgarma.cashBalance')}</span>
                <span className="fin-text-green">{formatAmount(viewingItem.cash_balance)} UZS</span>
              </div>
              <div className="fin-detail-row">
                <span>{t('jamgarma.nonCashBalance')}</span>
                <span className="fin-text-green">
                  {formatAmount(viewingItem.non_cash_balance)} UZS
                </span>
              </div>
              <div className="fin-detail-row">
                <span>{t('jamgarma.totalBalance')}</span>
                <span className="fin-text-green fin-amount-cell">
                  {formatAmount(viewingItem.total_balance)} UZS
                </span>
              </div>
              <div className="fin-detail-row">
                <span>{t('jamgarma.statusLabel')}</span>
                <span
                  className={viewingItem.status === 'active' ? 'fin-text-green' : 'fin-text-red'}
                >
                  {getStatusLabel(viewingItem.status)}
                </span>
              </div>
              {viewingItem.cash_account && (
                <div className="fin-detail-row">
                  <span>{t('jamgarma.cashAccount')}</span>
                  <span>
                    {viewingItem.cash_account.account_number}
                    {viewingItem.cash_account.balance != null &&
                      ` · ${formatAmount(Number(viewingItem.cash_account.balance) || 0)} UZS`}
                  </span>
                </div>
              )}
              {viewingItem.non_cash_account && (
                <div className="fin-detail-row">
                  <span>{t('jamgarma.nonCashAccount')}</span>
                  <span>
                    {viewingItem.non_cash_account.account_number}
                    {viewingItem.non_cash_account.balance != null &&
                      ` · ${formatAmount(Number(viewingItem.non_cash_account.balance) || 0)} UZS`}
                  </span>
                </div>
              )}
              {(getCashWithdrawers(viewingItem).length > 0 || getNonCashWithdrawers(viewingItem).length > 0) && (
                <div className="fin-detail-row fin-detail-row-signatories">
                  <span>{t('jamgarma.withdrawers')}</span>
                  <div className="fin-signatory-list-view">
                    {getCashWithdrawers(viewingItem).map((w) => (
                      <span key={`cash-${w.id}`} className="fin-signatory-tag">
                        {w.full_name} · {t('jamgarma.cashShort')}
                      </span>
                    ))}
                    {getNonCashWithdrawers(viewingItem).map((w) => (
                      <span key={`non-cash-${w.id}`} className="fin-signatory-tag">
                        {w.full_name} · {t('jamgarma.nonCashShort')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {viewingItem.created_at && (
                <div className="fin-detail-row">
                  <span>{t('jamgarma.dateLabel')}</span>
                  <span>{formatDate(viewingItem.created_at)}</span>
                </div>
              )}
            </div>

            {/* ── Status Change Section ── */}
            <div className="fin-status-change-section">
              <div className="fin-form-group">
                <label>{t('jamgarma.statusChange')}</label>
                <select
                  value={viewStatusChange}
                  onChange={(e) => {
                    setViewStatusChange(e.target.value);
                    setViewStatusNote('');
                  }}
                >
                  <option value="">{t('jamgarma.statusChangePlaceholder')}</option>
                  {viewingItem.status !== 'active' && (
                    <option value="active">{t('jamgarma.setActive')}</option>
                  )}
                  {viewingItem.status !== 'inactive' && (
                    <option value="inactive">{t('jamgarma.setInactive')}</option>
                  )}
                  {viewingItem.status !== 'frozen' && (
                    <option value="frozen">{t('jamgarma.setFrozen')}</option>
                  )}
                </select>
              </div>

              {viewStatusChange && (
                <>
                  <div className="fin-form-group">
                    <label>{t('jamgarma.statusChangedDate')}</label>
                    <input type="text" readOnly value={todayStr} className="fin-readonly-input" />
                  </div>
                  <div className="fin-form-group">
                    <label>{t('jamgarma.statusNote')}</label>
                    <textarea
                      value={viewStatusNote}
                      onChange={(e) => setViewStatusNote(e.target.value)}
                      rows={3}
                      placeholder={t('jamgarma.statusNotePlaceholder')}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="fin-modal-actions">
              {viewStatusChange && (
                <button
                  className="fin-btn-save"
                  disabled={changeStatusMutation.isPending}
                  onClick={() =>
                    changeStatusMutation.mutate({
                      id: viewingItem.id,
                      status: viewStatusChange,
                      note: viewStatusNote,
                    })
                  }
                >
                  {changeStatusMutation.isPending ? t('jamgarma.saving') : t('jamgarma.saveStatus')}
                </button>
              )}
              <button className="fin-btn-cancel" onClick={closeViewModal}>
                {t('jamgarma.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      {nameFilter && (
        <div className="fin-name-info">
          <span>{t('jamgarma.nameFilter', { id: nameFilter })}</span>
          <button type="button" className="fin-btn-cancel" onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete('jamgarma_name_id');
            setSearchParams(next);
          }}>{t('jamgarma.clearNameFilter')}</button>
        </div>
      )}
      <div className="fin-toolbar">
        <div className="fin-search-box">
          <input
            placeholder={t('jamgarma.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value); setSelectedIds([]);
              setPage(1);
            }}
          />
          <i className="fa-solid fa-magnifying-glass" />
        </div>
        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value); setSelectedIds([]);
            setPage(1);
          }}
        >
          <option value="">{t('finance.branch', 'Filial')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          value={purposeFilter}
          onChange={(e) => {
            setPurposeFilter(e.target.value); setSelectedIds([]);
            setPage(1);
          }}
        >
          <option value="">{t('jamgarma.purposeFilterAll')}</option>
          <option value="operating">{t('jamgarma.purpose.operating')}</option>
          <option value="payroll">{t('jamgarma.purpose.payroll')}</option>
          <option value="payroll_tax">{t('jamgarma.purpose.payroll_tax')}</option>
        </select>
        <Protected permission="jamgarmas.create">
          <button className="fin-btn-add" onClick={() => setShowCreate(true)}>
            {t('jamgarma.add')}
          </button>
        </Protected>
            <Protected permission="jamgarmas.delete">
              <button className="fin-btn-danger" disabled={selectedIds.length === 0 || deleteMutation.isPending} onClick={() => setDeleteId('selected')}>{t('branches.delete')}</button>
            </Protected>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="fin-table-wrapper">
        <table className="fin-table">
          <thead>
            <tr>
              <Protected permission="jamgarmas.delete"><th><input type="checkbox" aria-label={t('branches.delete')} checked={paginated.length > 0 && paginated.every(row => selectedIds.includes(row.id))} onChange={e => setSelectedIds(e.target.checked ? paginated.map(row => row.id) : [])} /></th></Protected>
                  <th>ID</th>
              <th>{t('jamgarma.branchCol')}</th>
              <th>{t('jamgarma.purposeCol')}</th>
              <th>{t('jamgarma.nameCol')}</th>
              <th>{t('jamgarma.sectionCol')}</th>
              <th>{t('jamgarma.withdrawersCol')}</th>
              <th>{t('jamgarma.balanceCol')}</th>
              <th>{t('jamgarma.statusCol')}</th>
              <th>{t('jamgarma.dateCol')}</th>
              <th>{t('jamgarma.actionsCol')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={10} columnCount={10 + (canBulkDelete ? 1 : 0)} />
            ) : paginated.length > 0 ? (
              paginated.map((item) => (
                <tr key={item.id}>
                  <Protected permission="jamgarmas.delete"><td><input type="checkbox" aria-label={String(item.id)} checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])} /></td></Protected>
                      <td>{item.id}</td>
                  <td className="fin-branch-cell">{getBranchLabel(item.branch)}</td>
                  <td>
                    <span className={`fin-purpose-badge fin-purpose-badge--${getPurpose(item)}`}>
                      {getPurposeLabel(getPurpose(item))}
                    </span>
                  </td>
                  <td>{getName(item)}</td>
                  <td>{getSectionLabel(item.jamgarma_fund_type || item.section_uz)}</td>
                  <td className="fin-signatories-cell">
                    {getWithdrawerBadges(item).length > 0 ? (
                      getWithdrawerBadges(item).map((w) => (
                        <div key={`${w.type}-${w.id}`} className="fin-withdrawer-badge-row">
                          <span>{w.name} · {t(w.type === 'cash' ? 'jamgarma.cashShort' : 'jamgarma.nonCashShort')}</span>
                        </div>
                      ))
                    ) : (
                      <div>-</div>
                    )}
                  </td>
                  <td>
                    <div className="fin-balance-cards">
                      <span className="fin-balance-card-total">
                        {formatAmount(item.total_balance)} UZS
                      </span>
                      <span className="fin-balance-card fin-balance-card--cash">
                        <i className="fa-solid fa-money-bill" />
                        {t('jamgarma.cashShort')}: {formatAmount(item.cash_balance)}
                      </span>
                      <span className="fin-balance-card fin-balance-card--noncash">
                        <i className="fa-solid fa-credit-card" />
                        {t('jamgarma.nonCashShort')}: {formatAmount(item.non_cash_balance)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={statusTone(item.status)}>
                      {getStatusLabel(item.status)}
                    </StatusBadge>
                  </td>
                  <td className="fin-date-cell">{formatDate(item.created_at)}</td>
                  <td>
                    <div className="fin-actions">
                      {/* «Ko'rish» ruxsatsiz: ro'yxatni ko'rgan kishi qatorni ham ko'radi (bazada bunday `.show` ruxsati yo'q edi — tugma hech kimga chiqmasdi) */}
                      <button
                        className="fin-action-btn fin-action-view"
                        onClick={() => {
                          setViewingItem(item);
                          setViewStatusChange('');
                          setViewStatusNote('');
                        }}
                        title={t('jamgarma.view')}
                      >
                        <i className="fa-solid fa-eye" />
                      </button>
                      <Protected permission="jamgarmas.edit">
                        <button
                          className="fin-action-btn fin-action-edit"
                          onClick={() => openEdit(item)}
                          title={t('jamgarma.editBtn')}
                        >
                          <i className="fa-solid fa-pen" />
                        </button>
                      </Protected>
                      <Protected permission="jamgarmas.delete">
                        <button
                          className="fin-action-btn fin-action-delete"
                          onClick={() => setDeleteId(item.id)}
                          title={t('jamgarma.deleteBtn')}
                        >
                          <i className="fa-solid fa-trash" />
                        </button>
                      </Protected>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={10 + (canBulkDelete ? 1 : 0)} message={t('jamgarma.noData')} />
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {filtered.length > 0 && (
        <PaginationBar
          page={safePage}
          totalPages={lastPage}
          total={filtered.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </section>
  );
};

export default JamgarmaPage;
