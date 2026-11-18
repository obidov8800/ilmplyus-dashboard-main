import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import { omitEmpty } from '../../utils/payload';
import '../users/users.css';
import './groups.css';
import { getLocalized } from '../../utils/getLocalized';
import { useTranslation } from 'react-i18next';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import type {
  Group,
  GroupPayload,
  GroupsApiResponse,
} from '../../types/groups.types';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useOptions, findLabel, getCourseLevels, getBranchCourses, type OptionItem } from '../../hooks/useOptions';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { formatDateTime } from '@/utils/date';
import { isPreschoolBranch } from '@/utils/branchType';
import { useTeacherOptions } from '@/api/teachers';
import { getFieldError } from '@/utils/apiError';
import {
  PRESCHOOL_DEFAULT_DAYS,
  PRESCHOOL_END_TIME,
  PRESCHOOL_START_TIME,
  isPreschoolDefaultDays,
  nextPreschoolGroupName,
} from '@/utils/preschoolGroup';
import { notifyWarning } from '@/utils/notify';

/**
 * «Kim yaratdi» ustuni: backend `created_by` ni obyekt (`{ id, full_name }`), matn yoki foydalanuvchi id'si bo'lib beradi
 * (yaratuvchi alohida `creator` obyektida ham kelishi mumkin). Faqat id kelsa ismi foydalanuvchilar ro'yxatidan olinadi.
 */
