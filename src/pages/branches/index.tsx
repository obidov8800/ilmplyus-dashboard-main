import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import './branches.css';
import { useTranslation } from 'react-i18next';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import BranchDetailModal from './BranchDetailModal';
import type { Branch } from './branch.types';
import { useTableColumns } from '../../hooks/useTableColumns';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { formatDateTime } from '@/utils/date';
import StatusBadge, { ActiveBadge } from '@/components/StatusBadge';
import {
  BRANCH_TYPES,
  branchTypeLabelKey,
  normalizeBranchType,
  type BranchType,
} from '@/utils/branchType';

const Branches = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { isVisible, visibleColumns } = useTableColumns('branches');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const shortDate = (iso?: string) => formatDateTime(iso, '-');

  const renderCell = (branch: Branch, colId: string) => {
    switch (colId) {
      case 'name':
        return getLocalized(branch, 'name', i18n.language);
      case 'branch_code':
        return branch.branch_code || '-';
      case 'branch_type': {
        const type = normalizeBranchType(branch.type);
        return (
          <StatusBadge tone={type === 'preschool' ? 'info' : 'neutral'}>
            {t(branchTypeLabelKey(type))}
          </StatusBadge>
        );
      }
      case 'address':
        return getLocalized(branch, 'address', i18n.language) || '-';
      case 'city':
        return branch.city || '-';
      case 'director_name':
        return branch.director_name || '-';
      case 'phone':
        return branch.phone || '-';
      case 'account_number':
        return branch.account_number || '-';
      case 'postal_code':
        return branch.postal_code || '-';
      case 'legal_name':
        return branch.legal_name || '-';
      case 'inn':
        return branch.inn || '-';
      case 'bank_name':
        return branch.bank_name || '-';
      case 'mfo':
        return branch.mfo || '-';
      case 'oked':
        return branch.oked || '-';
      case 'is_active':
        return (
          <ActiveBadge
            active={!!branch.is_active}
            activeLabel={t('branches.active')}
            inactiveLabel={t('branches.inactive')}
          />
        );
      case 'has_contract':
        return branch.has_contract ? t('branches.yes') : t('branches.no');
      case 'created_at':
        return shortDate(branch.created_at);
      case 'updated_at':
        return shortDate(branch.updated_at);
      default:
        return '-';
    }
  };
  const [selectedBranches, setSelectedBranches] = useState<number[]>([]);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<number | 'all' | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | BranchType>('');
  const [sortAsc, setSortAsc] = useState(false);
  const [viewBranch, setViewBranch] = useState<Branch | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: branchesApiData, isLoading } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await API.get('/branches');
      return Array.isArray(data) ? data : data?.data || [];
    },
  });

  const deleteBranchMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/branches/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
  });

  const filteredBranches = useMemo(() => {
    const branches = branchesApiData || [];
    return branches
      .filter((branch) =>
        getLocalized(branch, 'name', i18n.language)
          .toLowerCase()
          .includes(searchTerm.toLowerCase()),
      )
      // Ro'yxat to'liq yuklanadi (sahifalash klientda), shu sabab tur filtri ham shu yerda — `/branches?type=` ga
      // alohida so'rov va alohida kesh kerak emas.
      .filter((branch) => !typeFilter || normalizeBranchType(branch.type) === typeFilter)
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  }, [branchesApiData, searchTerm, typeFilter, i18n.language, sortAsc]);

  const branchesTotal = filteredBranches.length;
  const branchesTotalPages = Math.max(1, Math.ceil(branchesTotal / pageSize));
  const pagedBranches = useMemo(
    () => filteredBranches.slice((page - 1) * pageSize, page * pageSize),
    [filteredBranches, page, pageSize],
  );

  const toggleAllBranches = (checked: boolean) =>
    setSelectedBranches(checked ? filteredBranches.map((b) => b.id) : []);

  const toggleSingleBranch = (id: number) =>
    setSelectedBranches((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const confirmBranchDeletion = () => {
    if (deletionTarget === 'all') {
      selectedBranches.forEach((id) => deleteBranchMutation.mutate(id));
      setSelectedBranches([]);
    }
    if (typeof deletionTarget === 'number') {
      deleteBranchMutation.mutate(deletionTarget);
      setSelectedBranches((prev) => prev.filter((x) => x !== deletionTarget));
    }
    setShowDeleteConfirmation(false);
    setDeletionTarget(null);
  };

  return (
    <section className="branch-container container">
      <h1 className="branch-page-title">{t('branches.listTitle')}</h1>

      {showDeleteConfirmation && (
        <div className="branch-modal-overlay">
          <div className="branch-modal branch-small-modal">
            <h3>{t('branches.confirmDelete')}</h3>
            <div className="branch-modal-buttons">
              <button className="branch-danger-btn" onClick={confirmBranchDeletion}>
                {t('branches.confirm')}
              </button>
              <button
                className="branch-cancel-btn"
                onClick={() => setShowDeleteConfirmation(false)}
              >
                {t('branches.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewBranch && (
        <BranchDetailModal branch={viewBranch} onClose={() => setViewBranch(null)} />
      )}

      <div className="branch-filter-panel">
        <Protected permission="branches.create">
          <button className="branch-add-btn" onClick={() => navigate('/branches/add')}>
            {t('branches.addNew')}
          </button>
        </Protected>

        <Protected permission="branches.delete">
          <button
            className="branch-delete-btn"
            disabled={selectedBranches.length === 0}
            onClick={() => {
              setDeletionTarget('all');
              setShowDeleteConfirmation(true);
            }}
          >
            {t('branches.delete')}
          </button>
        </Protected>

        <select
          value={typeFilter}
          aria-label={t('branches.type')}
          onChange={(e) => {
            setTypeFilter(e.target.value as '' | BranchType);
            setPage(1);
          }}
        >
          <option value="">{t('branches.allTypes')}</option>
          {BRANCH_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(branchTypeLabelKey(type))}
            </option>
          ))}
        </select>

        <input
          placeholder={t('branches.search')}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          className="branch-search-input"
        />
      </div>

      <div className="branch-table-container">
        <table className="branch-data-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    selectedBranches.length === filteredBranches.length &&
                    filteredBranches.length > 0
                  }
                  onChange={(e) => toggleAllBranches(e.target.checked)}
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
              <th>{t('branches.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : filteredBranches.length > 0 ? (
              pagedBranches.map((branch) => (
                <tr key={branch.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedBranches.includes(branch.id)}
                      onChange={() => toggleSingleBranch(branch.id)}
                    />
                  </td>
                  {isVisible('id') && <td>{branch.id}</td>}
                  {visibleColumns.map((colId) => (
                    <td key={colId}>{renderCell(branch, colId)}</td>
                  ))}
                  <td className="branch-action-cell">
                    {/* «Ko'rish» (ko'z) — `branches.show` ruxsati bilan (Rollar sahifasidagi «Ko'rish» katakchasi). */}
                    <Protected permission="branches.show">
                      <button className="branch-view-icon" onClick={() => setViewBranch(branch)}>
                        <i className="fa-solid fa-eye"></i>
                      </button>
                    </Protected>
                    <Protected permission="branches.edit">
                      <button
                        className="branch-edit-icon"
                        onClick={() => navigate(`/branches/${branch.id}/edit`)}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>
                    <Protected permission="branches.delete">
                      <button
                        className="branch-delete-icon"
                        onClick={() => {
                          setDeletionTarget(branch.id);
                          setShowDeleteConfirmation(true);
                        }}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('branches.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={branchesTotalPages}
        total={branchesTotal}
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

export default Branches;
