import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API } from '../../api/api';
import { notifications } from '@mantine/notifications';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import './lessons.css';
import type { Group, Lesson } from '@/types/lesson.types';
import { useTranslation } from 'react-i18next';
import { getLocalized } from '@/utils/getLocalized';
import { getApiErrorMessage } from '@/utils/apiError';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useOptions } from '../../hooks/useOptions';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { dateToIso, toTashkentDate } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';

/** `Group` (lesson.types) doesn't declare `branch` — needed here to filter the
 * group dropdown. Tekshirilgan: `/groups` filialni `branch_id` emas, ichma-ich
 * `branch: { id, ... }` obyekti sifatida qaytaradi — `branch_id` bilan filtrlash
 * doim bo'sh natija berardi (hech qanday guruh mos kelmasdi). */
type GroupWithBranch = Group & { branch?: { id: number } };

const uzDays: Record<string, string> = {
  monday: 'dushanba',
  tuesday: 'seshanba',
  wednesday: 'chorshanba',
  thursday: 'payshanba',
  friday: 'juma',
  saturday: 'shanba',
  sunday: 'yakshanba',
};

const dayMap: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const formatTime = (time: string | undefined) => {
  if (!time) return '';
  return time.split(':').slice(0, 2).join(':');
};

const Lessons = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('studentTasks');
  // Bu jadvalda checkbox ustuni yo'q: ID (ixtiyoriy) + ustunlar + «Amallar».
  const colCount = 1 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>('');

  // Selected lesson for viewing
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);

  // Form state
  const [topic, setTopic] = useState('');
  const [lessonFile, setLessonFile] = useState<File | null>(null);
  const [homeworkTitle, setHomeworkTitle] = useState('');
  const [homeworkDescription, setHomeworkDescription] = useState('');
  const [homeworkFile, setHomeworkFile] = useState<File | null>(null);
  const [lessonDate, setLessonDate] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Davomat sahifasidan "Darsni tugatish" bilan kelinganda: guruh + sana tanlab,
  // uy vazifasini biriktirish uchun modalni avtomatik ochamiz.
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenGroupId = searchParams.get('groupId');
  const autoOpenDate = searchParams.get('date');
  const shouldAutoOpen = searchParams.get('openHomework') === '1';
  const autoOpenedRef = useRef(false);

  // Guruhlar: `groups.view` bo'lsa `/groups`, bo'lmasa tanlov ro'yxati — sahifaga `homework_submissions.view` yetadi.
  const canViewGroups = usePermission('groups.view');
  const canViewLessons = usePermission('lessons.view');
  const { data: groupOptions = [] } = useOptions('groups', undefined, { enabled: !canViewGroups });
  const { data: fullGroups } = useQuery({
    // Massiv shaklidagi nusxa — `['groups']` (guruhlar sahifasidagi to'liq javob) bilan to'qnashmasin.
    queryKey: ['groups', 'array'],
    queryFn: async () => {
      const res = await API.get('/groups');
      return Array.isArray(res.data) ? res.data : res.data?.data || [];
    },
    enabled: canViewGroups,
  });
  const rawGroups = canViewGroups ? fullGroups : groupOptions.map((o) =>
          ({
            id: o.id,
            name: o.label,
            branch_id: o.branch_id,
            room_id: o.room_id,
            room: o.room_id ? { id: o.room_id } : null,
            teacher_id: o.teacher_id,
            teacher: o.teacher_id ? { id: o.teacher_id } : null,
            course_id: o.course_id,
            start_time: o.start_time,
            end_time: o.end_time,
            days: (o as { days?: string[] }).days ?? [],
            academic_year_id: o.academic_year_id ?? null,
          }) as unknown as Group);

  const groups = useMemo<GroupWithBranch[]>(
    () => (Array.isArray(rawGroups) ? rawGroups : (rawGroups as { data?: Group[] })?.data ?? []),
    [rawGroups],
  );

  const [groupBranchFilter, setGroupBranchFilter] = useState('');
  const { data: branchOptions } = useOptions('branches');
  const visibleGroups = groupBranchFilter
    ? groups.filter((g) => String(g.branch?.id) === groupBranchFilter)
    : groups;

  const selectedGroup = useMemo(() => {
    return groups.find((g: Group) => g.id === selectedGroupId);
  }, [groups, selectedGroupId]);

  const dateOptions = useMemo(() => {
    if (!selectedGroup || !selectedGroup.days || selectedGroup.days.length === 0) return [];

    const options: { value: string; label: string }[] = [];
    const allowedDays = selectedGroup.days.map((d: string) => dayMap[d.toLowerCase()]);
    const startTime = formatTime(selectedGroup.start_time);
    const endTime = formatTime(selectedGroup.end_time);

    let current = new Date();
    // Agar start_date bugundan keyin bo'lsa, o'shandan boshlaymiz
    if (selectedGroup.start_date) {
      const start = new Date(selectedGroup.start_date);
      if (start > current) current = start;
    }

    // Keyingi 15 ta imkoniyatni qidiramiz
    let count = 0;
    let iterations = 0;
    const searchDate = new Date(current);

    while (count < 15 && iterations < 60) {
      if (allowedDays.includes(searchDate.getDay())) {
        const isoDate = dateToIso(searchDate);
        const dayName = Object.keys(dayMap).find(
          (key: string) => dayMap[key] === searchDate.getDay(),
        );
        const displayDay = dayName ? uzDays[dayName] : '';
        const label = `${searchDate.getDate()}-${
          [
            'yanvar',
            'fevral',
            'mart',
            'aprel',
            'may',
            'iyun',
            'iyul',
            'avgust',
            'sentabr',
            'oktabr',
            'noyabr',
            'dekabr',
          ][searchDate.getMonth()]
        }, ${displayDay} (${startTime}-${endTime})`;

        options.push({ value: isoDate, label });
        count++;
      }
      searchDate.setDate(searchDate.getDate() + 1);
      iterations++;
    }

    return options;
  }, [selectedGroup]);

  // jadval bosh turadi guruhni tanlaganda keyin darslar chiqadi
  const { data: lessons = [], isLoading } = useQuery({
    queryKey: ['lessons', selectedGroupId, lessonDate],
    queryFn: async () => {
      const res = await API.get('/lessons', {
        params: { group_id: selectedGroupId },
      });
      const data = Array.isArray(res.data) ? res.data : res.data?.data || [];
      // Backend ushbu filterga javob bergan taqdirda ham, frontda xavfsizlik uchun qayta tekshiramiz
      return data.filter((lesson: Lesson) => {
        const matchesGroup = Number(lesson.group_id) === Number(selectedGroupId);
        const matchesDate = lessonDate ? lesson.date === lessonDate : true;
        return matchesGroup && matchesDate;
      });
    },
    enabled: !!selectedGroupId && canViewLessons,
  });

  const lessonsTotal = lessons.length;
  const lessonsTotalPages = Math.max(1, Math.ceil(lessonsTotal / pageSize));
  const pagedLessons = useMemo(
    () => lessons.slice((page - 1) * pageSize, page * pageSize),
    [lessons, page, pageSize],
  );

  const mutation = useMutation({
    mutationFn: async ({ formData, lessonId }: { formData: FormData; lessonId?: number }) => {
      // Mavjud darsning uy vazifasi yangilanadi; aks holda yangi dars yaratiladi.
      // Laravel multipart PUT so'rovini `_method` orqali qabul qiladi.
      if (lessonId) formData.append('_method', 'PUT');
      const res = await API.post(lessonId ? `/lessons/${lessonId}` : '/lessons', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // Fayl yuklashda backend/proksi "osilib" qolsa — so'rov cheksiz kutmasin.
        // Aks holda "Saqlanmoqda..." abadiy turib qoladi. 2 daqiqadan keyin
        // xato beriladi, foydalanuvchi qayta urina oladi.
        timeout: 120_000,
      });
      return res.data;
    },
    onSuccess: (data) => {
      notifications.show({
        title: t('studentTasks.notification.successTitle'),
        message: data?.message || t('studentTasks.notification.lessonSaved'),
        color: 'green',
      });
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['lessons'] });
      resetForm();
    },
    onError: (error) => {
      console.error(error);
      notifications.show({
        title: t('studentTasks.notification.errorTitle'),
        message: getApiErrorMessage(error, t('studentTasks.notification.lessonSaveError')),
        color: 'red',
      });
    },
  });

  const resetForm = () => {
    setTopic('');
    setLessonFile(null);
    setHomeworkTitle('');
    setHomeworkDescription('');
    setHomeworkFile(null);
    setSelectedLesson(null);
  };

  const handleOpenAdd = () => {
    if (!selectedGroupId) {
      notifications.show({
        title: t('studentTasks.notification.warningTitle'),
        message: t('studentTasks.notification.selectGroupFirst'),
        color: 'orange',
      });
      return;
    }
    resetForm();
    if (dateOptions.length > 0) {
      setLessonDate(dateOptions[0].value);
    }
    setIsModalOpen(true);
  };

  // Maydonlar backendda `topic_uz` / `homework_title_uz` / `homework_description_uz` (+ _ru/_en) — eski `topic`
  // ustuni yo'q, shu sabab ko'rish/tahrirlash oynasi bo'sh ochilardi. Forma UZ matnni tahrirlaydi
  // (saqlashda ham `_uz` yoziladi), shuning uchun interfeys tilidan qat'i nazar `_uz` olinadi.
  const uzText = (lesson: Lesson, field: string) => {
    const v = getLocalized(lesson, field, 'uz');
    return v === '-' ? '' : v;
  };

  const handleView = (lesson: Lesson) => {
    setSelectedLesson(lesson);
    setTopic(uzText(lesson, 'topic'));
    setHomeworkTitle(uzText(lesson, 'homework_title'));
    setHomeworkDescription(uzText(lesson, 'homework_description'));
    setLessonDate(String(lesson.date).slice(0, 10));
    setLessonFile(null); // Clear file inputs so new files can be attached if they want
    setHomeworkFile(null);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId) return;

    const formData = new FormData();
    formData.append('group_id', String(selectedGroupId));
    formData.append('date', lessonDate || toTashkentDate(new Date()));
    formData.append('topic_uz', topic);
    if (lessonFile) formData.append('lesson_file', lessonFile);
    formData.append('homework_title_uz', homeworkTitle);
    formData.append('homework_description_uz', homeworkDescription);
    if (homeworkFile) formData.append('homework_file', homeworkFile);

    mutation.mutate({ formData, lessonId: selectedLesson?.id });
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: (file: File | null) => void,
  ) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const getFileName = (path: string | undefined) => {
    if (!path) return '';
    return path.split('/').pop();
  };

  // 1-qadam: URL'dan kelgan guruhni tanlaymiz (bir marta). Sanani query filtriga
  // qo'ymaymiz — aks holda dars sanasi datetime formatida bo'lsa, aynan tenglik
  // solishtiruvi uni ro'yxatdan chiqarib yuborardi.
  useEffect(() => {
    if (!shouldAutoOpen) return;
    if (autoOpenGroupId) setSelectedGroupId(Number(autoOpenGroupId));
  }, [shouldAutoOpen, autoOpenGroupId]);

  // 2-qadam: darslar yuklangach modalni ochamiz — o'sha sanaga dars bo'lsa,
  // uy vazifasini biriktirish uchun uni oldindan to'ldiramiz.
  useEffect(() => {
    if (!shouldAutoOpen || autoOpenedRef.current) return;
    if (!autoOpenGroupId || Number(selectedGroupId) !== Number(autoOpenGroupId)) return;
    // Dars ro'yxati yuklanib bo'lguncha kutamiz — bo'sh forma erta ochilmasin.
    if (isLoading) return;

    autoOpenedRef.current = true;
    const existing = (lessons as Lesson[]).find((l) =>
      autoOpenDate ? String(l.date).startsWith(autoOpenDate) : false,
    );
    if (existing) {
      handleView(existing);
    } else {
      resetForm();
      if (autoOpenDate) setLessonDate(autoOpenDate);
      setIsModalOpen(true);
    }

    // Parametrlarni tozalaymiz — modal yopilib qayta ochilib qolmasin.
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoOpen, autoOpenGroupId, autoOpenDate, selectedGroupId, lessons, isLoading]);

  return (
    <div className="lessons-container container">
      <h1 className="main-title">{t('aside.studentTasks')}</h1>
      <div className="lessons-header">
        <div className="lessons-filters">
          <div className="filter-item">
            <label>{t('studentTasks.branch', 'Filial')}</label>
            <select
              className="custom-select"
              value={groupBranchFilter}
              onChange={(e) => {
                setGroupBranchFilter(e.target.value);
                // Tanlangan guruh yangi filial ostida ko'rinmay qolsa — tanlovni tozalash.
                setSelectedGroupId('');
                setLessonDate('');
                setPage(1);
              }}
            >
              <option value="">{t('studentTasks.selectGroupPlaceholder')}</option>
              {branchOptions?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-item">
            <label>{t('studentTasks.selectGroup')}</label>
            <select
              className="custom-select"
              value={selectedGroupId}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : '';
                setSelectedGroupId(val);
                setLessonDate('');
                setPage(1);
              }}
            >
              <option value="">{t('studentTasks.selectGroupPlaceholder')}</option>
              {visibleGroups.map((g: Group) => (
                <option key={g.id} value={g.id}>
                  {g.name || getLocalized(g, 'name', lang)}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-item">
            <label>{t('studentTasks.nextLessonDate')}</label>
            <select
              className="custom-select"
              value={lessonDate}
              onChange={(e) => {
                setLessonDate(e.target.value);
                setPage(1);
              }}
              disabled={!selectedGroupId || dateOptions.length === 0}
            >
              {dateOptions.length === 0 ? (
                <option value="">{t('studentTasks.noDateAvailable')}</option>
              ) : (
                <>
                  <option value="">{t('studentTasks.selectDatePlaceholder')}</option>
                  {dateOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>
        <Protected permission="homework_submissions.create">
          <button className="add-lesson-btn" onClick={handleOpenAdd}>
            {t('studentTasks.addLesson')}
          </button>
        </Protected>
      </div>

      <div className="lessons-table-wrapper">
        <table className="lessons-table">
          <thead>
            <tr>
              {isVisible('id') && <th>{t('studentTasks.table.id')}</th>}
              {visibleColumns.map((colId) => (
                <th key={colId}>{columnHeader(colId)}</th>
              ))}
              <th>{t('studentTasks.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {!selectedGroupId ? (
              <tr>
                <td
                  colSpan={colCount}
                  style={{
                    textAlign: 'center',
                    padding: '30px',
                    fontSize: '16px',
                    color: '#666',
                  }}
                >
                  {t('studentTasks.selectGroupHint')}
                </td>
              </tr>
            ) : isLoading ? (
              <tr>
                <td
                  colSpan={colCount}
                  style={{
                    textAlign: 'center',
                    padding: '30px',
                    fontSize: '16px',
                    color: '#666',
                  }}
                >
                  {t('studentTasks.loading')}
                </td>
              </tr>
            ) : lessons.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  style={{
                    textAlign: 'center',
                    padding: '30px',
                    fontSize: '16px',
                    color: '#666',
                  }}
                >
                  {lessonDate
                    ? t('studentTasks.noLessonForDate')
                    : t('studentTasks.noLessons')}
                </td>
              </tr>
            ) : (
              pagedLessons.map((lesson: Lesson) => (
                <tr key={lesson.id}>
                  {isVisible('id') && <td className="fw-700">{lesson.id}</td>}
                  {visibleColumns.map((colId) => {
                    switch (colId) {
                      case 'date':
                        return <td key={colId} className="fw-700">{lesson.date}</td>;
                      case 'topic':
                        return (
                          <td key={colId} className="fw-700">
                            {getLocalized(lesson, 'topic', lang)}
                          </td>
                        );
                      case 'lesson_file':
                        return (
                          <td key={colId}>
                            {lesson.lesson_file && (
                              <a
                                href={lesson.lesson_file}
                                target="_blank"
                                rel="noreferrer"
                                className="table-link"
                              >
                                {getFileName(lesson.lesson_file)}
                              </a>
                            )}
                          </td>
                        );
                      case 'homework':
                        return (
                          <td key={colId} className="fw-700">
                            {getLocalized(lesson, 'homework_title', lang)}
                          </td>
                        );
                      case 'homework_file':
                        return (
                          <td key={colId}>
                            {lesson.homework_file && (
                              <a
                                href={lesson.homework_file}
                                target="_blank"
                                rel="noreferrer"
                                className="table-link"
                              >
                                {getFileName(lesson.homework_file)}
                              </a>
                            )}
                          </td>
                        );
                      default:
                        return <td key={colId}>-</td>;
                    }
                  })}
                  <td>
                    <button className="view-btn" onClick={() => handleView(lesson)}>
                      {t('studentTasks.view')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={lessonsTotalPages}
        total={lessonsTotal}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      {isModalOpen && (
        <div className="lt-modal-overlay">
          <div className="lt-modal">
            <div className="lt-modal-header">
              <h2>{selectedLesson ? t('studentTasks.modal.viewTitle') : t('studentTasks.modal.addTitle')}</h2>
              <p>
                {selectedGroup
                  ? selectedGroup.name || getLocalized(selectedGroup, 'name', lang)
                  : t('studentTasks.modal.groupFallback')}{' '}
                |{' '}
                {dateOptions.find((o) => o.value === lessonDate)?.label ||
                  lessonDate ||
                  t('studentTasks.modal.noDate')}
              </p>
            </div>
            <form onSubmit={handleSubmit} className="lt-modal-body">
              <div className="lt-form-sections">
                <div className="lt-form-section">
                  <h3 className="lt-section-title">{t('studentTasks.modal.lessonSection')}</h3>

                  <div className="lt-form-group">
                    <label>
                      {t('studentTasks.modal.topicLabel')}<span className="lt-required">*</span>
                    </label>
                    <input
                      type="text"
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder={t('studentTasks.modal.topicPlaceholder')}
                      required
                      className="lt-input"
                    />
                  </div>

                  <div className="lt-form-group">
                    <label>{t('studentTasks.modal.lessonFileLabel')}</label>
                    <div className="lt-file-wrapper">
                      <label className="lt-file-btn">
                        {t('studentTasks.modal.chooseFile')}
                        <input type="file" onChange={(e) => handleFileChange(e, setLessonFile)} />
                      </label>
                      <div className="lt-file-name">
                        {lessonFile
                          ? lessonFile.name
                          : selectedLesson?.lesson_file
                            ? getFileName(selectedLesson.lesson_file)
                            : ''}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="lt-form-section">
                  <h3 className="lt-section-title">{t('studentTasks.modal.homeworkSection')}</h3>

                  <div className="lt-form-group">
                    <label>
                      {t('studentTasks.modal.homeworkTitleLabel')}<span className="lt-required">*</span>
                    </label>
                    <input
                      type="text"
                      value={homeworkTitle}
                      onChange={(e) => setHomeworkTitle(e.target.value)}
                      placeholder={t('studentTasks.modal.homeworkTitlePlaceholder')}
                      required
                      className="lt-input"
                    />
                  </div>

                  <div className="lt-form-group">
                    <label>{t('studentTasks.modal.homeworkDescLabel')}</label>
                    <textarea
                      value={homeworkDescription}
                      onChange={(e) => setHomeworkDescription(e.target.value)}
                      placeholder={t('studentTasks.modal.homeworkDescPlaceholder')}
                      className="lt-textarea"
                    ></textarea>
                  </div>

                  <div className="lt-form-group">
                    <label>{t('studentTasks.modal.homeworkFileLabel')}</label>
                    <div className="lt-file-wrapper">
                      <label className="lt-file-btn">
                        {t('studentTasks.modal.chooseFile')}
                        <input type="file" onChange={(e) => handleFileChange(e, setHomeworkFile)} />
                      </label>
                      <div className="lt-file-name">
                        {homeworkFile
                          ? homeworkFile.name
                          : selectedLesson?.homework_file
                            ? getFileName(selectedLesson.homework_file)
                            : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lt-modal-footer">
                <button type="submit" className="lt-save-btn" disabled={mutation.isPending}>
                  {mutation.isPending ? t('studentTasks.modal.saving') : t('studentTasks.modal.save')}
                </button>
                <button
                  type="button"
                  className="lt-cancel-btn"
                  onClick={() => setIsModalOpen(false)}
                >
                  {t('studentTasks.modal.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Lessons;
