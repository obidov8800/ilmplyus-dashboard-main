import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '@/api/api';
import './finance.css';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import { clampCell } from '@/utils/clampCell';
import MultiPicker from '@/components/MultiPicker';
import PageTitle from '@/components/PageTitle';
import { getLocalized } from '@/utils/getLocalized';
import TableSkeleton from '@/components/TableSkeleton';
import EmptyState from '@/components/EmptyState';
import PaginationBar from '@/components/Pagination/PaginationBar';
import { Protected } from '@/components/Protected';
import { usePermission } from '@/hooks/usePermission';
import { useOptions } from '@/hooks/useOptions';
import type { Branch } from '@/types/common.types';
import { formatDateTime } from '@/utils/date';
import StatusBadge from '@/components/StatusBadge';
import { statusTone } from '@/utils/statusTone';

// ─── Local Type Definitions ──────────────────────────────────────────────────

interface TransferMaker {
  id: number;
  full_name: string;
}

interface FinanceAccount {
  id: number;
  branch_id: number;
  account_type: string; // "0001" | "0002"
  account_type_name?: string; // "Naqt (Cash)"
  account_number: string;
  balance: number;
  status: 'active' | 'inactive';
  is_active?: boolean;
  description_uz?: string;
  created_at: string;
  updated_at: string;
  branch?: Branch;
  transfer_makers?: TransferMaker[];
}

interface TransferPerson {
  id: number;
  full_name?: string;
  username?: string;
}

interface TransferAccountRef {
  id: number;
  account_number?: string;
  account_type?: string;
  account_type_name?: string;
  balance?: number;
}

interface JamgarmaRef {
  id: number;
  name?: string | null;
  name_uz?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
  cash_balance?: number;
  non_cash_balance?: number;
  total_balance?: number;
}

interface TransferCommonFields {
  id: number;
  amount: number;
  notes?: string | null;
  status: 'pending' | 'sent' | 'approved' | 'rejected' | 'cancelled';
  sent_by?: TransferPerson | null;
  sent_at?: string;
  approved_by?: TransferPerson | null;
  approved_at?: string;
  rejected_by?: TransferPerson | null;
  rejected_at?: string;
  cancelled_by?: TransferPerson | null;
  cancelled_at?: string;
  created_at: string;
  updated_at: string;
}

interface FinanceTransfer extends TransferCommonFields {
  source_account?: TransferAccountRef;
  destination_account?: TransferAccountRef;
}

interface AccountToJamgarmaTransfer extends TransferCommonFields {
  source_account?: TransferAccountRef;
  destination_jamgarma?: JamgarmaRef;
  account_type_name?: string;
}

type UnifiedTransfer =
  | ({ kind: 'account' } & FinanceTransfer)
  | ({ kind: 'jamgarma' } & AccountToJamgarmaTransfer);

interface Jamgarma {
  id: number;
  name_uz?: string;
  name_ru?: string;
  name_en?: string;
  status: 'active' | 'inactive' | 'frozen';
  /** Balanslar faqat `jamgarmas.view` bilan (`/jamgarmas`); `/options` zaxirasida yo'q. */
  cash_balance?: number;
  non_cash_balance?: number;
  total_balance?: number;
  branch?: Branch;
  created_at?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = [
  { code: '0001', label: '0001 - Naqd' },
  { code: '0002', label: '0002 - Naqdsiz' },
];

/**
 * Hisob raqamning filial id'si. Backend (`ChartOfAccountsResource`) ro'yxat javobida `branch_id` BERMAYDI — faqat
 * `branch` obyektini beradi; `branch_id` ga tayanish filtr, «har filialga bittadan» tekshiruvi va tahrirlashni buzardi.
 */
const branchIdOfAccount = (a?: { branch?: { id?: number }; branch_id?: number }) =>
  a?.branch?.id ?? a?.branch_id;

type FinanceTab = 'accounts' | 'transfers';
type TransferView = 'list' | 'select-type' | 'create' | 'savings';

// Sahifalash — umumiy `PaginationBar` (barcha jadval sahifalarida bir xil).

// ─── Main Component ──────────────────────────────────────────────────────────

const Finances = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  // Create permissions per transfer kind (drives the "create" button + type picker).
  const canCreateAccountTransfer = usePermission('chart_of_accounts_transfers.create');
  const canCreateSavingsTransfer = usePermission('account_to_jamgarma_transfers.create');
  const canCreateAnyTransfer = canCreateAccountTransfer || canCreateSavingsTransfer;

  // ── Tab & view state ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<FinanceTab>('accounts');
  const [transferView, setTransferView] = useState<TransferView>('list');

