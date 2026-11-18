import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import { getLocalized } from '../../utils/getLocalized';
import AddCourseModal from './AddCourseModal';
import ImportPricesModal from './ImportPricesModal';
// O'chirish modali (`.modal-overlay`, `.modal small`, `.modal-title`) va
// amallar tugmalari (`.user-view-btn`, `.user-edit-btn`) `users.css`da
// e'lon qilingan. `payments.css`da ham xuddi shu klasslarning ESKI (dizayn
// birlashtirilishidan oldingi) varianti bor — shu sabab `users.css` undan
// KEYIN import qilinishi kerak, aks holda CSS kaskadida oxirgi fayl
// (`payments.css`) g'olib chiqib, modal/tugmalar eski uslubda qolib
// ketardi (border rangi, radius, shrift — boshqa sahifalardan farqli).
import '../payments/payments.css';
import '../users/users.css';
import './course-prices.css';
import { useTranslation } from 'react-i18next';
import type {
  CoursePrice,
  CoursePriceListResponse,
  CoursePricePayload,
  CoursePricePerson,
  User,
} from '../../types';
import { Protected } from '../../components/Protected';
import useAuthStore from '../../store/useAuthStore';
import { notifications } from '@mantine/notifications';
import { downloadPriceListPdf } from './priceListPdf';
import { useTableColumns } from '@/hooks/useTableColumns';
import { useCourseBranches } from '@/hooks/useCourseBranches';
import PaginationBar from '../../components/Pagination/PaginationBar';
import StatusPill from '@/components/StatusBadge';
import type { StatusTone } from '@/utils/statusTone';
import { groupDigits } from '@/utils/formatNumber';

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

function formatNarx(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(n) ? String(val) : groupDigits(n);
}

/** Kurs narxi holati — `StatusBadge` rangi. `status` bo'lmasa `approved_at`/`approved_by`ga qarab. */
const CP_STATUS_TONES: Record<string, StatusTone> = {
  pending: 'warning',
  submitted: 'info',
  approved: 'success',
  rejected: 'danger',
  old_price: 'neutral',
};

function resolveStatus(row: CoursePrice): string {
  const s = (row.status ?? '').toLowerCase();
  if (s) return s;
  return row.approved_at || row.approved_by ? 'approved' : 'pending';
}

/** Admin ommaviy/qator amali: qaysi holatdagi narxni tasdiqlash / bekor qilish (rad etish) mumkin. */
const APPROVABLE = new Set(['pending', 'submitted', 'rejected']);
const REJECTABLE = new Set(['pending', 'submitted']);
type StatusAction = 'approve' | 'reject';

function CoursePriceStatus({ row }: { row: CoursePrice }) {
  const { t } = useTranslation();
  const status = resolveStatus(row);
  const key = `coursePrices.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  const label = t(key);
  return (
    <StatusPill tone={CP_STATUS_TONES[status] ?? 'neutral'}>{label === key ? status : label}</StatusPill>
  );
}

/**
 * Relation yuklanmagan bo'lsa: id login qilgan foydalanuvchiniki bo'lsa uning ismi,
 * aks holda xom id, u ham bo'lmasa chiziqcha.
 */
function personName(
  person: CoursePricePerson | null | undefined,
  id: number | null | undefined,
  currentUser: User | null,
) {
  if (person?.full_name) return person.full_name;
  if (!id) return '—';
  if (currentUser && currentUser.id === id) return currentUser.full_name;
  return `#${id}`;
}

/* Pastki sahifalash — umumiy `PaginationBar` (barcha jadval sahifalarida bir xil). */

interface TableRowProps {
  row: CoursePrice;
  isSelected: boolean;
  onToggle: (id: number) => void;
  onView: (row: CoursePrice) => void;
  onEdit: (row: CoursePrice) => void;
  onDelete: (id: number) => void;
  onStatusAction: (action: StatusAction, ids: number[]) => void;
}

