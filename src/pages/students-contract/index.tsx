import { useBulkDelete } from '@/hooks/useBulkDelete';
import { usePermission } from '@/hooks/usePermission';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTableColumns } from '../../hooks/useTableColumns';
import useAuthStore from '@/store/useAuthStore';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';
import './studentsContracts.css';
import {
  emptyStudent,

  type StudentContract,
  type StudentFormData,
} from '@/types/studentContract.types';
import type { Lid } from '@/types/lid.types';
import type { Group } from '@/types/group.types';
import { notifications } from '@mantine/notifications';
import { API } from '@/api/api';
import { fetchAllPages } from '@/api/fetchAllPages';
import { sortByNewest } from '@/utils/sortByNewest';
import { formatPhone, isValidUzPhone, normalizePhone } from '@/utils/phone';
import { lookupPersonByJshshir, applyPersonMatch } from './jshshirLookup';
import { useOptions, optionLabel } from '@/api/options';
import useRequiredFields from '@/hooks/useRequiredFields';
import StudentContractView from './StudentContractView';
import '@/pages/preschool-contracts/preschoolContract.css';
import DateInput from '@/components/DateInput';
import PhoneInput from '@/components/PhoneInput';
import FilterButton from '@/components/FilterButton';
import FilterBar, { type FilterBarField } from '@/components/FilterBar';
import PaginationBar from '@/components/Pagination/PaginationBar';
import { countFilterBarValues } from '@/components/FilterBar/filterBar.utils';
import { notifyWarning } from '@/utils/notify';
import { hasPermissionBypass } from '@/utils/fullAccess';
import { useContractSms } from '@/hooks/useContractSms';
import { isSmsContractType, smsPermissionFor } from '@/api/contractSms';

type ScFilterKey = 'branch' | 'course' | 'group' | 'status' | 'date';

const EMPTY_SC_FILTERS: Record<ScFilterKey, string> = {
  branch: '',
  course: '',
  group: '',
  status: '',
  date: '',
};

const getStatusKey = (status: string): string => {
  switch (status) {
    case 'active':
      return 'studentsContract.status.active';
    case 'completed':
      return 'studentsContract.status.completed';
    case 'in_progress':
      return 'studentsContract.status.inProgress';
    case 'cancelled':
      return 'studentsContract.status.cancelled';
    case 'expired':
      return 'studentsContract.status.expired';
    default:
      return 'studentsContract.status.inProgress';
  }
};

