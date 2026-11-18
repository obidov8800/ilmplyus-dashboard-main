import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/utils/date';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import PaginationBar from '../../components/Pagination/PaginationBar';
import '../users/users.css';

type TrashItem = Record<string, unknown> & { id: number };

type TrashGroup = {
  type: string;
  count: number;
  data: TrashItem[];
};

type TrashAllData = Record<string, TrashGroup>;

type PaginatedTrash = {
  type: string;
  // Backend `.data` ichida tekis Laravel paginatori qaytaradi
  // (`current_page`, `data`, `last_page`, `per_page`, `total` — `meta` obyekti YO'Q).
  data: {
    data: TrashItem[];
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
};

const PER_PAGE = 20;

const getDisplayName = (type: string, item: TrashItem): string => {
  if (type === 'lids') {
    const first = item.first_name ?? '';
    const last = item.last_name ?? '';
    return `${last} ${first}`.trim() || '-';
  }
  if (type === 'student_contracts' || type === 'employee_contracts') {
    return String(item.contract_number ?? '-');
  }
  if (typeof item.full_name === 'string') return item.full_name;
  if (typeof item.name === 'string') return item.name;
  if (typeof item.name_uz === 'string') return item.name_uz;
  if (typeof item.name_ru === 'string') return item.name_ru;
  if (typeof item.name_en === 'string') return item.name_en;
  if (typeof item.title === 'string') return item.title;
  if (item.date) return formatDate(item.date);
  return String(item.id);
};

const formatDate = (val: unknown) => formatDateTime(val as string | null | undefined, '-');

const TrashPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [confirmItem, setConfirmItem] = useState<{ type: string; id: number } | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PER_PAGE);
  const markedRef = useRef(new Set<string>());

  // All types with counts for tabs
  const { data: allData, isLoading: isLoadingAll } = useQuery<TrashAllData>({
    queryKey: ['trash-groups'],
    queryFn: async () => {
      const { data } = await API.get('/trash');
      return data as TrashAllData;
    },
  });

  // Unviewed counts per type for red badges
  const { data: unviewedData } = useQuery<{ unviewed_count: number; by_type: Record<string, number> }>({
    queryKey: ['trash-unviewed-count'],
    queryFn: async () => {
      const { data } = await API.get('/trash/unviewed-count', { silentError: true });
      return data;
    },
  });

  const tabs = Object.entries(allData ?? {}).filter(([, group]) => group.count > 0);
  const activeTab = selectedTab || tabs[0]?.[0] || '';

  // Paginated data for the active tab
  const { data: tabData, isLoading: isLoadingTab } = useQuery<PaginatedTrash>({
    queryKey: ['trash-paginated', activeTab, page, pageSize],
    queryFn: async () => {
      const { data } = await API.get('/trash', {
        params: { type: activeTab, per_page: pageSize, page },
      });
      return data as PaginatedTrash;
    },
    enabled: !!activeTab,
  });

  const paginator = tabData?.data;
  const activeItems: TrashItem[] = paginator?.data ?? [];
  const totalPages = paginator?.last_page ?? 1;
  const total = paginator?.total ?? 0;

  // Mark visible items as viewed
  useEffect(() => {
    if (!activeItems.length || !activeTab) return;
    const toMark = activeItems.filter(
      (item) => !markedRef.current.has(`${activeTab}:${item.id}`),
    );
    if (!toMark.length) return;
    toMark.forEach((item) => {
      markedRef.current.add(`${activeTab}:${item.id}`);
      API.post('/trash/mark-viewed', { type: activeTab, id: item.id }).catch(() => {});
    });
    queryClient.invalidateQueries({ queryKey: ['trash-unviewed-count'] });
  }, [activeItems, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const restoreMutation = useMutation({
    mutationFn: async ({ id, type }: { id: number; type: string }) => {
      await API.post('/trash/restore', { id, type });
    },
    onSuccess: () => {
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['trash-groups'] });
      queryClient.invalidateQueries({ queryKey: ['trash-paginated'] });
    },
  });

  const destroyMutation = useMutation({
    mutationFn: async ({ id, type }: { id: number; type: string }) => {
      await API.post('/trash/destroy', { id, type });
    },
    onSuccess: () => {
      setConfirmItem(null);
      queryClient.invalidateQueries({ queryKey: ['trash-groups'] });
      queryClient.invalidateQueries({ queryKey: ['trash-paginated'] });
    },
  });

  const isSelected = (id: number) => selected.includes(id);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? activeItems.map((i) => i.id) : []);

  const restoreSelected = () => {
    if (!activeTab) return;
    selected.filter(Boolean).forEach((id) => restoreMutation.mutate({ id, type: activeTab }));
  };

  const handleTabChange = (key: string) => {
    setSelectedTab(key);
    setSelected([]);
    setPage(1);
  };

  const handlePageChange = (p: number) => {
    setSelected([]);
    setPage(p);
  };

  const getSectionLabel = (key: string) => {
    const translated = t(`trash.types.${key}`, { defaultValue: '' });
    return translated || key.replace(/_/g, ' ');
  };

  const isLoading = isLoadingAll || (!!activeTab && isLoadingTab && !tabData);

  return (
    <section className="users container">
      <h1 className="main-title">{t('trash.title')}</h1>

      {confirmItem !== null && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('trash.confirmDestroy')}</h3>
            <div className="modal-actions">
              <button
                className="danger"
                onClick={() => destroyMutation.mutate(confirmItem)}
                disabled={destroyMutation.isPending}
              >
                {t('trash.confirm')}
              </button>
              <button className="cancel" onClick={() => setConfirmItem(null)}>
                {t('trash.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="users-filters"
        style={{
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div className="trash-tabs">
          {!isLoadingAll &&
            tabs.map(([type, group]) => {
              const unviewed = unviewedData?.by_type?.[type] ?? 0;
              return (
                <button
                  key={type}
                  className={`trash-tab${activeTab === type ? ' active' : ''}`}
                  onClick={() => handleTabChange(type)}
                >
                  {getSectionLabel(type)}
                  <span className="trash-tab-count">{group.count}</span>
                  {unviewed > 0 && (
                    <span className="trash-tab-unviewed">{unviewed}</span>
                  )}
                </button>
              );
            })}
        </div>

        <button
          className="archive-restore-all-btn"
          disabled={!selected.length || !activeTab || restoreMutation.isPending}
          onClick={restoreSelected}
        >
          <i className="fa-solid fa-rotate-left" />
          {t('trash.restoreSelected')} {selected.length > 0 && `(${selected.length})`}
        </button>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={activeItems.length > 0 && selected.length === activeItems.length}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={isLoading || activeItems.length === 0}
                />
              </th>
              <th>{t('trash.id')}</th>
              <th>{t('trash.name')}</th>
              <th>{t('trash.deletedAt')}</th>
              <th>{t('trash.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={6} columnCount={5} />
            ) : tabs.length === 0 ? (
              <EmptyState colSpan={5} message={t('trash.noData')} />
            ) : activeItems.length === 0 ? (
              <EmptyState colSpan={5} message={t('trash.noData')} />
            ) : (
              activeItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isSelected(item.id)}
                      onChange={() => toggleOne(item.id)}
                    />
                  </td>
                  <td>{item.id}</td>
                  <td>{getDisplayName(activeTab, item)}</td>
                  <td>{formatDate(item.deleted_at)}</td>
                  <td className="actions">
                    <button
                      className="archive-restore-btn"
                      onClick={() =>
                        activeTab &&
                        item.id &&
                        restoreMutation.mutate({ id: item.id, type: activeTab })
                      }
                      title={t('trash.restore')}
                      disabled={restoreMutation.isPending || !activeTab}
                    >
                      <i className="fa-solid fa-rotate-left" />
                    </button>
                    <Protected permission="trash.destroy">
                      <button
                        className="user-delete-btn"
                        onClick={() =>
                          activeTab &&
                          item.id &&
                          setConfirmItem({ type: activeTab, id: item.id })
                        }
                        title={t('trash.destroy')}
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
        />
      )}
    </section>
  );
};

export default TrashPage;