function creatorName(group: Group, users: OptionItem[] | undefined): string {
  const byId = (id: number | string) => users?.find((u) => String(u.id) === String(id))?.label ?? `#${id}`;
  if (group.creator?.full_name) return group.creator.full_name;
  const raw = group.created_by;
  if (raw === null || raw === undefined || raw === '') return group.creator?.id != null ? byId(group.creator.id) : '—';
  if (typeof raw === 'object') return raw.full_name || (raw.id != null ? byId(raw.id) : '—');
  const text = String(raw).trim();
  return /^\d+$/.test(text) ? byId(text) : text;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const DAY_NUM: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function computeDuration(
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  days: string[],
): number {
  if (!startDate || !endDate || !startTime || !endTime || !days.length) return 0;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const lessonMinutes = eh * 60 + em - (sh * 60 + sm);
  if (lessonMinutes <= 0) return 0;
  const selectedNums = days.map((d) => DAY_NUM[d]).filter(Boolean);
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (selectedNums.includes(cur.getDay())) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.round((count * lessonMinutes) / 60);
}

// ─── Custom select with availability badge ────────────────────────────────────

interface SelectOption {
  value: string;
  label: string;
  busy: boolean;
  floor?: number | string | null;
}

interface GroupSelectProps {
  value: string;
  options: SelectOption[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

function GroupSelect({ value, options, placeholder, disabled, onChange }: GroupSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="group-select">
      <button
        type="button"
        className="group-select__trigger"
        disabled={disabled}
        style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
        onClick={() => setOpen((p) => !p)}
      >
        <span>{selected?.label ?? placeholder}</span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: '12px' }} />
      </button>

      {open && (
        <div className="group-select__dropdown">
          <div
            className="group-select__option group-select__option--placeholder"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            {placeholder}
          </div>
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`group-select__option${value === opt.value ? ' group-select__option--active' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span>
                {opt.label}
                {opt.floor !== undefined && opt.floor !== null && opt.floor !== '' && (
                  <span className="group-select__floor">
                    &nbsp;·&nbsp;{opt.floor}-{t('groups.floor')}
                  </span>
                )}
              </span>
              <span
                className={`avail-badge ${opt.busy ? 'avail-badge--busy' : 'avail-badge--free'}`}
              >
                {opt.busy ? t('groups.busy') : t('groups.free')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface GroupFormData {
  name: string;
  /** Maktabga tayyorlov filialda nom avtomatik (`0-A`, `0-B`…); foydalanuvchi o'zi yozsa — `true`. */
  nameManual: boolean;
  branch_id: string;
  course_id: string;
  level_id: string;
  teacher_id: string;
  room_id: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  days: string[];
}

const emptyForm = (): GroupFormData => ({
  name: '',
  nameManual: false,
  branch_id: '',
  course_id: '',
  level_id: '',
  teacher_id: '',
  room_id: '',
  start_date: '',
  end_date: '',
  start_time: '',
  end_time: '',
  days: [],
});

// ─── Main component ───────────────────────────────────────────────────────────

const Groups = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('groups');
  const colCount = 2 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const queryClient = useQueryClient();
  // Sahifa ruxsati marshrutda tekshiriladi (`App.tsx`: <PermissionRoute permission="groups.edit">).
  // Ilgari shu yerda yana BOSHQA ruxsat (`lessons_schedules.view`) tekshirilib, `groups.edit` bor foydalanuvchi
  // menyudagi "Guruhlar" bandini bosganda bosh sahifaga qaytarib yuborilardi (va hook'lardan oldin `return` qoidani buzardi).

  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [viewGroup, setViewGroup] = useState<Group | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  // O'quv yillari sahifasidagi «Guruhlar soni» havolasi `?academic_year_id=` bilan keladi.
  const [searchParams, setSearchParams] = useSearchParams();
  const academicYearFilter = searchParams.get('academic_year_id') ?? '';
  const [sortAsc, setSortAsc] = useState(false);
  const [formData, setFormData] = useState<GroupFormData>(emptyForm());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Day label maps (translated)
  const DAY_LABELS = useMemo<Record<string, string>>(
    () => ({
      monday: t('groups.daysNames.monday'),
      tuesday: t('groups.daysNames.tuesday'),
      wednesday: t('groups.daysNames.wednesday'),
      thursday: t('groups.daysNames.thursday'),
      friday: t('groups.daysNames.friday'),
      saturday: t('groups.daysNames.saturday'),
    }),
    [t],
  );

  const DAY_SHORT = useMemo<Record<string, string>>(
    () => ({
      monday: t('groups.daysShort.monday'),
      tuesday: t('groups.daysShort.tuesday'),
      wednesday: t('groups.daysShort.wednesday'),
      thursday: t('groups.daysShort.thursday'),
      friday: t('groups.daysShort.friday'),
      saturday: t('groups.daysShort.saturday'),
    }),
    [t],
  );

  // ── Queries ────────────────────────────────────────────────────────────────

  // Diqqat: `allGroups` (pastda) shu yerdan keladi va dars jadvali
  // to'qnashuvini tekshirish (`teachers`, kun/vaqt validatsiyasi) uchun
  // sahifalanmagan, TO'LIQ ro'yxatga muhtoj — shu sabab bu so'rovga
  // `page`/`per_page` YUBORILMAYDI (backend hozircha bari bir hammasini
  // qaytaradi). Jadvalda ko'rsatish uchun sahifalash pastroqda, faqat
  // render bosqichida (klient tomonda) qo'llanadi.
  const { data: groupsData, isLoading } = useQuery<GroupsApiResponse>({
    queryKey: ['groups'],
    queryFn: async () => {
      const { data } = await API.get<GroupsApiResponse>('/groups');
      return data;
    },
  });

  const { data: branchesData } = useOptions('branches');
  const { data: coursesData } = useOptions('courses');
  // Xona faqat TANLANGAN FILIALniki (avval hamma filial xonalari chiqardi)
  const { data: roomsData, isLoading: roomsLoading } = useOptions(
    'rooms',
    { branch_id: formData.branch_id || undefined },
    { enabled: !!formData.branch_id },
  );
  const { data: academicYearsData } = useOptions('academic_years');
  // `created_by` faqat foydalanuvchi id'si bo'lib kelsa, ismi shu ro'yxatdan topiladi.
  const { data: creatorUsers } = useOptions('users');
  const { data: activeYearsData } = useOptions('academic_years', { status: 'active' });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (payload: GroupPayload) => {
      const { data } = await API.post<Group>('/groups', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      closeModal();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: GroupPayload }) => {
      const { data } = await API.put<Group>(`/groups/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await API.delete(`/groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  // ── Derived data ───────────────────────────────────────────────────────────

  const allGroups: Group[] = useMemo(() => groupsData?.data ?? [], [groupsData]);

  const groups: Group[] = useMemo(() => {
    return allGroups
      .filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
      .filter((g) => {
        if (!branchFilter) return true;
        // Backend `branch_id` (tekis) yoki `branch: { id }` (nested) qaytarishi
        // mumkin — ikkalasini ham hisobga olamiz, aks holda filial filtri
        // hech narsa topmaydi.
        const bId = g.branch_id ?? g.branch?.id;
        return bId != null && String(bId) === branchFilter;
      })
      .filter((g) => {
        if (!academicYearFilter) return true;
        const yId = g.academic_year_id ?? g.academic_year?.id;
        return yId != null && String(yId) === academicYearFilter;
      })
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id));
  }, [allGroups, search, branchFilter, academicYearFilter, sortAsc]);

  // Jadvalda ko'rsatish uchun klient tomonda sahifalash — backend
  // `/groups` hammasini bitta javobda qaytaradi, shu sabab shu yerda
  // bo'lib chiqamiz (aks holda oldin sahifalash umuman yo'q edi).
  const groupsTotal = groups.length;
  const groupsTotalPages = Math.max(1, Math.ceil(groupsTotal / pageSize));
  const pagedGroups: Group[] = useMemo(
    () => groups.slice((page - 1) * pageSize, page * pageSize),
    [groups, page, pageSize],
  );

  // O'qituvchi: `/options/teachers?branch_id=` — shu filialning pedagogik bo'limda faol shartnomali xodimlari. Avval ro'yxat
  // faqat MAVJUD GURUHLARDAN yig'ilardi — yangi xodim (hali guruhi yo'q) hech qachon chiqmasdi. Tanlangan (tahrirlanayotgan
  // guruhning joriy) o'qituvchisi doim qoladi.
  const keptTeachers = useMemo(() => {
    const id = Number(formData.teacher_id);
    if (!id) return [];
    const teacher = allGroups.find((g) => g.teacher?.id === id)?.teacher;
    return teacher ? [{ id, label: `${teacher.last_name} ${teacher.first_name}`.trim() }] : [];
  }, [formData.teacher_id, allGroups]);
  const { teachers: teacherList, isLoading: teachersLoading } = useTeacherOptions(
    Number(formData.branch_id) || null,
    keptTeachers,
  );

  // Backend 422 (`teacher_id` / `room_id`) — maydon tagida; xatoga sabab bo'lgan qiymat o'zgarsa yo'qoladi
  const [serverErr, setServerErr] = useState<{ teacherId: string; teacher?: string; roomId: string; room?: string }>({
    teacherId: '',
    roomId: '',
  });
  const onSaveError = (error: unknown) =>
    setServerErr({
      teacherId: formData.teacher_id,
      teacher: getFieldError(error, 'teacher_id'),
      roomId: formData.room_id,
      room: getFieldError(error, 'room_id'),
    });

  const branches = branchesData ?? [];
  const academicYears = academicYearsData ?? [];
  const activeAcademicYear = activeYearsData?.[0] ?? null;
  const filteredCourses = useMemo(
    () => getBranchCourses(coursesData, formData.branch_id),
    [coursesData, formData.branch_id],
  );
  const filteredLevels = useMemo(
    () => getCourseLevels(coursesData, formData.course_id),
    [coursesData, formData.course_id],
  );
  const rooms = useMemo(() => roomsData ?? [], [roomsData]);

  const selectedRoom = rooms.find((r) => r.id === Number(formData.room_id)) ?? null;

  // Maktabga tayyorlov (preschool) filialida guruh o'quv yiliga bog'lanadi. Yilni backend o'zi qo'yadi
  // (`POST/PUT /groups` `academic_year_id` qabul qilmaydi): yangi guruh — faol yilga, mavjud guruh — o'z yilida
  // qoladi. Shu sabab formada yil tanlanmaydi, faqat qaysi yilga tushishi ko'rsatiladi.
  const selectedBranch = branches.find((b) => String(b.id) === formData.branch_id);
  const isPreschoolGroup = isPreschoolBranch(selectedBranch);
  const formAcademicYear: { id: number; label: string } | null =
    editingGroup?.academic_year && Number(formData.branch_id) === editingGroup.branch?.id
      ? { id: editingGroup.academic_year.id, label: editingGroup.academic_year.name }
      : activeAcademicYear
        ? { id: activeAcademicYear.id, label: activeAcademicYear.label }
        : null;
  const missingAcademicYear = isPreschoolGroup && !formAcademicYear;

  // Maktabga tayyorlov filial guruhida kurs, daraja, tugash sanasi va davomiylik ixtiyoriy (backend: preschool'da `nullable`) —
  // forma ularni so'ramaydi va yubormaydi.

  // `0-A`, `0-B`… — shu filial va shu o'quv yilidagi band nomlar o'tkazib yuboriladi (backend nomni yil ichida takrorlatmaydi).
  const preschoolAutoName =
    isPreschoolGroup && formAcademicYear
      ? nextPreschoolGroupName(
          allGroups
            .filter(
              (g) =>
                g.id !== editingGroup?.id &&
                String(g.branch_id ?? g.branch?.id) === formData.branch_id &&
                (g.academic_year_id ?? g.academic_year?.id) === formAcademicYear.id,
            )
            .map((g) => g.name),
        )
      : '';
  const finalName = isPreschoolGroup && !formData.nameManual ? preschoolAutoName : formData.name;

  const computedDuration = useMemo(
    () =>
      computeDuration(
        formData.start_date,
        formData.end_date,
        formData.start_time,
        formData.end_time,
        formData.days,
      ),
    [formData.start_date, formData.end_date, formData.start_time, formData.end_time, formData.days],
  );

  // ── Availability helpers ───────────────────────────────────────────────────

  const isRoomBusy = useMemo(
    () =>
      (roomId: number): boolean => {
        if (!formData.days.length) return false;
        return allGroups.some((g) => {
          if (editingGroup && g.id === editingGroup.id) return false;
          if (g.room?.id !== roomId) return false;
          return formData.days.some((day) => g.days?.includes(day));
        });
      },
    [allGroups, formData.days, editingGroup],
  );

  const isTeacherBusy = useMemo(
    () =>
      (teacherId: number): boolean => {
        if (!formData.days.length) return false;
        return allGroups.some((g) => {
          if (editingGroup && g.id === editingGroup.id) return false;
          if (g.teacher?.id !== teacherId) return false;
          return formData.days.some((day) => g.days?.includes(day));
        });
      },
    [allGroups, formData.days, editingGroup],
  );

  const roomOptions: SelectOption[] = useMemo(
    () =>
      rooms.map((r) => ({
        value: r.id.toString(),
        label: r.label,
        busy: isRoomBusy(r.id),
        floor: r.floor as number | string | null | undefined,
      })),
    [rooms, isRoomBusy],
  );

  const teacherOptions: SelectOption[] = useMemo(
    () =>
      teacherList.map((t) => ({
        value: t.id.toString(),
        label: t.label,
        busy: isTeacherBusy(t.id),
      })),
    [teacherList, isTeacherBusy],
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleAll = (checked: boolean) => setSelected(checked ? groups.map((g) => g.id) : []);

  const toggleOne = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const openCreateModal = () => {
    setEditingGroup(null);
    setFormData(emptyForm());
    setShowModal(true);
  };

  const openEditModal = (group: Group) => {
    setEditingGroup(group);
    setFormData({
      name: group.name,
      nameManual: true,
      branch_id: group.branch?.id?.toString() ?? '',
      course_id: group.course?.id?.toString() ?? '',
      level_id: group.level?.id?.toString() ?? '',
      teacher_id: group.teacher?.id?.toString() ?? '',
      room_id: group.room?.id?.toString() ?? '',
      start_date: group.start_date ?? '',
      end_date: group.end_date ?? '',
      start_time: group.start_time?.slice(0, 5) ?? '',
      end_time: group.end_time?.slice(0, 5) ?? '',
      days: group.days ?? [],
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingGroup(null);
    setFormData(emptyForm());
  };

  const handleSubmit = () => {
    if (missingAcademicYear) {
      notifyWarning(t('groups.noActiveAcademicYear'));
      return;
    }
    if (isPreschoolGroup) {
      if (!formData.start_date || !formData.teacher_id || !formData.room_id || !finalName || !formData.days.length) {
        notifyWarning(t('groups.preschoolFillRequired'));
        return;
      }
    }
    const common = {
      name: finalName,
      branch_id: Number(formData.branch_id),
      teacher_id: Number(formData.teacher_id),
      room_id: Number(formData.room_id),
      start_date: formData.start_date,
      start_time: formData.start_time,
      end_time: formData.end_time,
      max_students: Number(selectedRoom?.capacity ?? 0),
      days: formData.days,
      is_active: true,
    };
    const payload: GroupPayload = isPreschoolGroup
      ? common
      : {
          ...common,
          course_id: Number(formData.course_id),
          level_id: Number(formData.level_id),
          end_date: formData.end_date,
          duration: computedDuration || undefined,
        };
    if (editingGroup) {
      // Backend `UpdateGroupRequest`: `sometimes|required|date` — eski guruhda tugash sanasi (end_date) NULL bo'lsa,
      // bo'sh qator yuborilganda butun saqlash 422 bilan rad etilardi. Bo'sh sana/vaqt yuborilmaydi.
      updateMutation.mutate(
        {
          id: editingGroup.id,
          payload: omitEmpty(payload, ['start_date', 'end_date', 'start_time', 'end_time']) as GroupPayload,
        },
        { onError: onSaveError },
      );
    } else {
      createMutation.mutate(payload, { onError: onSaveError });
    }
  };

  const confirmDelete = () => {
    if (deleteTarget !== null) deleteMutation.mutate(deleteTarget);
    setShowDeleteModal(false);
    setDeleteTarget(null);
  };

  const toggleDay = (day: string) => {
    setFormData((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day],
    }));
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="users container">
      <h1 className="main-title">{t('groups.listTitle')}</h1>

      {/* ── Add / Edit modal ── */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal add-user-modal">
            <h3 className="modal-title">
              {editingGroup ? t('groups.editTitle') : t('groups.addTitle')}
            </h3>

            <div className="add-user-form">
              <div className="form-left">
                <div className="form-group">
                  <label>{t('groups.branch')}</label>
                  <select
                    value={formData.branch_id}
                    onChange={(e) => {
                      const toPreschool = isPreschoolBranch(
                        branches.find((b) => String(b.id) === e.target.value),
                      );
                      setFormData({
                        ...formData,
                        branch_id: e.target.value,
                        course_id: '',
                        level_id: '',
                        name: '',
                        nameManual: false,
                        // Xona va o'qituvchi filialga bog'liq — filial o'zgarsa qayta tanlanadi
                        ...(e.target.value !== formData.branch_id ? { room_id: '', teacher_id: '' } : {}),
                        // Maktabga tayyorlov filialda hafta kunlari va dars vaqti tayyor keladi; oddiy filialga qaytilsa
                        // (foydalanuvchi o'zgartirmagan bo'lsa) tozalanadi.
                        ...(toPreschool
                          ? {
                              days: formData.days.length ? formData.days : [...PRESCHOOL_DEFAULT_DAYS],
                              start_time: formData.start_time || PRESCHOOL_START_TIME,
                              end_time: formData.end_time || PRESCHOOL_END_TIME,
                            }
                          : isPreschoolGroup
                            ? {
                                days: isPreschoolDefaultDays(formData.days) ? [] : formData.days,
                                start_time:
                                  formData.start_time === PRESCHOOL_START_TIME ? '' : formData.start_time,
                                end_time: formData.end_time === PRESCHOOL_END_TIME ? '' : formData.end_time,
                              }
                            : {}),
                      });
                    }}
                  >
                    <option value="">{t('groups.choose')}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>

                {isPreschoolGroup && (
                  <div className="form-group">
                    <label>{t('groups.academicYear')}</label>
                    <span
                      className={`view-field group-academic-year${missingAcademicYear ? ' group-academic-year--missing' : ''}`}
                    >
                      {formAcademicYear ? formAcademicYear.label : t('groups.noActiveAcademicYear')}
                    </span>
                    {formAcademicYear && (
                      <span style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>
                        {editingGroup?.academic_year && formAcademicYear.id === editingGroup.academic_year.id
                          ? t('groups.academicYearKept')
                          : t('groups.academicYearAuto')}
                      </span>
                    )}
                  </div>
                )}

                {!isPreschoolGroup && (
                  <>
                <div className="form-group">
                  <label>{t('groups.course')}</label>
                  <select
                    value={formData.course_id}
                    disabled={!formData.branch_id}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        course_id: e.target.value,
                        level_id: '',
                        name: '',
                      })
                    }
                  >
                    <option value="">
                      {formData.branch_id ? t('groups.choose') : t('groups.selectBranch')}
                    </option>
                    {filteredCourses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>{t('groups.level')}</label>
                  <select
                    value={formData.level_id}
                    disabled={!formData.course_id}
                    onChange={(e) => {
                      const levelId = e.target.value;
                      const level = filteredLevels.find((l) => l.id === Number(levelId));
                      setFormData({
                        ...formData,
                        level_id: levelId,
                        name: (level?.label ?? '').toUpperCase(),
                      });
                    }}
                  >
                    <option value="">
                      {formData.course_id ? t('groups.choose') : t('groups.selectCourse')}
                    </option>
                    {filteredLevels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                  </>
                )}

                <div className="form-group">
                  <label>{t('groups.groupName')}</label>
                  <input
                    value={isPreschoolGroup ? finalName : formData.name}
                    disabled={!isPreschoolGroup && !formData.level_id}
                    placeholder={
                      isPreschoolGroup
                        ? t('groups.preschoolNamePlaceholder')
                        : formData.level_id
                          ? ''
                          : t('groups.selectLevel')
                    }
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        name: e.target.value.toUpperCase(),
                        // Nom to'liq o'chirilsa — yana avtomatik nomga qaytadi.
                        nameManual: e.target.value !== '',
                      })
                    }
                  />
                  {isPreschoolGroup && !formData.nameManual && finalName && (
                    <span style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>
                      {t('groups.preschoolNameHint')}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label>{t('groups.teacher')}</label>
                  <GroupSelect
                    value={formData.teacher_id}
                    options={teacherOptions}
                    placeholder={formData.branch_id ? t('groups.choose') : t('groups.selectBranch')}
                    disabled={!formData.branch_id}
                    onChange={(v) => setFormData({ ...formData, teacher_id: v })}
                  />
                  {!!formData.branch_id && !teachersLoading && teacherOptions.length === 0 && (
                    <span style={{ fontSize: '12px', color: '#d93025', marginTop: '3px' }}>
                      {t('groups.noTeachers')}
                    </span>
                  )}
                  {serverErr.teacher && serverErr.teacherId === formData.teacher_id && (
                    <span style={{ fontSize: '12px', color: '#d93025', marginTop: '3px' }}>{serverErr.teacher}</span>
                  )}
                </div>

                <div className="form-group">
                  <label>{t('groups.room')}</label>
                  <GroupSelect
                    value={formData.room_id}
                    options={roomOptions}
                    placeholder={formData.branch_id ? t('groups.choose') : t('groups.selectBranch')}
                    disabled={!formData.branch_id}
                    onChange={(v) => setFormData({ ...formData, room_id: v })}
                  />
                  {!!formData.branch_id && !roomsLoading && roomOptions.length === 0 && (
                    <span style={{ fontSize: '12px', color: '#d93025', marginTop: '3px' }}>
                      {t('groups.noRooms')}
                    </span>
                  )}
                  {serverErr.room && serverErr.roomId === formData.room_id && (
                    <span style={{ fontSize: '12px', color: '#d93025', marginTop: '3px' }}>{serverErr.room}</span>
                  )}
                  {selectedRoom && (
                    <span style={{ fontSize: '13px', color: '#003366', marginTop: '4px' }}>
                      {t('groups.capacity')}: <strong>{String(selectedRoom.capacity ?? '')}</strong>{' '}
                      {t('groups.pieces')}
                      &nbsp;·&nbsp;{String(selectedRoom.floor ?? '')}-{t('groups.floor')}
                      &nbsp;·&nbsp;{findLabel(branches, selectedRoom.branch_id as number)}
                    </span>
                  )}
                </div>
              </div>

              <div className="form-right">
                <div className="form-group">
                  <label>{t('groups.startDateFull')}</label>
                  <input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  />
                </div>

                {!isPreschoolGroup && (
                  <div className="form-group">
                    <label>{t('groups.endDateFull')}</label>
                    <input
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label>{t('groups.startTime')}</label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>{t('groups.endTime')}</label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>{t('groups.lessonDays')}</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {DAYS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        style={{
                          padding: '6px 10px',
                          borderRadius: '8px',
                          border: '1px solid #003366',
                          background: formData.days.includes(day) ? '#003366' : '#fff',
                          color: formData.days.includes(day) ? '#fff' : '#003366',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontFamily: 'noto-m',
                        }}
                        onClick={() => toggleDay(day)}
                      >
                        {DAY_SHORT[day]}
                      </button>
                    ))}
                  </div>
                </div>

                {!isPreschoolGroup && (
                  <div className="form-group">
                    <label>{t('groups.duration')}</label>
                    <div
                      style={{
                        padding: '10px 12px',
                        border: '1px solid #ddd',
                        borderRadius: '15px',
                        fontSize: '14px',
                        color: computedDuration > 0 ? '#003366' : '#aaa',
                        background: '#f9f9f9',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {computedDuration > 0 ? (
                        <>
                          <strong>{computedDuration}</strong> {t('groups.hours')}
                        </>
                      ) : (
                        t('groups.durationAuto')
                      )}
                    </div>
                    {computedDuration > 0 && (
                      <span style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>
                        {t('groups.durationHint')}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="primary"
                onClick={handleSubmit}
                disabled={isPending || missingAcademicYear}
              >
                {isPending ? t('groups.saving') : t('groups.save')}
              </button>
              <button className="cancel" onClick={closeModal}>
                {t('groups.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete modal ── */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal small">
            <h3>{t('groups.confirmDelete')}</h3>
            <div className="modal-actions">
              <button className="danger" onClick={confirmDelete}>
                {t('groups.confirm')}
              </button>
              <button className="cancel" onClick={() => setShowDeleteModal(false)}>
                {t('groups.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View modal ── */}
      {showViewModal && viewGroup && (
        <div className="modal-overlay">
          <div className="modal add-user-modal">
            <h3 className="modal-title">{viewGroup.name?.toUpperCase()}</h3>

            <div className="add-user-form">
              <div className="form-left">
                <div className="form-group">
                  <label>{t('groups.branch')}</label>
                  <span className="view-field">
                    {viewGroup.branch ? getLocalized(viewGroup.branch, 'name', i18n.language) : '-'}
                  </span>
                </div>
                <div className="form-group">
                  <label>{t('groups.academicYear')}</label>
                  <span className="view-field">{viewGroup.academic_year?.name ?? '-'}</span>
                </div>
                <div className="form-group">
                  <label>{t('groups.course')}</label>
                  <span className="view-field">
                    {viewGroup.course ? getLocalized(viewGroup.course, 'name', i18n.language) : '-'}
                  </span>
                </div>
                <div className="form-group">
                  <label>{t('groups.level')}</label>
                  <span className="view-field">
                    {viewGroup.level ? getLocalized(viewGroup.level, 'name', i18n.language) : '-'}
                  </span>
                </div>
                <div className="form-group">
                  <label>{t('groups.teacher')}</label>
                  <span className="view-field">
                    {viewGroup.teacher
                      ? `${viewGroup.teacher.last_name} ${viewGroup.teacher.first_name}${viewGroup.teacher.middle_name ? ' ' + viewGroup.teacher.middle_name : ''}`
                      : '-'}
                  </span>
                </div>
                <div className="form-group">
                  <label>{t('groups.room')}</label>
                  <span className="view-field">
                    {viewGroup.room ? (viewGroup.room.name_uz ?? viewGroup.room.name) : '-'}
                  </span>
                </div>
                <div className="form-group">
                  <label>{t('groups.maxStudentsFull')}</label>
                  <span className="view-field">{viewGroup.max_students ?? '-'}</span>
                </div>
                <div className="form-group">
                  <label>{t('groups.durationView')}</label>
                  <span className="view-field">
                    {viewGroup.duration ? `${viewGroup.duration} ${t('groups.minutes')}` : '-'}
                  </span>
                </div>
              </div>

              <div className="form-right">
                <div className="form-group">
                  <label>{t('groups.startDateFull')}</label>
                  <span className="view-field">{viewGroup.start_date ?? '-'}</span>
                </div>
                <div className="form-group">
                  <label>{t('groups.endDateFull')}</label>
                  <span className="view-field">{viewGroup.end_date ?? '-'}</span>
                </div>
                <div className="form-group">
                  <label>{t('groups.lessonTime')}</label>
                  <span className="view-field">
                    {viewGroup.start_time && viewGroup.end_time
                      ? `${viewGroup.start_time.slice(0, 5)} – ${viewGroup.end_time.slice(0, 5)}`
                      : '-'}
                  </span>
                </div>
                <div className="form-group">
                  <label>{t('groups.lessonDays')}</label>
                  <span className="view-field">
                    {viewGroup.days?.length
                      ? viewGroup.days.map((d) => DAY_LABELS[d] ?? d).join(', ')
                      : '-'}
                  </span>
                </div>
                <div className="form-group">
                  <label>{t('groups.studentsCount')}</label>
                  <span className="view-field">{viewGroup.students_count ?? '-'}</span>
                </div>
                <div className="form-group">
                  <label>{t('groups.createdAt')}</label>
                  <span className="view-field">
                    {formatDateTime(viewGroup.created_at, '-')}
                  </span>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="cancel" onClick={() => setShowViewModal(false)}>
                {t('groups.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="users-filters">
        <Protected permission="groups.create">
          <button className="add-new-user" onClick={openCreateModal}>
            {t('groups.addNew')}
          </button>
        </Protected>
        <Protected permission="groups.delete">
          <button
            className="delete-all"
            disabled={!selected.length}
            onClick={() => {
              selected.forEach((id) => deleteMutation.mutate(id));
              setSelected([]);
            }}
          >
            {t('groups.delete')}
          </button>
        </Protected>
        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('groups.branch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        {(academicYears.length > 0 || academicYearFilter) && (
          <select
            value={academicYearFilter}
            aria-label={t('groups.academicYear')}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value) next.set('academic_year_id', e.target.value);
              else next.delete('academic_year_id');
              setSearchParams(next, { replace: true });
              setPage(1);
            }}
          >
            <option value="">{t('groups.academicYear')}</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        )}
        <input
          placeholder={t('groups.search')}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {/* ── Table ── */}
      <div className="users-table-wrapper" style={{ overflowX: 'auto' }}>
        <table className="users-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selected.length === groups.length && groups.length > 0}
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
              <th>{t('groups.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : groups.length > 0 ? (
              pagedGroups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(g.id)}
                      onChange={() => toggleOne(g.id)}
                    />
                  </td>
                  {isVisible('id') && <td>{g.id}</td>}
                  {visibleColumns.map((colId) => {
                    switch (colId) {
                      case 'name':
                        return <td key={colId}>{g.name?.toUpperCase()}</td>;
                      case 'branch':
                        return (
                          <td key={colId}>
                            {g.branch ? getLocalized(g.branch, 'name', i18n.language) : '-'}
                          </td>
                        );
                      case 'academic_year':
                        return <td key={colId}>{g.academic_year?.name ?? '-'}</td>;
                      case 'course':
                        return (
                          <td key={colId}>
                            {g.course ? getLocalized(g.course, 'name', i18n.language) : '-'}
                          </td>
                        );
                      case 'level':
                        return (
                          <td key={colId}>
                            {g.level ? getLocalized(g.level, 'name', i18n.language) : '-'}
                          </td>
                        );
                      case 'teacher':
                        return (
                          <td key={colId}>
                            {g.teacher ? `${g.teacher.last_name} ${g.teacher.first_name}` : '-'}
                          </td>
                        );
                      case 'room':
                        return <td key={colId}>{g.room?.name_uz ?? g.room?.name ?? '-'}</td>;
                      case 'days':
                        return (
                          <td key={colId}>
                            {g.days?.length
                              ? g.days.map((d) => DAY_SHORT[d] ?? d).join(', ')
                              : '-'}
                          </td>
                        );
                      case 'start_date':
                        return <td key={colId}>{g.start_date ?? '-'}</td>;
                      case 'end_date':
                        return <td key={colId}>{g.end_date ?? '-'}</td>;
                      case 'time':
                        return (
                          <td key={colId}>
                            {g.start_time && g.end_time
                              ? `${g.start_time.slice(0, 5)} – ${g.end_time.slice(0, 5)}`
                              : '-'}
                          </td>
                        );
                      case 'max_students':
                        return <td key={colId}>{g.max_students ?? '-'}</td>;
                      case 'created_by':
                        return (
                          <td key={colId} style={{ whiteSpace: 'nowrap' }}>
                            {creatorName(g, creatorUsers)}
                          </td>
                        );
                      default:
                        return <td key={colId}>-</td>;
                    }
                  })}
                  <td className="actions">
                    <Protected permission="groups.show">
                      <button
                        className="user-view-btn"
                        onClick={() => {
                          setViewGroup(g);
                          setShowViewModal(true);
                        }}
                      >
                        <i className="fa-solid fa-eye" />
                      </button>
                    </Protected>
                    <Protected permission="groups.edit">
                      <button className="user-edit-btn" onClick={() => openEditModal(g)}>
                        <i className="fa-solid fa-pen" />
                      </button>
                    </Protected>
                    <Protected permission="groups.delete">
                      <button
                        className="user-delete-btn"
                        onClick={() => {
                          setDeleteTarget(g.id);
                          setShowDeleteModal(true);
                        }}
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </Protected>
                  </td>
                </tr>
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('groups.notFound')} />
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={groupsTotalPages}
        total={groupsTotal}
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

export default Groups;
