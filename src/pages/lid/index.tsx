import { useBulkDelete } from '@/hooks/useBulkDelete';
import { usePermission } from '@/hooks/usePermission';
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import FilterDropdown from '../../components/FilterDropdown';
import { EMPTY_FILTER } from '@/components/FilterDropdown/Filterdropdown.constants';
import type {
  FilterState,
  StudentGender,
} from '@/components/FilterDropdown/Filterdropdown.constants';
import { RegistrationModal } from '@/components/RegistrationModal';
import { DeleteConfirmationModal } from '@/components/RegistrationModal/DeleteConfirmModal';
import PaginationBar from '@/components/Pagination/PaginationBar';
import { useDeleteMutation } from '@/hooks/useMutations';
import { fetchLids, deleteLid, updateLidInterestColor, type PaginatedLids } from '@/pages/lid/lid.service';
import { patchLidInCache } from '@/pages/lid/lidCache';
import { getName, formatGender, getSourceKey, getSourceLabel } from '../../types/lid.types';
import { useTranslation } from 'react-i18next';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import type { Lid, LidInterestColor } from '../../types/lid.types';
import InterestColorPicker from '@/components/InterestColorPicker';
import RecordViewModal from '@/components/RecordViewModal/RecordViewModal';
import './registration.css';
import { toTashkentDate } from '@/utils/date';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${hours}:${minutes} ${day}.${month}.${year}`;
}

function applyClientFilters(
  lids: Lid[],
  search: string,
  filters: FilterState,
  lang: string,
): Lid[] {
  const q = search.trim().toLowerCase();

  return lids.filter((s) => {
    const courseName = getName(s.course, lang);
    const groupName = getName(s.group, lang);
    const branchName = getName(s.branch, lang);
    const genderLabel = formatGender(s.gender) as StudentGender;

    if (q) {
      const fullName = `${s.first_name} ${s.last_name}`;
      const haystack =
        `${fullName} ${s.phone} ${courseName} ${groupName} ${branchName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filters.sources.length > 0 && (!s.source_id || !filters.sources.includes(s.source_id)))
      return false;
    if (filters.branches.length > 0 && (!s.branch_id || !filters.branches.includes(s.branch_id)))
      return false;
    if (filters.genders.length > 0 && !filters.genders.includes(genderLabel)) return false;

    // Direction filtering (courses and levels)
    if (filters.courses.length > 0) {
      const isCourseSelected = s.course_id && filters.courses.includes(s.course_id);
      const isLevelSelected = s.level_id && filters.levels.includes(s.level_id);

      // If they selected a specific level, they MUST match that level
      if (filters.levels.length > 0) {
        if (!isLevelSelected) return false;
      } else {
        // If no levels selected but course is selected, they MUST match the course
        if (!isCourseSelected) return false;
      }
    } else if (filters.levels.length > 0) {
      // Just levels selected
      if (!s.level_id || !filters.levels.includes(s.level_id)) return false;
    }

    // Date filtering
    if (filters.date) {
      const lidDate = s.created_at ? new Date(s.created_at) : new Date();
      const lidDateString = toTashkentDate(lidDate);
      if (lidDateString !== filters.date) return false;
    }

    return true;
  });
}

