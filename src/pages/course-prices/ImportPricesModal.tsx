import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { API } from '../../api/api';
import InfoHint from '@/components/InfoHint';
import useAuthStore from '../../store/useAuthStore';
import { getApiErrorMessage } from '../../utils/apiError';
import { getBranchCourses, getCourseLevels, useOptions, type CourseOption } from '../../hooks/useOptions';
import { useCourseBranches } from '../../hooks/useCourseBranches';
import type { CoursePrice, CoursePricePayload } from '../../types';
import { legacyLessonFields, previousLessonsCount } from './legacyLessons';
import { bestMatch, guessLevel, parsePriceSheet, readFirstSheet, type ParsedPrice } from './importExcel';
import './importPrices.css';
import { groupDigits } from '@/utils/formatNumber';

interface Props {
  /** Tizimdagi barcha narxlar — eski narx va «o'zgarmagan» belgisi uchun. */
  coursePrices: CoursePrice[];
  onClose: () => void;
}

interface ImportRow {
  key: string;
  src: ParsedPrice;
  branchId: string;
  courseId: string;
  levelId: string;
  /** Narx qachondan amal qiladi (`KK.OO`) — har qator uchun alohida. */
  startDate: string;
  include: boolean;
  state: 'idle' | 'sending' | 'done' | 'error';
  error?: string;
}

const money = (value: number) => groupDigits(value);
const pad = (n: number) => String(n).padStart(2, '0');

const daysIn = (month: string) => {
  const m = parseInt(month, 10);
  if ([1, 3, 5, 7, 8, 10, 12].includes(m)) return 31;
  if ([4, 6, 9, 11].includes(m)) return 30;
  return 29;
};

/** `KK.OO` — haqiqiy sana (kun oyga mos) bo'lishi shart: backend `start_date` ni shu shaklda qabul qiladi. */
const validDayMonth = (value: string) => {
  const m = /^(\d{2})\.(\d{2})$/.exec(value);
  if (!m) return false;
  const month = parseInt(m[2], 10);
  const day = parseInt(m[1], 10);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(m[2]);
};

