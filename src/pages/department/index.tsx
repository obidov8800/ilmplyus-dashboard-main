import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '../../api/api';
import { useTranslation } from 'react-i18next';
import InfoHint from '@/components/InfoHint';
import { clampCell } from '@/utils/clampCell';
import MultiPicker from '@/components/MultiPicker';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import { getLocalized } from '../../utils/getLocalized';
import EmptyState from '../../components/EmptyState';
import TableSkeleton from '../../components/TableSkeleton';
import '../branches/branches.css';
import type { Branch, DepartmentType, DepartmentPayload } from '../../types';
import { useTableColumns } from '../../hooks/useTableColumns';
import './department.css';
import { useEffect, useMemo, useState } from 'react';
import { Protected } from '../../components/Protected';
import { useOptions, type OptionItem } from '../../hooks/useOptions';
import PaginationBar from '../../components/Pagination/PaginationBar';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal';
import { ActiveBadge } from '@/components/StatusBadge';
import { notifyWarning } from '@/utils/notify';

// --- API FUNCTIONS ---
const getDepartments = async (): Promise<DepartmentType[]> => {
  const { data } = await API.get('/departments');
  return data;
};

const createDepartment = async (payload: DepartmentPayload): Promise<DepartmentType> => {
  const { data } = await API.post('/departments', payload);
  return data;
};

const updateDepartment = async (
  id: number,
  payload: DepartmentPayload,
): Promise<DepartmentType> => {
  const { data } = await API.put(`/departments/${id}`, payload);
  return data;
};

const deleteDepartment = async (id: number): Promise<void> => {
  await API.delete(`/departments/${id}`);
};

/** Yangi `branches[]` shakli ham, eski bitta `branch` shakli ham qo'llab-quvvatlanadi. */
const getDepartmentBranches = (dept: DepartmentType): Branch[] => {
  if (dept.branches?.length) return dept.branches;
  return dept.branch ? [dept.branch] : [];
};

const getDepartmentBranchIds = (dept: DepartmentType): number[] =>
  getDepartmentBranches(dept).map((b) => b.id);

// --- MODAL COMPONENT ---
interface DepartmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: DepartmentPayload, id?: number) => void;
  branches: OptionItem[];
  initialData?: DepartmentType | null;
  saving?: boolean;
}

