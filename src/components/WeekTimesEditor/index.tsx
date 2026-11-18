import { useTranslation } from 'react-i18next';
import { WEEK_DAYS, dayError, isOvernight, type DayTime } from './weekTimes';
import './weekTimesEditor.css';

/**
 * Haftaning 7 kuni uchun alohida vaqt: har kun o'z katagi — belgilangan kunda boshlanish/tugash vaqti,
 * belgilanmagan kun — dam olish (yopiq). «Ish jadvali» oynasida va «Smena vaqtlari» sahifasida bir xil ishlatiladi.
 * Tur va yordamchilar: `./weekTimes.ts`.
 */

interface Props {
  value: DayTime[];
  onChange: (next: DayTime[]) => void;
  disabled?: boolean;
  /** Yarim tundan oshadigan vaqt (22:00–06:00) ruxsatmi: smenada ha, xodim ish jadvalida yo'q. */
  allowOvernight?: boolean;
  startLabel: string;
  endLabel: string;
}

export default function WeekTimesEditor({
  value,
  onChange,
  disabled = false,
  allowOvernight = false,
  startLabel,
  endLabel,
}: Props) {
  const { t } = useTranslation();

  const patch = (day: number, change: Partial<DayTime>) =>
    onChange(value.map((d) => (d.day === day ? { ...d, ...change } : d)));

  const enableDay = (d: DayTime, enabled: boolean) => {
    // Yangi belgilangan kun vaqti bo'sh qolmasin: boshqa belgilangan kundan ko'chiriladi.
    if (enabled && (!d.start || !d.end)) {
      const donor = value.find((x) => x.enabled && x.start && x.end);
      patch(d.day, { enabled, start: donor?.start ?? '09:00', end: donor?.end ?? '18:00' });
    } else {
      patch(d.day, { enabled });
    }
  };

  const copyToAll = () => {
    const source = value.find((d) => d.enabled && d.start && d.end);
    if (!source) return;
    onChange(value.map((d) => (d.enabled ? { ...d, start: source.start, end: source.end } : d)));
  };

  const hasEnabled = value.some((d) => d.enabled);

  return (
    <div className={`wte${disabled ? ' wte--disabled' : ''}`}>
      <div className="wte-toolbar">
        <button
          type="button"
          className="wte-btn wte-btn--primary"
          disabled={disabled}
          onClick={() => onChange(value.map((d) => ({ ...d, enabled: true })))}
        >
          {t('workSchedule.all')}
        </button>
        <button
          type="button"
          className="wte-btn"
          disabled={disabled || !hasEnabled}
          onClick={() => onChange(value.map((d) => ({ ...d, enabled: false })))}
        >
          {t('workSchedule.clear')}
        </button>
        <button type="button" className="wte-btn wte-btn--link" disabled={disabled || !hasEnabled} onClick={copyToAll}>
          {t('weekTimes.copyToAll')}
        </button>
      </div>

      <div className="wte-list" role="group">
        {WEEK_DAYS.map(({ num, key }) => {
          const d = value.find((x) => x.day === num);
          if (!d) return null;
          const bad = dayError(d, allowOvernight);
          return (
            <div className={`wte-row${d.enabled ? ' wte-row--on' : ''}${bad ? ' wte-row--bad' : ''}`} key={num}>
              <label className="wte-day">
                <input
                  type="checkbox"
                  checked={d.enabled}
                  disabled={disabled}
                  onChange={(e) => enableDay(d, e.target.checked)}
                />
                <span>{t(`workSchedule.days.${key}`)}</span>
              </label>

              {d.enabled ? (
                <div className="wte-times">
                  <input
                    type="time"
                    className="wte-time"
                    value={d.start}
                    disabled={disabled}
                    aria-label={`${t(`workSchedule.days.${key}`)} — ${startLabel}`}
                    onChange={(e) => patch(num, { start: e.target.value })}
                  />
                  <span className="wte-dash">—</span>
                  <input
                    type="time"
                    className="wte-time"
                    value={d.end}
                    disabled={disabled}
                    aria-label={`${t(`workSchedule.days.${key}`)} — ${endLabel}`}
                    onChange={(e) => patch(num, { end: e.target.value })}
                  />
                  {allowOvernight && isOvernight(d.start, d.end) && (
                    <span className="wte-hint">{t('weekTimes.overnight')}</span>
                  )}
                </div>
              ) : (
                <span className="wte-off">{t('weekTimes.dayOff')}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