const getMainPerson = (item: StudentContract) => {
  const phoneCandidates = [
    ...(item.contract_students ?? []).flatMap((student) => [
      student.phone,
      ...(student.extra_phones ?? []),
    ]),
    item.representative?.phone,
    ...(item.representative?.extra_phones ?? []),
    ...(item.representatives ?? []).flatMap((representative) => [
      representative.phone,
      ...(representative.extra_phones ?? []),
    ]),
    item.organization?.phone,
  ];
  const phone =
    phoneCandidates.find((value) => Boolean(value?.trim() && value.trim() !== '+998'))?.trim() ?? '';
  const student = item.contract_students?.[0];
  if (student && (student.first_name || student.last_name)) {
    return {
      name: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
      phone,
    };
  }

  if (item.representative) {
    return {
      name: `${item.representative.first_name || ''} ${item.representative.last_name || ''}`.trim(),
      phone,
    };
  }

  return { name: item.organization?.organization_name || "Noma'lum", phone };
};

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${hours}:${minutes} ${day}.${month}.${year}`;
};

const getCourseGroup = (item: StudentContract) => {
  const student = item.contract_students?.[0];
  return {
    course: student?.level?.name_uz || 'Kiritilmagan',
    group: student?.group?.name || 'Kiritilmagan',
  };
};

// Helper: convert ISO date string to YYYY-MM-DD for date inputs
const formatDateForInput = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '';
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // ISO format: extract date part
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const AdultContractForm = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { id } = useParams();
  const { formRef, validate } = useRequiredFields();
  const [formData, setFormData] = useState<StudentFormData>({
    ...emptyStudent,
  });
  const [studentId, setStudentId] = useState<number | null>(null);
  const [lidSearchTerm, setLidSearchTerm] = useState('');
  const [showLidDropdown, setShowLidDropdown] = useState(false);
  const pendingLidIdRef = useRef<number | null>(
    (location.state as { lidId?: number } | null)?.lidId ?? null,
  );

  const { data: contractToEdit, isLoading: isFetchingContract } = useQuery({
    queryKey: ['student-contract', id],
    queryFn: () => API.get(`/student-contracts/${id}`).then((res) => res.data),
    enabled: !!id,
  });

  useEffect(() => {
    if (contractToEdit && id) {
      const contract = contractToEdit.contract || contractToEdit.data || contractToEdit;
      const student = contract.contract_students?.[0];
      if (student) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStudentId(student.id || null);
        setFormData({
          lid_id: String(student.lid_id),
          jshshir: student.jshshir || '',
          language: contract.language || 'uz',
          citizenship: student.citizenship || 'citizen',
          branch_id: contract.branch_id ? String(contract.branch_id) : '',
          city: contract.branch?.city || '',
          passport_series: (student.passport_series || '').toUpperCase(),
          passport_number: student.passport_number || '',
          passport_given_date: formatDateForInput(student.passport_given_date),
          passport_expiry_date: formatDateForInput(student.passport_expiry_date),
          passport_given_by: student.passport_given_by || '',
          birth_place: student.birth_place || '',
          last_name: student.last_name || '',
          first_name: student.first_name || '',
          father_name: student.father_name || '',
          birth_date: formatDateForInput(student.birth_date),
          group_id: student.group_id ? String(student.group_id) : '',
          course_id: student.course_id ? String(student.course_id) : '',
          level_id: student.level_id ? String(student.level_id) : '',
          // Asosiy raqam birinchi, qo'shimcha raqamlar ortidan (formadagi tartibda)
          phones: [
            student.phone ? formatPhone(student.phone) : '+998',
            ...(student.extra_phones || []).map(formatPhone),
          ],
          residential_address: student.residential_address || '',
          registered_address: student.registered_address || '',
          monthly_price: student.monthly_price ? String(student.monthly_price) : '',
          total_price: student.total_price ? String(student.total_price) : '',
          course_start_date: formatDateForInput(student.course_start_date),
          course_end_date: formatDateForInput(student.course_end_date),
          contract_date: formatDateForInput(contract.contract_date),
          end_date: formatDateForInput(contract.end_date),
          notes: contract.notes || '',
        });

        setLidSearchTerm(String(student.lid_id));
      }
    }
  }, [contractToEdit, id]);

  // Lid qidiruvi — faqat rolda «Lidlar» sahifasi bo'lsa (ruxsatsiz so'rov yuborilmaydi).
  const canViewLids = usePermission('lids.view');
  const { data: allLids, isFetching: isSearching } = useQuery({
    queryKey: ['lids-all'],
    enabled: canViewLids,
    queryFn: () =>
      API.get('/lids', { params: { per_page: 1000 } }).then((res) =>
        Array.isArray(res.data) ? res.data : res.data?.data || [],
      ),
  });

  const { data: allBranches } = useOptions('branches');

  const { data: allGroups } = useOptions('groups');
  const { data: allCourses } = useOptions('courses');
  const matchingGroups = useMemo(
    () =>
      (allGroups ?? []).filter(
        (group) =>
          String(group.course_id) === formData.course_id &&
          String(group.level_id) === formData.level_id,
      ),
    [allGroups, formData.course_id, formData.level_id],
  );

  const searchResults = useMemo(() => {
    if (!lidSearchTerm) return [];
    const term = lidSearchTerm.toLowerCase();
    return (allLids || [])
      .filter((lid: Lid) => {
        const fullName = `${lid.first_name || ''} ${lid.last_name || ''}`.toLowerCase();
        const idStr = String(lid.id);
        return idStr === term || fullName.includes(term);
      })
      .slice(0, 10);
  }, [allLids, lidSearchTerm]);

  const handleLidSelect = (lid: Lid) => {
    const addressStr = [
      lid.region?.name_uz || lid.region?.name_uz,
      lid.district?.name_uz || lid.district?.name_uz,
    ]
      .filter(Boolean)
      .join(', ');

    setFormData((prev) => ({
      ...prev,
      lid_id: String(lid.id),
      first_name: lid.first_name || prev.first_name,
      last_name: lid.last_name || prev.last_name,
      father_name: lid.father_name || prev.father_name,
      birth_date: lid.birth_date || prev.birth_date,
      phones: lid.phone ? [formatPhone(lid.phone)] : prev.phones,
      course_id: lid.course_id ? String(lid.course_id) : prev.course_id,
      group_id: lid.group_id ? String(lid.group_id) : prev.group_id,
      level_id: lid.level_id ? String(lid.level_id) : prev.level_id,
      residential_address: addressStr || prev.residential_address,
      monthly_price: lid.course_price?.new_price
        ? String(lid.course_price.new_price)
        : prev.monthly_price,
    }));

    setLidSearchTerm(String(lid.id));
    setShowLidDropdown(false);
  };

  useEffect(() => {
    if (!allLids || !pendingLidIdRef.current) return;
    const lid = (allLids as Lid[]).find((l) => l.id === pendingLidIdRef.current);
    if (lid) {
      pendingLidIdRef.current = null;
      window.history.replaceState({}, '');
      handleLidSelect(lid);
    }
  }, [allLids]);

  const handleChange = <K extends keyof StudentFormData>(field: K, value: StudentFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // JSHSHR to'liq (14 raqam) kiritilganda — bazadan odamni topib, mavjud
  // ma'lumotlarini formaga to'ldiradi (faqat yangi shartnomada — `id` yo'q).
  const handleJshshirInput = async (raw: string) => {
    const val = raw.replace(/\D/g, '').slice(0, 14);
    handleChange('jshshir', val);
    if (id || val.length !== 14) return;
    const match = await lookupPersonByJshshir(val);
    if (!match) return;
    setFormData((prev) => (prev.jshshir === val ? applyPersonMatch(prev, match) : prev));
    notifications.show({
      color: 'green',
      message: t('studentsContract.autofill.found', { name: match.displayName }),
    });
  };

  // Auto-fill dates and calculate total price when group is selected
  useEffect(() => {
    if (formData.group_id && allGroups) {
      const groups = allGroups as Group[];
      const selectedGroup = groups.find((g) => String(g.id) === formData.group_id);
      if (selectedGroup) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFormData((prev) => {
          // Only update if dates are empty or just changed group
          const newStartDate = formatDateForInput(selectedGroup.start_date);
          const newEndDate = formatDateForInput(selectedGroup.end_date);

          if (prev.course_start_date !== newStartDate || prev.course_end_date !== newEndDate) {
            return {
              ...prev,
              course_start_date: newStartDate,
              course_end_date: newEndDate,
            };
          }
          return prev;
        });
      }
    }
  }, [formData.group_id, allGroups]);

  // Auto-calculate total price based on monthly_price and duration
  useEffect(() => {
    if (formData.monthly_price && formData.course_start_date && formData.course_end_date) {
      const start = new Date(formData.course_start_date);
      const end = new Date(formData.course_end_date);

      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const months =
          (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        const total = Number(formData.monthly_price) * Math.max(months, 1);

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setFormData((prev) => ({ ...prev, total_price: String(total) }));
      }
    }
  }, [formData.monthly_price, formData.course_start_date, formData.course_end_date]);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => API.post('/student-contracts', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-contracts'] });
      navigate('/students-contract');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => API.put(`/student-contracts/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-contracts'] });
      navigate('/students-contract');
    },
  });

  const handleSubmit = () => {
    if (!validate()) return;
    // Asosiy raqam ham, qo'shimchalari ham +998 va 9 ta raqam formatida bo'lishi kerak.
    if (formData.phones.some((p) => !isValidUzPhone(p))) {
      notifyWarning(t('common.phoneFormatError'));
      return;
    }

    const studentPayload: Record<string, unknown> = {
      lid_id: Number(formData.lid_id),
      is_minor: false,
      jshshir: formData.jshshir,
      first_name: formData.first_name,
      last_name: formData.last_name,
      father_name: formData.father_name,
      birth_date: formData.birth_date,
      phone: normalizePhone(formData.phones[0]),
      extra_phones: formData.phones.slice(1).map(normalizePhone).filter(isValidUzPhone),
      passport_series: formData.passport_series,
      passport_number: formData.passport_number,
      passport_given_date: formData.passport_given_date,
      passport_expiry_date: formData.passport_expiry_date,
      passport_given_by: formData.passport_given_by,
      registered_address: formData.registered_address || formData.residential_address,
      residential_address: formData.residential_address,
      course_id: Number(formData.course_id),
      level_id: Number(formData.level_id),
      group_id: Number(formData.group_id),
      monthly_price: Number(formData.monthly_price) || 0,
      total_price: Number(formData.total_price) || 0,
      course_start_date: formData.course_start_date,
      course_end_date: formData.course_end_date,
    };

    // Include student id for update
    if (id && studentId) {
      studentPayload.id = studentId;
    }

    const payload = {
      contract_type: 'adult',
      language: formData.language,
      branch_id: Number(formData.branch_id) || 1,
      contract_date: formData.contract_date,
      end_date: formData.end_date || null,
      notes: formData.notes,
      students: [studentPayload],
    };

    if (id) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  if (id && isFetchingContract) {
    return (
      <div className="students-contract container" style={{ marginTop: 50, marginLeft: 140 }}>
        <div style={{ textAlign: 'center', padding: 40 }}>{t('studentsContract.form.loading')}</div>
      </div>
    );
  }

  return (
    <div
      className="students-contract container"
      style={{ marginTop: 50, marginLeft: 140 }}
      ref={formRef}
    >
      <div
        className="sc-page-top"
        style={{
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div
          className="sc-page-top-icon"
          style={{
            background: '#FFEFDB',
            color: '#FE9100',
            padding: '10px 24px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
          }}
        >
          <i className="fa-solid fa-user"></i>
        </div>
        <span
          className="sc-page-top-title"
          style={{
            textTransform: 'uppercase',
            fontFamily: 'noto-sb',
            fontSize: '16px',
            color: '#000',
          }}
        >
          {t('studentsContract.form.title')}
        </span>
      </div>

      <div className="sc-section-card">
        <div
          className="sc-section-card-header"
          style={{
            justifyContent: 'center',
            background: '#0f3460',
            borderRadius: '10px',
            margin: '16px',
            padding: '12px 24px',
          }}
        >
          <span
            style={{
              color: '#fff',
              fontFamily: 'noto-b',
              fontSize: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {t('studentsContract.form.step1')}
          </span>
        </div>

        <div className="sc-section-card-body">
          {/* User panel bilan bir xil 12 ustunli tarmoq — har bir maydon o'z
              kengligini `sc-col-*` bilan oladi (`studentsContracts.css`). */}
          <div className="sc-form-grid cols-12" style={{ gap: '14px 16px', marginBottom: '16px' }}>
            <div className="sc-form-group sc-col-3" style={{ position: 'relative' }}>
              <label className="sc-form-label">
                {t('studentsContract.form.lidId')} <span>*</span>
              </label>
              <input
                type="text"
                className="sc-form-input"
                placeholder={t('studentsContract.form.lidSearchPlaceholder')}
                value={lidSearchTerm || formData.lid_id}
                onChange={(e) => {
                  setLidSearchTerm(e.target.value);
                  handleChange('lid_id', e.target.value);
                  setShowLidDropdown(true);
                }}
                onFocus={() => setShowLidDropdown(true)}
                onBlur={() => setTimeout(() => setShowLidDropdown(false), 200)}
              />
              {showLidDropdown && lidSearchTerm.length > 0 && (
                <div
                  className="sc-lid-dropdown"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    marginTop: '4px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    zIndex: 10,
                  }}
                >
                  {isSearching ? (
                    <div
                      style={{
                        padding: '12px',
                        textAlign: 'center',
                        color: '#64748b',
                        fontSize: '13px',
                      }}
                    >
                      {t('studentsContract.form.searching')}
                    </div>
                  ) : searchResults && searchResults.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr
                          style={{
                            background: '#f8faff',
                            borderBottom: '1px solid #e2e8f0',
                          }}
                        >
                          <th
                            style={{
                              padding: '8px 12px',
                              textAlign: 'left',
                              fontSize: '12px',
                              color: '#64748b',
                              fontWeight: 600,
                            }}
                          >
                            {t('studentsContract.form.dropdownId')}
                          </th>
                          <th
                            style={{
                              padding: '8px 12px',
                              textAlign: 'left',
                              fontSize: '12px',
                              color: '#64748b',
                              fontWeight: 600,
                            }}
                          >
                            {t('studentsContract.form.dropdownName')}
                          </th>
                          <th
                            style={{
                              padding: '8px 12px',
                              textAlign: 'left',
                              fontSize: '12px',
                              color: '#64748b',
                              fontWeight: 600,
                            }}
                          >
                            {t('studentsContract.form.dropdownPhone')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchResults.map((lid: Lid) => (
                          <tr
                            key={lid.id}
                            style={{
                              borderBottom: '1px solid #f1f5f9',
                              cursor: 'pointer',
                              transition: 'background 0.2s',
                            }}
                            onClick={() => handleLidSelect(lid)}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f5ff')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <td
                              style={{
                                padding: '8px 12px',
                                fontSize: '13px',
                                color: '#1e293b',
                              }}
                            >
                              {lid.id}
                            </td>
                            <td
                              style={{
                                padding: '8px 12px',
                                fontSize: '13px',
                                color: '#1e293b',
                              }}
                            >
                              {lid.first_name} {lid.last_name}
                            </td>
                            <td
                              style={{
                                padding: '8px 12px',
                                fontSize: '13px',
                                color: '#1e293b',
                              }}
                            >
                              {lid.phone}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div
                      style={{
                        padding: '12px',
                        textAlign: 'center',
                        color: '#64748b',
                        fontSize: '13px',
                      }}
                    >
                      {t('studentsContract.form.notFound')}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="sc-form-group sc-col-5">
              <label className="sc-form-label">
                {t('studentsContract.form.jshshir')} <span>*</span>
              </label>
              <input
                type="text"
                className="sc-form-input"
                placeholder="00000000000000"
                maxLength={14}
                value={formData.jshshir}
                style={
                  formData.jshshir.length > 0 && formData.jshshir.length < 14
                    ? { borderColor: '#ef4444' }
                    : {}
                }
                onChange={(e) => {
                  void handleJshshirInput(e.target.value);
                }}
              />
            </div>

            <div className="sc-form-group sc-row-start sc-col-2">
              <label className="sc-form-label">
                {t('studentsContract.form.language')} <span>*</span>
              </label>
              <select
                className="sc-form-select"
                value={formData.language}
                onChange={(e) => handleChange('language', e.target.value)}
              >
                <option value="uz">UZ</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
            </div>
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.citizenship')} <span>*</span>
              </label>
              <select
                className="sc-form-select"
                value={formData.citizenship}
                onChange={(e) => handleChange('citizenship', e.target.value)}
              >
                <option value="citizen">{t('studentsContract.form.citizenUz')}</option>
                <option value="foreign">{t('studentsContract.form.citizenForeign')}</option>
              </select>
            </div>

            <div className="sc-form-group sc-row-start sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.branch')} <span>*</span>
              </label>
              <select
                className="sc-form-select"
                value={formData.branch_id}
                onChange={(e) => {
                  const branchId = e.target.value;
                  const branch = (allBranches || []).find((b) => String(b.id) === branchId);
                  setFormData((prev) => ({
                    ...prev,
                    branch_id: branchId,
                    city: branch?.city || '',
                  }));
                }}
              >
                <option value="">{t('studentsContract.form.select')}</option>
                {(allBranches || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sc-form-group sc-col-5">
              <label className="sc-form-label">{t('studentsContract.form.city')}</label>
              <input
                type="text"
                className="sc-form-input"
                value={formData.city}
                readOnly
                style={{ background: '#f1f5f9', color: '#64748b', cursor: 'not-allowed' }}
              />
            </div>
            <div className="sc-form-group sc-col-4">
              <label className="sc-form-label">
                {t('studentsContract.form.contractDate')} <span>*</span>
              </label>
              <DateInput
                className="sc-form-input"
                value={formData.contract_date}
                onChange={(e) => handleChange('contract_date', e.target.value)}
              />
            </div>
          </div>

          <div className="sc-form-grid cols-12" style={{ gap: '14px 16px' }}>
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.passport')} <span>*</span>
              </label>
              <div className="sc-passport-group" style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  className="sc-form-input"
                  style={{ width: '70px', textTransform: 'uppercase' }}
                  placeholder="AA"
                  maxLength={2}
                  value={formData.passport_series}
                  onChange={(e) => {
                    const val = e.target.value
                      .replace(/[^a-zA-Z]/g, '')
                      .toUpperCase()
                      .slice(0, 2);
                    handleChange('passport_series', val);
                  }}
                />
                <input
                  type="text"
                  className="sc-form-input"
                  style={{ flex: 1 }}
                  placeholder="1234567"
                  maxLength={7}
                  value={formData.passport_number}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 7);
                    handleChange('passport_number', val);
                  }}
                />
              </div>
            </div>
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.passportGivenDate')} <span>*</span>
              </label>
              <DateInput
                className="sc-form-input"
                value={formData.passport_given_date}
                onChange={(e) => handleChange('passport_given_date', e.target.value)}
              />
            </div>

            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.passportExpiry')} <span>*</span>
              </label>
              <DateInput
                className="sc-form-input"
                value={formData.passport_expiry_date}
                onChange={(e) => handleChange('passport_expiry_date', e.target.value)}
              />
            </div>
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.passportGivenBy')} <span>*</span>
              </label>
              <input
                type="text"
                className="sc-form-input"
                placeholder="Kiriting"
                value={formData.passport_given_by}
                onChange={(e) => handleChange('passport_given_by', e.target.value)}
              />
            </div>

            <div className="sc-form-group sc-row-start sc-col-4">
              <label className="sc-form-label">
                {t('studentsContract.form.lastName')} <span>*</span>
              </label>
              <input
                type="text"
                className="sc-form-input"
                placeholder="Kiriting"
                value={formData.last_name}
                onChange={(e) => handleChange('last_name', e.target.value)}
              />
            </div>

            <div className="sc-form-group sc-col-4">
              <label className="sc-form-label">
                {t('studentsContract.form.firstName')} <span>*</span>
              </label>
              <input
                type="text"
                className="sc-form-input"
                placeholder="Kiriting"
                value={formData.first_name}
                onChange={(e) => handleChange('first_name', e.target.value)}
              />
            </div>
            <div className="sc-form-group sc-col-4">
              <label className="sc-form-label">
                {t('studentsContract.form.fatherName')} <span>*</span>
              </label>
              <input
                type="text"
                className="sc-form-input"
                placeholder="Kiriting"
                value={formData.father_name}
                onChange={(e) => handleChange('father_name', e.target.value)}
              />
            </div>

            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.birthDate')} <span>*</span>
              </label>
              <DateInput
                className="sc-form-input"
                value={formData.birth_date}
                onChange={(e) => handleChange('birth_date', e.target.value)}
              />
            </div>

            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.course')} <span>*</span>
              </label>
              <select
                className="sc-form-select"
                value={formData.course_id}
                onChange={(e) => {
                  handleChange('course_id', e.target.value);
                  handleChange('level_id', ''); // Reset level when course changes
                  handleChange('group_id', '');
                }}
              >
                <option value="">{t('studentsContract.form.select')}</option>
                {(allCourses || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.level')} <span>*</span>
              </label>
              <select
                className="sc-form-select"
                value={formData.level_id}
                onChange={(e) => {
                  handleChange('level_id', e.target.value);
                  handleChange('group_id', '');
                }}
              >
                <option value="">{t('studentsContract.form.select')}</option>
                {(
                  (allCourses || []).find((c) => String(c.id) === formData.course_id)?.levels || []
                ).map((l) => (
                  <option key={l.id} value={l.id}>
                    {optionLabel(l, i18n.language)}
                  </option>
                ))}
              </select>
            </div>
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.group')} <span>*</span>
              </label>
              <select
                className="sc-form-select"
                value={formData.group_id}
                disabled={!formData.course_id || !formData.level_id || matchingGroups.length === 0}
                onChange={(e) => handleChange('group_id', e.target.value)}
              >
                <option value="">
                  {formData.course_id && formData.level_id && matchingGroups.length === 0
                    ? t('demoLesson.modal.noMatchingGroups')
                    : t('studentsContract.form.select')}
                </option>
                {matchingGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            {/* Har bir telefon raqami alohida maydon — qolgan maydonlar bilan bir xil
                o'lchamda, qatorda uchtadan joylashadi. Uchtadan oshsa keyingi
                qatorga tushib davom etadi. User panel bilan bir xil. */}
            {formData.phones.map((phone, index) => (
              <div key={index} className="sc-form-group sc-col-4">
                <label className="sc-form-label">
                  {t('studentsContract.form.phone')} <span>*</span>
                </label>
                <div className="sc-phone-item">
                  <PhoneInput
                    className="sc-form-input"
                    value={phone}
                    onChange={(v) => {
                      const newPhones = [...formData.phones];
                      newPhones[index] = v;
                      handleChange('phones', newPhones);
                    }}
                  />
                  {index > 0 && (
                    <button
                      type="button"
                      className="sc-phone-remove"
                      title="O'chirish"
                      onClick={() => {
                        const newPhones = formData.phones.filter((_, i) => i !== index);
                        handleChange('phones', newPhones);
                      }}
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="sc-form-group sc-col-4">
              <span className="sc-form-label" aria-hidden="true">
                &nbsp;
              </span>
              <button
                type="button"
                className="sc-phone-add"
                onClick={() => handleChange('phones', [...formData.phones, '+998'])}
              >
                <i className="fas fa-plus"></i>
                Telefon qo'shish
              </button>
            </div>
            <div className="sc-form-group sc-row-start sc-col-6">
              <label className="sc-form-label">
                {t('studentsContract.form.residentialAddress')} <span>*</span>
              </label>
              <input
                type="text"
                className="sc-form-input"
                placeholder="Kiriting"
                value={formData.residential_address}
                onChange={(e) => handleChange('residential_address', e.target.value)}
              />
            </div>
            <div className="sc-form-group sc-col-6">
              <label className="sc-form-label">{t('studentsContract.form.registeredAddress')}</label>
              <input
                type="text"
                className="sc-form-input"
                placeholder="Kiriting"
                value={formData.registered_address}
                onChange={(e) => handleChange('registered_address', e.target.value)}
              />
            </div>

            {/* Kurs narxlari */}
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.monthlyPrice')} <span>*</span>
              </label>
              <input
                type="number"
                className="sc-form-input"
                placeholder="500000"
                value={formData.monthly_price}
                onChange={(e) => handleChange('monthly_price', e.target.value)}
              />
            </div>
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.totalPrice')} <span>*</span>
              </label>
              <input
                type="number"
                className="sc-form-input"
                placeholder="3000000"
                value={formData.total_price}
                onChange={(e) => handleChange('total_price', e.target.value)}
              />
            </div>
            <div className="sc-form-group sc-row-start sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.courseStartDate')} <span>*</span>
              </label>
              <DateInput
                className="sc-form-input"
                value={formData.course_start_date}
                onChange={(e) => handleChange('course_start_date', e.target.value)}
              />
            </div>
            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.courseEndDate')} <span>*</span>
              </label>
              <DateInput
                className="sc-form-input"
                value={formData.course_end_date}
                onChange={(e) => handleChange('course_end_date', e.target.value)}
              />
            </div>

            <div className="sc-form-group sc-col-3">
              <label className="sc-form-label">
                {t('studentsContract.form.contractEndDate')} <span>*</span>
              </label>
              <DateInput
                className="sc-form-input"
                value={formData.end_date}
                onChange={(e) => handleChange('end_date', e.target.value)}
              />
            </div>
            {/* Izoh — user panelda yo'q, faqat adminga xos maydon. */}
            <div className="sc-form-group sc-col-9">
              <label className="sc-form-label">
                {t('studentsContract.form.notes')} <span>*</span>
              </label>
              <input
                type="text"
                className="sc-form-input"
                placeholder={t('studentsContract.form.notesPlaceholder')}
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="sc-form-actions" style={{ justifyContent: 'flex-end', paddingRight: 16 }}>
        <button
          className="sc-form-save-btn"
          style={{
            background: '#FE9100',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 'normal',
            fontSize: '14px',
            padding: '10px 14px',
          }}
          onClick={handleSubmit}
          disabled={createMutation.isPending || updateMutation.isPending}
        >
          {createMutation.isPending || updateMutation.isPending
            ? t('studentsContract.form.saving')
            : t('studentsContract.form.save')}
        </button>
        <button
          className="sc-form-cancel-btn"
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            color: '#374151',
            borderRadius: '8px',
          }}
          onClick={() => navigate('/students-contract')}
        >
          {t('studentsContract.form.cancel')}
        </button>
      </div>
    </div>
  );
};

const StudentsContract = () => {
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<Record<ScFilterKey, string>>(EMPTY_SC_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortAsc, setSortAsc] = useState(false);
  const [printContractId, setPrintContractId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { isVisible, visibleColumns } = useTableColumns('studentsContract');
  const colCount = 1 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const user = useAuthStore((s) => s.user);
  const isAdmin = hasPermissionBypass(user);
  const permissions = (user?.roles ?? []).flatMap(
    (role) => role.permissions?.map((p) => p.name) ?? [],
  );
  const can = (p: string) => isAdmin || permissions.includes(p);

  const isAdultForm = location.pathname.includes('/students-contract/adult');

  // Butun ro'yxat bir marta olinadi: backend maktabga tayyorlov shartnomalarini ham beradi, ularni chiqarib
  // tashlash (alohida bo'limda) sahifalash va «Jami» ni buzmasligi uchun qidiruv/filtr/sahifalash klientda.
  const { data: contractsRaw, isLoading } = useQuery<StudentContract[]>({
    queryKey: ['student-contracts', 'all'],
    queryFn: () => fetchAllPages<StudentContract>('/student-contracts'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: !isAdultForm,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => API.delete(`/student-contracts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-contracts'] });
    },
  });

  // Tasdiqlash SMS'ini qayta yuborish: avval tasdiqlash oynasi (kimga ketishi ko'rsatiladi), keyin so'rov.
  const contractSms = useContractSms(() => queryClient.invalidateQueries({ queryKey: ['student-contracts'] }));

  /** Backend qabul qiluvchini shunday tanlaydi: voyaga yetmagan/maktabga tayyorlov — vakil, voyaga yetgan — o'quvchi. */
  const smsRecipientPhone = (item: StudentContract): string => {
    const studentPhone = item.contract_students?.[0]?.phone || '';
    const repPhone = item.representative?.phone || '';
    return item.contract_type === 'minor' || item.contract_type === 'preschool' ? repPhone || studentPhone : studentPhone;
  };

  const allContracts = sortByNewest((contractsRaw ?? []).filter((c) => c.contract_type !== 'preschool'));

  // Filial/guruh/yo'nalishda `id` kelmaydi (faqat nom), shuning uchun variantlar
  // ro'yxatning o'zidan yig'iladi va nom bo'yicha solishtiriladi.
  const uniqueValues = (pick: (c: StudentContract) => string) =>
    [...new Set(allContracts.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const contractBranch = (c: StudentContract) => c.branch?.name_uz || c.branch?.city || '';
  const contractGroup = (c: StudentContract) => c.contract_students?.[0]?.group?.name || '';
  const contractCourse = (c: StudentContract) => c.contract_students?.[0]?.level?.name_uz || '';

  const filterFields: FilterBarField<ScFilterKey>[] = [
    {
      key: 'branch',
      label: t('studentsContract.table.branch'),
      options: uniqueValues(contractBranch).map((v) => ({ value: v, label: v })),
    },
    {
      key: 'course',
      label: t('studentsContract.table.direction'),
      options: uniqueValues(contractCourse).map((v) => ({ value: v, label: v })),
    },
    {
      key: 'group',
      label: t('studentsContract.table.group'),
      options: uniqueValues(contractGroup).map((v) => ({ value: v, label: v })),
    },
    {
      key: 'status',
      label: t('studentsContract.table.status'),
      options: uniqueValues((c) => c.status).map((s) => ({ value: s, label: t(getStatusKey(s)) })),
    },
    {
      key: 'date',
      label: t('studentsContract.table.date'),
      type: 'date',
    },
  ];

  const searchNeedle = searchQuery.trim().toLowerCase();
  const filteredContracts = allContracts.filter((c) => {
    if (filters.branch && contractBranch(c) !== filters.branch) return false;
    if (filters.course && contractCourse(c) !== filters.course) return false;
    if (filters.group && contractGroup(c) !== filters.group) return false;
    if (filters.status && c.status !== filters.status) return false;
    if (filters.date && (c.created_at ?? '').slice(0, 10) !== filters.date) return false;
    if (searchNeedle) {
      const person = getMainPerson(c);
      const haystack =
        `${c.contract_number ?? ''} ${person.name} ${person.phone} ${contractBranch(c)} ${contractGroup(c)} ${contractCourse(c)}`.toLowerCase();
      if (!haystack.includes(searchNeedle)) return false;
    }
    return true;
  });
  const sortedContracts = [...filteredContracts].sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  const totalItems = sortedContracts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const contracts = sortedContracts.slice((safePage - 1) * pageSize, safePage * pageSize);

  const bulkAllowed = usePermission('student_contracts.delete');
  const bulk = useBulkDelete({ rows: contracts, allowed: bulkAllowed, scope: JSON.stringify([currentPage, pageSize, searchQuery, filters]), remove: row => API.delete(`/student-contracts/${row.id}`), refresh: () => queryClient.invalidateQueries({ queryKey: ['student-contracts'] }) });
  if (isAdultForm) {
    return <AdultContractForm />;
  }

  const activeFilterCount = countFilterBarValues(filters);

  const handleContractSelect = (type: string) => {
    setShowModal(false);
    switch (type) {
      case 'adult':
        navigate('/students-contract/adult');
        break;
      case 'minor':
        navigate('/students-contract/minor');
        break;
      case 'legal_bilateral':
        navigate('/students-contract/legal_bilateral');
        break;
      case 'legal_trilateral':
        navigate('/students-contract/legal_trilateral');
        break;
    }
  };

  const handleDelete = (id: number) => {
    setPendingDeleteId(id);
  };

  const handleEdit = (item: StudentContract) => {
    const type =
      item.contract_type === 'adult'
        ? 'adult'
        : item.contract_type === 'minor'
          ? 'minor'
          : item.contract_type === 'legal_bilateral'
            ? 'legal_bilateral'
            : item.contract_type === 'legal_trilateral'
              ? 'legal_trilateral'
              : 'adult';

    navigate(`/students-contract/${type}/edit/${item.id}`);
  };

  return (
    <section className="container users students-contract students-contract-list">
      <ConfirmDeleteModal
        open={pendingDeleteId !== null}
        title={t('studentsContract.deleteConfirm')}
        busy={deleteMutation.isPending}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId !== null) deleteMutation.mutate(pendingDeleteId);
          setPendingDeleteId(null);
        }}
      />
      {contractSms.modal}

      <h1 className="main-title">{t('studentsContract.pageTitle')}</h1>
      {bulk.modal}
      <div className="users-filters">
        {bulk.button}
        <div className="sc-search-wrapper">
          <i className="fa-solid fa-magnifying-glass"></i>
          <input
            type="text"
            placeholder={t('studentsContract.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
        <FilterButton
          onClick={() => setFilterOpen((v) => !v)}
          active={filterOpen || activeFilterCount > 0}
          expanded={filterOpen}
          count={activeFilterCount}
          label={t('studentsContract.filter')}
        />
        {can('student_contracts.create') && (
          <button className="add-new-user" onClick={() => setShowModal(true)}>
            {t('studentsContract.createBtn')}
          </button>
        )}
      </div>

      {filterOpen && (
        <FilterBar
          fields={filterFields}
          values={filters}
          onChange={setFilters}
          onReset={() => setFilters(EMPTY_SC_FILTERS)}
          onClose={() => setFilterOpen(false)}
          ariaLabel={t('studentsContract.filter')}
        />
      )}

      <div className="users-table-wrapper students-contract-table-wrapper">
        <table className="users-table sc-table">
          <thead>
            <tr>
              {bulk.header}
              {isVisible('id') && (
                <th className="th-sortable" onClick={() => setSortAsc((p) => !p)}>
                  ID {sortAsc ? '↑' : '↓'}
                </th>
              )}
              {visibleColumns.map((colId) => (
                <th key={colId}>{columnHeader(colId)}</th>
              ))}
              <th>{t('studentsContract.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colCount + bulk.columnCount} style={{ textAlign: 'center', padding: 40 }}>
                  {t('studentsContract.loading')}
                </td>
              </tr>
            ) : contracts.length === 0 ? (
              <tr>
                <td colSpan={colCount + bulk.columnCount} style={{ textAlign: 'center', padding: 40 }}>
                  {t('studentsContract.noData')}
                </td>
              </tr>
            ) : (
              [...contracts]
                .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id))
                .map((item) => {
                  const person = getMainPerson(item);
                  const courseGroup = getCourseGroup(item);

                  return (
                    <tr key={item.id}>
                    {bulk.cell(item)}
                      {isVisible('id') && <td>{item.id}</td>}
                      {visibleColumns.map((colId) => {
                        switch (colId) {
                          case 'student':
                            return (
                              <td key={colId}>
                                {person.name}
                              </td>
                            );
                          case 'contract_number':
                            return <td key={colId}>{item.contract_number || '—'}</td>;
                          case 'representative':
                            return (
                              <td key={colId}>
                                {`${item.representative?.first_name ?? ''} ${item.representative?.last_name ?? ''}`.trim() || '—'}
                              </td>
                            );
                          case 'direction':
                            return (
                              <td key={colId}>
                                {courseGroup.course || '—'}
                              </td>
                            );
                          case 'group':
                            return <td key={colId}>{courseGroup.group || '—'}</td>;
                          case 'branch':
                            return (
                              <td key={colId}>{item.branch?.name_uz || item.branch?.city}</td>
                            );
                          case 'status':
                            return (
                              <td key={colId}>
                                {/* Maktabga tayyorlov shartnomalari ro'yxatidagi bilan bir xil holat belgisi */}
                                <span className={`psc-status psc-status--${item.status}`}>
                                  {t(getStatusKey(item.status))}
                                </span>
                              </td>
                            );
                          case 'date':
                            return <td key={colId}>{formatDateTime(item.created_at)}</td>;
                          default:
                            return <td key={colId}>-</td>;
                        }
                      })}
                      <td className="actions">
                        {can('student_contracts.show') && (
                          <button
                            type="button"
                            className="user-view-btn"
                            title={t('studentsContract.action.actions')}
                            aria-label={t('studentsContract.action.actions')}
                            onClick={() => setPrintContractId(item.id)}
                          >
                            <i className="fa-solid fa-eye"></i>
                          </button>
                        )}
                        {can('student_contracts.edit') && (
                          <button
                            type="button"
                            className="user-edit-btn"
                            title={t('studentsContract.action.edit')}
                            aria-label={t('studentsContract.action.edit')}
                            onClick={() => handleEdit(item)}
                          >
                            <i className="fa-solid fa-pen"></i>
                          </button>
                        )}
                        {isSmsContractType(item.contract_type) && can(smsPermissionFor(item.contract_type)) && (
                          <button
                            type="button"
                            className="user-edit-btn"
                            title={t('contractSms.action')}
                            aria-label={t('contractSms.action')}
                            onClick={() =>
                              contractSms.ask({
                                id: item.id,
                                number: item.contract_number,
                                phone: smsRecipientPhone(item),
                                confirmed: item.status === 'active',
                              })
                            }
                            disabled={contractSms.sendingId === item.id}
                          >
                            {contractSms.sendingId === item.id ? (
                              <i className="fa-solid fa-spinner fa-spin"></i>
                            ) : (
                              <i className="fa-solid fa-paper-plane"></i>
                            )}
                          </button>
                        )}
                        {can('student_contracts.delete') && (
                          <button
                            type="button"
                            className="user-delete-btn"
                            title={t('studentsContract.action.delete')}
                            aria-label={t('studentsContract.action.delete')}
                            onClick={() => handleDelete(item.id)}
                          >
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>

        {totalItems > 0 && (
          <PaginationBar
            page={safePage}
            totalPages={totalPages}
            total={totalItems}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        )}
      </div>

      {showModal && (
        <div className="sc-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sc-modal-header">
              <span className="sc-modal-header-title">{t('studentsContract.modal.title')}</span>
              <button className="sc-modal-close" onClick={() => setShowModal(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="sc-modal-body">
              <button className="sc-contract-option" onClick={() => handleContractSelect('adult')}>
                <span className="sc-contract-option-icon">
                  <i className="fa-solid fa-user"></i>
                </span>
                <span className="sc-contract-option-text">{t('studentsContract.modal.adult')}</span>
                <span className="sc-contract-option-arrow">
                  <i className="fa-solid fa-chevron-right"></i>
                </span>
              </button>
              <button className="sc-contract-option" onClick={() => handleContractSelect('minor')}>
                <span className="sc-contract-option-icon">
                  <i className="fa-solid fa-child"></i>
                </span>
                <span className="sc-contract-option-text">{t('studentsContract.modal.minor')}</span>
                <span className="sc-contract-option-arrow">
                  <i className="fa-solid fa-chevron-right"></i>
                </span>
              </button>
              <button
                className="sc-contract-option"
                onClick={() => handleContractSelect('legal_bilateral')}
              >
                <span className="sc-contract-option-icon">
                  <i className="fa-solid fa-building"></i>
                </span>
                <span className="sc-contract-option-text">
                  {t('studentsContract.modal.legalBilateral')}
                </span>
                <span className="sc-contract-option-arrow">
                  <i className="fa-solid fa-chevron-right"></i>
                </span>
              </button>
              <button
                className="sc-contract-option"
                onClick={() => handleContractSelect('legal_trilateral')}
              >
                <span className="sc-contract-option-icon">
                  <i className="fa-solid fa-users"></i>
                </span>
                <span className="sc-contract-option-text">
                  {t('studentsContract.modal.legalTrilateral')}
                </span>
                <span className="sc-contract-option-arrow">
                  <i className="fa-solid fa-chevron-right"></i>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {printContractId !== null && (
        // Ko'rish oynasi — maktabga tayyorlov shartnomasidagi kabi (PDF yuklash, chop etish, SMS, batafsil)
        <StudentContractView contractId={printContractId} onClose={() => setPrintContractId(null)} />
      )}
    </section>
  );
};

export default StudentsContract;