const DepartmentModal: React.FC<DepartmentModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  branches,
  initialData,
  saving,
}) => {
  const { t } = useTranslation();
  const [nameUz, setNameUz] = useState('');
  const [nameRu, setNameRu] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [code, setCode] = useState('');
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [isPedagogical, setIsPedagogical] = useState(false);
  const [isCodeModified, setIsCodeModified] = useState(false);

  useEffect(() => {
    if (initialData) {
      setNameUz(initialData.name_uz || '');
      setNameRu(initialData.name_ru || '');
      setNameEn(initialData.name_en || '');
      setCode(initialData.code ?? '');
      setBranchIds(getDepartmentBranchIds(initialData));
      setIsActive(initialData.is_active);
      setIsPedagogical(!!initialData.is_pedagogical);
      setIsCodeModified(true);
    } else {
      setNameUz('');
      setNameRu('');
      setNameEn('');
      setCode('');
      setBranchIds([]);
      setIsActive(true);
      setIsPedagogical(false);
      setIsCodeModified(false);
    }
  }, [initialData, isOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchIds.length) {
      // Ilgari hech qanday xabarsiz qaytardi — "Saqlash" bosilganda hech narsa bo'lmayotganday ko'rinardi.
      notifyWarning(t('departments.selectBranch'));
      return;
    }

    const payload: DepartmentPayload = {
      name_uz: nameUz,
      name_ru: nameRu,
      name_en: nameEn,
      code,
      branch_ids: branchIds,
      is_active: isActive,
      is_pedagogical: isPedagogical,
    };

    onSubmit(payload, initialData?.id);
  };

  const inputStyle = { padding: '6px 10px', height: '36px', fontSize: '13px' };

  return (
    <div className="branch-modal-overlay" onClick={onClose}>
      <form
        className="branch-modal branch-add-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h3 className="branch-modal-heading">
          {initialData ? t('departments.editTitle') : t('departments.addNewTitle')}
        </h3>

        <div className="dept-form-grid">
          <div className="branch-input-group">
            <label htmlFor="name_uz">{t('departments.name')} (UZ)</label>
            <input
              id="name_uz"
              type="text"
              value={nameUz}
              onChange={(e) => {
                const newName = e.target.value;
                setNameUz(newName);
                if (!isCodeModified && !initialData) {
                  setCode(newName.toUpperCase().replace(/\s+/g, '_'));
                }
              }}
              required
              style={inputStyle}
            />
          </div>

          {initialData && (
            <>
              <div className="branch-input-group">
                <label htmlFor="name_ru">{t('departments.name')} (RU)</label>
                <input
                  id="name_ru"
                  type="text"
                  value={nameRu}
                  onChange={(e) => setNameRu(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div className="branch-input-group">
                <label htmlFor="name_en">{t('departments.name')} (EN)</label>
                <input
                  id="name_en"
                  type="text"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </>
          )}

          <div className="branch-input-group">
            <label htmlFor="code">{t('departments.code')}</label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setIsCodeModified(true);
              }}
              required
              style={inputStyle}
            />
          </div>

          <div className="branch-input-group">
            <label>{t('departments.status')}</label>
            <div className="branch-toggle-wrapper">
              <button
                type="button"
                className={isActive ? '' : 'branch-active-btn'}
                onClick={() => setIsActive(false)}
              >
                {t('departments.inactive')}
              </button>
              <button
                type="button"
                className={isActive ? 'branch-active-btn' : ''}
                onClick={() => setIsActive(true)}
              >
                {t('departments.active')}
              </button>
            </div>
          </div>

          <div className="branch-input-group">
            <label>{t('departments.pedagogical')}</label>
            <div className="branch-toggle-wrapper">
              <button
                type="button"
                className={isPedagogical ? '' : 'branch-active-btn'}
                onClick={() => setIsPedagogical(false)}
              >
                {t('departments.no')}
              </button>
              <button
                type="button"
                className={isPedagogical ? 'branch-active-btn' : ''}
                onClick={() => setIsPedagogical(true)}
              >
                {t('departments.yes')}
              </button>
            </div>
            <div>
              <InfoHint withLabel text={t('departments.pedagogicalHint')} />
            </div>
          </div>

          <div className="branch-input-group dept-full-width">
            <label htmlFor="branch">{t('departments.branches')}</label>
            <MultiPicker
              options={branches.map((b) => ({ value: Number(b.id), label: b.label }))}
              value={branchIds}
              onChange={setBranchIds}
              placeholder={t('departments.selectBranch')}
            />
          </div>
        </div>

        <div className="branch-modal-buttons">
          <button type="submit" className="branch-save-btn" disabled={saving}>
            {saving ? t('users.saving') : t('departments.save')}
          </button>
          <button type="button" onClick={onClose} className="branch-cancel-btn">
            {t('departments.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
};

// --- MAIN PAGE COMPONENT ---
const Department = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('departments');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (dept: DepartmentType, colId: string) => {
    switch (colId) {
      case 'name':
        return getLocalized(dept, 'name', i18n.language);
      case 'code':
        return dept.code;
      case 'branches':
        return (
          getDepartmentBranches(dept)
            .map((b) => getLocalized(b, 'name', i18n.language))
            .join(', ') || '-'
        );
      case 'is_pedagogical':
        return (
          <ActiveBadge
            active={!!dept.is_pedagogical}
            activeLabel={t('departments.yes')}
            inactiveLabel={t('departments.no')}
          />
        );
      case 'is_active':
        return (
          <ActiveBadge
            active={!!dept.is_active}
            activeLabel={t('departments.active')}
            inactiveLabel={t('departments.inactive')}
          />
        );
      default:
        return '-';
    }
  };
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<DepartmentType | null>(null);
  const [viewItem, setViewItem] = useState<DepartmentType | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pendingDelete, setPendingDelete] = useState<
    { type: 'one'; id: number } | { type: 'many' } | null
  >(null);

  const toggleAll = (checked: boolean) => setSelected(checked ? tableData?.map((r) => r.id) : []);

  const toggleOne = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const { data: departments = [], isLoading: isLoadingDepartments } = useQuery<DepartmentType[]>({
    queryKey: ['departments'],
    queryFn: getDepartments,
    placeholderData: keepPreviousData,
  });

  const { data: branches = [] } = useOptions('branches');

  const createMutation = useMutation({
    mutationFn: createDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      setIsModalOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: DepartmentPayload }) =>
      updateDepartment(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      setIsModalOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDepartment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  const handleOpenModal = (department?: DepartmentType) => {
    setEditingDepartment(department || null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingDepartment(null);
  };

  const handleSubmit = (payload: DepartmentPayload, id?: number) => {
    if (id) {
      updateMutation.mutate({ id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (id: number) => {
    setPendingDelete({ type: 'one', id });
  };

  const handleDeleteSelected = () => {
    setPendingDelete({ type: 'many' });
  };

  const confirmPendingDelete = () => {
    if (pendingDelete?.type === 'one') {
      deleteMutation.mutate(pendingDelete.id);
    } else if (pendingDelete?.type === 'many') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    }
    setPendingDelete(null);
  };

  const tableData = useMemo(() => {
    return departments
      .filter(
        (d) => !branchFilter || getDepartmentBranchIds(d).some((id) => String(id) === branchFilter),
      )
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  }, [departments, branchFilter, sortAsc]);

  const departmentsTotal = tableData.length;
  const departmentsTotalPages = Math.max(1, Math.ceil(departmentsTotal / pageSize));
  const pagedTableData = useMemo(
    () => tableData.slice((page - 1) * pageSize, page * pageSize),
    [tableData, page, pageSize],
  );

  return (
    <section className="branch-container container">
      <h1 className="branch-page-title">{t('departments.listTitle')}</h1>

      {viewItem && (
        <RecordViewModal
          title={t('viewModal.title.department')}
          fields={[
            { label: t('viewModal.nameUz'), value: viewItem.name_uz },
            { label: t('viewModal.nameRu'), value: viewItem.name_ru },
            { label: t('viewModal.nameEn'), value: viewItem.name_en },
            { label: t('columns.code'), value: renderCell(viewItem, 'code') },
            { label: t('columns.branches'), value: renderCell(viewItem, 'branches') },
            { label: t('columns.is_pedagogical'), value: renderCell(viewItem, 'is_pedagogical') },
            { label: t('columns.is_active'), value: renderCell(viewItem, 'is_active') },
            { label: 'ID', value: `#${viewItem.id}` },
          ]}
          onClose={() => setViewItem(null)}
        />
      )}

      <ConfirmDeleteModal
        open={pendingDelete !== null}
        title={
          pendingDelete?.type === 'many'
            ? t('departments.confirmBatchDelete', 'Tanlanganlarni haqiqatan ham o‘chirmoqchimisiz?')
            : t('departments.confirmDelete', 'Haqiqatan ham o‘chirmoqchimisiz?')
        }
        busy={deleteMutation.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmPendingDelete}
      />

      <div className="branch-filter-panel">
        <Protected permission="departments.create">
          <button className="branch-add-btn" onClick={() => handleOpenModal()}>
            {t('departments.addNewTitle')}
          </button>
        </Protected>

        <Protected permission="departments.delete">
          <button
            className="branch-delete-btn"
            disabled={!selected.length}
            onClick={handleDeleteSelected}
            style={{
              opacity: selected.length ? 1 : 0.5,
              cursor: selected.length ? 'pointer' : 'not-allowed',
            }}
          >
            {t('departments.deleteSelected')}
          </button>
        </Protected>
        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('departments.branch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      <div className="branch-table-container">
        <table className="branch-data-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === tableData?.length && tableData?.length > 0}
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
              <th>{t('departments.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoadingDepartments ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : (
              pagedTableData?.map((dept) => (
                <tr key={dept.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(dept.id)}
                      onChange={() => toggleOne(dept.id)}
                    />
                  </td>
                  {isVisible('id') && <td>{dept.id}</td>}
                  {visibleColumns.map((colId) => (
                    <td key={colId}>{clampCell(renderCell(dept, colId))}</td>
                  ))}
                  <td className="branch-action-cell">
                    <Protected permission="departments.show">
                      <button
                        type="button"
                        className="branch-view-icon"
                        title={t('viewModal.view')}
                        aria-label={t('viewModal.view')}
                        onClick={() => setViewItem(dept)}
                      >
                        <i className="fa-solid fa-eye"></i>
                      </button>
                    </Protected>
                    <Protected permission="departments.edit">
                      <button
                        className="branch-edit-icon"
                        onClick={() => handleOpenModal(dept)}
                        aria-label={t('common.edit', 'Tahrirlash')}
                      >
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>
                    <Protected permission="departments.delete">
                      <button
                        className="branch-delete-icon"
                        onClick={() => handleDelete(dept.id)}
                        aria-label={t('common.delete', 'O’chirish')}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            )}
            {!isLoadingDepartments && tableData.length === 0 && (
              <EmptyState colSpan={colCount} message={t('common.noData')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={departmentsTotalPages}
        total={departmentsTotal}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      <DepartmentModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
        branches={branches}
        initialData={editingDepartment}
        saving={createMutation.isPending || updateMutation.isPending}
      />
    </section>
  );
};

export default Department;
