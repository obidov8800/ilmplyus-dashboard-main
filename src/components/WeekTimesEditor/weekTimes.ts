/** Haftaning 7 kuni uchun alohida vaqt — tur va yordamchi funksiyalar (komponent: `./index.tsx`). */

export interface DayTime {
  /** 1 = Dushanba … 7 = Yakshanba (backend `week_day` bilan bir xil). */
  day: number;
  enabled: boolean;
  start: string;
  end: string;
}

export const WEEK_DAYS: { num: number; key: string }[] = [
  { num: 1, key: 'monday' },
  { num: 2, key: 'tuesday' },
  { num: 3, key: 'wednesday' },
  { num: 4, key: 'thursday' },
  { num: 5, key: 'friday' },
  { num: 6, key: 'saturday' },
  { num: 7, key: 'sunday' },
];

/** Hamma kun bir xil vaqt bilan; `enabledDays` bo'lmasa — hammasi belgilangan. */
export function makeWeek(start: string, end: string, enabledDays: number[] = [1, 2, 3, 4, 5, 6, 7]): DayTime[] {
  return WEEK_DAYS.map(({ num }) => ({ day: num, enabled: enabledDays.includes(num), start, end }));
}

/** `HH:MM` (soniyasiz). */
export const hm = (value: string | null | undefined, fallback: string) => (value ? value.slice(0, 5) : fallback);

export const isOvernight = (start: string, end: string) => !!start && !!end && start > end;

/** Belgilangan kunda vaqt noto'g'rimi: bo'sh, bir xil yoki (yarim tundan o'tmaydigan jadvalda) tugash boshlanishdan oldin. */
export function dayError(d: DayTime, allowOvernight: boolean): boolean {
  if (!d.enabled) return false;
  if (!d.start || !d.end || d.start === d.end) return true;
  return !allowOvernight && d.end < d.start;
}

export const weekHasError = (week: DayTime[], allowOvernight: boolean) =>
  week.some((d) => dayError(d, allowOvernight));

/** «Du–Ju 08:00–20:00 · Sha 09:00–15:00 · Yak dam olish» — ketma-ket bir xil vaqtli kunlar birlashtiriladi. */
export function summarizeWeek(
  week: DayTime[],
  dayShort: (key: string) => string,
  dayOffLabel: string,
): string {
  const parts: string[] = [];
  const same = (a: DayTime, b: DayTime) =>
    a.enabled === b.enabled && (!a.enabled || (a.start === b.start && a.end === b.end));
  let i = 0;
  while (i < week.length) {
    let j = i;
    while (j + 1 < week.length && same(week[i], week[j + 1])) j++;
    const first = WEEK_DAYS[i];
    const last = WEEK_DAYS[j];
    const label = i === j ? dayShort(first.key) : `${dayShort(first.key)}–${dayShort(last.key)}`;
    parts.push(`${label} ${week[i].enabled ? `${week[i].start}–${week[i].end}` : dayOffLabel}`);
    i = j + 1;
  }
  return parts.join(' · ');
}
