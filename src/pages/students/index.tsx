import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  studentAPI,
  type Student,
  type StudentPayload,
  type StudentGroup,
  type PaginatedStudents,
} from '../../api/student.api';
import '../users/users.css';
import '../expenses/expenses.css';
import './students.css';
import { useTranslation } from 'react-i18next';
import { formatPhone, isValidUzPhone, normalizePhone } from '../../utils/phone';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { notifyWarning } from '@/utils/notify';
import { ActiveBadge } from '@/components/StatusBadge';
import { fetchAllPages } from '@/api/fetchAllPages';
import { usePermission } from '@/hooks/usePermission';
import { findLabel, useOptions, type OptionItem } from '@/hooks/useOptions';

interface StudentContractStatusItem {
  status?: string;
  contract_students?: Array<{
    student_id?: number | null;
    otp_confirmed?: boolean;
  }>;
}

const formatDate = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

const formatDateTime = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const isEnabledFlag = (value: unknown) =>
  value === true || value === 1 || value === '1' || value === 'true';

const Students = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('students');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;

  const columnHeader = (colId: string) =>
    t(`columns.${colId}`, { defaultValue: colId });
  const queryClient = useQueryClient();

  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | 'all' | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [viewingItem, setViewingItem] = useState<Student | null>(null);
  const [editingItem, setEditingItem] = useState<Student | null>(null);
  const [formData, setFormData] = useState<StudentPayload>({
    first_name: '',
    last_name: '',
    username: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [branchFilter, setBranchFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [contractFilter, setContractFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const canViewStudentContracts = usePermission('student_contracts.view');
  const canViewPreschoolContracts = usePermission('preschool_contracts.view');
  // Shartnoma holatini qo'lda o'zgartirish — backend (stage16) `student_contracts.edit|preschool_contracts.edit` talab qiladi.
  const canEditStudentContracts = usePermission('student_contracts.edit');
  const canEditPreschoolContracts = usePermission('preschool_contracts.edit');
  const canChangeContractStatus = canEditStudentContracts || canEditPreschoolContracts;

  const { data, isLoading } = useQuery<PaginatedStudents>({
    queryKey: ['students'],
    queryFn: async () => {
      const list = await fetchAllPages<Student>('/students', { per_page: 100 });
      return {
        data: list,
        meta: {
          current_page: 1,
          per_page: list.length,
          total: list.length,
          last_page: 1,
        },
      };
    },
    placeholderData: (prev) => prev,
  });

  const students = data?.data;

  // Nomlar uchun yengil ro'yxatlar — `/options/*` (`lookups.view`). Ilgari `/branches`, `/courses`, `/levels`,
  // `/contracts`, `/rooms` to'liq ro'yxatlari so'ralardi: faqat `students.view` bor rolda beshta «Ruxsat yo'q» chiqardi.
  const { data: branches = [] } = useOptions('branches');
  const { data: courses = [] } = useOptions('courses');
  const { data: levels = [] } = useOptions('levels');
  const { data: teachers = [] } = useOptions('employees');

  // Shartnoma tasdiqlanganda `students.is_contract_confirmed` ham yangilanadi.
  // Eski yoki sinxronlashdan oldingi yozuvlarda bu bayroq ortda qolishi mumkin,
  // shuning uchun ruxsati bor foydalanuvchilarda faol shartnomalardan ham tekshiramiz.
  const { data: confirmedStudentContracts = [] } = useQuery<StudentContractStatusItem[]>({
    queryKey: ['students-confirmed-contracts', 'regular'],
    queryFn: () => fetchAllPages<StudentContractStatusItem>('/student-contracts', {
      status: 'active',
      per_page: 100,
    }),
    enabled: canViewStudentContracts,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: 'always',
    retry: false,
  });

  const { data: confirmedPreschoolContracts = [] } = useQuery<StudentContractStatusItem[]>({
    queryKey: ['students-confirmed-contracts', 'preschool'],
    queryFn: () => fetchAllPages<StudentContractStatusItem>('/student-contracts', {
      contract_type: 'preschool',
      status: 'active',
      per_page: 100,
    }),
    enabled: canViewPreschoolContracts,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: 'always',
    retry: false,
  });

  const { data: rooms = [] } = useOptions('rooms');

  /** id → nom; ro'yxatda topilmasa id ning o'zi. */
  const nameOf = (items: OptionItem[], id: number | null | undefined) => {
    if (id == null) return '-';
    const label = findLabel(items, id);
    return label === '-' ? String(id) : label;
  };
  const getBranchName = (id: number) => nameOf(branches, id);

  const renderCell = (item: Student, colId: string) => {
    switch (colId) {
      case 'full_name':
        return item.full_name;
      case 'birth_date':
        return item.birth_date ? formatDate(item.birth_date) : '-';
      case 'username':
        return item.username;
      case 'branch':
        return getBranchName(item.branch_id);
      case 'groups':
        return item.groups && item.groups.length > 0 ? (
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}
          >
            {item.groups.map((g) => (
              <span key={g.id} className="groups-tag">
                {g.name}
              </span>
            ))}
          </div>
        ) : (
          '-'
        );
      case 'contract':
        return isContractConfirmed(item) ? (
          <i className="fa-solid fa-circle-check contract-yes"></i>
        ) : (
          <i className="fa-solid fa-circle-xmark contract-no"></i>
        );
      case 'created_at':
        return formatDateTime(item.created_at);
      case 'updated_at':
        return formatDateTime(item.updated_at);
      default:
        return '-';
    }
  };
  const getCourseName = (id: number) => nameOf(courses, id);
  const getLevelName = (id: number) => nameOf(levels, id);
  const getTeacherName = (id: number) => nameOf(teachers, id);
  const getRoomName = (id: number) => nameOf(rooms, id);

  const confirmedContractStudentIds = useMemo(() => {
    const ids = new Set<number>();
    [...confirmedStudentContracts, ...confirmedPreschoolContracts].forEach((contract) => {
      if (contract.status !== 'active') return;
      (Array.isArray(contract.contract_students) ? contract.contract_students : []).forEach((contractStudent) => {
        if (contractStudent.student_id != null) ids.add(Number(contractStudent.student_id));
      });
    });
    return ids;
  }, [confirmedStudentContracts, confirmedPreschoolContracts]);

  const isContractConfirmed = (student: Student) =>
    isEnabledFlag(student.is_contract_confirmed) || confirmedContractStudentIds.has(student.id);

  const availableGroups = useMemo(() => {
    const groups = new Map<number, StudentGroup>();
    (students ?? []).forEach((student) => {
      student.groups?.forEach((group) => groups.set(group.id, group));
    });
    return [...groups.values()].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), i18n.language));
  }, [students, i18n.language]);

  const sorted = useMemo(
    () => {
      const search = searchFilter.trim().toLocaleLowerCase(i18n.language);
      return (students || [])
        .filter((student) => !branchFilter || String(student.branch_id) === branchFilter)
        .filter((student) => !groupFilter || student.groups?.some((group) => String(group.id) === groupFilter))
        .filter((student) => {
          if (!contractFilter) return true;
          return isContractConfirmed(student) === (contractFilter === 'confirmed');
        })
        .filter((student) => {
          if (!activeFilter) return true;
          return isEnabledFlag(student.is_active) === (activeFilter === 'active');
        })
        .filter((student) => {
          if (!search) return true;
          return [student.full_name, student.username, student.student_code, student.phone, String(student.id)]
            .some((value) => String(value ?? '').toLocaleLowerCase(i18n.language).includes(search));
        })
        .slice()
        .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
    },
    [students, branchFilter, groupFilter, contractFilter, activeFilter, searchFilter, sortAsc, i18n.language, confirmedContractStudentIds],
  );

  // Backend sahifalarini yuqorida birlashtiramiz; quyidagi sahifalash va filtrlar
  // to‘liq ro‘yxat ustida mijoz tomonda ishlaydi.
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  );

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StudentPayload }) =>
      studentAPI.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      resetEditForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: studentAPI.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['students'] }),
  });

  const openViewModal = (item: Student) => {
    setViewingItem(item);
    setShowViewModal(true);
  };

  const toDateInput = (val: string | null | undefined) => {
    if (!val) return '';
    return val.slice(0, 10);
  };

  const openEditModal = (item: Student) => {
    setEditingItem(item);
    setFormData({
      first_name: item.first_name,
      last_name: item.last_name,
      username: item.username,
      password: '',
      birth_date: toDateInput(item.birth_date),
      phone: formatPhone(item.phone),
      branch_id: item.branch_id,
      gender: (item.gender || '').trim().toLowerCase(),
      father_name: item.father_name || '',
      is_active: item.is_active,
      is_contract_confirmed: isContractConfirmed(item),
    });
    setShowEditModal(true);
  };

  const confirmDelete = () => {
    const removingCount = deleteTarget === 'all' ? selected.length : 1;
    // Sahifadagi oxirgi yozuvlar o'chirilsa, bo'sh sahifada qolib ketmaslik uchun orqaga qaytamiz.
    const pageBecomesEmpty = (students?.length ?? 0) - removingCount <= 0 && currentPage > 1;

    if (deleteTarget === 'all') {
      selected.forEach((id) => deleteMutation.mutate(id));
      setSelected([]);
    } else if (typeof deleteTarget === 'number') {
      deleteMutation.mutate(deleteTarget);
      setSelected((p) => p.filter((x) => x !== deleteTarget));
    }

    if (pageBecomesEmpty) setCurrentPage((p) => p - 1);
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    setSelected([]);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    setSelected([]);
  };

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? pageRows.map((s) => s.id) : []);

  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const resetEditForm = () => {
    setShowEditModal(false);
    setEditingItem(null);
    setFormData({ first_name: '', last_name: '', username: '', password: '' });
  };

  const renderGroupCard = (group: StudentGroup, idx: number) => (
    <div className="group-card" key={group.id}>
      <div className="group-card-header">
        {idx + 1}. {group.name}
      </div>
      <div className="group-info-grid">
        <div className="group-info-item">
          <label>{t('students.branch')}</label>
          <span>{getBranchName(group.branch_id)}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.course')}</label>
          <span>{getCourseName(group.course_id)}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.level')}</label>
          <span>{getLevelName(group.level_id)}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.teacher')}</label>
          <span>{getTeacherName(group.teacher_id)}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.room')}</label>
          <span>{getRoomName(group.room_id)}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.maxStudents')}</label>
          <span>{group.max_students}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.startDate')}</label>
          <span>{group.start_date ? formatDate(group.start_date) : '-'}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.endDate')}</label>
          <span>{group.end_date ? formatDate(group.end_date) : '-'}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.duration')}</label>
          <span>
            {group.duration} {t('students.min')}
          </span>
        </div>
        <div className="group-info-item">
          <label>{t('students.startTime')}</label>
          <span>{group.start_time ?? '-'}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.endTime')}</label>
          <span>{group.end_time ?? '-'}</span>
        </div>
        <div className="group-info-item">
          <label>{t('students.status')}</label>
          <span>
            <ActiveBadge
              active={!!group.is_active}
              activeLabel={t('students.active')}
              inactiveLabel={t('students.inactive')}
            />
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <section className="users container">
      <h1 className="main-title">{t('students.title')}</h1>

      {/* View Modal */}
      {showViewModal && viewingItem && (
        <div className="modal-overlay">
          <div className="student-view-modal">
            <h2 className="student-view-title">{viewingItem.full_name}</h2>

            <div className="student-section-title">{t('students.personalInfo')}</div>
            <div className="student-info-grid">
              <div className="student-info-item">
                <label>{t('students.name')}</label>
                <span>{viewingItem.full_name}</span>
              </div>
              <div className="student-info-item">
                <label>{t('students.studentCode')}</label>
                <span>{viewingItem.student_code}</span>
              </div>
              <div className="student-info-item">
                <label>{t('students.birthDate')}</label>
                <span>{viewingItem.birth_date ? formatDate(viewingItem.birth_date) : '-'}</span>
              </div>
              <div className="student-info-item">
                <label>{t('students.phone')}</label>
                <span>{viewingItem.phone || '-'}</span>
              </div>
              <div className="student-info-item">
                <label>{t('students.login')}</label>
                <span>{viewingItem.username}</span>
              </div>
              <div className="student-info-item">
                <label>{t('students.balance')}</label>
                <span>{viewingItem.balance}</span>
              </div>
              <div className="student-info-item">
                <label>{t('students.lidId')}</label>
                <span>{viewingItem.lid_id ?? '-'}</span>
              </div>
              <div className="student-info-item">
                <label>{t('students.status')}</label>
                <span>
                  <ActiveBadge
                    active={!!viewingItem.is_active}
                    activeLabel={t('students.active')}
                    inactiveLabel={t('students.inactive')}
                  />
                </span>
              </div>
              <div className="student-info-item">
                <label>{t('students.contract')}</label>
                <span>
                  <ActiveBadge
                    active={isContractConfirmed(viewingItem)}
                    activeLabel={t('students.confirmed')}
                    inactiveLabel={t('students.notConfirmed')}
                  />
                </span>
              </div>
              <div className="student-info-item">
                <label>{t('students.createdAt')}</label>
                <span>{formatDateTime(viewingItem.created_at)}</span>
              </div>
              <div className="student-info-item">
                <label>{t('students.updatedAt')}</label>
                <span>{formatDateTime(viewingItem.updated_at)}</span>
              </div>
            </div>

            <div className="student-section-title">{t('students.groups')}</div>
            {viewingItem.groups && viewingItem.groups.length > 0 ? (
              viewingItem.groups.map((g, i) => renderGroupCard(g, i))
            ) : (
              <p style={{ color: '#999', fontSize: 14, textAlign: 'center', padding: '12px 0' }}>
                {t('students.noGroups')}
              </p>
            )}

            <div className="student-view-close">
              <button onClick={() => setShowViewModal(false)}>{t('students.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingItem && (
        <div className="modal-overlay">
          <div className="student-edit-modal">
            <h1>{t('students.editTitle')}</h1>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isValidUzPhone(formData.phone)) {
                  notifyWarning(t('common.phoneFormatError'));
                  return;
                }
                const payload = { ...formData, phone: normalizePhone(formData.phone) };
                if (!payload.password) delete payload.password;
                updateMutation.mutate({ id: editingItem.id, payload });
              }}
            >
              <div className="student-edit-columns">
                <div className="student-edit-column">
                  <div className="student-edit-group">
                    <label>{t('students.lastName')}</label>
                    <input
                      type="text"
                      value={formData.last_name}
                      onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.firstName')}</label>
                    <input
                      type="text"
                      value={formData.first_name}
                      onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.fatherName')}</label>
                    <input
                      type="text"
                      value={formData.father_name || ''}
                      onChange={(e) => setFormData({ ...formData, father_name: e.target.value })}
                    />
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.birthDate')}</label>
                    <input
                      type="date"
                      value={formData.birth_date || ''}
                      onChange={(e) => setFormData({ ...formData, birth_date: e.target.value })}
                    />
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.phone')}</label>
                    <input
                      type="tel"
                      placeholder="+998901234567"
                      value={formData.phone || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, phone: formatPhone(e.target.value) })
                      }
                    />
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.gender')}</label>
                    <select
                      value={formData.gender || ''}
                      onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    >
                      <option value="">{t('students.selectGender')}</option>
                      <option value="male">{t('students.male')}</option>
                      <option value="female">{t('students.female')}</option>
                    </select>
                  </div>
                </div>

                <div className="student-edit-column">
                  <div className="student-edit-group">
                    <label>{t('students.branch')}</label>
                    <select
                      value={formData.branch_id ?? ''}
                      onChange={(e) =>
                        setFormData({ ...formData, branch_id: Number(e.target.value) || undefined })
                      }
                    >
                      <option value="">{t('students.selectBranch')}</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.contract')}</label>
                    <select
                      disabled={!canChangeContractStatus}
                      title={
                        canChangeContractStatus
                          ? undefined
                          : t('students.contractStatusNeedsPermission', 'Shartnoma holatini o‘zgartirish uchun «O‘quvchi shartnomalari → Tahrirlash» ruxsati kerak')
                      }
                      value={
                        formData.is_contract_confirmed === undefined
                          ? ''
                          : String(formData.is_contract_confirmed)
                      }
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          is_contract_confirmed: e.target.value === 'true',
                        })
                      }
                    >
                      <option value="">{t('students.selectContract')}</option>
                      <option value="true">{t('students.confirmed')}</option>
                      <option value="false">{t('students.notConfirmed')}</option>
                    </select>
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.status')}</label>
                    <select
                      value={formData.is_active === undefined ? '' : String(formData.is_active)}
                      onChange={(e) =>
                        setFormData({ ...formData, is_active: e.target.value === 'true' })
                      }
                    >
                      <option value="">{t('students.selectStatus')}</option>
                      <option value="true">{t('students.active')}</option>
                      <option value="false">{t('students.inactive')}</option>
                    </select>
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.login')}</label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      required
                    />
                  </div>

                  <div className="student-edit-group">
                    <label>{t('students.newPassword')}</label>
                    <div className="password-input-wrapper">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={formData.password || ''}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder={t('students.passwordPlaceholder')}
                      />
                      <button
                        type="button"
                        className="password-eye-btn"
                        onClick={() => setShowPassword((p) => !p)}
                      >
                        <i className={showPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'} />
                      </button>
                    </div>
                    <span className="password-hint">{t('students.passwordHint')}</span>
                  </div>
                </div>
              </div>

              <div className="student-edit-actions">
                <button className="primary" type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? t('students.saving') : t('students.save')}
                </button>
                <button type="button" className="cancel" onClick={resetEditForm}>
                  {t('students.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('students.confirmDelete')}</h3>
            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('students.delete')}
              </button>
              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('students.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="users-filters">
        <Protected permission="students.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              setDeleteTarget('all');
              setShowDeleteModal(true);
            }}
          >
            {t('students.delete')}
          </button>
        </Protected>

        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setCurrentPage(1);
            setSelected([]);
          }}
        >
          <option value="">{t('students.branch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <select
          value={groupFilter}
          onChange={(e) => {
            setGroupFilter(e.target.value);
            setCurrentPage(1);
            setSelected([]);
          }}
        >
          <option value="">{t('students.groups')}</option>
          {availableGroups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
        <input
          type="search"
          value={searchFilter}
          placeholder={t('students.searchPlaceholder')}
          aria-label={t('students.searchPlaceholder')}
          onChange={(e) => {
            setSearchFilter(e.target.value);
            setCurrentPage(1);
            setSelected([]);
          }}
        />
        <select
          value={contractFilter}
          onChange={(e) => {
            setContractFilter(e.target.value);
            setCurrentPage(1);
            setSelected([]);
          }}
        >
          <option value="">{t('students.contract')}</option>
          <option value="confirmed">{t('students.confirmed')}</option>
          <option value="not_confirmed">{t('students.notConfirmed')}</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) => {
            setActiveFilter(e.target.value);
            setCurrentPage(1);
            setSelected([]);
          }}
        >
          <option value="">{t('students.status')}</option>
          <option value="active">{t('students.active')}</option>
          <option value="inactive">{t('students.inactive')}</option>
        </select>
        {(branchFilter || groupFilter || searchFilter || contractFilter || activeFilter) && (
          <button
            className="students-clear-filters"
            onClick={() => {
              setBranchFilter('');
              setGroupFilter('');
              setSearchFilter('');
              setContractFilter('');
              setActiveFilter('');
              setCurrentPage(1);
              setSelected([]);
            }}
          >
            {t('students.clearFilters')}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="users-table-wrapper">
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    pageRows.length > 0 && pageRows.every((s) => selected.includes(s.id))
                  }
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
              <th>{t('students.actions')}</th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : pageRows.length ? (
              pageRows.map((item) => (
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
                    <td key={colId}>{renderCell(item, colId)}</td>
                  ))}
                  <td className="actions">
                    <Protected permission="students.show">
                      <button className="user-view-btn" onClick={() => openViewModal(item)}>
                        <i className="fa-solid fa-eye"></i>
                      </button>
                    </Protected>
                    <Protected permission="students.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(item)}>
                        <i className="fa-solid fa-pen"></i>
                      </button>
                    </Protected>
                    <Protected permission="students.delete">
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
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('students.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && total > 0 && (
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      )}
    </section>
  );
};

export default Students;
