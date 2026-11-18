import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { API } from '../../api/api';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { useOptions } from '../../hooks/useOptions';
import { formatDateTime } from '../../utils/date';
import '../users/users.css';
import './login-history.css';
import StatusBadge from '@/components/StatusBadge';
import type { StatusTone } from '@/utils/statusTone';

type AccountType = 'user' | 'student' | 'employee';
type LoginStatus = 'success' | 'wrong_password' | 'user_not_found' | 'inactive';
type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'api_client' | 'unknown';
type LogoutReason = 'logout' | 'terminated' | 'terminated_by_admin';

interface LoginAccount {
  type: AccountType;
  id: number;
  full_name: string;
  username: string;
  is_deleted: boolean;
}

interface LoginHistoryItem {
  id: number;
  status: LoginStatus;
  method: 'password' | 'set_password';
  username: string;
  account: LoginAccount | null;
  ip_address: string | null;
  device_type: DeviceType | null;
  platform: string | null;
  browser: string | null;
  created_at: string;
  logged_out_at: string | null;
  logout_reason: LogoutReason | null;
  terminated_by: { id: number; full_name: string } | null;
  is_session_active: boolean;
}

interface ActiveSessionItem {
  id: number;
  account: LoginAccount | null;
  is_current: boolean;
  logged_in_at: string;
  last_used_at: string;
  expires_at: string;
  ip_address: string | null;
  device_type: DeviceType | null;
  platform: string | null;
  browser: string | null;
}

// Backend bu ikkala endpoint uchun ham to'g'ridan-to'g'ri Laravel paginatorni
// qaytaradi (`{data:[...], current_page, per_page, total, last_page, ...}`) —
// `/trash` dagi kabi qo'shimcha o'rab olingan qatlam YO'Q.
interface Paginator<T> {
  data: T[];
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
}

type ConfirmAction =
  | { kind: 'one'; id: number; label: string }
  | { kind: 'all'; user_type: AccountType; user_id: number; label: string };

const PER_PAGE = 30;

const deviceIcon = (device: DeviceType | null): string => {
  switch (device) {
    case 'mobile':
      return 'fa-solid fa-mobile-screen-button';
    case 'tablet':
      return 'fa-solid fa-tablet-screen-button';
    case 'desktop':
      return 'fa-solid fa-desktop';
    case 'api_client':
      return 'fa-solid fa-code';
    default:
      return 'fa-solid fa-question';
  }
};

const statusBadgeTone = (status: LoginStatus): StatusTone => {
  if (status === 'success') return 'success';
  if (status === 'inactive') return 'warning';
  return 'danger'; // wrong_password, user_not_found
};

const LoginHistoryPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'history' | 'sessions'>('history');

  // Ikkala tab ham ishlatadigan filtrlar
  const [userType, setUserType] = useState('');
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');

  // Faqat "Kirishlar tarixi" filtrlari
  const [status, setStatus] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PER_PAGE);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const { data: branchesData } = useOptions('branches');
  const branches = branchesData ?? [];

  const resetPage = () => setPage(1);

  const historyQuery = useQuery<Paginator<LoginHistoryItem>>({
    queryKey: [
      'login-histories',
      { userType, branchId, search, status, deviceType, dateFrom, dateTo, page, pageSize },
    ],
    queryFn: async () => {
      const { data } = await API.get('/login-histories', {
        params: {
          user_type: userType || undefined,
          branch_id: branchId || undefined,
          search: search || undefined,
          status: status || undefined,
          device_type: deviceType || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          per_page: pageSize,
          page,
        },
      });
      return data as Paginator<LoginHistoryItem>;
    },
    enabled: activeTab === 'history',
    placeholderData: (prev) => prev,
  });

  const sessionsQuery = useQuery<Paginator<ActiveSessionItem>>({
    queryKey: ['active-sessions', { userType, branchId, search, page, pageSize }],
    queryFn: async () => {
      const { data } = await API.get('/active-sessions', {
        params: {
          user_type: userType || undefined,
          branch_id: branchId || undefined,
          search: search || undefined,
          per_page: pageSize,
          page,
        },
      });
      return data as Paginator<ActiveSessionItem>;
    },
    enabled: activeTab === 'sessions',
    placeholderData: (prev) => prev,
  });

  const terminateMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/active-sessions/${id}`);
    },
    onSuccess: () => {
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['active-sessions'] });
    },
  });

  const terminateAllMutation = useMutation({
    mutationFn: async ({ user_type, user_id }: { user_type: AccountType; user_id: number }) => {
      await API.post('/active-sessions/terminate-all', { user_type, user_id });
    },
    onSuccess: () => {
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['active-sessions'] });
    },
  });

  const isTerminating = terminateMutation.isPending || terminateAllMutation.isPending;

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.kind === 'one') {
      terminateMutation.mutate(confirmAction.id);
    } else {
      terminateAllMutation.mutate({ user_type: confirmAction.user_type, user_id: confirmAction.user_id });
    }
  };

  const handleTabChange = (tab: 'history' | 'sessions') => {
    setActiveTab(tab);
    resetPage();
  };

  const handlePageChange = (p: number) => setPage(p);

  const activeQuery = activeTab === 'history' ? historyQuery : sessionsQuery;
  const paginator = activeQuery.data;
  const total = paginator?.total ?? 0;
  const totalPages = paginator?.last_page ?? 1;
  const isLoading = activeQuery.isLoading;

  const renderAccount = (account: LoginAccount | null, usernameFallback: string, isCurrent?: boolean) => {
    if (!account) {
      return (
        <span className="lh-account-cell">
          <span className="lh-account-name">{usernameFallback || '-'}</span>
          <StatusBadge tone="danger">{t('loginHistory.accountNotFound')}</StatusBadge>
        </span>
      );
    }
    return (
      <span className="lh-account-cell">
        <span className="lh-account-name">
          {account.full_name}
          {isCurrent && <span className="lh-badge lh-badge--current">{t('loginHistory.currentDevice')}</span>}
          {account.is_deleted && <span className="lh-badge lh-badge--muted">{t('loginHistory.deleted')}</span>}
        </span>
        <span className="lh-account-sub">
          @{account.username} · {t(`loginHistory.accountType.${account.type}`, { defaultValue: account.type ?? '' })}
        </span>
      </span>
    );
  };

  const renderDevice = (item: { device_type: DeviceType | null; platform: string | null; browser: string | null }) => (
    <span className="lh-device-cell">
      <span className="lh-device-main">
        <i className={deviceIcon(item.device_type)} />{' '}
        {t(`loginHistory.deviceType.${item.device_type ?? 'unknown'}`, {
          defaultValue: t('loginHistory.deviceType.unknown'),
        })}
      </span>
      <span className="lh-device-sub">
        {item.platform || item.browser ? [item.platform, item.browser].filter(Boolean).join(' · ') : ' '}
      </span>
    </span>
  );

  return (
    <section className="users container login-history-page">
      <h1 className="main-title">{t('loginHistory.title')}</h1>

      {confirmAction !== null && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>
              {confirmAction.kind === 'one'
                ? t('loginHistory.confirmTerminate')
                : t('loginHistory.confirmTerminateAll')}
            </h3>
            <p className="lh-confirm-label">{confirmAction.label}</p>
            <div className="modal-actions">
              <button className="danger" onClick={handleConfirm} disabled={isTerminating}>
                {t('loginHistory.confirm')}
              </button>
              <button className="cancel" onClick={() => setConfirmAction(null)}>
                {t('loginHistory.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="trash-tabs">
        <button
          className={`trash-tab${activeTab === 'history' ? ' active' : ''}`}
          onClick={() => handleTabChange('history')}
        >
          {t('loginHistory.tabs.history')}
        </button>
        <button
          className={`trash-tab${activeTab === 'sessions' ? ' active' : ''}`}
          onClick={() => handleTabChange('sessions')}
        >
          {t('loginHistory.tabs.sessions')}
        </button>
      </div>

      <div className="users-filters">
        <select
          value={userType}
          onChange={(e) => {
            setUserType(e.target.value);
            resetPage();
          }}
        >
          <option value="">{t('loginHistory.filters.allTypes')}</option>
          <option value="user">{t('loginHistory.accountType.user')}</option>
          <option value="student">{t('loginHistory.accountType.student')}</option>
          <option value="employee">{t('loginHistory.accountType.employee')}</option>
        </select>

        <select
          value={branchId}
          onChange={(e) => {
            setBranchId(e.target.value);
            resetPage();
          }}
        >
          <option value="">{t('loginHistory.filters.allBranches')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>

        {activeTab === 'history' && (
          <>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetPage();
              }}
            >
              <option value="">{t('loginHistory.filters.allStatuses')}</option>
              <option value="success">{t('loginHistory.status.success')}</option>
              <option value="wrong_password">{t('loginHistory.status.wrong_password')}</option>
              <option value="user_not_found">{t('loginHistory.status.user_not_found')}</option>
              <option value="inactive">{t('loginHistory.status.inactive')}</option>
            </select>

            <select
              value={deviceType}
              onChange={(e) => {
                setDeviceType(e.target.value);
                resetPage();
              }}
            >
              <option value="">{t('loginHistory.filters.allDevices')}</option>
              <option value="desktop">{t('loginHistory.deviceType.desktop')}</option>
              <option value="mobile">{t('loginHistory.deviceType.mobile')}</option>
              <option value="tablet">{t('loginHistory.deviceType.tablet')}</option>
              <option value="api_client">{t('loginHistory.deviceType.api_client')}</option>
              <option value="unknown">{t('loginHistory.deviceType.unknown')}</option>
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                resetPage();
              }}
              title={t('loginHistory.filters.dateFrom')}
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                resetPage();
              }}
              title={t('loginHistory.filters.dateTo')}
            />
          </>
        )}

        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPage();
          }}
          placeholder={t('loginHistory.filters.searchPlaceholder')}
        />
      </div>

      <div className="users-table-wrapper">
        {activeTab === 'history' ? (
          <table className="users-table">
            <thead>
              <tr>
                <th>{t('loginHistory.columns.index')}</th>
                <th className="col-fullname">{t('loginHistory.columns.account')}</th>
                <th>{t('loginHistory.columns.ip')}</th>
                <th>{t('loginHistory.columns.device')}</th>
                <th>{t('loginHistory.columns.status')}</th>
                <th>{t('loginHistory.columns.loggedInAt')}</th>
                <th>{t('loginHistory.columns.loggedOutAt')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rowCount={8} columnCount={7} />
              ) : (historyQuery.data?.data ?? []).length === 0 ? (
                <EmptyState colSpan={7} message={t('loginHistory.noHistory')} />
              ) : (
                (historyQuery.data?.data ?? []).map((item, idx) => (
                  <tr key={item.id}>
                    <td>{(page - 1) * pageSize + idx + 1}</td>
                    <td>{renderAccount(item.account, item.username)}</td>
                    <td>{item.ip_address ?? '-'}</td>
                    <td>{renderDevice(item)}</td>
                    <td>
                      <StatusBadge tone={statusBadgeTone(item.status)}>
                        {t(`loginHistory.status.${item.status}`, { defaultValue: item.status ?? '-' })}
                      </StatusBadge>
                    </td>
                    <td>{formatDateTime(item.created_at)}</td>
                    <td>
                      {item.logged_out_at ? (
                        <span className="lh-device-cell">
                          <span className="lh-device-main">{formatDateTime(item.logged_out_at)}</span>
                          <span className="lh-device-sub">
                            {item.logout_reason
                              ? `${t(`loginHistory.logoutReason.${item.logout_reason}`, { defaultValue: item.logout_reason })}${
                                  item.terminated_by ? ` — ${item.terminated_by.full_name}` : ''
                                }`
                              : ' '}
                          </span>
                        </span>
                      ) : item.is_session_active ? (
                        <StatusBadge tone="success">{t('loginHistory.active')}</StatusBadge>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>{t('loginHistory.columns.index')}</th>
                <th className="col-fullname">{t('loginHistory.columns.account')}</th>
                <th>{t('loginHistory.columns.ip')}</th>
                <th>{t('loginHistory.columns.device')}</th>
                <th>{t('loginHistory.columns.loggedInAt')}</th>
                <th>{t('loginHistory.columns.lastUsedAt')}</th>
                <th>{t('loginHistory.columns.expiresAt')}</th>
                <th>{t('loginHistory.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton rowCount={8} columnCount={8} />
              ) : (sessionsQuery.data?.data ?? []).length === 0 ? (
                <EmptyState colSpan={8} message={t('loginHistory.noSessions')} />
              ) : (
                (sessionsQuery.data?.data ?? []).map((item, idx) => (
                  <tr key={item.id}>
                    <td>{(page - 1) * pageSize + idx + 1}</td>
                    <td>{renderAccount(item.account, '', item.is_current)}</td>
                    <td>{item.ip_address ?? '-'}</td>
                    <td>{renderDevice(item)}</td>
                    <td>{formatDateTime(item.logged_in_at)}</td>
                    <td>{formatDateTime(item.last_used_at)}</td>
                    <td>{formatDateTime(item.expires_at)}</td>
                    <td className="actions">
                      <Protected permission="login_histories.terminate">
                        <button
                          className="user-delete-btn"
                          title={t('loginHistory.terminate')}
                          onClick={() =>
                            setConfirmAction({
                              kind: 'one',
                              id: item.id,
                              label: item.account?.full_name ?? item.ip_address ?? '',
                            })
                          }
                        >
                          <i className="fa-solid fa-right-from-bracket" />
                        </button>
                        {item.account && (
                          <button
                            className="lh-terminate-all-btn"
                            title={t('loginHistory.terminateAll')}
                            onClick={() =>
                              item.account &&
                              setConfirmAction({
                                kind: 'all',
                                user_type: item.account.type,
                                user_id: item.account.id,
                                label: item.account.full_name,
                              })
                            }
                          >
                            <i className="fa-solid fa-power-off" />
                          </button>
                        )}
                      </Protected>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {total > 0 && (
        <PaginationBar
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={(size) => {
            setPageSize(size);
            handlePageChange(1);
          }}
          pageSizeOptions={[10, 30, 50, 100]}
        />
      )}
    </section>
  );
};

export default LoginHistoryPage;