const Registration = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('lid');
  const colCount = 1 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const lang = i18n.language;
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTER);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | undefined>(undefined);
  const [viewLid, setViewLid] = useState<Lid | null>(null);
  const [deleteId, setDeleteId] = useState<number | undefined>(undefined);
  const [idSortOrder, setIdSortOrder] = useState<'asc' | 'desc'>('asc');

  const { data, isLoading, isError } = useQuery<PaginatedLids>({
    queryKey: ['lids', currentPage, pageSize],
    queryFn: () => fetchLids({ page: currentPage, per_page: pageSize }),
  });

  const deleteMutation = useDeleteMutation(deleteLid, [['lids']]);

  const queryClient = useQueryClient();
  const interestColorMutation = useMutation({
    mutationFn: ({ id, color }: { id: number; color: LidInterestColor | null }) =>
      updateLidInterestColor(id, color),
    // Rang darhol ko'rinsin; xato bo'lsa ro'yxat qayta yuklanib eski rang qaytadi.
    onMutate: ({ id, color }) => patchLidInCache(queryClient, id, { interest_color: color }),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['lids'] });
    },
  });

  // Backend javobi `meta` ichida ham, tekis (flat) shaklda ham kelishi
  // mumkin — ikkalasini ham qo'llab-quvvatlaymiz (pastroqda izoh bor).
  const total = data?.meta?.total ?? data?.total ?? 0;
  const totalPages = data?.meta?.last_page ?? data?.last_page ?? 1;

  const filteredData = useMemo(() => {
    const lids: Lid[] = data?.data ?? [];
    const filtered = applyClientFilters(lids, search, filters, lang);
    return [...filtered].sort((a, b) => (idSortOrder === 'asc' ? a.id - b.id : b.id - a.id));
  }, [data, search, filters, lang, idSortOrder]);

  const bulkAllowed = usePermission('lids.delete');
  const bulk = useBulkDelete({ rows: filteredData, allowed: bulkAllowed, scope: JSON.stringify([currentPage, pageSize, search, filters]), remove: row => deleteLid(row.id), refresh: () => queryClient.invalidateQueries({ queryKey: ['lids'] }) });
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setCurrentPage(1);
  }, []);

  const handleFiltersChange = useCallback((next: FilterState) => {
    setFilters(next);
    setCurrentPage(1);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditId(undefined);
  }, []);

  const handleOpenAdd = useCallback(() => {
    setEditId(undefined);
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((id: number) => {
    setEditId(id);
    setIsModalOpen(true);
  }, []);

  const handleOpenDelete = useCallback((id: number) => {
    setDeleteId(id);
  }, []);

  const handleCloseDelete = useCallback(() => {
    setDeleteId(undefined);
  }, []);

  return (
    <>
      <section className="registration container">
        <div className="registration-top">
          <h1>{t('registration.newRegistrated')}</h1>
          {bulk.modal}
          <div className="registration-top__actions">
            {bulk.button}
            <div
              className="registration-top__search"
              role="search"
              aria-label="O‘quvchilarni qidirish"
            >
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <input
                type="text"
                placeholder={t('registration.inputPlaceholder')}
                value={search}
                onChange={handleSearchChange}
                aria-label="Qidiruv"
              />
            </div>
            <FilterDropdown filters={filters} onChange={handleFiltersChange} />
            <Protected permission="lids.create">
              <button type="button" className="registration-add-btn" onClick={handleOpenAdd}>
                {t('registration.registerNew')}
              </button>
            </Protected>
          </div>
        </div>

        <div className="dashboard-bottom">
          <div className="db-header">
            <h2 className="db-header__title">{t('registration.tableTitle')}</h2>
          </div>

          <div
            className="db-table-wrapper"
            role="region"
            aria-label="Yangi ‘quvchilar jadvali"
            tabIndex={0}
          >
            <table className="db-table">
              <thead>
                <tr>
                  {bulk.header}
                  {isVisible('id') && (
                    <th
                      scope="col"
                      className="th-sortable"
                      onClick={() => setIdSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                      aria-sort={idSortOrder === 'asc' ? 'ascending' : 'descending'}
                    >
                      {t('registration.colLidId')}{' '}
                      <i
                        className={`fa-solid fa-sort-${idSortOrder === 'asc' ? 'up' : 'down'}`}
                        aria-hidden="true"
                      />
                    </th>
                  )}
                  {visibleColumns.map((colId) => (
                    <th key={colId} scope="col">
                      {columnHeader(colId)}
                    </th>
                  ))}
                  <th scope="col">{t('registration.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={colCount + bulk.columnCount} className="db-empty-state" aria-live="polite">
                      <div className="db-empty-state__inner">
                        <p>{t('registration.loading')}</p>
                      </div>
                    </td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={colCount + bulk.columnCount} className="db-empty-state" aria-live="polite">
                      <div className="db-empty-state__inner">
                        <p>{t('registration.error')}</p>
                      </div>
                    </td>
                  </tr>
                ) : filteredData.length > 0 ? (
                  filteredData.map((student: Lid) => {
                    const fish = [student.last_name, student.first_name, student.father_name]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <tr key={student.id} className="db-table__row">
                        {bulk.cell(student)}
                        {isVisible('id') && (
                          <td>
                            <span className="db-id-cell">{student.id}</span>
                          </td>
                        )}
                        {visibleColumns.map((colId) => {
                          switch (colId) {
                            case 'full_name':
                              return (
                                <td key={colId}>
                                  <span className="db-fish-cell">{fish}</span>
                                </td>
                              );
                            case 'direction':
                              return (
                                <td key={colId}>
                                  <div className="db-direction-cell">
                                    <span className="db-direction-cell__dot" aria-hidden="true" />
                                    <span className="db-direction-cell__text">
                                      {getName(student.course, lang)} {getName(student.level, lang)}
                                    </span>
                                  </div>
                                </td>
                              );
                            case 'group':
                              return (
                                <td key={colId}>
                                  <span className="db-group-cell">
                                    {getName(student.group, lang)}
                                  </span>
                                </td>
                              );
                            case 'gender':
                              return (
                                <td key={colId}>
                                  <span className="db-gender-cell">
                                    {formatGender(student.gender)}
                                  </span>
                                </td>
                              );
                            case 'branch':
                              return (
                                <td key={colId}>
                                  <span className="db-branch-cell">
                                    {getName(student.branch, lang)}
                                  </span>
                                </td>
                              );
                            case 'source':
                              return (
                                <td key={colId}>
                                  <span
                                    className={`db-source-badge db-source-badge--${getSourceKey(student.source)}`}
                                  >
                                    {getSourceLabel(student.source, lang)}
                                  </span>
                                </td>
                              );
                            case 'date':
                              return (
                                <td key={colId}>
                                  <span className="db-date-cell">
                                    {formatDate(student.created_at)}
                                  </span>
                                </td>
                              );
                            case 'interest_color':
                              return (
                                <td key={colId}>
                                  <InterestColorPicker
                                    value={student.interest_color}
                                    disabled={interestColorMutation.isPending}
                                    onChange={(color) =>
                                      interestColorMutation.mutate({ id: student.id, color })
                                    }
                                  />
                                </td>
                              );
                            default:
                              return <td key={colId}>-</td>;
                          }
                        })}
                        <td>
                          <div className="db-actions-cell">
                            <Protected permission="lids.show">
                              <button
                                type="button"
                                className="db-action-btn"
                                title={t('viewModal.view')}
                                aria-label={t('viewModal.view')}
                                onClick={() => setViewLid(student)}
                              >
                                <i className="fa-solid fa-eye" />
                              </button>
                            </Protected>
                            <Protected
                              permission="lids.edit"
                              scopePermissions={student.permissions}
                            >
                              <button
                                type="button"
                                className="db-action-btn"
                                onClick={() => handleOpenEdit(student.id)}
                              >
                                <i className="fa-solid fa-pen" />
                              </button>
                            </Protected>
                            <Protected permission="lids.delete">
                              <button
                                type="button"
                                className="db-action-btn db-action-btn--danger"
                                aria-label={`${fish}ni o‘chirish`}
                                onClick={() => handleOpenDelete(student.id)}
                                disabled={deleteMutation.isPending}
                              >
                                <i className="fa-solid fa-trash" />
                              </button>
                            </Protected>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={colCount + bulk.columnCount} className="db-empty-state" aria-live="polite">
                      <div className="db-empty-state__inner">
                        <i
                          className="fa-solid fa-magnifying-glass db-empty-state__icon"
                          aria-hidden="true"
                        />
                        <p>{t('registration.resultsNotFound')}</p>
                        <span>{t('registration.changeFilters')}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {total > 0 && (
            <PaginationBar
              page={currentPage}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
        </div>
      </section>

      {isModalOpen && <RegistrationModal onClose={handleCloseModal} editId={editId} />}
      {viewLid && (
        <RecordViewModal
          title={t('viewModal.title.lid')}
          fields={[
            {
              label: t('columns.full_name'),
              value: [viewLid.last_name, viewLid.first_name, viewLid.father_name].filter(Boolean).join(' '),
              wide: true,
            },
            { label: t('columns.phone'), value: viewLid.phone },
            { label: t('columns.gender'), value: formatGender(viewLid.gender) },
            { label: t('columns.birth_date'), value: viewLid.birth_date ? viewLid.birth_date.slice(0, 10) : null },
            {
              label: t('columns.direction'),
              value: `${getName(viewLid.course, lang)} ${getName(viewLid.level, lang)}`.trim(),
            },
            { label: t('columns.group'), value: getName(viewLid.group, lang) },
            { label: t('columns.branch'), value: getName(viewLid.branch, lang) },
            { label: t('columns.source'), value: getSourceLabel(viewLid.source, lang) },
            { label: t('columns.date'), value: formatDate(viewLid.created_at) },
            { label: 'ID', value: `#${viewLid.id}` },
          ]}
          onClose={() => setViewLid(null)}
        />
      )}

      {deleteId != null && <DeleteConfirmationModal lidId={deleteId} onClose={handleCloseDelete} />}
    </>
  );
};

export default Registration;
