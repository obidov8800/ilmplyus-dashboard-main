import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { API } from '../../api/api';
import '../users/users.css';
import './teachers.css';
import { useTranslation } from 'react-i18next';
import type { Contract } from '../../types';
import { Protected } from '../../components/Protected';
import { useOptions } from '../../hooks/useOptions';
import { useTableColumns } from '../../hooks/useTableColumns';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ContractsCreate } from '../contracts/ContractsCreate';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import { ActiveBadge } from '@/components/StatusBadge';

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

interface TableRowProps {
  row: Contract;
  isSelected: boolean;
  onToggle: (id: number) => void;
  branchName: string;
  isVisible: (colId: string) => boolean;
  visibleColumns: string[];
  onEdit: (row: Contract) => void;
  onDelete: (row: Contract) => void;
}

function TableRow({
  row,
  isSelected,
  onToggle,
  branchName,
  isVisible,
  visibleColumns,
  onEdit,
  onDelete,
}: TableRowProps) {
  const { t } = useTranslation();
  const emp = row.employee;

  const isActive = row.status === 'active';

  const renderCell = (colId: string) => {
    switch (colId) {
      case 'full_name':
        return (
          emp?.full_name ||
          `${emp?.last_name ?? ''} ${emp?.first_name ?? ''} ${emp?.middle_name ?? ''}`.trim() ||
          '-'
        );
      case 'branch':
        return branchName || '-';
      case 'phone':
        return emp?.phone || '-';
      case 'status':
        return (
          <ActiveBadge
            active={isActive}
            activeLabel={t('teachers.statusActive')}
            inactiveLabel={t('teachers.statusInactive')}
          />
        );
      case 'created_at':
        return formatDate(row.created_at);
      case 'updated_at':
        return formatDate(row.updated_at);
      default:
        return '-';
    }
  };

  return (
    <tr style={isSelected ? { background: '#eef4ff' } : undefined}>
      <td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(row.id)}
          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#003366' }}
        />
      </td>
      {isVisible('id') && (
        <td style={{ fontWeight: 600, color: '#003366' }}>{row.id}</td>
      )}
      {visibleColumns.map((colId) => (
        <td key={colId} style={colId === 'full_name' ? { textAlign: 'left' } : undefined}>
          {renderCell(colId)}
        </td>
      ))}
      <td>
        <div className="actions">
          <Protected permission="employee_contracts.edit">
            <button
              type="button"
              className="user-edit-btn"
              title={t('teachers.editTooltip')}
              onClick={() => onEdit(row)}
            >
              <i className="fa-solid fa-pen" />
            </button>
          </Protected>
          <Protected permission="employee_contracts.delete">
            <button
              type="button"
              className="user-delete-btn"
              title={t('teachers.deleteTooltip')}
              onClick={() => onDelete(row)}
            >
              <i className="fa-solid fa-trash" />
            </button>
          </Protected>
        </div>
      </td>
    </tr>
  );
}

interface TableProps {
  rows: Contract[];
  selectedIds: Set<number>;
  onToggleOne: (id: number) => void;
  onToggleAll: () => void;
  branchMap: Map<number, string>;
  sortAsc: boolean;
  onToggleSort: () => void;
  onEdit: (row: Contract) => void;
  onDelete: (row: Contract) => void;
}