  // ── Accounts UI state ───────────────────────────────────────────
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceAccount | null>(null);
  const [viewingAccount, setViewingAccount] = useState<FinanceAccount | null>(null);
  const [deleteAccountId, setDeleteAccountId] = useState<number | "selected" | null>(null);
  const canBulkDelete = usePermission('chart_of_accounts.delete');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [viewStatusChange, setViewStatusChange] = useState('');
  const [viewStatusNote, setViewStatusNote] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountBranchFilter, setAccountBranchFilter] = useState('');
  const [accountPage, setAccountPage] = useState(1);
  const [accountPageSize, setAccountPageSize] = useState(20);

  // ── Account form state ─────────────────────────────────────────
  const [accountForm, setAccountForm] = useState({
    branch_id: '',
    account_type: '',
    status: 'active',
  });
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  // ── Transfers UI state ──────────────────────────────────────────
  const [transferSearch, setTransferSearch] = useState('');
  const [transferBranchFilter, setTransferBranchFilter] = useState('');
  const [transferPage, setTransferPage] = useState(1);
  const [transferPageSize, setTransferPageSize] = useState(20);
  const [showConfirmTransfer, setShowConfirmTransfer] = useState(false);

  // ── Transfer form state ────────────────────────────────────────
  const [transferForm, setTransferForm] = useState({
    sender_account_id: '',
    receiver_account_id: '',
    amount: '',
    description: '',
  });

  // ── Savings transfer form state ────────────────────────────────
  const [savingsForm, setSavingsForm] = useState({
    sender_account_id: '',
    jamgarma_id: '',
    amount: '',
    description: '',
  });
  const [showConfirmSavings, setShowConfirmSavings] = useState(false);

  // ─── API Queries ──────────────────────────────────────────────────────────

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<FinanceAccount[]>({
    queryKey: ['chart-of-accounts'],
    queryFn: async () => {
      const { data } = await API.get('/chart-of-accounts');
      return Array.isArray(data) ? data : data?.data || [];
    },
    placeholderData: keepPreviousData,
  });

  // Modal dropdownlari — to'liq ro'yxatlar emas, yengil `/options/*` lookuplari.
  const { data: branchOptions = [] } = useOptions('branches');
  const { data: userOptions = [] } = useOptions('users');

  // Har ro'yxat faqat o'z ruxsati bo'lsa so'raladi («ruxsati yo'q so'rov yuborilmaydi»).
  const canViewAccountTransfers = usePermission('chart_of_accounts_transfers.view');
  const canViewSavingsTransfers = usePermission('account_to_jamgarma_transfers.view');
  const canViewJamgarmas = usePermission('jamgarmas.view');

  const { data: transfers = [], isLoading: transfersListLoading } = useQuery<FinanceTransfer[]>({
    queryKey: ['chart-of-accounts-transfers'],
    queryFn: async () => {
      const { data } = await API.get('/chart-of-accounts-transfers');
      return Array.isArray(data) ? data : data?.data || [];
    },
    enabled: canViewAccountTransfers,
    placeholderData: keepPreviousData,
  });

  const { data: jamgarmaTransfers = [], isLoading: jamgarmaTransfersLoading } = useQuery<
    AccountToJamgarmaTransfer[]
  >({
    queryKey: ['account-to-jamgarma-transfers'],
    queryFn: async () => {
      const { data } = await API.get('/account-to-jamgarma-transfers');
      return Array.isArray(data) ? data : data?.data || [];
    },
    enabled: canViewSavingsTransfers,
    placeholderData: keepPreviousData,
  });

  const { data: fullJamgarmas = [] } = useQuery<Jamgarma[]>({
    queryKey: ['jamgarmas'],
    queryFn: async () => {
      const { data } = await API.get('/jamgarmas');
      return Array.isArray(data) ? data : data?.data || [];
    },
    enabled: canViewJamgarmas,
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  });
  // `jamgarmas.view` yo'q — tanlov ro'yxatidan (`lookups.view`), BALANSSIZ: sahifa xato bermaydi.
  const { data: jamgarmaOptions = [] } = useOptions('jamgarmas', undefined, { enabled: !canViewJamgarmas });
  const jamgarmas: Jamgarma[] = canViewJamgarmas
    ? fullJamgarmas
    : jamgarmaOptions.map((o) => ({ id: o.id, name_uz: o.label, status: 'active', branch_id: o.branch_id }) as Jamgarma);

  // ─── Mutations ────────────────────────────────────────────────────────────

  // Hisob raqam yaratish: filial uchun naqd (0001) va naqdsiz (0002) hisoblar BIRGA, ketma-ket yaratiladi
  // (faqat yetishmayotgan turlar). Biri xato bersa ro'yxat yangilanadi — qayta urinishda faqat qolgani yaratiladi.
  const createAccountMutation = useMutation({
    // Tur yuborilmaydi: backend filialning yetishmayotgan naqd (0001) va naqdsiz (0002) hisobini BITTA tranzaksiyada
    // yaratadi (201, `{ data: [...], existing_types }`); ikkalasi ham bor bo'lsa 422 `errors.account_type`.
    mutationFn: async (v: { branch_id: number; status: string; transfer_maker_ids: number[] }) => {
      const { data } = await API.post('/chart-of-accounts', v);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      closeAccountModal();
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] }),
  });

  const updateAccountMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: object }) => {
      const { data } = await API.put(`/chart-of-accounts/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      closeAccountModal();
    },
  });

  const changeStatusMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: number; status: string; note: string }) => {
      const { data } = await API.put(`/chart-of-accounts/${id}`, {
        status,
        is_active: status === 'active',
        description_uz: note || undefined,
      });
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      setViewingAccount((prev) =>
        prev ? { ...prev, status: vars.status as 'active' | 'inactive' } : prev,
      );
      setViewStatusChange('');
      setViewStatusNote('');
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async (target: number | 'selected') => {
      const ids = target === 'selected' ? selectedIds : [target];
      for (const id of ids) {
        await API.delete(`/chart-of-accounts/${id}`);
        setSelectedIds(prev => prev.filter(value => value !== id));
      }
    },
    onSuccess: () => setDeleteAccountId(null),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] }),
  });


  const createTransferMutation = useMutation({
    mutationFn: async (payload: object) => {
      const { data } = await API.post('/chart-of-accounts-transfers', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      setShowConfirmTransfer(false);
      setTransferView('list');
      setTransferForm({
        sender_account_id: '',
        receiver_account_id: '',
        amount: '',
        description: '',
      });
    },
  });

  const createSavingsTransferMutation = useMutation({
    // Backendda `/jamgarma-transfers` YO'Q (404) — hisobdan jamg'armaga o'tkazma `/account-to-jamgarma-transfers`
    // (`source_account_id`, `destination_jamgarma_id`, `amount`, `notes`). Ro'yxat ham shu manbadan o'qiladi.
    mutationFn: async (payload: object) => {
      const { data } = await API.post('/account-to-jamgarma-transfers', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['account-to-jamgarma-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['jamgarmas'] });
      setShowConfirmSavings(false);
      setTransferView('list');
      setSavingsForm({ sender_account_id: '', jamgarma_id: '', amount: '', description: '' });
    },
  });

  const approveTransferMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data } = await API.post(`/chart-of-accounts-transfers/${id}/approve`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
  });

  const rejectTransferMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data } = await API.post(`/chart-of-accounts-transfers/${id}/reject`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
  });

  const cancelTransferMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data } = await API.post(`/chart-of-accounts-transfers/${id}/cancel`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
  });

  const approveJamgarmaTransferMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data } = await API.post(`/account-to-jamgarma-transfers/${id}/approve`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-to-jamgarma-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['jamgarmas'] });
    },
  });

  const rejectJamgarmaTransferMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data } = await API.post(`/account-to-jamgarma-transfers/${id}/reject`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-to-jamgarma-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['jamgarmas'] });
    },
  });

  const cancelJamgarmaTransferMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data } = await API.post(`/account-to-jamgarma-transfers/${id}/cancel`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-to-jamgarma-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['jamgarmas'] });
    },
  });

  const getTransferKey = (tr: UnifiedTransfer) => `${tr.kind}-${tr.id}`;

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const formatAmount = (val: number | string) =>
    Number(val)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Admin bo'ylab bir xil shakl: `DD.MM.YYYY HH:mm` (`utils/date.ts`).
  const formatDate = (dateStr?: string) => formatDateTime(dateStr, '-');

  const getAccountStatusLabel = (status: string) => {
    if (status === 'active') return t('finance.statusActive');
    if (status === 'inactive') return t('finance.statusInactive');
    // Jamg'arma hisobi muzlatilgan bo'lishi mumkin — xom `frozen` o'rniga tarjima.
    if (status === 'frozen') return t('finance.statusFrozen');
    return status;
  };

  const getTransferStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      approved: t('finance.statusApproved'),
      pending: t('finance.statusPending'),
      sent: t('finance.statusPending'),
      rejected: t('finance.statusRejected'),
      cancelled: t('finance.statusCancelled'),
    };
    return map[status] || status;
  };

  const isPendingTransferStatus = (status: string) => status === 'pending' || status === 'sent';

  const getJamgarmaRefName = (j?: JamgarmaRef) => {
    if (!j) return '-';
    return getLocalized(j, 'name', i18n.language) || j.name_uz || j.name || `Jam'garma #${j.id}`;
  };

  const getAccountTypeName = (type: string, typeName?: string) => {
    if (typeName) return typeName;
    if (type === '0001') return '0001 - Naqd';
    if (type === '0002') return '0002 - Naqdsiz';
    return type;
  };

  const getBranchLabel = (branch?: Branch) => {
    if (!branch) return '-';
    return getLocalized(branch, 'name', i18n.language) || branch.name_uz || '-';
  };

  const isCashAccountType = (acc?: { account_type?: string; account_type_name?: string }) => {
    if (!acc) return false;
    if (acc.account_type) return acc.account_type === '0001';
    return !acc.account_type_name?.toLowerCase().includes('siz');
  };

  // Tanlov ro'yxatida faqat raqam emas, tur matni ham: «202000010001 — Naqd (Parvoz)».
  const accountOptionLabel = (a: FinanceAccount) =>
    `${a.account_number} — ${
      isCashAccountType(a) ? t('jamgarma.cashShort') : t('jamgarma.nonCashShort')
    } (${getBranchLabel(a.branch)})`;

  const resolveTransferAccount = (
    ref?: TransferAccountRef,
  ): (TransferAccountRef & { branch?: Branch; account_type?: string }) | undefined => {
    if (!ref) return undefined;
    return accounts.find((a) => a.id === ref.id) ?? ref;
  };

  const getTransferMakersDisplay = (account: FinanceAccount) => {
    if (!account.transfer_makers?.length) return '-';
    return account.transfer_makers.map((tm) => tm.full_name).join(', ');
  };

  // ─── Account Modal Logic ───────────────────────────────────────────────────

  function closeAccountModal() {
    setShowCreateAccount(false);
    setEditingAccount(null);
    setAccountForm({ branch_id: '', account_type: '', status: 'active' });
    setSelectedUserIds([]);
  }

  const openEditAccount = (account: FinanceAccount) => {
    setEditingAccount(account);
    setAccountForm({
      branch_id: String(branchIdOfAccount(account) ?? ''),
      account_type: account.account_type,
      status: account.status,
    });
    setSelectedUserIds(account.transfer_makers?.map((tm) => tm.id) || []);
    setShowCreateAccount(true);
  };

  // Filial bo'yicha mavjud hisob turlari: har filialga bittadan naqd va bittadan naqdsiz.
  const existingTypesOfBranch = (branchId: string | number) =>
    new Set(accounts.filter((a) => String(branchIdOfAccount(a)) === String(branchId)).map((a) => a.account_type));
  const missingAccountTypes = (branchId: string | number) =>
    ACCOUNT_TYPES.map((at) => at.code).filter((code) => !existingTypesOfBranch(branchId).has(code));
  // Yangi hisob raqam uchun faqat to'liq (naqd + naqdsiz) juftligi YO'Q filiallar tanlanadi
  const branchesForNewAccount = branchOptions.filter((b) => missingAccountTypes(b.id).length > 0);

  const handleAccountSubmit = () => {
    if (!accountForm.branch_id) return;
    if (editingAccount) {
      // Hisob raqam turi va filiali o'zgartirilmaydi — faqat status va transfer qiluvchilar.
      updateAccountMutation.mutate({
        id: editingAccount.id,
        payload: {
          status: accountForm.status,
          is_active: accountForm.status === 'active',
          transfer_maker_ids: selectedUserIds,
        },
      });
    } else {
      if (missingAccountTypes(accountForm.branch_id).length === 0) return;
      createAccountMutation.mutate({
        branch_id: Number(accountForm.branch_id),
        status: accountForm.status,
        transfer_maker_ids: selectedUserIds,
      });
    }
  };


  const filteredAccounts = (() => {
    let list = accounts;
    if (accountBranchFilter) {
      list = list.filter((a) => String(branchIdOfAccount(a)) === accountBranchFilter);
    }
    if (!accountSearch) return list;
    const q = accountSearch.toLowerCase();
    return list.filter(
      (a) =>
        a.account_number?.toLowerCase().includes(q) ||
        getBranchLabel(a.branch).toLowerCase().includes(q),
    );
  })();

  const accountLastPage = Math.max(1, Math.ceil(filteredAccounts.length / accountPageSize));
  const safeAccountPage = Math.min(accountPage, accountLastPage);

  const paginatedAccounts = (() => {
    const start = (safeAccountPage - 1) * accountPageSize;
    return filteredAccounts.slice(start, start + accountPageSize);
  })();

  // ─── Transfer Logic ────────────────────────────────────────────────────────

  const senderAccount = accounts.find((a) => a.id === Number(transferForm.sender_account_id));
  const receiverAccount = accounts.find((a) => a.id === Number(transferForm.receiver_account_id));

  const savingsSenderAccount = accounts.find((a) => a.id === Number(savingsForm.sender_account_id));
  const selectedJamgarma = jamgarmas.find((j) => j.id === Number(savingsForm.jamgarma_id));

  // Jamg'armaga o'tkazma: hisob raqam alohida tanlanmaydi — jamg'arma filialining naqd va naqdsiz hisoblaridan biri
  // tanlanadi. Backend o'tkazmani manba hisob turiga qarab jamg'armaning naqd yoki naqdsiz balansiga qo'shadi.
  const savingsBranchId = selectedJamgarma ? branchIdOfAccount(selectedJamgarma) : undefined;
  const savingsBranchAccounts =
    savingsBranchId == null
      ? []
      : accounts.filter(
          (a) =>
            String(branchIdOfAccount(a)) === String(savingsBranchId) &&
            a.status !== 'inactive' &&
            a.is_active !== false,
        );
  const savingsSourceOptions = [
    { key: 'cash', label: t('jamgarma.cashShort'), account: savingsBranchAccounts.find(isCashAccountType) },
    { key: 'noncash', label: t('jamgarma.nonCashShort'), account: savingsBranchAccounts.find((a) => !isCashAccountType(a)) },
  ];

  const getJamgarmaName = (j: Jamgarma) =>
    getLocalized(j, 'name', i18n.language) || j.name_uz || `Jam'garma #${j.id}`;

  // Jamg'armalar filialma-filial bor (bir xil nom bir necha filialda takrorlanadi) — tanlovda «Nom (Filial)».
  const jamgarmaOptionLabel = (j: Jamgarma) => {
    const branch = getBranchLabel(j.branch);
    return branch === '-' ? getJamgarmaName(j) : `${getJamgarmaName(j)} (${branch})`;
  };

  const handleTransferSubmit = () => {
    if (
      !transferForm.sender_account_id ||
      !transferForm.receiver_account_id ||
      !transferForm.amount
    )
      return;
    setShowConfirmTransfer(true);
  };

  const confirmTransfer = () => {
    createTransferMutation.mutate({
      sender_account_id: Number(transferForm.sender_account_id),
      receiver_account_id: Number(transferForm.receiver_account_id),
      amount: Number(transferForm.amount.replace(/\s/g, '')),
      currency: 'UZS',
      description: transferForm.description,
    });
  };

  // ─── Filtered & Paginated Data ─────────────────────────────────────────────

  const unifiedTransfers: UnifiedTransfer[] = [
    ...transfers.map((tr) => ({ ...tr, kind: 'account' as const })),
    ...jamgarmaTransfers.map((tr) => ({ ...tr, kind: 'jamgarma' as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const transfersLoading = transfersListLoading || jamgarmaTransfersLoading;

  // `source_account`/`destination_account` refs on a transfer don't carry
  // `branch_id` (backend only sends account_number/type/balance there) — so
  // the branch is looked up from the full `accounts` list by account id.
  const accountBranchId = (accountId: number | undefined): number | undefined =>
    accountId == null ? undefined : branchIdOfAccount(accounts.find((a) => a.id === accountId));

  const filteredTransfers = (() => {
    let list = unifiedTransfers;
    if (transferBranchFilter) {
      // Transfer filialga tegishli: chiqaruvchi hisob YOKI (hisoblar aro transferda) qabul qiluvchi hisob shu filialniki
      list = list.filter((tr) => {
        const source = accountBranchId(tr.source_account?.id);
        const destination =
          tr.kind === 'account' ? accountBranchId(tr.destination_account?.id) : undefined;
        return (
          String(source) === transferBranchFilter || String(destination) === transferBranchFilter
        );
      });
    }
    if (!transferSearch) return list;
    const q = transferSearch.toLowerCase();
    return list.filter((tr) => {
      if (tr.notes?.toLowerCase().includes(q)) return true;
      if (tr.source_account?.account_number?.toLowerCase().includes(q)) return true;
      if (tr.kind === 'account') {
        return !!tr.destination_account?.account_number?.toLowerCase().includes(q);
      }
      return getJamgarmaRefName(tr.destination_jamgarma).toLowerCase().includes(q);
    });
  })();

  const transferLastPage = Math.max(1, Math.ceil(filteredTransfers.length / transferPageSize));
  const safeTransferPage = Math.min(transferPage, transferLastPage);

  const paginatedTransfers = (() => {
    const start = (safeTransferPage - 1) * transferPageSize;
    return filteredTransfers.slice(start, start + transferPageSize);
  })();

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <section className="finances container">
      <PageTitle title={t('aside.scoreSheet')} icon="fa-building-columns" />

      {/* ── Tab Navigation ────────────────────────────────────────── */}
      <div className="fin-tabs">
        <button
          className={`fin-tab${activeTab === 'accounts' ? ' active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          <i className="fa-solid fa-building-columns" />
          {t('finance.accountsTab')}
        </button>
        <button
          className={`fin-tab${activeTab === 'transfers' ? ' active' : ''}`}
          onClick={() => setActiveTab('transfers')}
        >
          <i className="fa-solid fa-right-left" />
          {t('finance.transfersTab')}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          ACCOUNTS TAB
         ══════════════════════════════════════════════════════════════ */}
      {activeTab === 'accounts' && (
        <>
          {/* ── Create / Edit Account Modal ───────────────────────── */}
          {showCreateAccount && (
            <div className="fin-modal-overlay" onClick={closeAccountModal}>
              <div className="fin-modal" onClick={(e) => e.stopPropagation()}>
                <h3 className="fin-modal-title">
                  {editingAccount ? t('finance.editAccount') : t('finance.createAccount')}
                </h3>

                <div className="fin-form-group">
                  <label>{t('finance.selectBranch')}</label>
                  <select
                    value={accountForm.branch_id}
                    onChange={(e) => setAccountForm({ ...accountForm, branch_id: e.target.value })}
                    disabled={!!editingAccount}
                  >
                    <option value="">
                      {!editingAccount && branchesForNewAccount.length === 0
                        ? t('finance.noBranchWithoutAccounts')
                        : t('finance.branchPlaceholder')}
                    </option>
                    {(editingAccount ? branchOptions : branchesForNewAccount).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>

                {editingAccount ? (
                  // Tahrirlashda tur ko'rsatiladi (o'zgartirilmaydi)
                  <div className="fin-form-group">
                    <label>{t('finance.accountType')}</label>
                    <select value={accountForm.account_type} disabled>
                      {ACCOUNT_TYPES.map((at) => (
                        <option key={at.code} value={at.code}>
                          {at.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <InfoHint withLabel text={t('finance.accountsAutoNote')} />
                  </div>
                )}

                <div className="fin-form-group">
                  <label>{t('finance.selectTransactionMakers')}</label>
                  <MultiPicker
                    options={userOptions.map((u) => ({ value: u.id, label: u.label }))}
                    value={selectedUserIds}
                    onChange={setSelectedUserIds}
                    placeholder={t('finance.choose')}
                  />
                </div>

                <div className="fin-modal-actions">
                  <button
                    className="fin-btn-save"
                    onClick={handleAccountSubmit}
                    disabled={
                      !accountForm.branch_id ||
                      createAccountMutation.isPending ||
                      updateAccountMutation.isPending
                    }
                  >
                    {createAccountMutation.isPending || updateAccountMutation.isPending
                      ? t('finance.saving')
                      : t('finance.saveAccount')}
                  </button>
                  <button className="fin-btn-cancel" onClick={closeAccountModal} type="button">
                    {t('finance.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Delete Account Confirmation ───────────────────────── */}
          {deleteAccountId !== null && (
            <div className="fin-modal-overlay" onClick={() => setDeleteAccountId(null)}>
              <div className="fin-modal fin-modal-sm" onClick={(e) => e.stopPropagation()}>
                {deleteAccountMutation.isError && <p role="alert">{t('common.deleteError', 'O‘chirish amalga oshmadi. Qolgan yozuvlar uchun qayta urinib ko‘ring.')}</p>}
                <p className="fin-confirm-text">{t('finance.confirmDeleteAccount')}</p>
                <div className="fin-modal-actions">
                  <button
                    className="fin-btn-danger"
                    onClick={() => deleteAccountMutation.mutate(deleteAccountId)}
                    disabled={deleteAccountMutation.isPending}
                  >
                    {t('finance.confirm')}
                  </button>
                  <button className="fin-btn-cancel" onClick={() => setDeleteAccountId(null)}>
                    {t('finance.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── View Account Detail Modal ─────────────────────────── */}
          {viewingAccount && (
            <div className="fin-modal-overlay" onClick={() => setViewingAccount(null)}>
              <div className="fin-detail-modal" onClick={(e) => e.stopPropagation()}>
                <div className="fin-detail-header">
                  <i className="fa-solid fa-building-columns fin-detail-icon" />
                  <h3>{t('finance.accountDetails')}</h3>
                </div>
                <div className="fin-detail-rows">
                  <div className="fin-detail-row">
                    <span>{t('finance.id')}</span>
                    <span>{viewingAccount.id}</span>
                  </div>
                  <div className="fin-detail-row">
                    <span>{t('finance.branch')}</span>
                    <span>{getBranchLabel(viewingAccount.branch)}</span>
                  </div>
                  <div className="fin-detail-row">
                    <span>{t('finance.accountType')}</span>
                    <span>
                      {getAccountTypeName(
                        viewingAccount.account_type,
                        viewingAccount.account_type_name,
                      )}
                    </span>
                  </div>
                  <div className="fin-detail-row">
                    <span>{t('finance.accountNumber')}</span>
                    <span className="fin-mono">{viewingAccount.account_number}</span>
                  </div>
                  <div className="fin-detail-row">
                    <span>{t('finance.currentBalance')}</span>
                    <span className="fin-text-green">
                      {formatAmount(viewingAccount.balance)} UZS
                    </span>
                  </div>
                  <div className="fin-detail-row">
                    <span>{t('finance.status')}</span>
                    <span
                      className={
                        viewingAccount.status === 'active' ? 'fin-text-green' : 'fin-text-red'
                      }
                    >
                      {getAccountStatusLabel(viewingAccount.status)}
                    </span>
                  </div>
                  <div className="fin-detail-row">
                    <span>{t('finance.createdAt')}</span>
                    <span>{formatDate(viewingAccount.created_at)}</span>
                  </div>
                  {viewingAccount.transfer_makers && viewingAccount.transfer_makers.length > 0 && (
                    <div className="fin-detail-row fin-detail-row-signatories">
                      <span>{t('finance.transferMakers')}</span>
                      <div className="fin-signatory-list-view">
                        {viewingAccount.transfer_makers.map((tm) => (
                          <span key={tm.id} className="fin-signatory-tag">
                            {tm.full_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="fin-status-change-section">
                  <div className="fin-form-group">
                    <label>{t('finance.accountStatus')}</label>
                    <select
                      value={viewStatusChange}
                      onChange={(e) => {
                        setViewStatusChange(e.target.value);
                        setViewStatusNote('');
                      }}
                    >
                      <option value="">{t('finance.selectStatusChange')}</option>
                      {viewingAccount.status !== 'active' && (
                        <option value="active">{t('finance.statusActive')}</option>
                      )}
                      {viewingAccount.status !== 'inactive' && (
                        <option value="inactive">{t('finance.statusInactive')}</option>
                      )}
                    </select>
                  </div>

                  {viewStatusChange && (
                    <>
                      <div className="fin-form-group">
                        <label>{t('finance.statusChangedAt')}</label>
                        <input
                          type="text"
                          readOnly
                          value={(() => {
                            const now = new Date();
                            return `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
                          })()}
                          className="fin-readonly-input"
                        />
                      </div>
                      <div className="fin-form-group">
                        <label>{t('finance.statusNote')}</label>
                        <textarea
                          value={viewStatusNote}
                          onChange={(e) => setViewStatusNote(e.target.value)}
                          rows={3}
                          placeholder={t('finance.statusNotePlaceholder')}
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
                          id: viewingAccount.id,
                          status: viewStatusChange,
                          note: viewStatusNote,
                        })
                      }
                    >
                      {changeStatusMutation.isPending
                        ? t('finance.saving')
                        : t('finance.saveStatus')}
                    </button>
                  )}
                  <button
                    className="fin-btn-cancel"
                    onClick={() => {
                      setViewingAccount(null);
                      setViewStatusChange('');
                      setViewStatusNote('');
                    }}
                  >
                    {t('finance.close')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Accounts Toolbar ──────────────────────────────────── */}
          <div className="fin-toolbar">
            <select
              value={accountBranchFilter}
              onChange={(e) => {
                setAccountBranchFilter(e.target.value); setSelectedIds([]);
                setAccountPage(1);
              }}
            >
              <option value="">{t('finance.branch', 'Filial')}</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <div className="fin-search-box">
              <input
                placeholder={t('finance.searchPlaceholder')}
                value={accountSearch}
                onChange={(e) => {
                  setAccountSearch(e.target.value); setSelectedIds([]);
                  setAccountPage(1);
                }}
              />
              <i className="fa-solid fa-magnifying-glass" />
            </div>
            <Protected permission="chart_of_accounts.create">
              <button className="fin-btn-add" onClick={() => setShowCreateAccount(true)}>
                {t('finance.addAccount')}
              </button>
            </Protected>
            <Protected permission="chart_of_accounts.delete">
              <button className="fin-btn-danger" disabled={selectedIds.length === 0 || deleteAccountMutation.isPending} onClick={() => setDeleteAccountId('selected')}>{t('branches.delete')}</button>
            </Protected>
          </div>

          {/* ── Accounts Table ────────────────────────────────────── */}
          <div className="fin-table-wrapper">
            <table className="fin-table">
              <thead>
                <tr>
                  <Protected permission="chart_of_accounts.delete"><th><input type="checkbox" aria-label={t('branches.delete')} checked={paginatedAccounts.length > 0 && paginatedAccounts.every(row => selectedIds.includes(row.id))} onChange={e => setSelectedIds(e.target.checked ? paginatedAccounts.map(row => row.id) : [])} /></th></Protected>
                  <th>{t('finance.id')}</th>
                  <th>{t('finance.branch')}</th>
                  <th>{t('finance.accountNumber')}</th>
                  <th>{t('finance.transferMakers')}</th>
                  <th>{t('finance.balance')}</th>
                  <th>{t('finance.status')}</th>
                  <th>{t('finance.date')}</th>
                  <th>{t('finance.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {accountsLoading ? (
                  <TableSkeleton rowCount={10} columnCount={8 + (canBulkDelete ? 1 : 0)} />
                ) : paginatedAccounts.length > 0 ? (
                  paginatedAccounts.map((acc) => (
                    <tr key={acc.id}>
                      <Protected permission="chart_of_accounts.delete"><td><input type="checkbox" aria-label={String(acc.id)} checked={selectedIds.includes(acc.id)} onChange={() => setSelectedIds(prev => prev.includes(acc.id) ? prev.filter(id => id !== acc.id) : [...prev, acc.id])} /></td></Protected>
                      <td>{acc.id}</td>
                      <td className="fin-branch-cell">{getBranchLabel(acc.branch)}</td>
                      <td className="fin-account-number">{acc.account_number}</td>
                      <td className="fin-signatories-cell">{clampCell(getTransferMakersDisplay(acc))}</td>
                      <td className="fin-text-green fin-amount-cell">
                        {formatAmount(acc.balance)} UZS
                      </td>
                      <td>
                        <StatusBadge tone={statusTone(acc.status)}>
                          {getAccountStatusLabel(acc.status)}
                        </StatusBadge>
                      </td>
                      <td className="fin-date-cell">{formatDate(acc.created_at)}</td>
                      <td>
                        <div className="fin-actions">
                          {/* «Ko'rish» ruxsatsiz: ro'yxatni ko'rgan kishi qatorni ham ko'radi (bazada bunday `.show` ruxsati yo'q edi — tugma hech kimga chiqmasdi) */}
                          <button
                            className="fin-action-btn fin-action-view"
                            onClick={() => setViewingAccount(acc)}
                            title={t('finance.view')}
                          >
                            <i className="fa-solid fa-eye" />
                          </button>
                          <Protected permission="chart_of_accounts.edit">
                            <button
                              className="fin-action-btn fin-action-edit"
                              onClick={() => openEditAccount(acc)}
                              title={t('finance.edit')}
                            >
                              <i className="fa-solid fa-pen" />
                            </button>
                          </Protected>
                          <Protected permission="chart_of_accounts.delete">
                            <button
                              className="fin-action-btn fin-action-delete"
                              onClick={() => setDeleteAccountId(acc.id)}
                              title={t('finance.delete')}
                            >
                              <i className="fa-solid fa-trash" />
                            </button>
                          </Protected>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <EmptyState colSpan={8 + (canBulkDelete ? 1 : 0)} message={t('finance.noAccounts')} />
                )}
              </tbody>
            </table>
          </div>

          {/* ── Accounts Pagination ───────────────────────────────── */}
          {filteredAccounts.length > 0 && (
            <PaginationBar
              page={safeAccountPage}
              totalPages={accountLastPage}
              total={filteredAccounts.length}
              pageSize={accountPageSize}
              onPageChange={setAccountPage}
              onPageSizeChange={(size) => {
                setAccountPageSize(size);
                setAccountPage(1);
              }}
            />
          )}
        </>
      )}

      {/* ── Confirm Transfer Modal ────────────────────────────── */}
      {activeTab === 'transfers' && showConfirmTransfer && (
        <div className="fin-modal-overlay" onClick={() => setShowConfirmTransfer(false)}>
          <div className="fin-modal fin-modal-sm" onClick={(e) => e.stopPropagation()}>
            <p className="fin-confirm-text">{t('finance.confirmTransfer')}</p>
            <div className="fin-modal-actions">
              <button
                className="fin-btn-save"
                onClick={confirmTransfer}
                disabled={createTransferMutation.isPending}
              >
                {createTransferMutation.isPending ? t('finance.saving') : t('finance.confirm')}
              </button>
              <button className="fin-btn-cancel" onClick={() => setShowConfirmTransfer(false)}>
                {t('finance.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TRANSFER LIST VIEW ─────────────────────────────────── */}
      {activeTab === 'transfers' && transferView === 'list' && (
        <>
          {/* Toolbar */}
          <div className="fin-toolbar">
            <select
              value={transferBranchFilter}
              onChange={(e) => {
                setTransferBranchFilter(e.target.value);
                setTransferPage(1);
              }}
            >
              <option value="">{t('finance.branch', 'Filial')}</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <div className="fin-search-box">
              <input
                placeholder={t('finance.searchPlaceholder')}
                value={transferSearch}
                onChange={(e) => {
                  setTransferSearch(e.target.value);
                  setTransferPage(1);
                }}
              />
              <i className="fa-solid fa-magnifying-glass" />
            </div>
            {canCreateAnyTransfer && (
              <button className="fin-btn-add" onClick={() => setTransferView('select-type')}>
                {t('finance.createTransfer')}
              </button>
            )}
          </div>

          {/* Transfers Table */}
          <div className="fin-table-wrapper">
            <table className="fin-table fin-transfers-table">
              <thead>
                <tr>
                  <th>{t('finance.id')}</th>
                  <th>{t('finance.senderAccount')}</th>
                  <th>{t('finance.receiverAccount')}</th>
                  <th>{t('finance.amount')}</th>
                  <th>{t('finance.responsiblePersons')}</th>
                  <th>{t('finance.description')}</th>
                  <th>{t('finance.status')}</th>
                  <th>{t('finance.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {transfersLoading ? (
                  <TableSkeleton rowCount={10} columnCount={8} />
                ) : paginatedTransfers.length > 0 ? (
                  paginatedTransfers.map((tr) => {
                    const key = getTransferKey(tr);
                    const senderAcc = resolveTransferAccount(tr.source_account);
                    const receiverAcc =
                      tr.kind === 'account'
                        ? resolveTransferAccount(tr.destination_account)
                        : undefined;
                    const approverEntity = tr.approved_by || tr.rejected_by || tr.cancelled_by;
                    const approverDate = tr.approved_at || tr.rejected_at || tr.cancelled_at;
                    const approveMutation =
                      tr.kind === 'account'
                        ? approveTransferMutation
                        : approveJamgarmaTransferMutation;
                    const rejectMutation =
                      tr.kind === 'account'
                        ? rejectTransferMutation
                        : rejectJamgarmaTransferMutation;
                    const cancelMutation =
                      tr.kind === 'account'
                        ? cancelTransferMutation
                        : cancelJamgarmaTransferMutation;
                    const transferModule =
                      tr.kind === 'account'
                        ? 'chart_of_accounts_transfers'
                        : 'account_to_jamgarma_transfers';
                    return (
                      <tr key={key}>
                        <td>{tr.id}</td>

                        {/* Sender Account */}
                        <td>
                          <div className="fin-account-cell">
                            <span className="fin-branch-name">
                              {getBranchLabel(senderAcc?.branch)}
                            </span>
                            <span className="fin-acct-row">
                              <span className="fin-acct-number">
                                {tr.source_account?.account_number || '-'}
                              </span>
                              <span
                                className={`fin-type-badge ${
                                  isCashAccountType(senderAcc)
                                    ? 'fin-badge-cash'
                                    : 'fin-badge-noncash'
                                }`}
                              >
                                {isCashAccountType(senderAcc)
                                  ? t('finance.typeCash')
                                  : t('finance.typeNonCash')}
                              </span>
                            </span>
                          </div>
                        </td>

                        {/* Receiver Account / Jamgarma Fund */}
                        <td>
                          {tr.kind === 'account' ? (
                            <div className="fin-account-cell">
                              <span className="fin-branch-name">
                                {getBranchLabel(receiverAcc?.branch)}
                              </span>
                              <span className="fin-acct-row">
                                <span className="fin-acct-number">
                                  {tr.destination_account?.account_number || '-'}
                                </span>
                                <span
                                  className={`fin-type-badge ${
                                    isCashAccountType(receiverAcc)
                                      ? 'fin-badge-cash'
                                      : 'fin-badge-noncash'
                                  }`}
                                >
                                  {isCashAccountType(receiverAcc)
                                    ? t('finance.typeCash')
                                    : t('finance.typeNonCash')}
                                </span>
                              </span>
                            </div>
                          ) : (
                            <div className="fin-account-cell">
                              <span className="fin-branch-name">
                                {getJamgarmaRefName(tr.destination_jamgarma)}
                              </span>
                              <span className="fin-acct-row">
                                <span
                                  className={`fin-type-badge ${
                                    isCashAccountType({ account_type_name: tr.account_type_name })
                                      ? 'fin-badge-cash'
                                      : 'fin-badge-noncash'
                                  }`}
                                >
                                  {isCashAccountType({ account_type_name: tr.account_type_name })
                                    ? t('finance.typeCash')
                                    : t('finance.typeNonCash')}
                                </span>
                              </span>
                            </div>
                          )}
                        </td>

                        {/* Amount */}
                        <td className="fin-amount-cell fin-text-orange">
                          {formatAmount(tr.amount)} UZS
                        </td>

                        {/* Responsible Persons */}
                        <td className="fin-responsible-cell">
                          {tr.sent_by && (
                            <div className="fin-resp-row">
                              <span className="fin-resp-label">{t('finance.senderPerson')}:</span>
                              <span className="fin-resp-name">{tr.sent_by.full_name}</span>
                              {tr.sent_at && (
                                <span className="fin-resp-date">{formatDate(tr.sent_at)}</span>
                              )}
                            </div>
                          )}
                          {approverEntity && (
                            <div className="fin-resp-row">
                              <span className="fin-resp-label">{t('finance.approverPerson')}:</span>
                              <span className="fin-resp-name">{approverEntity.full_name}</span>
                              {approverDate && (
                                <span className="fin-resp-date">{formatDate(approverDate)}</span>
                              )}
                            </div>
                          )}
                          {!tr.sent_by && !approverEntity && '-'}
                        </td>

                        {/* Description */}
                        <td className="fin-description-cell">{tr.notes || '-'}</td>

                        {/* Status */}
                        <td>
                          <StatusBadge tone={statusTone(tr.status)}>
                            {getTransferStatusLabel(tr.status)}
                          </StatusBadge>
                        </td>

                        {/* Actions */}
                        <td>
                          {isPendingTransferStatus(tr.status) && (
                            <div className="fin-transfer-action-btns">
                              <Protected permission={`${transferModule}.approve`}>
                                <button
                                  className="fin-btn-approve"
                                  onClick={() => approveMutation.mutate(tr.id)}
                                  disabled={approveMutation.isPending}
                                >
                                  {t('finance.approve')}
                                </button>
                              </Protected>
                              <Protected permission={`${transferModule}.reject`}>
                                <button
                                  className="fin-btn-reject"
                                  onClick={() => rejectMutation.mutate(tr.id)}
                                  disabled={rejectMutation.isPending}
                                >
                                  {t('finance.reject')}
                                </button>
                              </Protected>
                              <Protected permission={`${transferModule}.cancel`}>
                                <button
                                  className="fin-btn-cancel-transfer"
                                  onClick={() => cancelMutation.mutate(tr.id)}
                                  disabled={cancelMutation.isPending}
                                >
                                  {t('finance.cancelTransfer')}
                                </button>
                              </Protected>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <EmptyState colSpan={8} message={t('finance.noTransfers')} />
                )}
              </tbody>
            </table>
          </div>

          {/* Transfers Pagination */}
          {filteredTransfers.length > 0 && (
            <PaginationBar
              page={safeTransferPage}
              totalPages={transferLastPage}
              total={filteredTransfers.length}
              pageSize={transferPageSize}
              onPageChange={setTransferPage}
              onPageSizeChange={(size) => {
                setTransferPageSize(size);
                setTransferPage(1);
              }}
            />
          )}
        </>
      )}

      {/* ── SELECT TRANSFER TYPE MODAL ───────────────────────── */}
      {activeTab === 'transfers' && transferView === 'select-type' && (
        <div className="fin-modal-overlay" onClick={() => setTransferView('list')}>
          <div className="fin-transfer-type-select" onClick={(e) => e.stopPropagation()}>
            <h3 className="fin-type-select-title">{t('finance.selectTransferType')}</h3>
            {canCreateAccountTransfer && (
              <button className="fin-type-btn" onClick={() => setTransferView('create')}>
                {t('finance.typeAccountToAccount')}
              </button>
            )}
            {canCreateSavingsTransfer && (
              <button className="fin-type-btn" onClick={() => setTransferView('savings')}>
                {t('finance.typeAccountToSavings')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── TRANSFER CREATE VIEW ──────────────────────────────── */}
      {activeTab === 'transfers' && transferView === 'create' && (
        <div className="fin-transfer-create">
          <button
            className="fin-back-btn"
            onClick={() => {
              setTransferView('select-type');
              setTransferForm({
                sender_account_id: '',
                receiver_account_id: '',
                amount: '',
                description: '',
              });
            }}
          >
            <i className="fa-solid fa-arrow-left" />
            {t('finance.back')}
          </button>

          <div className="fin-transfer-layout">
            {/* Left: Account Cards */}
            <div className="fin-transfer-cards">
              {/* Sender Card */}
              <div className="fin-account-card">
                <div className="fin-card-header">
                  <i className="fa-solid fa-building-columns fin-card-icon" />
                  <h4>{t('finance.senderAccountCard')}</h4>
                </div>
                {senderAccount ? (
                  <div className="fin-card-details">
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.id')}</span>
                      <span className="fin-card-value">{senderAccount.id}</span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.branch')}</span>
                      <span className="fin-card-value">{getBranchLabel(senderAccount.branch)}</span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.accountType')}</span>
                      <span className="fin-card-value">
                        {getAccountTypeName(
                          senderAccount.account_type,
                          senderAccount.account_type_name,
                        )}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.accountNumber')}</span>
                      <span className="fin-card-value fin-mono">
                        {senderAccount.account_number}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.currentBalance')}</span>
                      <span className="fin-card-value fin-text-green">
                        {formatAmount(senderAccount.balance)} UZS
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.status')}</span>
                      <span className="fin-card-value fin-text-green">
                        {getAccountStatusLabel(senderAccount.status)}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.createdAt')}</span>
                      <span className="fin-card-value">{formatDate(senderAccount.created_at)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="fin-card-empty">{t('finance.selectSenderFirst')}</p>
                )}
              </div>

              {/* Receiver Card */}
              <div className="fin-account-card">
                <div className="fin-card-header">
                  <i className="fa-solid fa-building-columns fin-card-icon" />
                  <h4>{t('finance.receiverAccountCard')}</h4>
                </div>
                {receiverAccount ? (
                  <div className="fin-card-details">
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.id')}</span>
                      <span className="fin-card-value">{receiverAccount.id}</span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.branch')}</span>
                      <span className="fin-card-value">
                        {getBranchLabel(receiverAccount.branch)}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.accountType')}</span>
                      <span className="fin-card-value">
                        {getAccountTypeName(
                          receiverAccount.account_type,
                          receiverAccount.account_type_name,
                        )}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.accountNumber')}</span>
                      <span className="fin-card-value fin-mono">
                        {receiverAccount.account_number}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.currentBalance')}</span>
                      <span className="fin-card-value fin-text-green">
                        {formatAmount(receiverAccount.balance)} UZS
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.status')}</span>
                      <span className="fin-card-value fin-text-green">
                        {getAccountStatusLabel(receiverAccount.status)}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.createdAt')}</span>
                      <span className="fin-card-value">
                        {formatDate(receiverAccount.created_at)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="fin-card-empty">{t('finance.selectReceiverFirst')}</p>
                )}
              </div>
            </div>

            {/* Right: Transfer Form */}
            <div className="fin-transfer-form-card">
              <div className="fin-card-header">
                <i className="fa-solid fa-building-columns fin-card-icon" />
                <h4>{t('finance.newTransfer')}</h4>
              </div>

              <div className="fin-form-group">
                <label>{t('finance.senderAccountLabel')}</label>
                <select
                  value={transferForm.sender_account_id}
                  onChange={(e) =>
                    setTransferForm({ ...transferForm, sender_account_id: e.target.value })
                  }
                >
                  <option value="">{t('finance.choose')}</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fin-form-group">
                <label>{t('finance.receiverAccountLabel')}</label>
                <select
                  value={transferForm.receiver_account_id}
                  onChange={(e) =>
                    setTransferForm({ ...transferForm, receiver_account_id: e.target.value })
                  }
                >
                  <option value="">{t('finance.choose')}</option>
                  {accounts
                    .filter((a) => a.id !== Number(transferForm.sender_account_id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {accountOptionLabel(a)}
                      </option>
                    ))}
                </select>
              </div>

              <div className="fin-form-group">
                <label>{t('finance.amount')}</label>
                <div className="fin-amount-input-wrap">
                  <input
                    type="text"
                    value={transferForm.amount}
                    onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                    placeholder="0"
                    className={
                      senderAccount &&
                      transferForm.amount &&
                      Number(transferForm.amount.replace(/\s/g, '')) > senderAccount.balance
                        ? 'fin-input-error'
                        : ''
                    }
                  />
                  <span className="fin-currency-badge">UZS</span>
                </div>
                {senderAccount &&
                  transferForm.amount &&
                  Number(transferForm.amount.replace(/\s/g, '')) > senderAccount.balance && (
                    <span className="fin-field-error">
                      {t('finance.amountExceedsBalance')}: {formatAmount(senderAccount.balance)} UZS
                    </span>
                  )}
              </div>

              <div className="fin-form-group">
                <label>{t('finance.description')}</label>
                <textarea
                  value={transferForm.description}
                  onChange={(e) =>
                    setTransferForm({ ...transferForm, description: e.target.value })
                  }
                  rows={4}
                  placeholder={t('finance.descriptionPlaceholder')}
                />
              </div>

              <button
                className="fin-btn-transfer"
                onClick={handleTransferSubmit}
                disabled={
                  !transferForm.sender_account_id ||
                  !transferForm.receiver_account_id ||
                  !transferForm.amount ||
                  (!!senderAccount &&
                    Number(transferForm.amount.replace(/\s/g, '')) > senderAccount.balance)
                }
              >
                {t('finance.sendTransfer')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── SAVINGS TRANSFER CREATE VIEW ─────────────────────── */}
      {activeTab === 'transfers' && transferView === 'savings' && (
        <div className="fin-transfer-create">
          <button
            className="fin-back-btn"
            onClick={() => {
              setTransferView('select-type');
              setSavingsForm({
                sender_account_id: '',
                jamgarma_id: '',
                amount: '',
                description: '',
              });
            }}
          >
            <i className="fa-solid fa-arrow-left" />
            {t('finance.back')}
          </button>

          {/* Confirm savings transfer modal */}
          {showConfirmSavings && (
            <div className="fin-modal-overlay" onClick={() => setShowConfirmSavings(false)}>
              <div className="fin-modal fin-modal-sm" onClick={(e) => e.stopPropagation()}>
                <p className="fin-confirm-text">{t('finance.confirmTransfer')}</p>
                <div className="fin-modal-actions">
                  <button
                    className="fin-btn-save"
                    onClick={() => {
                      createSavingsTransferMutation.mutate({
                        source_account_id: Number(savingsForm.sender_account_id),
                        destination_jamgarma_id: Number(savingsForm.jamgarma_id),
                        amount: Number(savingsForm.amount.replace(/\s/g, '')),
                        notes: savingsForm.description,
                      });
                    }}
                    disabled={createSavingsTransferMutation.isPending}
                  >
                    {createSavingsTransferMutation.isPending
                      ? t('finance.saving')
                      : t('finance.confirm')}
                  </button>
                  <button className="fin-btn-cancel" onClick={() => setShowConfirmSavings(false)}>
                    {t('finance.cancel')}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="fin-transfer-layout">
            {/* Left: Cards */}
            <div className="fin-transfer-cards">
              {/* Sender Account Card */}
              <div className="fin-account-card">
                <div className="fin-card-header">
                  <i className="fa-solid fa-building-columns fin-card-icon" />
                  <h4>{t('finance.senderAccountCard')}</h4>
                </div>
                {savingsSenderAccount ? (
                  <div className="fin-card-details">
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.id')}</span>
                      <span className="fin-card-value">{savingsSenderAccount.id}</span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.branch')}</span>
                      <span className="fin-card-value">
                        {getBranchLabel(savingsSenderAccount.branch)}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.accountType')}</span>
                      <span className="fin-card-value">
                        {getAccountTypeName(
                          savingsSenderAccount.account_type,
                          savingsSenderAccount.account_type_name,
                        )}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.accountNumber')}</span>
                      <span className="fin-card-value fin-mono">
                        {savingsSenderAccount.account_number}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.currentBalance')}</span>
                      <span className="fin-card-value fin-text-green">
                        {formatAmount(savingsSenderAccount.balance)} UZS
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.status')}</span>
                      <span className="fin-card-value fin-text-green">
                        {getAccountStatusLabel(savingsSenderAccount.status)}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.createdAt')}</span>
                      <span className="fin-card-value">
                        {formatDate(savingsSenderAccount.created_at)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="fin-card-empty">{t('finance.selectSenderFirst')}</p>
                )}
              </div>

              {/* Receiver Jamgarma Card */}
              <div className="fin-account-card">
                <div className="fin-card-header">
                  <h4>{t('finance.receiverSavingsCard')}</h4>
                </div>
                {selectedJamgarma ? (
                  <div className="fin-card-details">
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.id')}</span>
                      <span className="fin-card-value">{selectedJamgarma.id}</span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.savingsName')}</span>
                      <span className="fin-card-value">{getJamgarmaName(selectedJamgarma)}</span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.branch')}</span>
                      <span className="fin-card-value">{getBranchLabel(selectedJamgarma.branch)}</span>
                    </div>
                    {canViewJamgarmas && (
                      <div className="fin-card-row">
                        <span className="fin-card-label">{t('finance.cashBalance')}</span>
                        <span className="fin-card-value fin-text-green">
                          {formatAmount(selectedJamgarma.cash_balance ?? 0)} UZS
                        </span>
                      </div>
                    )}
                    {canViewJamgarmas && (
                      <div className="fin-card-row">
                        <span className="fin-card-label">{t('finance.nonCashBalance')}</span>
                        <span className="fin-card-value fin-text-green">
                          {formatAmount(selectedJamgarma.non_cash_balance ?? 0)} UZS
                        </span>
                      </div>
                    )}
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.status')}</span>
                      <span
                        className={`fin-card-value ${selectedJamgarma.status === 'active' ? 'fin-text-green' : 'fin-text-red'}`}
                      >
                        {getAccountStatusLabel(selectedJamgarma.status)}
                      </span>
                    </div>
                    <div className="fin-card-row">
                      <span className="fin-card-label">{t('finance.createdAt')}</span>
                      <span className="fin-card-value">
                        {formatDate(selectedJamgarma.created_at)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="fin-card-empty">{t('finance.selectSavingsFirst')}</p>
                )}
              </div>
            </div>

            {/* Right: Savings Transfer Form */}
            <div className="fin-transfer-form-card">
              <div className="fin-card-header">
                <i className="fa-solid fa-piggy-bank fin-card-icon" />
                <h4>{t('finance.newTransfer')}</h4>
              </div>

              <div className="fin-form-group">
                <label>{t('finance.savingsLabel')}</label>
                <select
                  value={savingsForm.jamgarma_id}
                  onChange={(e) =>
                    setSavingsForm({ ...savingsForm, jamgarma_id: e.target.value, sender_account_id: '' })
                  }
                >
                  <option value="">{t('finance.choose')}</option>
                  {jamgarmas.map((j) => (
                    <option key={j.id} value={j.id}>
                      {jamgarmaOptionLabel(j)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="fin-form-group">
                <label>{t('finance.savingsSource')}</label>
                <select
                  value={savingsForm.sender_account_id}
                  disabled={!selectedJamgarma}
                  onChange={(e) =>
                    setSavingsForm({ ...savingsForm, sender_account_id: e.target.value })
                  }
                >
                  <option value="">
                    {selectedJamgarma ? t('finance.choose') : t('finance.savingsSourceFirst')}
                  </option>
                  {savingsSourceOptions.map((o) => (
                    <option key={o.key} value={o.account?.id ?? ''} disabled={!o.account}>
                      {o.account
                        ? `${accountOptionLabel(o.account)} — ${formatAmount(o.account.balance)} UZS`
                        : `${o.label} — ${t('finance.noAccountOfType')}`}
                    </option>
                  ))}
                </select>
                {selectedJamgarma && savingsBranchAccounts.length === 0 && (
                  <span className="fin-field-error">{t('finance.noBranchAccounts')}</span>
                )}
              </div>

              <div className="fin-form-group">
                <label>{t('finance.amount')}</label>
                <div className="fin-amount-input-wrap">
                  <input
                    type="text"
                    value={savingsForm.amount}
                    onChange={(e) => setSavingsForm({ ...savingsForm, amount: e.target.value })}
                    placeholder="0"
                    className={
                      savingsSenderAccount &&
                      savingsForm.amount &&
                      Number(savingsForm.amount.replace(/\s/g, '')) > savingsSenderAccount.balance
                        ? 'fin-input-error'
                        : ''
                    }
                  />
                  <span className="fin-currency-badge">UZS</span>
                </div>
                {savingsSenderAccount &&
                  savingsForm.amount &&
                  Number(savingsForm.amount.replace(/\s/g, '')) > savingsSenderAccount.balance && (
                    <span className="fin-field-error">
                      {t('finance.amountExceedsBalance')}:{' '}
                      {formatAmount(savingsSenderAccount.balance)} UZS
                    </span>
                  )}
              </div>

              <div className="fin-form-group">
                <label>{t('finance.description')}</label>
                <textarea
                  value={savingsForm.description}
                  onChange={(e) => setSavingsForm({ ...savingsForm, description: e.target.value })}
                  rows={4}
                  placeholder={t('finance.descriptionPlaceholder')}
                />
              </div>

              <button
                className="fin-btn-transfer"
                onClick={() => setShowConfirmSavings(true)}
                disabled={
                  !savingsForm.sender_account_id ||
                  !savingsForm.jamgarma_id ||
                  !savingsForm.amount ||
                  (!!savingsSenderAccount &&
                    Number(savingsForm.amount.replace(/\s/g, '')) > savingsSenderAccount.balance)
                }
              >
                {t('finance.sendTransfer')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default Finances;
