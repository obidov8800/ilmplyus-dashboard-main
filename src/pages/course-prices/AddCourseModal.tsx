import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CoursePricePayload, CoursePrice } from '../../types';
import { useOptions, getCourseLevels, getBranchCourses } from '../../hooks/useOptions';
import { useCourseBranches } from '../../hooks/useCourseBranches';
import { legacyLessonFields, previousLessonsCount } from './legacyLessons';
import { groupDigits } from '@/utils/formatNumber';

interface FormState {
  filial: string;
  kurs: string;
  level: string;
  old_price: string;
  percentage: string;
  new_price: string;
  start_date: string;
  comment: string;
}

interface FormErrors {
  filial?: string;
  kurs?: string;
  level?: string;
  old_price?: string;
  percentage?: string;
  new_price?: string;
  start_date?: string;
}

export interface AddCourseModalProps {
  coursePrices: CoursePrice[];
  editItem?: CoursePrice | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (data: CoursePricePayload) => void;
}

function getDaysInMonth(month: string): number {
  if (!month) return 31;
  const m = parseInt(month, 10);
  if ([1, 3, 5, 7, 8, 10, 12].includes(m)) return 31;
  if ([4, 6, 9, 11].includes(m)) return 30;
  return 29;
}

const num = (value: string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Eski narx = shu filial+kurs+daraja bo'yicha oxirgi yozuvning yangi narxi. */
function findPreviousPrice(
  coursePrices: CoursePrice[],
  filial: string,
  kurs: string,
  level: string,
): number {
  if (!kurs) return 0;
  let list = coursePrices.filter((cp) => String(cp.course_id) === kurs);
  if (level) list = list.filter((cp) => String(cp.level_id) === level);
  if (!list.length) return 0;
  const matched = filial
    ? (list.find((cp) => String(cp.branch_id) === filial) ?? list[0])
    : list[0];
  return parseFloat(matched.new_price) || 0;
}

const calcNewPrice = (oldPrice: number, percentage: number): string =>
  oldPrice ? String(Math.round(oldPrice * (1 + percentage / 100))) : '';

const calcPercentage = (oldPrice: number, newPrice: number): string =>
  oldPrice ? String(Math.round(((newPrice - oldPrice) / oldPrice) * 100)) : '';

export default function AddCourseModal({
  coursePrices,
  editItem,
  isSaving,
  onClose,
  onSave,
}: AddCourseModalProps) {
  const { t } = useTranslation();

  const MONTHS = useMemo(
    () => [
      { value: '01', label: t('coursePrices.jan') },
      { value: '02', label: t('coursePrices.feb') },
      { value: '03', label: t('coursePrices.mar') },
      { value: '04', label: t('coursePrices.apr') },
      { value: '05', label: t('coursePrices.may') },
      { value: '06', label: t('coursePrices.jun') },
      { value: '07', label: t('coursePrices.jul') },
      { value: '08', label: t('coursePrices.aug') },
      { value: '09', label: t('coursePrices.sep') },
      { value: '10', label: t('coursePrices.oct') },
      { value: '11', label: t('coursePrices.nov') },
      { value: '12', label: t('coursePrices.dec') },
    ],
    [t],
  );

  const [form, setForm] = useState<FormState>(() => {
    if (editItem) {
      return {
        filial: String(editItem.branch_id),
        kurs: String(editItem.course_id),
        level: String(editItem.level_id),
        old_price: String(parseFloat(editItem.old_price) || ''),
        // Foiz bazada NULL bo'lsa (eski yozuv) — eski va yangi narxdan hisoblanadi; aks holda tahrirlash
        // "O'zgarish foizini kiriting" xatosi bilan bloklanib qolardi.
        percentage:
          editItem.percentage !== null && editItem.percentage !== undefined
            ? String(editItem.percentage)
            : calcPercentage(parseFloat(editItem.old_price) || 0, parseFloat(editItem.new_price) || 0),
        new_price: String(parseFloat(editItem.new_price) || ''),
        start_date: editItem.start_date ?? '',
        comment: editItem.comment ?? '',
      };
    }
    return {
      filial: '',
      kurs: '',
      level: '',
      old_price: '',
      percentage: '',
      new_price: '',
      start_date: '',
      comment: '',
    };
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [startDay, setStartDay] = useState(() =>
    editItem?.start_date ? (editItem.start_date.split('.')[0] ?? '') : '',
  );
  const [startMonth, setStartMonth] = useState(() =>
    editItem?.start_date ? (editItem.start_date.split('.')[1] ?? '') : '',
  );
  // Maktabga tayyorlov filiali (PARVOZ) kurs narxiga ega emas — tanlovda chiqmaydi (tahrirlashda yozuvning o'z filiali qoladi).
  const { data: branches, isLoading: isLoadingData } = useCourseBranches(editItem?.branch_id);
  const { data: courses = [] } = useOptions('courses');

  // /options/courses har bir kursni o'ziga biriktirilgan filiallar bilan qaytaradi —
  // kurslar ro'yxati tanlangan filialga qarab filtrlanadi.
  const filteredCourses = useMemo(
    () => getBranchCourses(courses, form.filial),
    [courses, form.filial],
  );

  const selectedCourseLevels = useMemo(
    () => getCourseLevels(courses, form.kurs),
    [courses, form.kurs],
  );

  const dayOptions = useMemo(() => {
    const count = getDaysInMonth(startMonth);
    return Array.from({ length: count }, (_, i) => String(i + 1).padStart(2, '0'));
  }, [startMonth]);

  const oldPriceRaw = num(form.old_price);
  const newPriceRaw = num(form.new_price);
  const percentageRaw = num(form.percentage);

  /**
   * Eski narx filial+kurs+daraja tanlanganda avtomatik to'ladi, yangi narx esa foizdan
   * hisoblanadi — lekin ikkalasini ham qo'lda o'zgartirsa bo'ladi. Qo'lda yozilgan
   * qiymat ustunlik qiladi: yangi narx tahrirlansa, foiz unga qarab qayta hisoblanadi.
   */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;

      setForm((prev) => {
        const next = { ...prev, [name]: value };

        if (name === 'filial' || name === 'kurs' || name === 'level') {
          if (name === 'filial') {
            next.kurs = '';
            next.level = '';
          }
          if (name === 'kurs') next.level = '';

          const auto = findPreviousPrice(coursePrices, next.filial, next.kurs, next.level);
          next.old_price = auto ? String(auto) : '';
          next.new_price = calcNewPrice(auto, num(next.percentage));
          return next;
        }

        // Eski narx bo'lmasa (kurs uchun birinchi narx) hech nima hisoblanmaydi —
        // foydalanuvchi uchala maydonni ham o'zi to'ldiradi.
        if (name === 'old_price') {
          if (num(value) > 0) next.new_price = calcNewPrice(num(value), num(prev.percentage));
          return next;
        }

        if (name === 'percentage') {
          const oldPrice = num(prev.old_price);
          if (oldPrice > 0) next.new_price = calcNewPrice(oldPrice, num(value));
          return next;
        }

        if (name === 'new_price') {
          const oldPrice = num(prev.old_price);
          if (oldPrice > 0) next.percentage = calcPercentage(oldPrice, num(value));
          return next;
        }

        return next;
      });

      setErrors((prev) => ({ ...prev, [name]: undefined }));
    },
    [coursePrices],
  );

  const handleDayChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const day = e.target.value;
      setStartDay(day);
      setErrors((prev) => ({ ...prev, start_date: undefined }));
      setForm((prev) => ({ ...prev, start_date: day && startMonth ? `${day}.${startMonth}` : '' }));
    },
    [startMonth],
  );

  const handleMonthChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const month = e.target.value;
      setStartMonth(month);
      setErrors((prev) => ({ ...prev, start_date: undefined }));
      const maxDay = getDaysInMonth(month);
      const validDay = startDay && parseInt(startDay, 10) <= maxDay ? startDay : '';
      if (!validDay) setStartDay('');
      setForm((prev) => ({ ...prev, start_date: validDay && month ? `${validDay}.${month}` : '' }));
    },
    [startDay],
  );

  const validate = useCallback((): boolean => {
    const next: FormErrors = {};
    if (!form.filial) next.filial = t('coursePrices.errBranch');
    if (!form.kurs) next.kurs = t('coursePrices.errCourse');
    if (!form.level) next.level = t('coursePrices.errLevel');
    // Foiz — eski narxga nisbatan. Kursning BIRINCHI narxida eski narx yo'q (foiz bazada NULL) — shu sabab
    // bunday yozuvni tahrirlashda foizni majburan so'ramaymiz (yuborilganda 0 bo'ladi).
    const percentageMissing = form.percentage.trim() === '' && oldPriceRaw > 0;
    if (percentageMissing || !Number.isFinite(Number(form.percentage || 0)))
      next.percentage = t('coursePrices.errPercentage');
    if (!form.new_price || Number(form.new_price) <= 0)
      next.new_price = t('coursePrices.errNewPrice');
    if (!form.start_date) next.start_date = t('coursePrices.errDate');
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form, oldPriceRaw, t]);

  const handleSave = useCallback(() => {
    if (!validate()) return;
    // Darslar soni formada yo'q — guruh kunlaridan hisoblanadi; backend talabi uchun qiymat `legacyLessons.ts` da.
    const lessonsCount =
      editItem?.lessons_count && editItem.lessons_count > 0
        ? editItem.lessons_count
        : previousLessonsCount(coursePrices, form.filial, form.kurs, form.level);
    onSave({
      branch_id: Number(form.filial),
      course_id: Number(form.kurs),
      level_id: Number(form.level),
      old_price: oldPriceRaw,
      new_price: newPriceRaw,
      ...legacyLessonFields(newPriceRaw, lessonsCount),
      percentage: percentageRaw,
      start_date: form.start_date,
      comment: form.comment || '',
    });
  }, [form, onSave, validate, oldPriceRaw, newPriceRaw, percentageRaw, editItem, coursePrices]);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && !isSaving && onClose()}
    >
      <div className="modal add-payment-modal">
        <h3 className="modal-title">
          {editItem ? t('coursePrices.editTitle') : t('coursePrices.addTitle')}
        </h3>

        {isLoadingData ? (
          <p style={{ textAlign: 'center', color: '#7a8fa6' }}>{t('coursePrices.loading')}</p>
        ) : (
          <div className="add-payment-form">
            <div className="form-left">
              <div className="form-group">
                <label>{t('coursePrices.branch')}</label>
                <select
                  name="filial"
                  value={form.filial}
                  onChange={handleChange}
                  disabled={isSaving}
                >
                  <option value="">{t('coursePrices.choose')}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.label}
                    </option>
                  ))}
                </select>
                {errors.filial && <small style={{ color: '#e70a0a' }}>{errors.filial}</small>}
              </div>

              <div className="form-group">
                <label>{t('coursePrices.course')}</label>
                <select
                  name="kurs"
                  value={form.kurs}
                  onChange={handleChange}
                  disabled={isSaving || !form.filial}
                >
                  <option value="">{t('coursePrices.choose')}</option>
                  {filteredCourses.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {errors.kurs && <small style={{ color: '#e70a0a' }}>{errors.kurs}</small>}
              </div>

              <div className="form-group">
                <label>{t('coursePrices.level')}</label>
                <select
                  name="level"
                  value={form.level}
                  onChange={handleChange}
                  disabled={isSaving || !form.kurs}
                >
                  <option value="">{t('coursePrices.choose')}</option>
                  {selectedCourseLevels.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.label}
                    </option>
                  ))}
                </select>
                {errors.level && <small style={{ color: '#e70a0a' }}>{errors.level}</small>}
              </div>

              <div className="form-group">
                <label>{t('coursePrices.oldPrice')}</label>
                <input
                  name="old_price"
                  type="number"
                  value={form.old_price}
                  onChange={handleChange}
                  placeholder="0"
                  min={0}
                  disabled={isSaving}
                  style={errors.old_price ? { borderColor: '#e70a0a' } : undefined}
                />
                {oldPriceRaw > 0 && (
                  <small style={{ color: '#7a8fa6' }}>{groupDigits(oldPriceRaw)}</small>
                )}
                {errors.old_price && <small style={{ color: '#e70a0a' }}>{errors.old_price}</small>}
              </div>

              <div className="form-group">
                <label>{t('coursePrices.changePercent')}</label>
                <input
                  name="percentage"
                  type="number"
                  value={form.percentage}
                  onChange={handleChange}
                  placeholder="0"
                  step={1}
                  disabled={isSaving}
                  style={errors.percentage ? { borderColor: '#e70a0a' } : undefined}
                />
                {oldPriceRaw > 0 && percentageRaw !== 0 && (
                  <small style={{ color: percentageRaw > 0 ? '#27ae60' : '#e70a0a' }}>
                    {t('coursePrices.priceChange')}: {percentageRaw > 0 ? '+' : ''}
                    {percentageRaw}%
                  </small>
                )}
                {errors.percentage && <small style={{ color: '#e70a0a' }}>{errors.percentage}</small>}
              </div>
            </div>

            <div className="form-right">
              <div className="form-group">
                <label>{t('coursePrices.newPriceMonthly')}</label>
                <input
                  name="new_price"
                  type="number"
                  value={form.new_price}
                  onChange={handleChange}
                  placeholder="0"
                  min={0}
                  disabled={isSaving}
                  style={errors.new_price ? { borderColor: '#e70a0a' } : undefined}
                />
                {newPriceRaw > 0 && (
                  <small style={{ color: '#7a8fa6' }}>{groupDigits(newPriceRaw)}</small>
                )}
                {errors.new_price && <small style={{ color: '#e70a0a' }}>{errors.new_price}</small>}
              </div>

              <div className="form-group">
                <label>{t('coursePrices.changeDate')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={startDay}
                    onChange={handleDayChange}
                    disabled={isSaving}
                    style={{ flex: 1, ...(errors.start_date ? { borderColor: '#e70a0a' } : {}) }}
                  >
                    <option value="">{t('coursePrices.day')}</option>
                    {dayOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    value={startMonth}
                    onChange={handleMonthChange}
                    disabled={isSaving}
                    style={{ flex: 1, ...(errors.start_date ? { borderColor: '#e70a0a' } : {}) }}
                  >
                    <option value="">{t('coursePrices.month')}</option>
                    {MONTHS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                {errors.start_date && (
                  <small style={{ color: '#e70a0a' }}>{errors.start_date}</small>
                )}
              </div>

              <div className="form-group">
                <label>{t('coursePrices.comment')}</label>
                <textarea
                  name="comment"
                  value={form.comment}
                  onChange={handleChange}
                  rows={3}
                  placeholder={t('coursePrices.commentPlaceholder')}
                  disabled={isSaving}
                />
              </div>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="primary"
            onClick={handleSave}
            disabled={isSaving || isLoadingData}
          >
            {isSaving ? t('coursePrices.saving') : t('coursePrices.save')}
          </button>
          <button type="button" className="cancel" onClick={onClose} disabled={isSaving}>
            {t('coursePrices.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