function TableRow({
  row,
  isSelected,
  onToggle,
  onView,
  onEdit,
  onDelete,
  onStatusAction,
}: TableRowProps) {
  const { t, i18n } = useTranslation();
  const { isVisible, visibleColumns } = useTableColumns('coursePrices');
  const lang = i18n.language;
  const currentUser = useAuthStore((s) => s.user);

  const rowStatus = resolveStatus(row);
  const pctColor = row.percentage > 0 ? '#27ae60' : row.percentage < 0 ? '#e70a0a' : '#333';

  return (
    <tr
      className={isSelected ? 'row-selected' : undefined}
      style={isSelected ? { background: '#eef4ff' } : undefined}
    >
      <td>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(row.id)}
          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#003366' }}
        />
      </td>
      {isVisible('id') && <td style={{ fontWeight: 600, color: '#003366' }}>{row.id}</td>}
      {visibleColumns.map((colId) => {
        switch (colId) {
          case 'course':
            return <td key={colId}>{getLocalized(row.course, 'name', lang)}</td>;
          case 'branch':
            return <td key={colId}>{getLocalized(row.branch, 'name', lang)}</td>;
          case 'level':
            return (
              <td key={colId}>
                <span
                  style={{
                    background: '#e8f0fe',
                    color: '#003366',
                    padding: '3px 10px',
                    borderRadius: 5,
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getLocalized(row.level, 'name', lang)}
                </span>
              </td>
            );
          case 'old_price':
            return <td key={colId}>{formatNarx(row.old_price)}</td>;
          case 'new_price':
            return <td key={colId}>{formatNarx(row.new_price)}</td>;
          case 'change':
            // Kursning birinchi narxida foiz yo'q (NULL) — ilgari faqat "%" belgisi chiqib qolardi.
            if (row.percentage === null || row.percentage === undefined) {
              return <td key={colId}>-</td>;
            }
            return (
              <td key={colId} style={{ color: pctColor, fontWeight: 600 }}>
                {row.percentage > 0 ? '+' : ''}
                {row.percentage}%
              </td>
            );
          case 'change_date':
            return <td key={colId}>{row.start_date ? formatDate(row.start_date) : '—'}</td>;
          case 'status':
            return (
              <td key={colId}>
                <CoursePriceStatus row={row} />
              </td>
            );
          case 'created_at':
            return <td key={colId}>{formatDate(row.created_at)}</td>;
          case 'created_by':
            return (
              <td key={colId} style={{ whiteSpace: 'nowrap' }}>
                {personName(row.creator, row.created_by, currentUser)}
              </td>
            );
          case 'approved_by':
            return (
              <td key={colId} style={{ whiteSpace: 'nowrap' }}>
                {personName(row.approver, row.approved_by, currentUser)}
              </td>
            );
          case 'approved_at':
            return <td key={colId}>{row.approved_at ? formatDate(row.approved_at) : '—'}</td>;
          case 'rejected_by':
            return (
              <td key={colId} style={{ whiteSpace: 'nowrap' }}>
                {personName(row.rejecter, row.rejected_by, currentUser)}
              </td>
            );
          default:
            return <td key={colId}>-</td>;
        }
      })}
      <td>
        <div className="actions">
          <Protected permission="course_prices.show">
            <button
              type="button"
              className="user-view-btn"
              title={t('coursePrices.viewTooltip')}
              onClick={() => onView(row)}
              style={{ color: '#003366' }}
            >
              <i className="fa-solid fa-eye" />
            </button>
          </Protected>
          {APPROVABLE.has(rowStatus) && (
            <Protected permission="course_prices.approve">
              <button
                type="button"
                className="cp-approve-btn"
                title={t('coursePrices.approveTooltip')}
                onClick={() => onStatusAction('approve', [row.id])}
              >
                <i className="fa-solid fa-check" />
              </button>
            </Protected>
          )}
          {REJECTABLE.has(rowStatus) && (
            <Protected permission="course_prices.reject">
              <button
                type="button"
                className="cp-reject-btn"
                title={t('coursePrices.rejectTooltip')}
                onClick={() => onStatusAction('reject', [row.id])}
              >
                <i className="fa-solid fa-ban" />
              </button>
            </Protected>
          )}
          <Protected permission="course_prices.edit">
            <button
              type="button"
              className="user-edit-btn"
              title={t('coursePrices.editTooltip')}
              onClick={() => onEdit(row)}
            >
              <i className="fa-solid fa-pen" />
            </button>
          </Protected>
          <Protected permission="course_prices.delete">
            <button
              type="button"
              className="payment-delete-btn"
              title={t('coursePrices.deleteTooltip')}
              onClick={() => onDelete(row.id)}
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
  rows: CoursePrice[];
  selectedIds: Set<number>;
  onToggleOne: (id: number) => void;
  onToggleAll: () => void;
  onView: (row: CoursePrice) => void;
  onEdit: (row: CoursePrice) => void;
  onDelete: (id: number) => void;
  onStatusAction: (action: StatusAction, ids: number[]) => void;
  sortAsc: boolean;
  onToggleSort: () => void;
}

function Table({
  rows,
  selectedIds,
  onToggleOne,
  onToggleAll,
  onView,
  onEdit,
  onDelete,
  onStatusAction,
  sortAsc,
  onToggleSort,
}: TableProps) {
  const { t } = useTranslation();
  const { isVisible, visibleColumns } = useTableColumns('coursePrices');
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const someSelected = rows.some((r) => selectedIds.has(r.id)) && !allSelected;
  const cbRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (cbRef.current) cbRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const columnHeader = (colId: string) => {
    switch (colId) {
      case 'course':
        return t('coursePrices.tableCourse');
      case 'branch':
        return t('coursePrices.tableBranch');
      case 'level':
        return t('coursePrices.tableLevel');
      case 'old_price':
        return t('coursePrices.tableOldPrice');
      case 'new_price':
        return t('coursePrices.tableNewPrice');
      case 'change':
        return t('coursePrices.tableChange');
      case 'change_date':
        return t('coursePrices.tableChangeDate');
      case 'status':
        return t('coursePrices.status');
      case 'created_at':
        return t('coursePrices.tableCreatedAt');
      case 'created_by':
        return t('coursePrices.tableCreatedBy');
      case 'approved_by':
        return t('coursePrices.tableApprovedBy');
      case 'approved_at':
        return t('coursePrices.tableApprovedAt');
      case 'rejected_by':
        return t('coursePrices.tableRejectedBy');
      default:
        return colId;
    }
  };

  return (
    <div className="payments-table-wrapper">
      {/* `cp-price-table` — `payments-table` klassi `payments` va `archive`
          sahifalarida ham ishlatiladi; matn kesilmasligi haqidagi qoida
          faqat shu jadvalga tegishli bo'lishi uchun alohida klass kerak. */}
      <table className="payments-table cp-price-table">
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
                {t('coursePrices.tableId')} {sortAsc ? '↑' : '↓'}
              </th>
            )}
            {visibleColumns.map((colId) => (
              <th key={colId}>{columnHeader(colId)}</th>
            ))}
            <th>{t('coursePrices.tableActions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              row={row}
              isSelected={selectedIds.has(row.id)}
              onToggle={onToggleOne}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
              onStatusAction={onStatusAction}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CoursePrices() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editItem, setEditItem] = useState<CoursePrice | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  // Tasdiqlash / bekor qilish (rad etish) — tasdiq oynasi va jarayon holati.
  const [statusDialog, setStatusDialog] = useState<{ action: StatusAction; ids: number[] } | null>(
    null,
  );
  const [rejectReason, setRejectReason] = useState('');
  const [isStatusRunning, setIsStatusRunning] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const [isPriceListLoading, setIsPriceListLoading] = useState(false);
  const [branchFilter, setBranchFilter] = useState('');
  const currentUser = useAuthStore((s) => s.user);
  // Maktabga tayyorlov filiali (PARVOZ) kurs narxiga ega emas — filtrda chiqmaydi.
  const { data: branches } = useCourseBranches();

  // `/course_prices` `per_page`ni ham, `branch_id` filtrini ham qo'llamaydi
  // (har doim 20 tadan qaytaradi). Shuning uchun barcha sahifalar bir marta
  // yuklanib, filtr + sahifalash MIJOZ tomonда qilinadi — filial filtri
  // to'g'ri ishlaydi va jadval bo'sh bo'lganда pagination chiqmaydi.
  const {
    data: allCoursePrices = [],
    isLoading,
    isError,
  } = useQuery<CoursePrice[]>({
    queryKey: ['course_prices', 'all'],
    queryFn: async () => {
      const first: CoursePriceListResponse = await API.get('/course_prices', {
        params: { page: 1 },
      }).then((r) => r.data);
      const lastPage = first.last_page ?? 1;
      if (lastPage <= 1) return first.data ?? [];
      const rest = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, i) =>
          API.get('/course_prices', { params: { page: i + 2 } }).then(
            (r) => (r.data?.data ?? []) as CoursePrice[],
          ),
        ),
      );
      return [first.data ?? [], ...rest].flat();
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: CoursePricePayload) =>
      API.post('/course_prices', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course_prices'] });
      setIsModalOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CoursePricePayload }) =>
      API.put(`/course_prices/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course_prices'] });
      setEditItem(null);
      setIsModalOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => API.delete(`/course_prices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course_prices'] });
    },
  });

  // Filtr + saralash (butun ro'yxat bo'yicha), so'ng mijoz tomonда sahifalash.
  const rows = useMemo(
    () =>
      allCoursePrices
        .filter((r) => !branchFilter || String(r.branch_id) === branchFilter)
        .slice()
        .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id)),
    [allCoursePrices, branchFilter, sortAsc],
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    [rows, safePage, pageSize],
  );

  const handleSave = useCallback(
    (payload: CoursePricePayload) => {
      if (editItem) {
        // Tahrirlashda created_by tegilmaydi — u yozuvni birinchi yaratgan shaxs bo'lib qoladi.
        updateMutation.mutate({ id: editItem.id, payload });
      } else {
        // Yaratuvchi — login qilgan foydalanuvchi.
        createMutation.mutate(currentUser ? { ...payload, created_by: currentUser.id } : payload);
      }
    },
    [editItem, createMutation, updateMutation, currentUser],
  );

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
      const allSel = pageRows.every((r) => prev.has(r.id));
      const next = new Set(prev);
      pageRows.forEach((r) => (allSel ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }, [pageRows]);

  const handleView = useCallback(
    (row: CoursePrice) => {
      navigate(`/course-prices/${row.id}`);
    },
    [navigate],
  );

  const handleEdit = useCallback((row: CoursePrice) => {
    setEditItem(row);
    setIsModalOpen(true);
  }, []);

  const handleDeleteOne = useCallback((id: number) => {
    setDeleteTargetId(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    setDeleteTargetId(null);
    setShowDeleteModal(true);
  }, []);

  const confirmDelete = useCallback(() => {
    if (deleteTargetId !== null) {
      deleteMutation.mutate(deleteTargetId);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTargetId);
        return next;
      });
    } else {
      selectedIds.forEach((id) => deleteMutation.mutate(id));
      setSelectedIds(new Set());
    }
    setShowDeleteModal(false);
    setDeleteTargetId(null);
  }, [deleteTargetId, selectedIds, deleteMutation]);

  const rowById = useMemo(() => new Map(allCoursePrices.map((r) => [r.id, r])), [allCoursePrices]);

  /** Tanlanganlardan shu amal mumkin bo'lgan holatdagilar (tasdiqlangan/eski narxga tegilmaydi). */
  const actionableIds = useCallback(
    (action: StatusAction): number[] => {
      const allowed = action === 'approve' ? APPROVABLE : REJECTABLE;
      return Array.from(selectedIds).filter((id) => {
        const row = rowById.get(id);
        return !!row && allowed.has(resolveStatus(row));
      });
    },
    [selectedIds, rowById],
  );
  const approvableCount = actionableIds('approve').length;
  const rejectableCount = actionableIds('reject').length;

  const openStatusDialog = useCallback((action: StatusAction, ids: number[]) => {
    if (!ids.length) return;
    setRejectReason('');
    setStatusDialog({ action, ids });
  }, []);

  const confirmStatusChange = useCallback(async () => {
    if (!statusDialog) return;
    const { action, ids } = statusDialog;
    setIsStatusRunning(true);
    let ok = 0;
    let failed = 0;
    const reason = rejectReason.trim();
    // Ketma-ket: backend har bir narx uchun alohida endpoint beradi (`/course_prices/{id}/approve|reject`).
    for (const id of ids) {
      try {
        const res = await API.patch(
          `/course_prices/${id}/${action}`,
          action === 'reject' && reason ? { rejection_reason: reason } : undefined,
          { silentError: true },
        );
        const applied = res.data?.data?.status;
        if (applied && applied !== (action === 'approve' ? 'approved' : 'rejected')) failed += 1;
        else ok += 1;
      } catch {
        failed += 1;
      }
    }
    setIsStatusRunning(false);
    setStatusDialog(null);
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ['course_prices'] });
    notifications.show({
      title: t(action === 'approve' ? 'coursePrices.approveConfirmTitle' : 'coursePrices.rejectConfirmTitle'),
      message: t('coursePrices.statusChangeResult', { ok, failed }),
      color: failed ? 'orange' : 'green',
    });
  }, [statusDialog, rejectReason, queryClient, t]);

  const allRowsSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const pageFullySelected = pageRows.length > 0 && pageRows.every((r) => selectedIds.has(r.id));

  // Prays-list: faqat tasdiqlangan narxlarning eng oxirgisi, print oynasisiz to'g'ridan-to'g'ri PDF.
  const handleDownloadPriceList = useCallback(async () => {
    setIsPriceListLoading(true);
    try {
      const created = await downloadPriceListPdf();
      if (!created) {
        notifications.show({
          title: t('coursePrices.priceList'),
          message: t('coursePrices.priceListEmpty'),
          color: 'orange',
        });
      }
    } catch {
      notifications.show({
        title: t('coursePrices.priceList'),
        message: t('coursePrices.priceListError'),
        color: 'red',
      });
    } finally {
      setIsPriceListLoading(false);
    }
  }, [t]);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const deleteCount = deleteTargetId !== null ? 1 : selectedIds.size;

  return (
    <section className="payments container">
      <h1 className="main-title">{t('coursePrices.mainTitle')}</h1>

      <div className="payments-filters">
        <Protected permission="course_prices.create">
          <button
            type="button"
            className="add-new-payment"
            onClick={() => {
              setEditItem(null);
              setIsModalOpen(true);
            }}
          >
            {t('coursePrices.add')}
          </button>
        </Protected>
        <Protected permission="course_prices.delete">
          <button
            type="button"
            className="delete-all"
            onClick={handleDeleteSelected}
            disabled={selectedIds.size === 0}
          >
            {t('coursePrices.delete')}
          </button>
        </Protected>
        <Protected permission="course_prices.approve">
          <button
            type="button"
            className="cp-bulk-btn cp-bulk-btn--approve"
            onClick={() => openStatusDialog('approve', actionableIds('approve'))}
            disabled={approvableCount === 0 || isStatusRunning}
            title={approvableCount === 0 ? t('coursePrices.noActionable') : undefined}
          >
            <i className="fa-solid fa-check" />
            {t('coursePrices.approveSelected')}
            {approvableCount > 0 && ` (${approvableCount})`}
          </button>
        </Protected>
        <Protected permission="course_prices.reject">
          <button
            type="button"
            className="cp-bulk-btn cp-bulk-btn--reject"
            onClick={() => openStatusDialog('reject', actionableIds('reject'))}
            disabled={rejectableCount === 0 || isStatusRunning}
            title={rejectableCount === 0 ? t('coursePrices.noActionable') : undefined}
          >
            <i className="fa-solid fa-ban" />
            {t('coursePrices.rejectSelected')}
            {rejectableCount > 0 && ` (${rejectableCount})`}
          </button>
        </Protected>
        <Protected permission="course_prices.create">
          <button type="button" className="cp-pricelist-btn" onClick={() => setIsImportOpen(true)}>
            <i className="fa-solid fa-file-excel" />
            {t('coursePrices.import.button')}
          </button>
        </Protected>
        <button
          type="button"
          className="cp-pricelist-btn"
          onClick={handleDownloadPriceList}
          disabled={isPriceListLoading}
        >
          <i
            className={isPriceListLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-pdf'}
          />
          {isPriceListLoading ? t('coursePrices.priceListLoading') : t('coursePrices.priceList')}
        </button>

        <select
          className="payment-type-select"
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="">{t('coursePrices.tableBranch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#7a8fa6' }}>
          {t('coursePrices.loading')}
        </div>
      )}
      {isError && (
        <div style={{ padding: 40, textAlign: 'center', color: '#e70a0a' }}>
          {t('coursePrices.error')}
        </div>
      )}
      {!isLoading && !isError && rows.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: '#7a8fa6' }}>
          {t('coursePrices.noData')}
        </div>
      )}

      {!isLoading && !isError && rows.length > pageRows.length && pageFullySelected && (
        <div className="cp-select-banner">
          {allRowsSelected ? (
            <>
              <span>{t('coursePrices.selectionAll', { count: rows.length })}</span>
              <button type="button" onClick={() => setSelectedIds(new Set())}>
                {t('coursePrices.clearSelection')}
              </button>
            </>
          ) : (
            <>
              <span>{t('coursePrices.selectionPage', { count: pageRows.length })}</span>
              <button type="button" onClick={() => setSelectedIds(new Set(rows.map((r) => r.id)))}>
                {t('coursePrices.selectAllRows', { total: rows.length })}
              </button>
            </>
          )}
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <Table
          rows={pageRows}
          selectedIds={selectedIds}
          onToggleOne={handleToggleOne}
          onToggleAll={handleToggleAll}
          onView={handleView}
          onEdit={handleEdit}
          onDelete={handleDeleteOne}
          onStatusAction={openStatusDialog}
          sortAsc={sortAsc}
          onToggleSort={() => setSortAsc((p) => !p)}
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          total={rows.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
        />
      )}

      {isModalOpen && (
        <AddCourseModal
          coursePrices={allCoursePrices}
          editItem={editItem}
          isSaving={isSaving}
          onClose={() => {
            setIsModalOpen(false);
            setEditItem(null);
          }}
          onSave={handleSave}
        />
      )}

      {isImportOpen && (
        <ImportPricesModal coursePrices={allCoursePrices} onClose={() => setIsImportOpen(false)} />
      )}

      {statusDialog && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3 className="modal-title">
              {t(
                statusDialog.action === 'approve'
                  ? 'coursePrices.approveConfirmTitle'
                  : 'coursePrices.rejectConfirmTitle',
              )}
            </h3>
            <p style={{ fontSize: 14, color: '#333' }}>
              {t(
                statusDialog.action === 'approve'
                  ? 'coursePrices.approveConfirmText'
                  : 'coursePrices.rejectConfirmText',
                { count: statusDialog.ids.length },
              )}
            </p>
            {statusDialog.action === 'reject' && (
              <textarea
                className="cp-reason"
                rows={2}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('coursePrices.rejectReasonPlaceholder')}
                disabled={isStatusRunning}
              />
            )}
            <div className="modal-actions">
              <button
                type="button"
                className={statusDialog.action === 'approve' ? 'primary' : 'danger'}
                onClick={confirmStatusChange}
                disabled={isStatusRunning}
              >
                {isStatusRunning
                  ? t('coursePrices.saving')
                  : t(statusDialog.action === 'approve' ? 'coursePrices.approveSelected' : 'coursePrices.rejectSelected')}
              </button>
              <button
                type="button"
                className="cancel"
                onClick={() => setStatusDialog(null)}
                disabled={isStatusRunning}
              >
                {t('coursePrices.back')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3 className="modal-title">{t('coursePrices.deleteConfirmTitle')}</h3>
            <p style={{ fontSize: 14, color: '#333' }}>
              {t('coursePrices.deleteConfirmText', { count: deleteCount })}
            </p>
            <div className="modal-actions">
              <button type="button" className="danger" onClick={confirmDelete}>
                {t('coursePrices.delete')}
              </button>
              <button
                type="button"
                className="cancel"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteTargetId(null);
                }}
              >
                {t('coursePrices.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