/** Yozish paytida `1210` → `12.10`. */
const formatDayMonth = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}.${digits.slice(2)}` : digits;
};

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

export default function ImportPricesModal({ coursePrices, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  // Maktabga tayyorlov filiali (masalan «PARVOZ») kurs narxiga ega emas — ro'yxatda chiqmaydi.
  const { data: branches = [], isLoading: loadingBranches } = useCourseBranches();
  const { data: courseOptions = [], isLoading: loadingCourses } = useOptions('courses');
  const courses = courseOptions as CourseOption[];

  const today = useMemo(() => new Date(), []);
  const todayDayMonth = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}`;
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  // «Qachongacha amal qiladi» — butun fayl uchun bitta sana (ixtiyoriy). Backendda tugash sanasi maydoni yo'q — izohga yoziladi.
  const [endDay, setEndDay] = useState('');
  const [endMonth, setEndMonth] = useState('');
  const [comment, setComment] = useState('Excel import (prays-list)');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [running, setRunning] = useState(false);
  const [formError, setFormError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const loading = loadingBranches || loadingCourses;

  /** Tanlangan filialga biriktirilgan kurslar. */
  const coursesOf = (branchId: string) => (branchId ? getBranchCourses(courses, branchId) : []);

  const autoMap = (src: ParsedPrice): Pick<ImportRow, 'branchId' | 'courseId' | 'levelId'> => {
    const branch = bestMatch(src.branchName, branches, 0.6);
    const branchId = branch ? String(branch.id) : '';
    // Avval filialga biriktirilgan kurslardan; topilmasa — qat'iyroq talab bilan hamma kurslardan (belgilab ko'rsatiladi).
    const course = branchId
      ? (bestMatch(src.courseName, coursesOf(branchId), 0.72) ?? bestMatch(src.courseName, courses, 0.85))
      : null;
    const courseId = course ? String(course.id) : '';
    const level = courseId ? guessLevel(getCourseLevels(courses, courseId), src.stage) : null;
    return { branchId, courseId, levelId: level ? String(level.id) : '' };
  };

  /** Shu filial+kurs+daraja bo'yicha eng so'nggi narx (eski narx/foiz shundan). */
  const latestPrice = (row: Pick<ImportRow, 'branchId' | 'courseId' | 'levelId'>): number => {
    if (!row.branchId || !row.courseId || !row.levelId) return 0;
    const same = coursePrices
      .filter(
        (p) =>
          String(p.branch_id) === row.branchId &&
          String(p.course_id) === row.courseId &&
          String(p.level_id) === row.levelId,
      )
      .sort((a, b) => b.id - a.id)[0];
    return same ? parseFloat(same.new_price) || 0 : 0;
  };

  const analyze = (row: ImportRow) => {
    const old = latestPrice(row);
    const percentage = old > 0 ? Math.round(((row.src.price - old) / old) * 100) : 0;
    const complete = !!(row.branchId && row.courseId && row.levelId);
    return {
      old,
      percentage,
      complete,
      same: old > 0 && old === row.src.price,
      outOfRange: percentage > 100 || percentage < -99,
      dateOk: validDayMonth(row.startDate),
      detached: complete && !coursesOf(row.branchId).some((c) => String(c.id) === row.courseId),
    };
  };

  const handleFile = async (file: File | undefined) => {
    setFileError('');
    setRows([]);
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed = parsePriceSheet(readFirstSheet(await file.arrayBuffer()));
      if (parsed.length === 0) {
        setFileError(t('coursePrices.import.noRows'));
        return;
      }
      setRows(
        parsed.map((src) => {
          const mapped = autoMap(src);
          const draft: ImportRow = {
            key: `${src.excelRow}-${src.stage}`,
            src,
            ...mapped,
            startDate: todayDayMonth,
            include: false,
            state: 'idle',
          };
          const info = analyze(draft);
          return { ...draft, include: info.complete && !info.same && !info.outOfRange };
        }),
      );
    } catch {
      setFileError(t('coursePrices.import.readError'));
    }
  };

  const patchRow = (key: string, patch: Partial<ImportRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const changeBranch = (row: ImportRow, branchId: string) => {
    const course = branchId ? bestMatch(row.src.courseName, coursesOf(branchId), 0.72) : null;
    const courseId = course ? String(course.id) : '';
    const level = courseId ? guessLevel(getCourseLevels(courses, courseId), row.src.stage) : null;
    patchRow(row.key, { branchId, courseId, levelId: level ? String(level.id) : '', include: false });
  };

  const changeCourse = (row: ImportRow, courseId: string) => {
    const level = courseId ? guessLevel(getCourseLevels(courses, courseId), row.src.stage) : null;
    patchRow(row.key, { courseId, levelId: level ? String(level.id) : '', include: false });
  };

  // Fayldagi ikki qator bir xil filial+kurs+darajaga tushsa («Arab tili» va «Arab tili (CEFR)» bitta kursga mos kelsa) —
  // keyingisi takror: avval boshqa kursga/darajaga o'tkazilmasa yuborilmaydi.
  const firstByKey = new Map<string, number>();
  const analyzed = rows.map((row) => {
    const info = analyze(row);
    const key = `${row.branchId}-${row.courseId}-${row.levelId}`;
    let duplicateOf: number | null = null;
    if (info.complete) {
      const first = firstByKey.get(key);
      if (first === undefined) firstByKey.set(key, row.src.excelRow);
      else duplicateOf = first;
    }
    return { row, info: { ...info, duplicateOf } };
  });
  type Info = (typeof analyzed)[number]['info'];

  const sendable = (row: ImportRow, info: Info) =>
    info.complete && !info.outOfRange && info.dateOk && info.duplicateOf === null && row.state !== 'done';
  const needsAttention = (row: ImportRow, info: Info) =>
    row.state === 'error' ||
    (row.state !== 'done' &&
      (!info.complete || info.duplicateOf !== null || info.outOfRange || !info.dateOk || info.detached));

  const selected = analyzed.filter(({ row, info }) => row.include && sendable(row, info));
  const readyCount = analyzed.filter(({ row, info }) => sendable(row, info) || row.state === 'done').length;
  const visible = onlyAttention ? analyzed.filter(({ row, info }) => needsAttention(row, info)) : analyzed;

  const run = async () => {
    setFormError('');
    if (!!endDay !== !!endMonth) {
      setFormError(t('coursePrices.import.endDateIncomplete'));
      return;
    }
    if (selected.length === 0) return;

    const endDate = endDay && endMonth ? `${endDay}.${endMonth}` : '';
    const finalComment = [comment.trim(), endDate ? t('coursePrices.import.validUntilNote', { date: endDate }) : '']
      .filter(Boolean)
      .join('. ');

    setRunning(true);
    let ok = 0;
    let failed = 0;
    for (const { row, info } of selected) {
      patchRow(row.key, { state: 'sending', error: undefined });
      const payload: CoursePricePayload = {
        branch_id: Number(row.branchId),
        course_id: Number(row.courseId),
        level_id: Number(row.levelId),
        old_price: info.old,
        new_price: row.src.price,
        // Darslar soni importda yo'q — guruh kunlaridan hisoblanadi (backend talabi uchun qiymat `legacyLessons.ts` da).
        ...legacyLessonFields(row.src.price, previousLessonsCount(coursePrices, row.branchId, row.courseId, row.levelId)),
        percentage: info.percentage,
        start_date: row.startDate,
        comment: finalComment,
        ...(currentUser ? { created_by: currentUser.id } : {}),
      };
      try {
        // `silentError`: har qator uchun alohida qizil xabar chiqmasin — natija jadvalda ko'rinadi.
        await API.post('/course_prices', payload, { silentError: true });
        patchRow(row.key, { state: 'done', include: false });
        ok += 1;
      } catch (err) {
        patchRow(row.key, { state: 'error', error: getApiErrorMessage(err, t('coursePrices.import.saveError')) });
        failed += 1;
      }
    }
    setRunning(false);
    queryClient.invalidateQueries({ queryKey: ['course_prices'] });
    notifications.show({
      title: t('coursePrices.import.title'),
      message: t('coursePrices.import.result', { ok, failed }),
      color: failed ? 'orange' : 'green',
    });
  };

  const statusOf = (row: ImportRow, info: Info) => {
    if (row.state === 'sending') return { cls: 'cpi-st--busy', text: t('coursePrices.import.sending') };
    if (row.state === 'done') return { cls: 'cpi-st--done', text: t('coursePrices.import.done') };
    if (row.state === 'error') return { cls: 'cpi-st--error', text: row.error ?? t('coursePrices.import.saveError') };
    if (!info.complete) return { cls: 'cpi-st--warn', text: t('coursePrices.import.unmapped') };
    if (info.duplicateOf !== null) return { cls: 'cpi-st--warn', text: t('coursePrices.import.duplicate', { row: info.duplicateOf }) };
    if (info.outOfRange) return { cls: 'cpi-st--error', text: t('coursePrices.import.pctOut', { pct: info.percentage }) };
    if (!info.dateOk) return { cls: 'cpi-st--warn', text: t('coursePrices.import.badDate') };
    if (info.detached) return { cls: 'cpi-st--warn', text: t('coursePrices.import.detached') };
    if (info.same) return { cls: 'cpi-st--muted', text: t('coursePrices.import.same') };
    return { cls: 'cpi-st--ready', text: t('coursePrices.import.ready') };
  };

  return (
    <div className="cpi-overlay" onClick={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="cpi-modal" role="dialog" aria-modal="true">
        <div className="cpi-head">
          <h3>
            {t('coursePrices.import.title')}
            <InfoHint text={t('coursePrices.import.hint')} />
          </h3>
          <button type="button" className="cpi-close" onClick={onClose} disabled={running} aria-label={t('coursePrices.cancel')}>
            ×
          </button>
        </div>

        <div className="cpi-body">
          <div className="cpi-file">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button type="button" className="cpi-btn" onClick={() => fileRef.current?.click()} disabled={running || loading}>
              <i className="fa-solid fa-file-excel" /> {t('coursePrices.import.chooseFile')}
            </button>
            {fileName && <span className="cpi-file-name">{fileName}</span>}
            {loading && <span className="cpi-muted">{t('coursePrices.import.loadingLists')}</span>}
            {fileError && <span className="cpi-error">{fileError}</span>}
          </div>

          {rows.length > 0 && (
            <>
              <div className="cpi-params">
                <label>
                  <span>{t('coursePrices.import.validUntil')}</span>
                  <span className="cpi-date">
                    <select
                      value={endDay}
                      onChange={(e) => setEndDay(e.target.value)}
                      disabled={running}
                      aria-label={t('coursePrices.day')}
                    >
                      <option value="">—</option>
                      {Array.from({ length: daysIn(endMonth || '01') }, (_, i) => pad(i + 1)).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <select
                      value={endMonth}
                      onChange={(e) => {
                        setEndMonth(e.target.value);
                        if (e.target.value && endDay && parseInt(endDay, 10) > daysIn(e.target.value)) {
                          setEndDay(pad(daysIn(e.target.value)));
                        }
                      }}
                      disabled={running}
                      aria-label={t('coursePrices.month')}
                    >
                      <option value="">—</option>
                      {MONTH_KEYS.map((key, i) => (
                        <option key={key} value={pad(i + 1)}>
                          {t(`coursePrices.${key}`)}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="cpi-params-wide">
                  <span>{t('coursePrices.comment')}</span>
                  <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} disabled={running} />
                </label>
              </div>

              <div className="cpi-summary">
                <span>{t('coursePrices.import.found', { rows: rows.length, ready: readyCount })}</span>
                <label className="cpi-check">
                  <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
                  {t('coursePrices.import.onlyAttention')}
                </label>
              </div>

              <div className="cpi-table-wrap">
                <table className="cpi-table">
                  <thead>
                    <tr>
                      <th />
                      <th>{t('coursePrices.import.colExcel')}</th>
                      <th>{t('coursePrices.import.colBranch')}</th>
                      <th>{t('coursePrices.import.colCourse')}</th>
                      <th>{t('coursePrices.import.colLevel')}</th>
                      <th>{t('coursePrices.import.colFrom')}</th>
                      <th>{t('coursePrices.import.colPrice')}</th>
                      <th>{t('coursePrices.import.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={8} className="cpi-empty">
                          {t('coursePrices.import.nothingToShow')}
                        </td>
                      </tr>
                    )}
                    {visible.map(({ row, info }) => {
                      const status = statusOf(row, info);
                      const levels = row.courseId ? getCourseLevels(courses, row.courseId) : [];
                      const locked = running || row.state === 'done';
                      const own = coursesOf(row.branchId);
                      const ownIds = new Set(own.map((c) => c.id));
                      const others = courses.filter((c) => !ownIds.has(c.id));
                      return (
                        <tr key={row.key} className={row.state === 'done' ? 'cpi-row--done' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={row.include && sendable(row, info)}
                              disabled={locked || !sendable(row, info)}
                              onChange={(e) => patchRow(row.key, { include: e.target.checked })}
                              aria-label={t('coursePrices.import.includeRow')}
                            />
                          </td>
                          <td className="cpi-src">
                            <b>{row.src.courseName.trim()}</b>
                            <span>
                              {row.src.branchName.trim()} · {t('coursePrices.import.stage', { n: row.src.stage })} · #{row.src.excelRow}
                            </span>
                          </td>
                          <td>
                            <select value={row.branchId} disabled={locked} onChange={(e) => changeBranch(row, e.target.value)}>
                              <option value="">{t('coursePrices.import.choose')}</option>
                              {branches.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={row.courseId}
                              disabled={locked || !row.branchId}
                              onChange={(e) => changeCourse(row, e.target.value)}
                            >
                              <option value="">{t('coursePrices.import.choose')}</option>
                              {own.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label}
                                </option>
                              ))}
                              {others.length > 0 && (
                                <optgroup label={t('coursePrices.import.otherCourses')}>
                                  {others.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.label}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </td>
                          <td>
                            <select
                              value={row.levelId}
                              disabled={locked || !row.courseId}
                              onChange={(e) => patchRow(row.key, { levelId: e.target.value, include: false })}
                            >
                              <option value="">{t('coursePrices.import.choose')}</option>
                              {levels.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className={`cpi-from${info.dateOk ? '' : ' cpi-from--bad'}`}
                              type="text"
                              inputMode="numeric"
                              maxLength={5}
                              placeholder="KK.OO"
                              value={row.startDate}
                              disabled={locked}
                              onChange={(e) => patchRow(row.key, { startDate: formatDayMonth(e.target.value) })}
                              aria-label={t('coursePrices.import.colFrom')}
                            />
                          </td>
                          <td className="cpi-price">
                            <b>{money(row.src.price)}</b>
                            {info.old > 0 && (
                              <span>
                                {t('coursePrices.import.was', { old: money(info.old) })}
                                {info.percentage !== 0 && ` (${info.percentage > 0 ? '+' : ''}${info.percentage}%)`}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`cpi-st ${status.cls}`} title={status.text}>
                              {status.text}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {formError && <div className="cpi-error">{formError}</div>}
        </div>

        <div className="cpi-foot">
          <span className="cpi-muted">{rows.length > 0 && t('coursePrices.import.selected', { count: selected.length })}</span>
          <div className="cpi-foot-actions">
            <button type="button" className="cpi-btn cpi-btn--primary" onClick={run} disabled={running || selected.length === 0}>
              {running ? t('coursePrices.import.running') : t('coursePrices.import.run', { count: selected.length })}
            </button>
            <button type="button" className="cpi-btn" onClick={onClose} disabled={running}>
              {t('coursePrices.import.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
