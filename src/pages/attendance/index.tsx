import { useState, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './attendance.css';
import TableSkeleton from '../../components/TableSkeleton';
import EmptyState from '../../components/EmptyState';
import { getLocalized } from '../../utils/getLocalized';
import { API } from '../../api/api';
import type { DepartmentType } from '../../types/department.types';
import { useOptions, type OptionItem } from '../../hooks/useOptions';
import { useEmployees } from '../../hooks/useSharedQueries';
import { useTableColumns } from '../../hooks/useTableColumns';
import useAuthStore from '../../store/useAuthStore';
import { getBranchScope } from '../../utils/branchScope';
import { hasPermissionBypass } from '../../utils/fullAccess';
import type { FlatAttendanceRecord, AttendanceBranch } from '../../types/attendance.types';
import {
  toStatusCode,
  statusClass,
  statusLabelKey,
  shortTime,
  fetchAttendanceRange,
  fetchMonthAttendances,
  monthRange,
  type StatusCode,
} from './attendance.utils';
import { toTashkentDate } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';

// Toshkent bo'yicha bugungi sana (UTC kuni 00:00–05:00 da kechani ko'rsatardi).
const todayISO = () => toTashkentDate(new Date());

/**
 * Bo'lim tablari foydalanuvchiga biriktirilgan bo'limlar orqali ochiladi.
 * Slug'lar bo'limning code yoki nomidan topiladi.
 */
type DeptSlug = 'pedagog' | 'mamuriy' | 'texnik' | 'sotuv';

const DEPT_TABS: { slug: DeptSlug; keywords: string[] }[] = [
  { slug: 'pedagog', keywords: ['pedagog', 'педагог'] },
  { slug: 'mamuriy', keywords: ['mamuriy', 'маъмурий', 'мамурий', 'админ', 'administrat'] },
  { slug: 'texnik', keywords: ['texnik', 'техник', 'technic'] },
  { slug: 'sotuv', keywords: ['sotuv', 'сотув', 'прода', 'sales'] },
];

/** Apostrof variantlarini tashlab, kichik harfga o'tkazadi (ma'muriy → mamuriy). */
const normalizeName = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[ʼ’‘'`ʻ]/g, '');

/** Option ichidan bo'lim id'larini yig'adi: department_id, department.id yoki departments[].id */
const extractDeptIds = (src: Record<string, unknown> | null | undefined): number[] => {
  if (!src) return [];
  const ids = new Set<number>();
  if (typeof src.department_id === 'number') ids.add(src.department_id);
  const dep = src.department as { id?: unknown } | null | undefined;
  if (dep && typeof dep === 'object' && typeof dep.id === 'number') ids.add(dep.id);
  const list = src.departments as Array<{ id?: unknown } | null> | undefined;
  if (Array.isArray(list)) {
    list.forEach((d) => {
      if (d && typeof d.id === 'number') ids.add(d.id);
    });
  }
  return [...ids];
};

/** Foydalanuvchi bo'limi: biriktirilgani (`DepartmentType`) yoki `/options/departments` elementi (`label` bilan). */
type AssignedDepartment = Partial<DepartmentType> & { id: number; label?: string };

/** Oy ichidagi eng so'nggi yozuvli kunning jamlanmasi (tanlangan kunda yozuv bo'lmasa ko'rsatiladi) */
interface LastDaySummary {
  date: string;
  firstIn: string;
  lastOut: string;
  statuses: StatusCode[];
}

/** "2026-06-08" → "08.06" */
const formatDayMonth = (iso: string) =>
  iso && iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : iso;

interface EmployeeRow {
  id: number;
  employee: string;
  position: string;
  branch: AttendanceBranch | null;
  branchId?: number;
  firstIn: string;
  lastOut: string;
  statuses: StatusCode[];
  deptIds: number[];
  lastActivity: LastDaySummary | null;
  /** Kun uchun yagona umumiy status (Kelgan/Kech qolgan/Uzrli/Sababsiz) */
  dayStatus?: StatusCode | null;
  /** lastActivity kunining umumiy statusi */
  lastDayStatus?: StatusCode | null;
}

/**
 * Kunning yagona umumiy statusi. Ustuvorlik: kech qolgan > kelgan > uzrli > sababsiz.
 * Kirdi/chiqdi yozuvi bo'lsa-yu status kodi kelmasa ham "Kelgan" deb hisoblanadi.
 */
const overallDayStatus = (day: {
  statuses: StatusCode[];
  firstIn: string;
  lastOut: string;
}): StatusCode | null => {
  if (day.statuses.includes('K')) return 'K';
  if (day.statuses.includes('+') || day.firstIn || day.lastOut) return '+';
  if (day.statuses.includes('S')) return 'S';
  if (day.statuses.includes('NB')) return 'NB';
  return null;
};

const AttendancePage = () => {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('attendance');
  // checkbox + (id) + ustunlar; bu jadvalda amallar ustuni yo'q
  const colCount = 1 + (isVisible('id') ? 1 : 0) + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const branchScope = getBranchScope(user);

  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [date, setDate] = useState(todayISO());
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  // Default: oxirgi qo'shilgan xodim birinchi
  const [sortAsc, setSortAsc] = useState(false);

  const { data: branchOptions } = useOptions('branches');
  const { data: employeeOptions } = useEmployees();
  const { data: departmentOptions } = useOptions('departments');

  // TEZLIK: tanlangan KUN uchun faqat shu kun so'raladi (oldin har doim butun
  // oyning hamma xodimlari yozuvlari yuklanardi). Kun tanlanmagan bo'lsa — oy.
  const range = useMemo(() => (date ? { from: date, to: date } : monthRange(month)), [date, month]);
  const {
    data: records = [],
    isLoading,
    isError,
    refetch: refetchAttendances,
  } = useQuery<FlatAttendanceRecord[]>({
    queryKey: ['attendances', 'range', range.from, range.to],
    queryFn: () => fetchAttendanceRange(range.from, range.to, { pageSize: date ? 500 : 200 }),
    placeholderData: keepPreviousData,
    // Bu so'rov ba'zi oylar uchun backendda 500 bilan tugaydi — bunday holatda
    // standart qayta urinishlar (kutish bilan 2 marta) foyda bermay, faqat
    // sahifani sekinlashtiradi, shuning uchun bu yerda o'chirilgan.
    retry: false,
  });

  // Kunlik ko'rinishda lavozim/filial/oxirgi faol kun uchun butun oy ma'lumoti
  // kerak — u jadval chizilgandan KEYIN, fonda va kam parallellik bilan yuklanadi
  // (jadval uni kutmaydi).
  const contextMonth = date ? date.slice(0, 7) : month;
  const { data: monthRecords } = useQuery<FlatAttendanceRecord[]>({
    queryKey: ['attendances', 'month', contextMonth],
    queryFn: () => fetchMonthAttendances(contextMonth, { concurrency: 3 }),
    enabled: Boolean(date) && !isLoading && !isError,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const recordsInScope = useMemo(
    () => branchScope
      ? records.filter((r) => {
          const branchId = r.branch_id ?? r.branch?.id;
          return branchId != null && branchScope.includes(Number(branchId));
        })
      : records,
    [records, branchScope],
  );
  const monthRecordsInScope = useMemo(
    () => branchScope
      ? (monthRecords ?? []).filter((r) => {
          const branchId = r.branch_id ?? r.branch?.id;
          return branchId != null && branchScope.includes(Number(branchId));
        })
      : monthRecords,
    [monthRecords, branchScope],
  );
  const contextRecords = date ? (monthRecordsInScope ?? recordsInScope) : recordsInScope;

  // Davomat yozuvlaridan xodim haqidagi doimiy ma'lumotlar:
  // bo'lim (id'lar + normallashgan nomlari) va lavozim.
  // Sana filtridan OLDIN, oyning barcha yozuvlaridan yig'iladi — shunda
  // tanlangan kunda kelmagan xodimning bo'limi/lavozimi ham aniqlanadi.
  const recordDepts = useMemo(() => {
    const byEmp: Record<number, number[]> = {};
    const names: Record<number, string> = {};
    const positions: Record<number, string> = {};
    const branches: Record<number, { branch: AttendanceBranch | null; branchId?: number }> = {};
    const lastActivity: Record<number, LastDaySummary> = {};
    contextRecords.forEach((r) => {
      if (r.position && !positions[r.employee_id]) positions[r.employee_id] = r.position;
      if (!branches[r.employee_id] && (r.branch || r.branch_id)) {
        branches[r.employee_id] = { branch: r.branch || null, branchId: r.branch_id };
      }
      const laTime = shortTime(r.time || r.check_in);
      if (r.date) {
        let cur = lastActivity[r.employee_id];
        if (!cur || r.date > cur.date) {
          cur = { date: r.date, firstIn: '', lastOut: '', statuses: [] };
          lastActivity[r.employee_id] = cur;
        }
        if (r.date === cur.date) {
          if (laTime) {
            if (r.type === 'out') {
              if (!cur.lastOut || laTime > cur.lastOut) cur.lastOut = laTime;
            } else if (!cur.firstIn || laTime < cur.firstIn) {
              cur.firstIn = laTime;
            }
          }
          (Array.isArray(r.status) ? r.status : []).forEach((s) => {
            const code = toStatusCode(s);
            if (code && !cur.statuses.includes(code)) cur.statuses.push(code);
          });
        }
      }
      const dep = (r as unknown as Record<string, unknown>).department as
        | Record<string, unknown>
        | null
        | undefined;
      if (!dep || typeof dep.id !== 'number') return;
      if (!names[dep.id]) {
        names[dep.id] = normalizeName(
          [dep.code, dep.name_uz, dep.name_ru, dep.name_en].filter(Boolean).join(' '),
        );
      }
      const list = (byEmp[r.employee_id] ??= []);
      if (!list.includes(dep.id)) list.push(dep.id);
    });
    return { byEmp, names, positions, branches, lastActivity };
  }, [contextRecords]);

  /**
   * Foydalanuvchining bo'limlari — bo'lim tablari va «Barchasi» ro'yxati shundan chiqadi.
   * Manbalar (birinchisi bo'sh bo'lsa keyingisi, hammasi birlashtiriladi):
   *  1) `/me` dagi `user.departments` (biriktirilgan bo'limlar) — backend bersa;
   *  2) `GET /users/{id}` (`users.show`) — jim, ruxsat bo'lmasa o'tkazib yuboriladi;
   *  3) o'z xodim yozuvining (`user.employee.id`) davomat yozuvlaridagi bo'limi (shartnomadagi bo'lim).
   * Admin (to'liq ruxsat) — hamma bo'lim. Hech biri topilmasa — cheklov yo'q (bo'sh jadval o'rniga hammasi).
   */
  const bypass = hasPermissionBypass(user);
  const meDepartments = useMemo(() => user?.departments ?? [], [user?.departments]);
  const canShowUsers = usePermission('users.show');
  const { data: profileDepartments } = useQuery<DepartmentType[]>({
    queryKey: ['user-departments', user?.id],
    // Faqat `users.show` bo'lsa (ruxsatsiz so'rov yuborilmaydi); bo'lmasa bo'limlar davomat yozuvlaridan aniqlanadi.
    enabled: !bypass && canShowUsers && meDepartments.length === 0 && Boolean(user?.id),
    queryFn: async () => {
      try {
        const res = await API.get(`/users/${user?.id}`, { silentError: true });
        const found = (res.data?.data ?? res.data)?.departments;
        return Array.isArray(found) ? found : [];
      } catch {
        return [];
      }
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const assignedDepartments = useMemo<AssignedDepartment[]>(() => {
    if (bypass) return departmentOptions ?? [];
    const byId = new Map<number, AssignedDepartment>();
    [...meDepartments, ...(profileDepartments ?? [])].forEach((d) => byId.set(d.id, d));
    const ownIds = user?.employee?.id ? (recordDepts.byEmp[user.employee.id] ?? []) : [];
    ownIds.forEach((id) => {
      const option = (departmentOptions ?? []).find((d) => d.id === id);
      if (option && !byId.has(id)) byId.set(id, option);
    });
    return [...byId.values()];
  }, [bypass, meDepartments, profileDepartments, departmentOptions, recordDepts, user?.employee?.id]);

  // Bo'limi aniqlanmagan foydalanuvchida cheklov yo'q: hamma bo'lim tabi chiqadi.
  const unrestricted = bypass || assignedDepartments.length === 0;

  const visibleTabs = useMemo(() => {
    if (unrestricted) return DEPT_TABS;
    return DEPT_TABS.filter(({ keywords }) =>
      assignedDepartments.some((department) => {
        const haystack = normalizeName(
          [department.code, department.label, department.name_uz, department.name_ru, department.name_en]
            .filter(Boolean)
            .join(' '),
        );
        return keywords.some((keyword) => haystack.includes(keyword));
      }),
    );
  }, [unrestricted, assignedDepartments]);

  // Standart — «Barchasi». Tanlangan tab ruxsatdan chiqib qolsa ham «Barchasi»ga qaytadi.
  const [selectedDept, setSelectedDept] = useState<DeptSlug | 'all'>('all');
  const activeDept: DeptSlug | 'all' =
    selectedDept === 'all' || visibleTabs.some((tab) => tab.slug === selectedDept)
      ? selectedDept
      : 'all';

  // Slug → shu slugga mos bo'lim id'lari. Nom/kod ham /options/departments dan,
  // ham davomat yozuvlaridagi department obyektidan tekshiriladi.
  const deptIdsBySlug = useMemo(() => {
    const map = {} as Record<DeptSlug, Set<number>>;
    DEPT_TABS.forEach(({ slug, keywords }) => {
      const ids = new Set<number>();
      (departmentOptions || []).forEach((d) => {
        const haystack = normalizeName(
          [d.code, d.label, d.name_uz, d.name_ru, d.name_en].filter(Boolean).join(' '),
        );
        if (keywords.some((k) => haystack.includes(k))) ids.add(d.id);
      });
      Object.entries(recordDepts.names).forEach(([id, name]) => {
        if (keywords.some((k) => name.includes(k))) ids.add(Number(id));
      });
      map[slug] = ids;
    });
    return map;
  }, [departmentOptions, recordDepts]);

  // employee_id → bo'lim id'lari (options/employees dan)
  const employeeDeptMap = useMemo(() => {
    const map: Record<number, number[]> = {};
    (employeeOptions || []).forEach((e: OptionItem) => {
      map[e.id] = extractDeptIds(e);
    });
    return map;
  }, [employeeOptions]);

  // Har bir xodim uchun bitta qator: tanlangan kundagi birinchi kirish va oxirgi chiqish
  const rows = useMemo(() => {
    const byEmployee: Record<number, EmployeeRow> = {};

    // Avval barcha xodimlarni qatorga qo'shamiz — davomati yo'qlari ham ko'rinsin
    (employeeOptions || []).forEach((e) => {
      byEmployee[e.id] = {
        id: e.id,
        employee: e.label,
        position: recordDepts.positions[e.id] || '',
        branch: recordDepts.branches[e.id]?.branch ?? null,
        branchId: recordDepts.branches[e.id]?.branchId,
        lastActivity: recordDepts.lastActivity[e.id] || null,
        firstIn: '',
        lastOut: '',
        statuses: [],
        deptIds: [
          ...new Set([...(employeeDeptMap[e.id] || []), ...(recordDepts.byEmp[e.id] || [])]),
        ],
      };
    });

    recordsInScope
      .filter((r) => (date ? r.date === date : true))
      .forEach((r) => {
        const row = (byEmployee[r.employee_id] ??= {
          id: r.employee_id,
          employee: r.employee,
          position: recordDepts.positions[r.employee_id] || '',
          branch: recordDepts.branches[r.employee_id]?.branch ?? null,
          branchId: recordDepts.branches[r.employee_id]?.branchId,
          lastActivity: recordDepts.lastActivity[r.employee_id] || null,
          firstIn: '',
          lastOut: '',
          statuses: [],
          deptIds: [
            ...new Set([
              ...(employeeDeptMap[r.employee_id] || []),
              ...(recordDepts.byEmp[r.employee_id] || []),
            ]),
          ],
        });

        row.position ||= r.position || '';
        row.branch ??= r.branch || null;
        row.branchId ??= r.branch_id;

        const time = shortTime(r.time || r.check_in);
        if (time) {
          if (r.type === 'out') {
            if (!row.lastOut || time > row.lastOut) row.lastOut = time;
          } else {
            if (!row.firstIn || time < row.firstIn) row.firstIn = time;
          }
        }

        (Array.isArray(r.status) ? r.status : []).forEach((s) => {
          const code = toStatusCode(s);
          if (code && !row.statuses.includes(code)) row.statuses.push(code);
        });
      });

    // «Barchasi» — hamma bo'lim (agar foydalanuvchida faqat ayrim bo'limlarga ruxsat
    // bo'lsa, o'sha bo'limlar yig'indisi). Aniq tab — faqat shu bo'lim xodimlari.
    let activeDeptIds: Set<number> | null = null;
    if (activeDept !== 'all') {
      activeDeptIds = deptIdsBySlug[activeDept];
    } else if (!unrestricted && visibleTabs.length < DEPT_TABS.length) {
      activeDeptIds = new Set(visibleTabs.flatMap((tab) => [...deptIdsBySlug[tab.slug]]));
    }

    return Object.values(byEmployee)
      .filter((row) => {
        const matchSearch = search
          ? row.employee.toLowerCase().includes(search.toLowerCase())
          : true;
        const matchBranch = branchId ? String(row.branchId) === branchId : true;
        const matchDept = activeDeptIds ? row.deptIds.some((id) => activeDeptIds.has(id)) : true;
        return matchSearch && matchBranch && matchDept;
      })
      .sort((a, b) => (sortAsc ? a.id - b.id : b.id - a.id))
      .map((row) => ({
        ...row,
        dayStatus: overallDayStatus(row),
        lastDayStatus: row.lastActivity ? overallDayStatus(row.lastActivity) : null,
      }));
  }, [
    recordsInScope,
    employeeOptions,
    employeeDeptMap,
    recordDepts,
    date,
    search,
    branchId,
    sortAsc,
    activeDept,
    visibleTabs,
    unrestricted,
    deptIdsBySlug,
  ]);

  const toggleAll = (checked: boolean) => setSelected(checked ? rows.map((r) => r.id) : []);
  const toggleOne = (id: number) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <section className="attendance-page container">
      <h1 className="main-title">{t('aside.attendance')}</h1>
      {visibleTabs.length > 0 && (
        <div className="attendance-dept-tabs">
          <button
            type="button"
            className={`attendance-dept-tab${activeDept === 'all' ? ' active' : ''}`}
            onClick={() => {
              setSelectedDept('all');
              setSelected([]);
            }}
          >
            {t('attendance.tabs.all')}
          </button>
          {visibleTabs.map((tab) => (
            <button
              key={tab.slug}
              type="button"
              className={`attendance-dept-tab${activeDept === tab.slug ? ' active' : ''}`}
              onClick={() => {
                setSelectedDept(tab.slug);
                setSelected([]);
              }}
            >
              {t(`attendance.tabs.${tab.slug}`)}
            </button>
          ))}
        </div>
      )}

      <div className="attendance-filters">
        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setDate('');
          }}
        />

        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">{t('attendance.table.branch')}</option>
          {(branchOptions || []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>

        <input
          placeholder={t('attendance.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* <div className="legend">
          <div className="legend-item">
            <b className="status-plus">+</b> {t('attendance.legend.present')}
          </div>
          <div className="legend-item">
            <b className="status-nb">NB</b> {t('attendance.legend.absentNoExcuse')}
          </div>
          <div className="legend-item">
            <b className="status-s">S</b> {t('attendance.legend.absentWithExcuse')}
          </div>
          <div className="legend-item">
            <b className="status-f">F</b> {t('attendance.legend.noUniform')}
          </div>
          <div className="legend-item">
            <b className="status-k">K</b> {t('attendance.legend.late')}
          </div>
        </div> */}
      </div>

      <div className="attendance-table-wrapper">
        <table className="attendance-list-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.length === rows.length}
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
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <TableSkeleton rowCount={8} columnCount={colCount} />
            ) : isError ? (
              <tr>
                <td colSpan={colCount} className="empty-state-cell">
                  <div className="empty-state" role="status" aria-live="polite">
                    <i className="fa-solid fa-triangle-exclamation" style={{ color: '#dc2626' }} />
                    <p>{t('attendance.loadError')}</p>
                    <button
                      type="button"
                      className="employee-link"
                      onClick={() => refetchAttendances()}
                    >
                      {t('attendance.retry')}
                    </button>
                  </div>
                </td>
              </tr>
            ) : rows.length > 0 ? (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={() => toggleOne(r.id)}
                    />
                  </td>
                  {isVisible('id') && <td>{r.id}</td>}
                  {visibleColumns.map((colId) => {
                    if (colId === 'full_name') {
                      return (
                        <td key={colId}>
                          <button
                            className="employee-link"
                            onClick={() => navigate(`/attendance/${r.id}`)}
                          >
                            {r.employee}
                          </button>
                        </td>
                      );
                    }
                    if (colId === 'position') return <td key={colId}>{r.position || '-'}</td>;
                    if (colId === 'branch')
                      return (
                        <td key={colId}>
                          {r.branch ? getLocalized(r.branch, 'name', i18n.language) : '-'}
                        </td>
                      );
                    if (colId !== 'status') return <td key={colId}>-</td>;
                    return (
                  <td key={colId}>
                    <div className="type-cell">
                      {/* Bitta badge: "09:00-18:00 Kelgan" — birinchi kirish, oxirgi chiqish va umumiy status */}
                      {r.dayStatus ? (
                        <span className={`attendance-day-status ${statusClass(r.dayStatus)}`}>
                          {(r.firstIn || r.lastOut) && (
                            <b className="attendance-day-times">
                              {r.firstIn || '--:--'}-{r.lastOut || '--:--'}
                            </b>
                          )}
                          {t(statusLabelKey(r.dayStatus))}
                        </span>
                      ) : r.lastActivity && r.lastDayStatus ? (
                        /* Tanlangan kunda yozuv yo'q — oxirgi yozuvli kun xira ko'rsatiladi */
                        <span
                          className={`attendance-day-status attendance-last-activity ${statusClass(
                            r.lastDayStatus,
                          )}`}
                        >
                          {(r.lastActivity.firstIn || r.lastActivity.lastOut) && (
                            <b className="attendance-day-times">
                              {r.lastActivity.firstIn || '--:--'}-
                              {r.lastActivity.lastOut || '--:--'}
                            </b>
                          )}
                          {t(statusLabelKey(r.lastDayStatus))}
                          <span className="attendance-last-date">
                            {formatDayMonth(r.lastActivity.date)}
                          </span>
                        </span>
                      ) : (
                        <span className="type-badge type-none">-</span>
                      )}
                    </div>
                  </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <EmptyState colSpan={colCount} message={t('attendance.notFound')} />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default AttendancePage;
