import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { API } from '../../api/api';
import '../users/users.css';
import './courses.css';
import '../levels/levels.css';
import { useTranslation } from 'react-i18next';
import { clampCell } from '@/utils/clampCell';
import MultiPicker from '@/components/MultiPicker';
import { getLocalized } from '../../utils/getLocalized';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import type { Course, CoursePayload } from '../../types';
import { useTableColumns } from '../../hooks/useTableColumns';
import { Protected } from '../../components/Protected';
import { useOptions } from '../../hooks/useOptions';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { toTashkentDate } from '@/utils/date';
import { ActiveBadge } from '@/components/StatusBadge';

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
};

const Courses = () => {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [editingItem, setEditingItem] = useState<Course | null>(null);
  const [viewItem, setViewItem] = useState<Course | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name_uz: '',
    name_ru: '',
    name_en: '',
    is_active: true,
    created_at: '',
  });
  const [selectedBranchIds, setSelectedBranchIds] = useState<number[]>([]);
  const [selectedLevelIds, setSelectedLevelIds] = useState<number[]>([]);
  const [branchListFilter, setBranchListFilter] = useState('');
  const [levelListFilter, setLevelListFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { isVisible, visibleColumns } = useTableColumns('courses');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });

  const renderCell = (item: Course, colId: string) => {
    switch (colId) {
      case 'name':
        return getLocalized(item, 'name', i18n.language);
      case 'branches':
        return item.branches && item.branches.length > 0
          ? item.branches.map((b) => getLocalized(b, 'name', i18n.language)).join(', ')
          : '-';
      case 'levels':
        return item.levels && item.levels.length > 0
          ? item.levels.map((l) => getLocalized(l, 'name', i18n.language)).join(', ')
          : '-';
      case 'status':
        return (
          <ActiveBadge
            active={!!item.is_active}
            activeLabel={t('courses.active')}
            inactiveLabel={t('courses.inactive')}
          />
        );
      case 'created_at':
        return item.created_at ? formatDate(item.created_at) : '-';
      case 'updated_at':
        return item.updated_at ? formatDate(item.updated_at) : '-';
      default:
        return '-';
    }
  };

  const { data: courses, isLoading } = useQuery<Course[]>({
    queryKey: ['courses'],
    queryFn: async () => {
      const { data } = await API.get<Course[]>('/courses');
      return Array.isArray(data) ? data : ((data as { data?: Course[] })?.data ?? []);
    },
    placeholderData: keepPreviousData,
  });

  const { data: branches } = useOptions('branches');
  const { data: levels } = useOptions('levels');

  const createMutation = useMutation({
    mutationFn: async (payload: CoursePayload) => API.post('/courses', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (params: { id: number; payload: CoursePayload }) =>
      API.put(`/courses/${params.id}`, params.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => API.delete(`/courses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] });
    },
  });

  const resetForm = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({ name_uz: '', name_ru: '', name_en: '', is_active: true, created_at: '' });
    setSelectedBranchIds([]);
    setSelectedLevelIds([]);
  };

  const openEditModal = (item: Course) => {
    setEditingItem(item);
    setFormData({
      name_uz: item.name_uz,
      name_ru: item.name_ru || '',
      name_en: item.name_en || '',
      is_active: !!item.is_active,
      created_at: item.created_at ? toTashkentDate(item.created_at) : '',
    });
    setSelectedBranchIds(item.branches?.map((b) => b.id) || []);
    setSelectedLevelIds(item.levels?.map((l) => l.id) || []);
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CoursePayload = {
      name_uz: formData.name_uz.trim(),
      name_ru: formData.name_ru?.trim() || '',
      name_en: formData.name_en?.trim() || '',
      is_active: formData.is_active,
      // Faqat admin sanani o'zgartirgan bo'lsa yuboriladi (aks holda har tahrirda
      // yaratilgan sana yarim tunga/UTC kuniga qayta yozilardi).
      ...(editingItem &&
        formData.created_at &&
        formData.created_at !== toTashkentDate(editingItem.created_at) && {
          created_at: formData.created_at,
        }),
      branch_ids: selectedBranchIds,
      level_ids: selectedLevelIds,
    };
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const confirmDelete = () => {
    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    }
    if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((prev) => prev.filter((x) => x !== deleteTarget));
    }
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const filteredCourses = [...(courses || [])]
    .filter((c) => !branchListFilter || c.branches?.some((b) => String(b.id) === branchListFilter))
    .filter((c) => !levelListFilter || c.levels?.some((l) => String(l.id) === levelListFilter))
    .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  const coursesTotal = filteredCourses.length;
  const coursesTotalPages = Math.max(1, Math.ceil(coursesTotal / pageSize));
  const pagedCourses = filteredCourses.slice((page - 1) * pageSize, page * pageSize);

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? (courses?.map((c) => c.id) ?? []) : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className="users container">
      <h1 className="main-title">{t('courses.mainTitle')}</h1>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="expenses-subcategory" style={{ minWidth: 480 }}>
            <h1>
              {editingItem
                ? t('courses.editTitle', 'Kursni tahrirlash')
                : t('courses.addTitle', 'Kurs q‘shish')}
            </h1>

            <form className="subcategory-form" onSubmit={handleSubmit}>
              {/* Course name */}
              <div className="subcategory-form-group">
                <label>{t('courses.courseName')} (UZ)</label>
                <input
                  type="text"
                  value={formData.name_uz}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name_uz: e.target.value }))}
                  required
                />
              </div>

              {editingItem && (
                <>
                  <div className="subcategory-form-group">
                    <label>{t('courses.courseName')} (RU)</label>
                    <input
                      type="text"
                      value={formData.name_ru}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name_ru: e.target.value }))
                      }
                    />
                  </div>
                  <div className="subcategory-form-group">
                    <label>{t('courses.courseName')} (EN)</label>
                    <input
                      type="text"
                      value={formData.name_en}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, name_en: e.target.value }))
                      }
                    />
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('courses.status')}</label>
                    <select
                      value={formData.is_active ? '1' : '0'}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, is_active: e.target.value === '1' }))
                      }
                    >
                      <option value="1">{t('courses.active')}</option>
                      <option value="0">{t('courses.inactive')}</option>
                    </select>
                  </div>

                  <div className="subcategory-form-group">
                    <label>{t('courses.createdDate')}</label>
                    <input
                      type="date"
                      value={formData.created_at}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, created_at: e.target.value }))
                      }
                    />
                  </div>
                </>
              )}

              {/* Filial va daraja — ko'p tanlash */}
              <div className="subcategory-form-group">
                <label>{t('courses.branch')}</label>
                <MultiPicker
                  options={(branches ?? []).map((b) => ({ value: b.id, label: b.label }))}
                  value={selectedBranchIds}
                  onChange={setSelectedBranchIds}
                  placeholder={t('courses.choose')}
                />
              </div>

              <div className="subcategory-form-group">
                <label>{t('levels.level')}</label>
                <MultiPicker
                  options={(levels ?? []).map((l) => ({ value: l.id, label: l.label }))}
                  value={selectedLevelIds}
                  onChange={setSelectedLevelIds}
                  placeholder={t('courses.choose')}
                />
              </div>

              <div className="modal-actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? t('expenses.saving', 'Saqlanmoqda...')
                    : t('expenses.save')}
                </button>
                <button type="button" className="cancel" onClick={resetForm}>
                  {t('expenses.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('expenses.confirmDelete')}</h3>
            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('expenses.delete')}
              </button>

              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('expenses.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewItem && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 600, padding: 32, borderRadius: 8 }}>
            <h2
              style={{
                textAlign: 'center',
                marginBottom: 32,
                color: '#003b73',
              }}
            >
              {t('courses.detailsTitle')}
            </h2>

            <div style={{ display: 'flex', marginBottom: 24 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('courses.courseName')}:
                </p>
                <p style={{ color: '#003b73', fontWeight: 500, fontSize: 16 }}>
                  {viewItem ? getLocalized(viewItem, 'name', i18n.language) : ''}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('courses.branch')}:
                </p>
                <p style={{ color: '#003b73', fontWeight: 500, fontSize: 16 }}>
                  {viewItem.branches && viewItem.branches.length > 0
                    ? viewItem.branches
                        .map((b) => getLocalized(b, 'name', i18n.language))
                        .join(', ')
                    : '-'}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', marginBottom: 32 }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>
                  {t('courses.createdDate')}:
                </p>
                <p style={{ color: '#003b73', fontWeight: 500, fontSize: 16 }}>
                  {viewItem.created_at ? formatDate(viewItem.created_at) : '-'}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>ID:</p>
                <p style={{ color: '#003b73', fontWeight: 500, fontSize: 16 }}>#{viewItem.id}</p>
              </div>
            </div>

            <hr
              style={{
                border: 'none',
                borderTop: '1px solid #ddd',
                marginBottom: 24,
              }}
            />

            <h4
              style={{
                color: '#003b73',
                marginBottom: 16,
                textTransform: 'uppercase',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {t('courses.availableLevels')}
            </h4>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 40,
              }}
            >
              {viewItem.levels && viewItem.levels.length > 0 ? (
                viewItem.levels.map((level) => (
                  <span
                    key={level.id}
                    style={{
                      border: '1px solid #003b73',
                      color: '#003b73',
                      borderRadius: 20,
                      padding: '6px 16px',
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {getLocalized(level, 'name', i18n.language)}
                  </span>
                ))
              ) : (
                <span style={{ color: '#888', fontSize: 14 }}>-</span>
              )}
            </div>

            <button
              onClick={() => setViewItem(null)}
              style={{
                border: '1px solid #003b73',
                background: 'transparent',
                color: '#003b73',
                padding: '8px 32px',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {t('courses.back')}
            </button>
          </div>
        </div>
      )}

      <div className="users-filters">
        <Protected permission="courses.create">
          <button className="add-new-user" onClick={() => setShowModal(true)}>
            {t('expenses.addBtn')}
          </button>
        </Protected>
        <Protected permission="courses.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('expenses.delete')}
          </button>
        </Protected>
        <select
          value={branchListFilter}
          onChange={(e) => {
            setBranchListFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('courses.branch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select value={levelListFilter} onChange={(e) => { setLevelListFilter(e.target.value); setPage(1); }}>
          <option value="">{t('levels.level')}</option>
          {levels?.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
        </select>
      </div>

      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={(courses?.length ?? 0) > 0 && selected.length === (courses?.length ?? 0)}
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
              <th>{t('courses.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : courses && courses.length > 0 ? (
              pagedCourses.map((item) => {
                  return (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          onChange={() => toggleOne(item.id)}
                        />
                      </td>
                      {isVisible('id') && <td>{item.id}</td>}
                      {visibleColumns.map((colId) => (
                        <td key={colId}>{clampCell(renderCell(item, colId))}</td>
                      ))}
                      <td className="actions">
                        {/* «Ko'rish» (ko'z) — `courses.show` ruxsati bilan (Rollar sahifasidagi «Ko'rish» katakchasi). */}
                        <Protected permission="courses.show">
                          <button className="user-view-btn" onClick={() => setViewItem(item)}>
                            <i className="fa-solid fa-eye"></i>
                          </button>
                        </Protected>
                        <Protected permission="courses.edit">
                          <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                            <i className="fa-solid fa-pen"></i>
                          </button>
                        </Protected>
                        <Protected permission="courses.delete">
                          <button
                            className="user-delete-btn"
                            onClick={() => {
                              setDeleteTarget(item.id);
                              setShowDeleteModal(true);
                            }}
                          >
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </Protected>
                      </td>
                    </tr>
                  );
                })
            ) : (
              <EmptyState colSpan={colCount} message={t('courses.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={coursesTotalPages}
        total={coursesTotal}
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

export default Courses;
