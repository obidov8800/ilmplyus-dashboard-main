import { useBulkDelete } from '@/hooks/useBulkDelete';
import { usePermission } from '@/hooks/usePermission';
import { useDeferredValue, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import '../users/users.css';
import './preschoolContract.css';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import PaginationBar from '../../components/Pagination/PaginationBar';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import { Protected } from '../../components/Protected';
import { useOptions } from '@/api/options';
import { useContractSms } from '@/hooks/useContractSms';
import { deletePreschoolContract, fetchPreschoolContracts } from '@/api/preschoolContracts';
import { notifySuccess } from '@/utils/notify';
import { PRESCHOOL_CONTRACT_PERMISSIONS as PERM, type PreschoolContract } from '@/types/preschoolContract.types';
import { branchName, contractRepresentatives, formatContractDate as formatDate, personName } from '@/utils/preschoolContractView';
import PreschoolContractView from './PreschoolContractView';

/*
 * Maktabga tayyorlov shartnomalari ro'yxati: qidiruv, sahifalash, ko'rish, o'chirish.
 * Yaratish — `/preschool-contracts/new`.
 */

const COLUMNS = 9;

/** Backend `PATCH /student-contracts/{id}/status` qabul qiladigan holatlar. */
const CONTRACT_STATUSES = ['in_progress', 'active', 'completed', 'expired', 'cancelled'] as const;

const PreschoolContracts = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const created = (location.state as { created?: string } | null)?.created;

  // «Shartnoma yaratildi» — sahifa ichidagi blok emas, o'ng tepadagi bildirishnoma. Router holati tozalanadi,
  // aks holda sahifa yangilanganda xabar qayta chiqadi.
  useEffect(() => {
    if (!created) return;
    notifySuccess(t('preschoolContracts.created', { number: created }));
    navigate(location.pathname, { replace: true, state: null });
  }, [created, t, navigate, location.pathname]);

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [yearFilter, setYearFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewItem, setViewItem] = useState<PreschoolContract | null>(null);
  const [deleteItem, setDeleteItem] = useState<PreschoolContract | null>(null);

  const { data: years } = useOptions('academic_years');
  const { data: branches } = useOptions('branches', { type: 'preschool' });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['preschool-contracts', page, pageSize, deferredSearch, yearFilter, branchFilter, statusFilter],
    queryFn: () =>
      fetchPreschoolContracts({
        page,
        perPage: pageSize,
        search: deferredSearch,
        academicYearId: yearFilter,
        branchId: branchFilter,
        status: statusFilter,
      }),
    placeholderData: keepPreviousData,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePreschoolContract(id),
    onSuccess: () => {
      setDeleteItem(null);
      queryClient.invalidateQueries({ queryKey: ['preschool-contracts'] });
    },
  });

  // Tasdiqlash SMS'ini qayta yuborish — backend birinchi vakil telefoniga yuboradi (`StudentContractController::sendSms`).
  const contractSms = useContractSms();
  const smsPhone = (c: PreschoolContract): string => c.representative?.phone || contractRepresentatives(c)[0]?.phone || '';

  const rows = data?.data ?? [];
  const bulkAllowed = usePermission(PERM.delete);
  const bulk = useBulkDelete({ rows: rows, allowed: bulkAllowed, scope: JSON.stringify([page, pageSize, deferredSearch, yearFilter, branchFilter, statusFilter]), remove: row => deletePreschoolContract(row.id), refresh: () => queryClient.invalidateQueries({ queryKey: ['preschool-contracts'] }) });
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.last_page ?? 1);

  return (
    <section className="users container">
      <h1 className="main-title">{t('preschoolContracts.title')}</h1>

      {bulk.modal}
      <div className="users-filters">
        {bulk.button}
        <Protected permission={PERM.create}>
          <button className="add-new-user" onClick={() => navigate('/preschool-contracts/new')}>
            {t('preschoolContracts.addNew')}
          </button>
        </Protected>
        <input
          type="text"
          className="psc-search"
          value={search}
          placeholder={t('preschoolContracts.searchPlaceholder')}
          aria-label={t('preschoolContracts.searchPlaceholder')}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={yearFilter}
          aria-label={t('preschoolContracts.filters.year')}
          onChange={(e) => {
            setYearFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('preschoolContracts.filters.allYears')}</option>
          {(years ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.label}
            </option>
          ))}
        </select>
        <select
          value={branchFilter}
          aria-label={t('preschoolContracts.filters.branch')}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('preschoolContracts.filters.allBranches')}</option>
          {(branches ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          aria-label={t('preschoolContracts.filters.status')}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('preschoolContracts.filters.allStatuses')}</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`preschoolContracts.statuses.${s}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table psc-table">
          <thead>
            <tr>
              {bulk.header}
              <th>ID</th>
              <th>{t('preschoolContracts.columns.number')}</th>
              <th>{t('preschoolContracts.columns.student')}</th>
              <th>{t('preschoolContracts.columns.representative')}</th>
              <th>{t('studentsContract.table.group')}</th>
              <th>{t('preschoolContracts.columns.branch')}</th>
              <th>{t('preschoolContracts.columns.date')}</th>
              <th>{t('preschoolContracts.columns.status')}</th>
              <th>{t('preschoolContracts.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={6} columnCount={COLUMNS + bulk.columnCount} />
            ) : isError ? (
              <EmptyState colSpan={COLUMNS + bulk.columnCount} message={t('preschoolContracts.loadError')} />
            ) : rows.length > 0 ? (
              rows.map((c) => (
                <tr key={c.id}>
                    {bulk.cell(c)}
                  <td>{c.id}</td>
                  <td>{c.contract_number}</td>
                  <td>{personName(c.contract_students?.[0])}</td>
                  <td>{personName(contractRepresentatives(c)[0])}</td>
                  <td>{c.contract_students?.[0]?.group?.name || '—'}</td>
                  <td>{branchName(c.branch, i18n.language)}</td>
                  <td>{formatDate(c.contract_date)}</td>
                  <td>
                    <span className={`psc-status psc-status--${c.status}`}>
                      {t(`preschoolContracts.statuses.${c.status}`, { defaultValue: c.status })}
                    </span>
                  </td>
                  <td className="actions">
                    <Protected permission="preschool_contracts.show">
                      <button
                        type="button"
                        className="user-view-btn"
                        title={t('preschoolContracts.view')}
                        aria-label={t('preschoolContracts.view')}
                        onClick={() => setViewItem(c)}
                      >
                        <i className="fa-solid fa-eye" />
                      </button>
                    </Protected>
                    <Protected permission={PERM.edit}>
                      <button
                        type="button"
                        className="user-edit-btn"
                        title={t('contractSms.action')}
                        aria-label={t('contractSms.action')}
                        disabled={contractSms.sendingId === c.id}
                        onClick={() =>
                          contractSms.ask({
                            id: c.id,
                            number: c.contract_number,
                            phone: smsPhone(c),
                            confirmed: c.status === 'active',
                          })
                        }
                      >
                        <i className={contractSms.sendingId === c.id ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-paper-plane'} />
                      </button>
                    </Protected>
                    <Protected permission={PERM.delete}>
                      <button
                        type="button"
                        className="user-delete-btn"
                        title={t('preschoolContracts.delete')}
                        aria-label={t('preschoolContracts.delete')}
                        onClick={() => setDeleteItem(c)}
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={COLUMNS + bulk.columnCount} message={t('preschoolContracts.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={Math.min(page, totalPages)}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {viewItem && <PreschoolContractView contract={viewItem} onClose={() => setViewItem(null)} />}
      {contractSms.modal}

      <ConfirmDeleteModal
        open={deleteItem !== null}
        message={t('preschoolContracts.deleteMessage', { number: deleteItem?.contract_number ?? '' })}
        busy={deleteMutation.isPending}
        onConfirm={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
        onCancel={() => setDeleteItem(null)}
      />
    </section>
  );
};

export default PreschoolContracts;
