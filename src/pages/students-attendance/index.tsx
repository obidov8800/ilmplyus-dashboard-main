import React, { useState, useMemo, useCallback, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { API } from '../../api/api';
import './studentsAttendance.css';
import { usePermission } from '../../hooks/usePermission';
import { useCanSeeAll, useOwnEmployeeId } from '../../hooks/useCanSeeAll';
import { useOptions } from '../../hooks/useOptions';
import { useDragScroll } from '../../hooks/useDragScroll';
import useAuthStore from '../../store/useAuthStore';
import ConfirmModal from '../../components/ConfirmModal';
import { getApiErrorMessage } from '@/utils/apiError';
import type { Lesson } from '@/types/lesson.types';
import type {
  Attendance,
  GroupData,
  MonthlyAttendanceResponse,
  PopoverState,
  Student,
  StudentsResponse,
} from '@/types/studentsAttendance.types';
import type { Group } from '../../types/groups.types';
import { fetchAllPages } from '@/api/fetchAllPages';
import { groupDigits } from '@/utils/formatNumber';

/** Backend status → badge klass + tarjima kaliti. */
const STUDENT_STATUS_META: Record<string, { key: string; cls: string }> = {
  active: { key: 'st_active', cls: 'aktiv' },
  Aktiv: { key: 'st_active', cls: 'aktiv' },
  frozen: { key: 'st_frozen', cls: 'frozen' },
  dropped: { key: 'st_dropped', cls: 'dropped' },
  graduated: { key: 'st_graduated', cls: 'graduated' },
  Noaktiv: { key: 'noaktiv', cls: 'noaktiv' },
};

const getStatusMeta = (s?: string) =>
  STUDENT_STATUS_META[s ?? ''] ?? { key: 'st_active', cls: 'aktiv' };

/*
 * "Bugungi dars mavzusini kiriting" oynasi avval faqat ruxsatga
 * (`lessons.start` / `student_attendance.create`) qarab avtomatik ochilardi
 * — bu ruxsatlar odatda adminda ham bo'lgani uchun, admin har qanday
 * guruhni ochsa ham (o'sha guruhning o'qituvchisi bo'lmasa ham) oyna
 * chiqaverardi. Endi qo'shimcha shart: foydalanuvchi "Pedagog xodimlar"
 * bo'limiga tegishli bo'lishi kerak — nomi bo'yicha solishtiriladi, chunki
 * backend departmentlarni kod emas, nom orqali qaytaradi.
 */
const TEACHING_DEPARTMENT_NAME = 'pedagog xodimlar';

const isTeachingDepartment = (name: string | undefined | null): boolean =>
  (name ?? '').trim().toLowerCase() === TEACHING_DEPARTMENT_NAME;

// Backend sanalarni Toshkent yarim tunini UTC'da saqlaydi
// (masalan "2026-07-17T19:00:00Z" = 2026-07-18 00:00 +05).
// Shu sabab sanani Asia/Tashkent mintaqasida "YYYY-MM-DD" ko'rinishiga keltiramiz.
const APP_TZ = 'Asia/Tashkent';

const toTashkentDate = (value: unknown): string => {
  if (!value) return '';
  // "DD.MM.YYYY" bo'lsa — bevosita ISO'ga aylantiramiz.
  const dotMatch = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  // en-CA => "YYYY-MM-DD"
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
};

const isSameDay = (raw: unknown, today: Date): boolean => {
  const a = toTashkentDate(raw);
  return a !== '' && a === toTashkentDate(today);
};

const DAY_SHORT: Record<string, string> = {
  monday: 'Du',
  tuesday: 'Se',
  wednesday: 'Ch',
  thursday: 'Pa',
  friday: 'Ju',
  saturday: 'Sh',
  sunday: 'Ya',
};

const DAY_INDEX: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const AttendanceDot = memo(
  ({
    status,
    grade,
    onClick,
  }: {
    status?: Attendance['status'];
    grade?: number | null;
    onClick: () => void;
  }) => {
    let className = 'attendance-dot dot-empty';
    if (status === 'present') className = 'attendance-dot dot-present';
    if (status === 'absent') className = 'attendance-dot dot-absent';
    if (status === 'late') className = 'attendance-dot dot-late';
    if (status === 'reason') className = 'attendance-dot dot-reason';

    return (
      <div className={className} onClick={onClick}>
        {grade !== undefined && grade !== null && <span className="grade-value">{grade}</span>}
      </div>
    );
  },
);

const Popover = ({
  attendance,
  onSave,
  onCancel,
  onDelete,
  saving,
  canDelete,
}: {
  attendance: PopoverState;
  onSave: (data: PopoverState) => void;
  onCancel: () => void;
  onDelete: () => void;
  saving?: boolean;
  canDelete?: boolean;
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Attendance['status'] | undefined>(attendance.status);
  const [grade, setGrade] = useState<number | undefined>(attendance.grade ?? undefined);
  const [comment, setComment] = useState<string>(attendance.comment_uz ?? '');

  const handleSave = () => {
    if (!status) return;
    onSave({ ...attendance, status, grade, comment_uz: comment });
  };

  return (
    <div className="sa-popover-overlay" onClick={onCancel}>
      <div className="sa-attendance-popover" onClick={(e) => e.stopPropagation()}>
        <div className="sa-popover-section">
          <span className="sa-popover-title">{t('studentsAttendance.davomat')}:</span>
          <div className="sa-davomat-options">
            {(['present', 'absent', 'late', 'reason'] as const).map((opt) => (
              <button
                key={opt}
                className={`sa-option-btn${status === opt ? ' active' : ''}`}
                onClick={() => setStatus(opt)}
              >
                <div className={`legend-dot dot-${opt}`} />
                {t(`studentsAttendance.${opt}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="sa-popover-section">
          <span className="sa-popover-title">
            {t('studentsAttendance.baho')}{' '}
            <span className="sa-grade-hint">({t('studentsAttendance.grade_hint')})</span>
          </span>
          {/* Baho 1–5 (besh ballik). Tanlangan bahoni qayta bosish — olib tashlaydi. Eski 100 ballik qiymat
              (masalan 85) yangi baho tanlanmaguncha saqlanadi. User ilovasidagi davomat oynasi bilan bir xil. */}
          <div className="sa-grade-btns" role="radiogroup" aria-label={t('studentsAttendance.baho')}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={grade === value}
                className={`sa-grade-btn${grade === value ? ' active' : ''}`}
                onClick={() => setGrade(grade === value ? undefined : value)}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={grade === undefined}
              className={`sa-grade-btn sa-grade-btn--none${grade === undefined ? ' active' : ''}`}
              onClick={() => setGrade(undefined)}
            >
              {t('studentsAttendance.no_grade')}
            </button>
          </div>
          {grade !== undefined && grade !== null && (grade < 1 || grade > 5) && (
            <span className="sa-grade-hint sa-grade-hint--block">
              {t('studentsAttendance.grade_legacy', { value: grade })}
            </span>
          )}
        </div>

        {status === 'reason' && (
          <div className="sa-popover-section">
            <span className="sa-popover-title">{t('studentsAttendance.reason_label')}:</span>
            <textarea
              className="sa-reason-field"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        )}

        <div className="sa-popover-actions">
          {attendance.id && canDelete && (
            <button className="sa-pop-cancel" style={{ color: 'red' }} onClick={onDelete}>
              {t('studentsAttendance.delete')}
            </button>
          )}
          <button className="sa-pop-save" onClick={handleSave} disabled={saving}>
            {t('studentsAttendance.save')}
          </button>
          <button className="sa-pop-cancel" onClick={onCancel}>
            {t('studentsAttendance.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

const GroupSelector: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  // Guruhlar: `groups.view` bo'lsa `/groups`, bo'lmasa tanlov ro'yxati (`/options/groups`) — sahifa uchun davomat
  // ruxsati yetadi. Qamrov (o'z guruhlari yoki hammasi) — `canSeeAll('student_attendance')`.
  const canViewGroups = usePermission('groups.view');
  const seeAll = useCanSeeAll('student_attendance');
  const ownEmployeeId = useOwnEmployeeId();
  const { data } = useQuery<{ data: Group[] }>({
    queryKey: ['groups', 'all'],
    queryFn: () => API.get('/groups', { params: { limit: 1000 } }).then((res) => res.data),
    enabled: canViewGroups,
  });
  const { data: groupOptions = [] } = useOptions('groups', undefined, { enabled: !canViewGroups });
  const allGroups: Group[] = canViewGroups
    ? (data?.data ?? [])
    : groupOptions.map(
        (o) =>
          ({
            id: o.id,
            name: o.label,
            teacher_id: o.teacher_id,
            start_date: o.start_date ?? undefined,
            end_date: o.end_date ?? undefined,
            academic_year_id: o.academic_year_id ?? null,
          }) as unknown as Group,
      );

  // Maktabga tayyorlov (preschool) guruhlar davomati alohida bo'limda (`/preschool-attendance`): backend oddiy davomatni
  // preschool guruhga belgilashni rad etadi. Preschool guruh o'quv yiliga bog'langan (`academic_year_id`).
  const groups: Group[] = allGroups.filter(
    (g) =>
      (g as { academic_year_id?: number | null }).academic_year_id == null &&
      (seeAll || (!!ownEmployeeId && Number(g.teacher?.id ?? g.teacher_id) === Number(ownEmployeeId))),
  );

  const filtered = groups.filter((g) => g.name?.toLowerCase().includes(search.toLowerCase()));

  const formatDate = (d?: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  };

  return (
    <div className="group-selector-wrap">
      <div className="group-selector-header">
        <h2 className="group-selector-title">Guruhni tanlang</h2>
        <input
          className="group-selector-search"
          placeholder="Guruh qidirish..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="group-cards-grid">
        {filtered.map((g) => (
          <div
            key={g.id}
            className="group-card"
            onClick={() => navigate(`/students-attendance?groupId=${g.id}`)}
          >
            <div className="group-card__header">
              <span className="group-card__title">Guruh: {g.name}</span>
              {g.start_date && (
                <span className="group-card__date-badge">{formatDate(g.start_date)}</span>
              )}
            </div>
            <div className="group-card__grid">
              <div className="group-card__item">
                <div className="group-card__item-icon">
                  <i className="fa-solid fa-users" />
                </div>
                <div className="group-card__item-content">
                  <span className="group-card__item-label">O‘quvchilar soni</span>
                  <span className="group-card__item-value">
                    {g.students_count ?? g.max_students ?? 0} o‘quvchi
                  </span>
                </div>
              </div>

              <div className="group-card__item">
                <div className="group-card__item-icon">
                  <i className="fa-solid fa-chart-bar" />
                </div>
                <div className="group-card__item-content">
                  <span className="group-card__item-label">Bosqich</span>
                  <span className="group-card__item-value">{g.level?.name_uz ?? '—'}</span>
                </div>
              </div>

              <div className="group-card__item">
                <div className="group-card__item-icon">
                  <i className="fa-regular fa-clock" />
                </div>
                <div className="group-card__item-content">
                  <span className="group-card__item-label">Dars vaqti</span>
                  <span className="group-card__item-value">
                    {g.start_time?.slice(0, 5)} - {g.end_time?.slice(0, 5)}
                  </span>
                </div>
              </div>

              <div className="group-card__item">
                <div className="group-card__item-icon">
                  <i className="fa-regular fa-calendar" />
                </div>
                <div className="group-card__item-content">
                  <span className="group-card__item-label">Dars kunlari</span>
                  <span className="group-card__item-value">
                    {g.days?.map((d) => DAY_SHORT[d] ?? d).join(', ') ?? '—'}
                  </span>
                </div>
              </div>

              <div className="group-card__item">
                <div className="group-card__item-icon">
                  <i className="fa-regular fa-building" />
                </div>
                <div className="group-card__item-content">
                  <span className="group-card__item-label">Xona</span>
                  <span className="group-card__item-value">
                    {g.room ? `${g.room.floor} qavat ${g.room.name_uz ?? g.room.name}` : '—'}
                  </span>
                </div>
              </div>

              <div className="group-card__item">
                <div className="group-card__item-icon">
                  <i className="fa-solid fa-book-open" />
                </div>
                <div className="group-card__item-content">
                  <span className="group-card__item-label">Kurs</span>
                  <span className="group-card__item-value">{g.course?.name_uz ?? '—'}</span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p style={{ color: '#888', gridColumn: '1/-1', textAlign: 'center', padding: '2rem' }}>
            Guruhlar topilmadi
          </p>
        )}
      </div>
    </div>
  );
};

const StudentsAttendance: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const groupId = searchParams.get('groupId');

  // Sahifaning o'zi `student_attendance.view` bilan cheklangan (App.tsx
  // marshrutida). Bu yerdagilar esa ICHKI amallarni cheklaydi:
  //  - lessons.start / lessons.end — darsni boshlash/tugatish (ikkalasi
  //    birga berilsa, "dars o'tish" to'liq imkoniyati beriladi);
  //  - student_attendance.create — faqat BUGUNGI (dars kuni) yangi
  //    davomat/baho qo'shish (sana tekshiruvi pastda saqlanadi);
  //  - student_attendance.edit — mavjud yozuvni ochib o'zgartirish;
  //  - student_attendance.delete — mavjud yozuvni o'chirish.
  // `lessons.start`/`lessons.end` hali backendda ro'yxatdan o'tmagan bo'lishi
  // mumkin (Rollar sahifasida checkbox yo'q) — shu sabab `lessons.create` ham
  // zaxira sifatida qabul qilinadi. DIQQAT: ilgari bu yerda
  // `student_attendance.create` edi — natijada davomatni faqat KO'RIB CHIQADIGAN
  // admin·menejer ham "Darsni boshlash / Bugun dars yo'q / Darsni tamomlash"
  // tugmalarini ko'rardi. Dars o'tish — o'qituvchining ishi, shuning uchun endi
  // dars lifecycle tugmalari `lessons.*` ruxsatiga bog'langan.
  // Backend `POST /lessons/{id}/start|end` — `lessons.edit` (LessonController middleware). `lessons.start/end`
  // ruxsatlari bazada YO'Q (rolga berib bo'lmaydi) — shu sabab ular tekshirilmaydi.
  const canEditLesson = usePermission('lessons.edit');
  const canViewAttendance = usePermission('student_attendance.view');
  const canCreateAttendance = usePermission('student_attendance.create');
  const canEditAttendance = usePermission('student_attendance.edit');
  const canDeleteAttendance = usePermission('student_attendance.delete');
  const canStartLesson = canEditLesson;
  const canEndLesson = canEditLesson;

  // Guruh + davomat bo'yicha TO'LIQ ruxsatlari bo'lganlar (yoki admin) istalgan
  // O'TGAN dars sanasidagi davomat/bahoni tahrirlashi mumkin — "ongoing dars =
  // faqat bugun" cheklovi ularга tegmaydi. Kelajak sanalar baribir yopiq.
  const canViewGroups = usePermission('groups.view');
  const canCreateGroups = usePermission('groups.create');
  const canEditGroups = usePermission('groups.edit');
  const canDeleteGroups = usePermission('groups.delete');
  const canManageAnyAttendance =
    canViewAttendance &&
    canCreateAttendance &&
    canEditAttendance &&
    canDeleteAttendance &&
    canViewGroups &&
    canCreateGroups &&
    canEditGroups &&
    canDeleteGroups;

  // Jadval keng bo'lganda sichqoncha bilan ushlab surish.
  const { ref: tableScrollRef, onMouseDown: onTableScrollMouseDown } =
    useDragScroll<HTMLDivElement>();

  // "Dars mavzusini kiriting" oynasi ruxsatdan tashqari — faqat pedagog
  // xodim kirganda avtomatik ochilishi uchun.
  const currentUser = useAuthStore((s) => s.user);
  const isTeachingStaff = (currentUser?.departments ?? []).some((d) =>
    isTeachingDepartment(d.name_uz),
  );

  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [startTopic, setStartTopic] = useState('');
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [autoPrompted, setAutoPrompted] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{
    studentId: number;
    date: string;
    attendance?: Attendance;
  } | null>(null);

  const todayStr = useMemo(() => toTashkentDate(new Date()), []);

  const { data: studentsData } = useQuery<StudentsResponse>({
    queryKey: ['students', groupId],
    // `/students` 100 tadan sahifalaydi va guruh bo'yicha filtrlamaydi — 1-sahifa bilan
    // cheklansak, 100 tadan keyingi o'quvchilar guruh davomatidan tushib qolardi.
    queryFn: async (): Promise<StudentsResponse> => {
      const all = await fetchAllPages<Student>('/students');
      return {
        data: all.filter((s) =>
          s.groups?.some((g: { id: number }) => String(g.id) === String(groupId)),
        ),
      };
    },
    enabled: !!groupId,
  });

  // Guruh tafsiloti (nomi, dars kunlari) — `groups.show` bo'lsa `/groups/{id}`, bo'lmasa tanlov ro'yxatidan (nomi;
  // dars kunlari `/options/groups` ga backend topshirig'i B4 bilan qo'shiladi). Ruxsatsiz so'rov yuborilmaydi.
  const canShowGroup = usePermission('groups.show');
  const { data: fullGroupData } = useQuery<GroupData>({
    queryKey: ['group', groupId],
    queryFn: () => API.get(`/groups/${groupId}`).then((res) => res.data.data ?? res.data),
    enabled: !!groupId && canShowGroup,
  });
  const { data: groupOptionList = [] } = useOptions('groups', undefined, { enabled: !!groupId && !canShowGroup });
  const groupData: GroupData | undefined = canShowGroup
    ? fullGroupData
    : (() => {
        const option = groupOptionList.find((o) => String(o.id) === String(groupId));
        return option ? ({ id: option.id, name: option.label } as unknown as GroupData) : undefined;
      })();
  const canViewLessons = usePermission('lessons.view');

  const { data: attendanceData } = useQuery<MonthlyAttendanceResponse>({
    queryKey: ['student_attendance', 'monthly', groupId, currentYear, currentMonth],
    queryFn: () =>
      API.get('/student_attendance/monthly', {
        params: {
          group_id: groupId,
          year: currentYear,
          month: currentMonth + 1,
        },
      }).then((res) => res.data),
    enabled: !!groupId,
  });

  // Davomat faqat "ongoing" dars paytida qo'yiladi — bugungi darsni topamiz.
  // `silentError: true` — `lessons.view` ruxsati yo'q bo'lsa, butun sahifani
  // "buzilgandek" ko'rsatadigan qizil xabar chiqmaydi; sahifa shunchaki
  // dars-holatiga bog'liq imkoniyatlarsiz (start/end) ishlashda davom etadi.
  const { data: lessonsData } = useQuery<Lesson[]>({
    queryKey: ['lessons', groupId],
    queryFn: () =>
      API.get('/lessons', {
        params: { group_id: groupId, per_page: 200 },
        silentError: true,
      }).then((res) => {
        const arr = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
        return arr as Lesson[];
      }),
    enabled: !!groupId && canViewLessons,
    retry: false,
  });

  const todayLesson = useMemo(
    () =>
      (lessonsData ?? []).find(
        (l) => Number(l.group_id) === Number(groupId) && isSameDay(l.date, new Date()),
      ),
    [lessonsData, groupId],
  );
  const lessonStatus = todayLesson?.status;
  const lessonActive = lessonStatus === 'ongoing';

  // Bugun guruhning dars kunimi? (group.days asosida)
  const todayIsLessonDay = useMemo(() => {
    if (!groupData?.days) return false;
    const todayDow = new Date().getDay();
    return groupData.days.some((d) => DAY_INDEX[d.toLowerCase()] === todayDow);
  }, [groupData]);

  // Dars vaqti — guruhning start_time/end_time (masalan "15:00-16:30").
  const lessonTime = useMemo(() => {
    const g = groupData as Record<string, unknown> | undefined;
    const fmt = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : '');
    const start = fmt(g?.start_time);
    const end = fmt(g?.end_time);
    if (!start && !end) return '';
    return end ? `${start}-${end}` : start;
  }, [groupData]);

  const notifyError = (error: unknown, fallbackKey: string) =>
    notifications.show({
      title: t('studentsAttendance.notif_error_title'),
      message: getApiErrorMessage(error, t(fallbackKey)),
      color: 'red',
    });

  const notifySuccess = (messageKey: string) =>
    notifications.show({
      title: t('studentsAttendance.notif_success_title'),
      message: t(messageKey),
      color: 'green',
    });

  const invalidateAttendanceQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['student_attendance'] });
    // balansi davomatdan keyin o'zgaradi — o'quvchilar ro'yxatini ham yangilaymiz
    queryClient.invalidateQueries({ queryKey: ['students', groupId] });
    queryClient.invalidateQueries({ queryKey: ['group', groupId] });
  };

  const startLessonMutation = useMutation({
    mutationFn: (id: number) => API.post(`/lessons/${id}/start`),
    onSuccess: () => notifySuccess('studentsAttendance.lesson_started'),
    onError: (error) => notifyError(error, 'studentsAttendance.lesson_start_error'),
    onSettled: () => {
      setStartModalOpen(false);
      // 409 (allaqachon boshlangan) holatida ham holatni yangilaymiz
      queryClient.invalidateQueries({ queryKey: ['lessons', groupId] });
    },
  });

  // Bugungi dars yozuvi bo'lmasa — avval yaratamiz (mavzu bilan), so'ng boshlaymiz.
  const createAndStartMutation = useMutation({
    mutationFn: async (topic: string) => {
      const form = new FormData();
      form.append('group_id', String(groupId));
      form.append('date', todayStr);
      form.append('topic', topic);
      // Backend homework_title_uz ni majburiy qiladi — vaqtincha mavzu bilan to'ldiramiz.
      // Asl uy vazifasi dars tugaganda darslar sahifasida yangilanadi.
      form.append('homework_title_uz', topic);
      const res = await API.post('/lessons', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const created = (res.data?.data ?? res.data) as Lesson | undefined;
      if (created?.id) {
        await API.post(`/lessons/${created.id}/start`);
      }
      return created;
    },
    onSuccess: () => notifySuccess('studentsAttendance.lesson_started'),
    onError: (error) => notifyError(error, 'studentsAttendance.lesson_start_error'),
    onSettled: () => {
      setStartModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['lessons', groupId] });
    },
  });

  const startBusy = startLessonMutation.isPending || createAndStartMutation.isPending;

  const handleConfirmStart = () => {
    if (todayLesson) {
      startLessonMutation.mutate(todayLesson.id);
    } else {
      createAndStartMutation.mutate(startTopic.trim());
    }
  };

  // Dars boshlanishi kerak bo'lgan holat (bugun dars kuni, hali ongoing/completed emas).
  const startNeeded =
    Boolean(todayLesson || todayIsLessonDay) &&
    lessonStatus !== 'ongoing' &&
    lessonStatus !== 'completed';

  // Guruh tanlangach / ma'lumot yuklangach — start modalini bir marta avtomatik ochamiz.
  // Effekt emas, render fazasida (ConfirmModal'dagi kabi) — cascading render bo'lmasligi uchun.
  // FAQAT darsni boshlash ruxsati bo'lganlar uchun — aks holda modal ochilib,
  // backend so'rovni rad etib (403) "Ruxsat yo'q" xabari chiqib qolardi. Va
  // FAQAT pedagog xodim uchun — aks holda shu ruxsatga ega admin/boshqa
  // xodim har qanday guruhni ochganida ham "mavzu kiriting" oynasi
  // bexosdan chiqaverardi.
  if (groupId && startNeeded && !autoPrompted && canStartLesson && isTeachingStaff) {
    setAutoPrompted(true);
    setStartModalOpen(true);
  }

  const endLessonMutation = useMutation({
    mutationFn: (id: number) => API.post(`/lessons/${id}/end`),
    onSuccess: () => {
      notifySuccess('studentsAttendance.lesson_ended');
      setConfirmEndOpen(false);
      queryClient.invalidateQueries({ queryKey: ['lessons', groupId] });
      invalidateAttendanceQueries();
      navigate(
        `/student-tasks?groupId=${groupId}&date=${todayStr}&openHomework=1&lessonId=${todayLesson?.id ?? ''}`,
      );
    },
    onError: (error) => notifyError(error, 'studentsAttendance.lesson_end_error'),
  });

  const createMutation = useMutation({
    mutationFn: (data: Attendance) => API.post('/student_attendance', data),
    onSuccess: () => {
      invalidateAttendanceQueries();
      setSelectedCell(null);
    },
    onError: (error) => notifyError(error, 'studentsAttendance.attendance_error'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Attendance) => API.put(`/student_attendance/${data.id}`, data),
    onSuccess: () => {
      invalidateAttendanceQueries();
      setSelectedCell(null);
    },
    onError: (error) => notifyError(error, 'studentsAttendance.attendance_error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => API.delete(`/student_attendance/${id}`),
    onSuccess: () => {
      invalidateAttendanceQueries();
      setSelectedCell(null);
    },
    onError: (error) => notifyError(error, 'studentsAttendance.attendance_error'),
  });

  const lessonDatesInMonth = useMemo(() => {
    if (!groupData?.days) return [];
    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    const lessonDays = groupData.days.map((d: string) => DAY_INDEX[d.toLowerCase()]);
    const result: number[] = [];
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(currentYear, currentMonth, day);
      if (lessonDays.includes(date.getDay())) {
        result.push(day);
      }
    }
    return result;
  }, [currentYear, currentMonth, groupData]);

  const getWeekday = useCallback(
    (day: number) => {
      const date = new Date(currentYear, currentMonth, day);
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      return t(`studentsAttendance.weekdays.${dayNames[date.getDay()]}`);
    },
    [currentYear, currentMonth, t],
  );

  // Katakcha tahrirlanadimi: to'liq ruxsatlilar uchun — bugungi yoki O'TGAN har
  // qanday dars sanasi; qolganlar uchun — faqat bugungi "ongoing" dars.
  const isCellEditable = useCallback(
    (dateStr: string) =>
      canManageAnyAttendance
        ? dateStr <= todayStr
        : lessonActive && dateStr === todayStr,
    [canManageAnyAttendance, lessonActive, todayStr],
  );

  const handleCellClick = useCallback(
    (studentId: number, day: number) => {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!isCellEditable(dateStr)) return;
      const attendance = (attendanceData?.[studentId] || []).find((a) =>
        String(a.date).startsWith(dateStr),
      );
      // Mavjud yozuvni ochish — tahrirlash ruxsati kerak; yangi yozuv
      // qo'shish (bo'sh katakcha) — qo'shish ruxsati kerak.
      if (attendance ? !canEditAttendance : !canCreateAttendance) return;
      setSelectedCell({ studentId, date: dateStr, attendance });
    },
    [
      isCellEditable,
      attendanceData,
      currentYear,
      currentMonth,
      canEditAttendance,
      canCreateAttendance,
    ],
  );

  if (!groupId) return <GroupSelector />;

  const handleSaveAttendance = (data: PopoverState) => {
    if (!data.status) return;

    const payload: Attendance = {
      student_id: selectedCell?.studentId ?? 0,
      group_id: Number(groupId),
      date: selectedCell?.date ?? '',
      status: data.status,
      // `null` ham yuboriladi: PUT'da so'rovda YO'Q maydon o'zgarmay qolardi (bahoni o'chirib bo'lmasdi).
      score: data.grade ?? null,
      comment_uz: data.comment_uz ?? '',
    };

    if (data.id) {
      updateMutation.mutate({ ...payload, id: data.id });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDeleteAttendance = () => {
    if (selectedCell?.attendance?.id) {
      deleteMutation.mutate(selectedCell.attendance.id);
    }
  };

  const monthKeys = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sept',
    'oct',
    'nov',
    'dec',
  ];

  const popoverAttendance: PopoverState = selectedCell?.attendance
    ? {
        id: selectedCell.attendance.id,
        student_id: selectedCell.attendance.student_id,
        group_id: selectedCell.attendance.group_id,
        date: selectedCell.attendance.date,
        status: selectedCell.attendance.status,
        grade: selectedCell.attendance.score,
        comment_uz: selectedCell.attendance.comment_uz,
      }
    : {
        student_id: selectedCell?.studentId ?? 0,
        group_id: Number(groupId),
        date: selectedCell?.date ?? '',
      };

  return (
    <div
      className={`attendance-container container${
        canStartLesson || canEndLesson ? ' has-lesson-controls' : ''
      }`}
    >
      <h1 className="main-title">{t('aside.studentsAttendance')}</h1>
      <button
        type="button"
        className="attendance-group-bar"
        onClick={() => navigate('/students-attendance')}
        title={t('studentsAttendance.change_group')}
      >
        <span className="attendance-group-bar__back" aria-hidden>
          ‹
        </span>
        <span className="attendance-group-bar__name">
          {t('studentsAttendance.group')}: {groupData?.name ?? '…'}
        </span>
        {studentsData?.data && (
          <span className="attendance-group-bar__count">
            · {studentsData.data.length} {t('studentsAttendance.students_short')}
          </span>
        )}
      </button>

      <div className="attendance-header">
        <div className="attendance-controls">
          <div className="year-selector">
            <button className="year-btn" onClick={() => setCurrentYear((p) => p - 1)}>
              ‹
            </button>
            <span className="year-display">{currentYear}</span>
            <button className="year-btn" onClick={() => setCurrentYear((p) => p + 1)}>
              ›
            </button>
          </div>
          <div className="month-pills">
            {monthKeys.map((m, idx) => (
              <button
                key={m}
                className={`month-pill${currentMonth === idx ? ' active' : ''}`}
                onClick={() => setCurrentMonth(idx)}
              >
                {t(`studentsAttendance.months.${m}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="attendance-legend">
          <div className="legend-item">
            <div className="legend-dot dot-present" />
            {t('studentsAttendance.present')}
          </div>
          <div className="legend-item">
            <div className="legend-dot dot-absent" />
            {t('studentsAttendance.absent')}
          </div>
          <div className="legend-item">
            <div className="legend-dot dot-late" />
            {t('studentsAttendance.late')}
          </div>
          <div className="legend-item">
            <div className="legend-dot dot-reason" />
            {t('studentsAttendance.reason')}
          </div>
        </div>
      </div>

      <div
        className="desktop-table-container"
        ref={tableScrollRef}
        onMouseDown={onTableScrollMouseDown}
      >
        <table className="attendance-table">
          <thead>
            <tr>
              <th className="student-col-header">FISH</th>
              {lessonDatesInMonth.map((day) => (
                <th key={day} className="attendance-col-header">
                  <div className="weekday-header">{getWeekday(day)}</div>
                  <div className="date-header">{day}</div>
                </th>
              ))}
              <th className="balance-col-header">{t('studentsAttendance.oquvchi_balansi')}</th>
            </tr>
          </thead>
          <tbody>
            {studentsData?.data?.map((student) => (
              <tr key={student.id}>
                <td className="student-info-cell">
                  <div className="student-info-inner">
                    <img
                      src={`https://ui-avatars.com/api/?name=${student.first_name}+${student.last_name}`}
                      alt="avatar"
                      className="avatar"
                    />
                    <div className="student-text">
                      <span className="student-name">
                        {student.first_name} {student.last_name}
                      </span>
                      <span className="student-phone">{student.phone}</span>
                    </div>
                    <div className={`status-badge status-${getStatusMeta(student?.status).cls}`}>
                      {t(`studentsAttendance.${getStatusMeta(student?.status).key}`)}
                    </div>
                  </div>
                </td>
                {lessonDatesInMonth.map((day) => {
                  const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const cellActive = isCellEditable(dateStr);
                  const att = (attendanceData?.[student.id] || []).find((a) =>
                    String(a.date).startsWith(dateStr),
                  );
                  return (
                    <td key={day} className={`attendance-cell${cellActive ? '' : ' cell-locked'}`}>
                      <AttendanceDot
                        status={att?.status}
                        grade={att?.score}
                        onClick={() => handleCellClick(student.id, day)}
                      />
                    </td>
                  );
                })}
                <td className="balance-info">
                  <div className="id-text">
                    {t('studentsAttendance.id')}: {student.id}
                  </div>
                  <div className="last-payment">{student.last_payment_date}</div>
                  <div
                    className={`balance-text ${student.balance < 0 ? 'balance-red' : 'balance-green'}`}
                  >
                    Balans: {groupDigits(student?.balance)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-cards">
        {studentsData?.data?.map((student) => (
          <div key={student.id} className="student-card">
            <div className="card-header">
              <img
                src={`https://ui-avatars.com/api/?name=${student.first_name}+${student.last_name}`}
                alt="avatar"
                className="avatar"
              />
              <div className="student-text">
                <span className="student-name">
                  {student.first_name} {student.last_name}
                </span>
                <span className="student-phone">{student.phone}</span>
              </div>
              <div className={`status-badge status-${getStatusMeta(student?.status).cls}`}>
                {t(`studentsAttendance.${getStatusMeta(student?.status).key}`)}
              </div>
            </div>
            <div className="card-body">
              <div className="card-attendance-grid">
                {lessonDatesInMonth.map((day) => {
                  const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const att = (attendanceData?.[student.id] || []).find((a) =>
                    String(a.date).startsWith(dateStr),
                  );
                  return (
                    <div key={day} className="card-day-col">
                      <span className="card-weekday">{getWeekday(day)}</span>
                      <span className="card-date">{day}</span>
                      <AttendanceDot
                        status={att?.status}
                        grade={att?.score}
                        onClick={() => handleCellClick(student.id, day)}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="card-footer">
                <span
                  className={`balance-text ${student?.balance < 0 ? 'balance-red' : 'balance-green'}`}
                >
                  Balans: {groupDigits(student?.balance)}
                </span>
                <span className="id-text">
                  {t('studentsAttendance.id')}: {student.id}
                </span>
                <span className="last-payment">{student.last_payment_date}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Darsni boshlash/tugatish paneli — dars o'tadigan xodim (o'qituvchi)
          uchun. Ko'rish uchun `lessons.create` (yoki backend qo'shsa
          `lessons.start`/`lessons.end`) ruxsati kerak — davomatni faqat ko'rib
          chiqadigan admin·menejerdan shu ruxsatni olib qo'ysangiz, «Darsni
          boshlash / Bugun dars yo'q / Darsni tamomlash» va dars-mavzusi oynasi
          umuman chiqmaydi. (Avtomatik ochiladigan oyna uchun qo'shimcha
          `isTeachingStaff` sharti bor — u faqat «Pedagog xodimlar» bo'limidagi
          foydalanuvchiga o'z-o'zidan ochiladi.) */}
      {(canStartLesson || canEndLesson) && (
        <div className="lesson-control-fixed">
          {canStartLesson &&
            (todayLesson || todayIsLessonDay) &&
            lessonStatus !== 'ongoing' &&
            lessonStatus !== 'completed' && (
              <button
                className="lesson-btn btn-start"
                onClick={() => setStartModalOpen(true)}
                disabled={startBusy}
              >
                {t('studentsAttendance.darsni_boshlash')}
                {lessonTime && <span>{lessonTime}</span>}
              </button>
            )}
          {!todayLesson && !todayIsLessonDay && (
            <button className="lesson-btn btn-disabled" disabled>
              {t('studentsAttendance.no_lesson_today')}
            </button>
          )}
          {canEndLesson && lessonStatus === 'ongoing' && (
            <button
              className="lesson-btn btn-end"
              onClick={() => setConfirmEndOpen(true)}
              disabled={endLessonMutation.isPending}
            >
              {t('studentsAttendance.darsni_tamomlash')}
              {lessonTime && <span>{lessonTime}</span>}
            </button>
          )}
          {lessonStatus === 'completed' && (
            <button className="lesson-btn btn-disabled" disabled>
              {t('studentsAttendance.lesson_completed')}
            </button>
          )}
        </div>
      )}

      {startModalOpen && (
        <div className="modal-centered-overlay">
          <div className="start-lesson-modal">
            <h2>{t('studentsAttendance.start_lesson_title')}</h2>
            {lessonTime && <p className="start-lesson-time">🕒 {lessonTime}</p>}
            <p>{t('studentsAttendance.start_lesson_desc')}</p>

            {!todayLesson && (
              <div className="start-topic-field">
                <label className="end-field-label">
                  {t('studentsAttendance.lesson_topic_label')}
                </label>
                <input
                  className="end-field-input"
                  value={startTopic}
                  disabled={startBusy}
                  autoFocus
                  onChange={(e) => setStartTopic(e.target.value)}
                />
              </div>
            )}

            <button
              className="start-modal-btn"
              type="button"
              disabled={startBusy || (!todayLesson && !startTopic.trim())}
              onClick={handleConfirmStart}
            >
              {t('studentsAttendance.start')}
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmEndOpen}
        title={t('studentsAttendance.end_lesson_title')}
        message={t('studentsAttendance.end_confirm_desc')}
        confirmLabel={t('studentsAttendance.end_confirm_btn')}
        cancelLabel={t('studentsAttendance.cancel')}
        tone="danger"
        busy={endLessonMutation.isPending}
        onConfirm={() => todayLesson && endLessonMutation.mutate(todayLesson.id)}
        onCancel={() => setConfirmEndOpen(false)}
      />

      {selectedCell && (
        <Popover
          attendance={popoverAttendance}
          onSave={handleSaveAttendance}
          onCancel={() => setSelectedCell(null)}
          onDelete={handleDeleteAttendance}
          saving={createMutation.isPending || updateMutation.isPending}
          canDelete={canDeleteAttendance}
        />
      )}
    </div>
  );
};

export default StudentsAttendance;