function Table({
  rows,
  selectedIds,
  onToggleOne,
  onToggleAll,
  branchMap,
  sortAsc,
  onToggleSort,
  onEdit,
  onDelete,
}: TableProps) {
  const { t } = useTranslation();
  const { isVisible, visibleColumns } = useTableColumns('teachers');
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = rows.some((r) => selectedIds.has(r.id)) && !allSelected;
  const cbRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (cbRef.current) cbRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className="users-table-wrapper">
      <table className="users-table">
        <thead>
          <tr>
            <th style={{ width: 46 }}>
              <input
                ref={cbRef}
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#003366' }}
              />
            </th>
            {isVisible('id') && (
              <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={onToggleSort}>
                {t('teachers.tableId')} {sortAsc ? '↑' : '↓'}
              </th>
            )}
            {visibleColumns.map((colId) => (
              <th key={colId}>{columnHeader(colId)}</th>
            ))}
            <th>{t('teachers.tableActions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              row={row}
              isSelected={selectedIds.has(row.id)}
              onToggle={onToggleOne}
              branchName={branchMap.get(row.employee?.branch_id ?? 0) ?? '-'}
              isVisible={isVisible}
              visibleColumns={visibleColumns}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Teachers() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [branchFilter, setBranchFilter] = useState('');
  const [editTarget, setEditTarget] = useState<{ employeeId: number; contractId: number } | null>(
    null,
  );

  const {
    data: contractsData,
    isLoading,
    isError,
  } = useQuery<Contract[]>({
    queryKey: ['contracts', 'teachers'],
    queryFn: async () => {
      const { data } = await API.get('/contracts');
      const list: Contract[] = Array.isArray(data) ? data : (data?.data ?? []);
      return list.filter((c) => c.department_id === 1);
    },
  });

  const { data: branches } = useOptions('branches');

  // Tahrirlash/o'chirish — o'qituvchi = `department_id: 1` bo'lgan shartnoma;
  // shu sabab shartnoma sahifasidagi bilan aynan bir xil ishlaydi.
  const deleteMutation = useMutation({
    mutationFn: ({ employeeId, contractId }: { employeeId: number; contractId: number }) =>
      API.delete(`/employees/${employeeId}/contracts/${contractId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const handleEdit = useCallback((row: Contract) => {
    const employeeId = row.employee?.id;
    if (!employeeId) return;
    setEditTarget({ employeeId, contractId: row.id });
  }, []);

  const [pendingDelete, setPendingDelete] = useState<{
    employeeId: number;
    contractId: number;
  } | null>(null);

  const handleDelete = useCallback((row: Contract) => {
    const employeeId = row.employee?.id;
    if (!employeeId) return;
    setPendingDelete({ employeeId, contractId: row.id });
  }, []);

  const branchMap = useMemo(() => {
    const map = new Map<number, string>();
    (branches ?? []).forEach((b) => map.set(b.id, b.label));
    return map;
  }, [branches]);

  const sortedData = useMemo(
    () =>
      (contractsData ?? [])
        .filter((c) => !branchFilter || String(c.employee?.branch_id) === branchFilter)
        .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id)),
    [contractsData, branchFilter, sortAsc],
  );

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, safePage, pageSize]);

  const handleToggleOne = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSel = paginatedData.every((r) => prev.has(r.id));
      const next = new Set(prev);
      paginatedData.forEach((r) => (allSel ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }, [paginatedData]);

  if (editTarget) {
    return (
      <ContractsCreate
        employeeId={editTarget.employeeId}
        contractId={editTarget.contractId}
        onCancel={() => setEditTarget(null)}
        onSuccess={() => {
          setEditTarget(null);
          queryClient.invalidateQueries({ queryKey: ['contracts'] });
        }}
      />
    );
  }

  return (
    <section className="users container">
      <h1 className="main-title">{t('teachers.title')}</h1>

      <ConfirmDeleteModal
        open={!!pendingDelete}
        title={t('teachers.deleteConfirm', { defaultValue: t('contracts.deleteConfirm') })}
        busy={deleteMutation.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
          setPendingDelete(null);
        }}
      />

      <div className="users-filters">
        <Protected permission="employee_contracts.create">
          <button
            type="button"
            className="add-new-user"
            onClick={() => navigate('/contracts/create')}
          >
            {t('teachers.add')}
          </button>
        </Protected>
        <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="">{t('teachers.tableBranch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#7a8fa6' }}>
          {t('teachers.loading')}
        </div>
      )}
      {isError && (
        <div style={{ padding: 40, textAlign: 'center', color: '#e70a0a' }}>
          {t('teachers.error')}
        </div>
      )}
      {!isLoading && !isError && sortedData.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: '#7a8fa6' }}>
          {t('teachers.noData')}
        </div>
      )}

      {!isLoading && !isError && sortedData.length > 0 && (
        <Table
          rows={paginatedData}
          selectedIds={selectedIds}
          onToggleOne={handleToggleOne}
          onToggleAll={handleToggleAll}
          branchMap={branchMap}
          sortAsc={sortAsc}
          onToggleSort={() => setSortAsc((p) => !p)}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}

      {!isLoading && !isError && sortedData.length > 0 && (
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          total={sortedData.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
        />
      )}
    </section>
  );
}
