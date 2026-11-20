import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageTitle from '@/components/PageTitle';
import { Link, useSearchParams } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { useOptions } from '@/hooks/useOptions';
import ConfirmModal from '@/components/ConfirmModal';
import { Protected } from '@/components/Protected';
import { usePermission } from '@/hooks/usePermission';
import { useApprovedDistributions } from '../payroll-distribution-requests/api';
import { formatDateTime } from '@/utils/date';
import { getApiErrorMessage } from '@/utils/apiError';
import {
  useEmployeeContracts,
  useRevertSheet,
  useSheet,
  useSheetAction,
  useSheetLogs,
  useSheetPostings,
  useSheetRows,
} from './api';
import DetailsModal from './DetailsModal';
import AdjustModal from './AdjustModal';
import HistoryModal from './HistoryModal';
import PdfPreviewModal from './PdfPreviewModal';
import {
  ACTION_PERMISSION,
  CONTRACT_VIEW_PERMISSION,
  SHEET_PERMISSIONS,
  contractVacationPay,
  contractsByEmployee,
  docNumber,
  formatMoney,
  hasSalaryColumns,
  isActionAvailable,
  monthI18nKey,
  monthOptions,
  monthValue,
  parseMonthValue,
  placeholderRow,
  rowCash,
  rowNonCash,
  statusClass,
  statusI18nKey,
  sumRows,
} from './helpers';
import type { PayrollSheet, SheetAction, SheetRow, SheetType } from './types';
import './payrollSheets.css';

interface Props {
  type: SheetType;
}

/* ------------------------------------------------------------------ *
 * Avans jadvali / Oylik jadvali — bitta komponent, `type` bilan farqlanadi.
 * Ilmplyus (user panel) bilan bir xil komponent — Ilmplyus Dashboard
 * (admin panel) uchun ko'chirilgan.
 *
 * Zanjir: Xodimlar bo'limi «Tayyorlandi deb yuborish» → Buxgalter
 * «Direktorga yuborish» → Direktor «Tasdiqlash» / «Rad etish».
 * Bo'lim va FISh filtrlari serverda bajariladi (`{id}/rows`).
 *
 * Tasdiqlangan (`approved`) vedomostni «Tasdiqni qaytarish» (revert) orqali
 * `sent` holatiga qaytarish mumkin — backend `POST /{id}/revert` endpointi
 * jamg'arma balanslarini tiklaydi va «Ish haqi» chiqimini bekor qiladi.
 * Faqat `payroll_sheets.revert` ruxsati bo'lganlar uchun (admin panel).
 * ------------------------------------------------------------------ */

const MONTHS = monthOptions();

/** Zanjir tugmalarining ko'rinishi. */
const ACTION_STYLE: Record<SheetAction, { cls: string; icon: string }> = {
  prepare: { cls: 'ps-btn--success', icon: '✓' },
  send: { cls: 'ps-btn--primary', icon: '→' },
  approve: { cls: 'ps-btn--success', icon: '✓' },
  reject: { cls: 'ps-btn--danger', icon: '✗' },
};

const PayrollSheetPage = ({ type }: Props) => {
  const { t } = useTranslation();
  const { data: branches = [] } = useOptions('branches');
  const { data: departments = [] } = useOptions('departments');
  const action = useSheetAction();
  const revert = useRevertSheet();

  const canView = usePermission(SHEET_PERMISSIONS.view);
  // Qatorlar/tarix so'rovlari faqat shu ruxsat bilan yuboriladi (aks holda 403) — yo'q bo'lsa jadval o'rnida xabar.
  const canShowRows = usePermission(SHEET_PERMISSIONS.show);
  const canPrint = usePermission(SHEET_PERMISSIONS.print);
  const canViewContracts = usePermission(CONTRACT_VIEW_PERMISSION);
  const canRevert = usePermission(SHEET_PERMISSIONS.revert);

  // Generatsiya sahifasi filial/oyni URL orqali uzatadi.
  const [searchParams] = useSearchParams();
  const [period, setPeriod] = useState(() => {
    const y = Number(searchParams.get('year'));
    const m = Number(searchParams.get('month'));
    return y && m ? monthValue(y, m) : monthValue(MONTHS[0].year, MONTHS[0].month);
  });
  const [branchId, setBranchId] = useState<string>(() => searchParams.get('branch_id') ?? '');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [search, setSearch] = useState('');
  // Oylik jadvalida standart holatda faqat shartnomasi bor xodimlar chiqadi.
  const [contractOnly, setContractOnly] = useState(true);

  const [selected, setSelected] = useState<number[]>([]);
  const [detailsRow, setDetailsRow] = useState<SheetRow | null>(null);
  const [adjustRow, setAdjustRow] = useState<SheetRow | null>(null);
  const canEditRows = usePermission(SHEET_PERMISSIONS.edit);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<SheetAction | null>(null);
  const [revertOpen, setRevertOpen] = useState(false);
  // "Tasdiqlandi" ma'lumoti + PDF eslatmasi — endi doim ko'rinmaydi, faqat
  // shu "!" tugmasi bosilganda popoverda chiqadi.
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showInfo) return;
    const handleClick = (e: MouseEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setShowInfo(false);
    };
    const handleKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowInfo(false);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showInfo]);

  const effectiveBranchId = branchId ? Number(branchId) : (branches[0]?.id ?? null);
  const { year, month } = parseMonthValue(period);

  const {
    data: sheet,
    isLoading,
    isError,
    error,
  } = useSheet({ type, branch_id: effectiveBranchId, year, month });

  /**
   * Soliq kimning hisobidan: tasdiqlangan taqsimlashdagi tanlov (xodim / tashkilot) — daromad solig'i va
   * pensiyaga qo'llanadi; ijtimoiy soliqni doim tashkilot to'laydi. Xodim hisobidan bo'lsa jadvalda
   * ushlanadigan summa minus bilan chiqadi.
   */
  const canViewDistributionsForTax = usePermission('payroll_distributions.view');
  const { data: taxDistributions } = useApprovedDistributions(
    { branch_id: effectiveBranchId, year, month },
    canViewDistributionsForTax,
  );
  const taxPayerByEmployee = useMemo(() => {
    const map = new Map<number, 'employee' | 'organization'>();
    (taxDistributions ?? []).forEach((d) => {
      const ok =
        type === 'advance'
          ? d.kind === 'advance' || d.kind === 'combined'
          : d.kind === 'salary' || d.kind === 'combined';
      if (!ok || d.employee_id == null) return;
      if (d.income_tax_payer === 'employee' || d.income_tax_payer === 'organization') {
        map.set(d.employee_id, d.income_tax_payer);
      }
    });
    return map;
  }, [taxDistributions, type]);
  /** Xodim hisobidan soliq bo'lsa: ushlanadigan summa naqdsiz summadan (yetmasa naqddan) ayriladi. */
  const shownPayout = (row: SheetRow) => {
    const nonCash = rowNonCash(row, type);
    const cash = rowCash(row, type);
    const withheld =
      taxPayerByEmployee.get(row.employee_id) === 'employee'
        ? row.income_tax_amount + row.pension_fund_amount
        : 0;
    const fromNonCash = Math.min(withheld, Math.max(0, nonCash));
    const fromCash = Math.min(withheld - fromNonCash, Math.max(0, cash));
    return { nonCash: nonCash - fromNonCash, cash: cash - fromCash, fromNonCash, fromCash };
  };
  const taxPayerTitle = (payer: 'employee' | 'organization' | undefined) =>
    payer === 'employee'
      ? t('payrollSheets.details.taxPayerEmployee')
      : payer === 'organization'
        ? t('payrollSheets.details.taxPayerOrganization')
        : undefined;

  // Qatorlar alohida endpointdan; filtrlash serverda.
  const {
    data: rowsData,
    isLoading: rowsLoading,
    isError: rowsError,
    error: rowsErrorObj,
  } = useSheetRows(sheet?.id ?? null, {
    department_id: departmentId,
    last_name: search.trim(),
  }, canShowRows);

  const { data: logs = [] } = useSheetLogs(sheet?.id ?? null, historyOpen && canShowRows);
  const { data: postingsData } = useSheetPostings(
    sheet?.id ?? null,
    sheet?.status === 'approved',
  );

  // `?? []` har renderда yangi massiv yasaydi — useMemo bog'liqligi uchun
  // barqaror qiymat kerak, shuning uchun `rowsData?.rows` ning o'zi kuzatiladi.
  const allRows = useMemo(() => rowsData?.rows ?? [], [rowsData?.rows]);
  const showSalaryColumns = hasSalaryColumns(type);

  // Shartnomalar (faqat Oylik jadvalida va `employee_contracts.view` bo'lsa).
  // So'rov muvaffaqiyatsiz bo'lsa filtr qo'llanmaydi — hech kim "yo'qolib" qolmasin.
  const contractsEnabled = showSalaryColumns && canViewContracts;
  const contractsQuery = useEmployeeContracts(contractsEnabled);
  const contractMap = useMemo(
    () => (contractsQuery.data ? contractsByEmployee(contractsQuery.data, year, month) : null),
    [contractsQuery.data, year, month],
  );
  const contractsLoading = contractsEnabled && contractsQuery.isLoading;
  const filterByContract = contractsEnabled && contractOnly && contractMap !== null;

  const sheetRows = useMemo(
    () =>
      filterByContract && contractMap
        ? allRows.filter((r) => contractMap.has(r.employee_id))
        : allRows,
    [allRows, contractMap, filterByContract],
  );
  const hiddenNoContract = allRows.length - sheetRows.length;

  // Shartnomasi bor, lekin vedomostda yo'q xodimlar (vedomost generatsiya
  // qilinmagan yoki ish haqi hali taqsimlanmagan) ham jadvalda turadi — summalar 0.
  // Vedomost bor-u qatorlari hali kelmagan (yoki xato) bo'lsa — qo'shilmaydi.
  const rowsSettled = !sheet || rowsData !== undefined;
  const pendingRows = useMemo(() => {
    if (!contractMap || !rowsSettled || effectiveBranchId == null) return [];
    const inSheet = new Set(allRows.map((r) => r.employee_id));
    const needle = search.trim().toLowerCase();
    return [...contractMap.values()]
      .filter(
        (c) =>
          !inSheet.has(c.employee_id) &&
          c.branch_id === effectiveBranchId &&
          (!departmentId || String(c.department_id ?? '') === departmentId) &&
          (!needle || c.employee_name.toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name))
      .map(placeholderRow);
  }, [allRows, contractMap, rowsSettled, effectiveBranchId, departmentId, search]);
  const rows = useMemo(
    () => (pendingRows.length > 0 ? [...sheetRows, ...pendingRows] : sheetRows),
    [sheetRows, pendingRows],
  );
  // Tanlash/chop etish faqat vedomostda bor qatorlar uchun.
  const selectableRows = useMemo(() => rows.filter((r) => !r.not_in_sheet), [rows]);

  const totalEmployees =
    filterByContract || pendingRows.length > 0 ? rows.length : (rowsData?.total ?? 0);
  const totals = useMemo(() => sumRows(rows, type), [rows, type]);
  const vacationTotal = useMemo(
    () =>
      rows.reduce(
        (sum, r) => sum + (contractVacationPay(contractMap?.get(r.employee_id)) ?? 0),
        0,
      ),
    [rows, contractMap],
  );

  const branchName =
    sheet?.branch_name ?? branches.find((b) => b.id === effectiveBranchId)?.label ?? '—';

  // Vedomost generatsiya qilinmagan bo'lsa ham «Batafsil» ochilishi uchun vaqtinchalik qobiq.
  const detailsSheet: PayrollSheet | null =
    sheet ??
    (pendingRows.length > 0
      ? {
          id: 0,
          type,
          branch_id: effectiveBranchId ?? 0,
          branch_name: branchName,
          year,
          month,
          status: 'draft',
          income_tax_percent: null,
          pension_fund_percent: null,
          social_tax_percent: null,
          tax_on_cash: false,
          approved_at: null,
          director_name: null,
          reject_reason: null,
        }
      : null);

  /**
   * Ro'yxat joriy oydan oldinga yuradi. URL orqali o'tgan oy kelsa u ro'yxatda
   * bo'lmaydi — selectda bo'sh ko'rinmasligi uchun boshiga qo'shamiz.
   */
  const monthChoices = useMemo(() => {
    const known = MONTHS.some((m) => monthValue(m.year, m.month) === period);
    return known ? MONTHS : [parseMonthValue(period), ...MONTHS];
  }, [period]);

  const isApproved = sheet?.status === 'approved';
  // Tanlash va chop etish faqat tasdiqlangan vedomostda (backend ham shunday).
  const showSelection = isApproved && canPrint;

  const allChecked =
    selectableRows.length > 0 && selectableRows.every((r) => selected.includes(r.employee_id));
  const toggleAll = () =>
    setSelected(allChecked ? [] : selectableRows.map((r) => r.employee_id));
  const toggleRow = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const documentNumber = docNumber(type, year, month, effectiveBranchId);

  const runAction = (reason?: string) => {
    if (!sheet || !confirmAction) return;
    action.mutate(
      { id: sheet.id, action: confirmAction, reason },
      {
        onSuccess: () => {
          notifications.show({
            title: t('payrollSheets.savedTitle'),
            message: t(`payrollSheets.actionDone.${confirmAction}`),
            color: confirmAction === 'reject' ? 'orange' : 'green',
          });
        },
        onError: (err) => {
          notifications.show({
            title: t('payrollSheets.errorTitle'),
            message: getApiErrorMessage(err, t('payrollSheets.actionError')),
            color: 'red',
          });
        },
        onSettled: () => setConfirmAction(null),
      },
    );
  };

  const runRevert = (reason?: string) => {
    if (!sheet || !reason?.trim()) return;
    revert.mutate(
      { id: sheet.id, reason: reason.trim() },
      {
        onSuccess: () => {
          notifications.show({
            title: t('payrollSheets.savedTitle'),
            message: t('payrollSheets.revert.done'),
            color: 'orange',
          });
        },
        onError: (err) => {
          notifications.show({
            title: t('payrollSheets.errorTitle'),
            message: getApiErrorMessage(err, t('payrollSheets.actionError')),
            color: 'red',
          });
        },
        onSettled: () => setRevertOpen(false),
      },
    );
  };

  const titleKey = type === 'advance' ? 'payrollSheets.advanceTitle' : 'payrollSheets.salaryTitle';
  const typeWord = t(`payrollSheets.type.${type}`);

  const actionButton = (act: SheetAction) =>
    sheet &&
    isActionAvailable(act, sheet.status) && (
      <Protected key={act} permission={ACTION_PERMISSION[act]}>
        <button
          type="button"
          className={`ps-btn ${ACTION_STYLE[act].cls}`}
          disabled={action.isPending}
          onClick={() => setConfirmAction(act)}
        >
          {ACTION_STYLE[act].icon} {t(`payrollSheets.actions.${act}`)}
        </button>
      </Protected>
    );

  if (!canView) {
    return (
      <div className="ps-container container">
        <p className="ps-empty">{t('payrollSheets.forbidden')}</p>
      </div>
    );
  }

  /**
   * Ustunlar soni — bo'sh holat qatorining colSpan'i uchun. Oylikda 4 ta
   * qo'shimcha (tuzatish, KPI, avans) + «Shartnoma» va «Ta'til maoshi».
   */
  const columnCount = 11 + (showSalaryColumns ? 5 : 0) + (showSelection ? 1 : 0);

  return (
    <div className="ps-container container">
      <div className="ps-header">
        <div>
          <PageTitle
            title={t(titleKey)}
            icon={type === 'advance' ? 'fa-calendar-check' : 'fa-file-invoice-dollar'}
            spaced={false}
          />
          <p className="ps-subtitle">{t('payrollSheets.subtitle')}</p>
        </div>
      </div>

      {/* Filtrlar */}
      <div className="ps-card ps-filters-card">
        <div className="ps-filters">
          <div className="ps-field">
            <label htmlFor="ps-month">{t('payrollSheets.filters.month')}</label>
            <select id="ps-month" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {monthChoices.map((m) => (
                <option key={monthValue(m.year, m.month)} value={monthValue(m.year, m.month)}>
                  {t(monthI18nKey(m.month))} {m.year}
                </option>
              ))}
            </select>
          </div>

          <div className="ps-field">
            <label htmlFor="ps-branch">{t('payrollSheets.filters.branch')}</label>
            <select
              id="ps-branch"
              value={branchId || String(effectiveBranchId ?? '')}
              onChange={(e) => {
                setBranchId(e.target.value);
                setSelected([]);
              }}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ps-field">
            <label htmlFor="ps-department">{t('payrollSheets.filters.department')}</label>
            <select
              id="ps-department"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t('payrollSheets.filters.all')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ps-field ps-field--search">
            <label htmlFor="ps-search">{t('payrollSheets.filters.search')}</label>
            <input
              id="ps-search"
              type="text"
              value={search}
              placeholder={t('payrollSheets.filters.searchPlaceholder')}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Shartnomalar yuklanmagan bo'lsa (ruxsat yo'q / xato) filtr ham ko'rinmaydi. */}
          {contractMap !== null && (
            <label className="ps-checkbox">
              <input
                type="checkbox"
                checked={contractOnly}
                onChange={(e) => {
                  setContractOnly(e.target.checked);
                  setSelected([]);
                }}
              />
              {t('payrollSheets.filters.contractOnly')}
            </label>
          )}

          <span className="ps-count">
            {/* `count` emas `n` — i18next `count` ni ko'rsa ko'plik shakllarini
                izlaydi, uzbek tilida esa ular aniqlanmagan. */}
            {t('payrollSheets.filters.totalEmployees', { n: totalEmployees })}
            {hiddenNoContract > 0 &&
              ` · ${t('payrollSheets.filters.hiddenNoContract', { n: hiddenNoContract })}`}
          </span>
        </div>
      </div>

      {/* Vedomost */}
      <div className="ps-card">
        <div className="ps-card-head">
          <div className="ps-card-title">
            <h2>
              {t(monthI18nKey(month))} {year} — {branchName}
            </h2>
            {sheet && adjustRow && (
        <AdjustModal sheetId={sheet.id} row={adjustRow} type={type} onClose={() => setAdjustRow(null)} />
      )}

      {sheet && (
              <span className={`ps-status ${statusClass(sheet.status)}`}>
                <span className="ps-dot" aria-hidden />
                {t(statusI18nKey(sheet.status))}
              </span>
            )}
            {isApproved && (
              <div className="ps-info-wrap" ref={infoRef}>
                <button
                  type="button"
                  className="ps-info-btn"
                  onClick={() => setShowInfo((v) => !v)}
                  aria-label={t('payrollSheets.infoButton')}
                  title={t('payrollSheets.infoButton')}
                >
                  !
                </button>
                {showInfo && (
                  <div className="ps-info-popover" role="dialog">
                    <p>
                      ✓ <strong>{t('payrollSheets.alert.approved', { type: typeWord })}</strong>
                      {sheet.director_name || sheet.approved_at
                        ? ` — ${sheet.director_name ?? '—'}, ${formatDateTime(sheet.approved_at)}.`
                        : '.'}{' '}
                      {t('payrollSheets.alert.locked')}
                    </p>
                    {canPrint && <p>{t('payrollSheets.printHint')}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
          {sheet && (
            <div className="ps-card-actions">
              {actionButton('prepare')}
              {actionButton('send')}
              {actionButton('approve')}
              {actionButton('reject')}
              {sheet.status === 'approved' && canRevert && (
                <button
                  type="button"
                  className="ps-btn ps-btn--danger"
                  disabled={revert.isPending}
                  onClick={() => setRevertOpen(true)}
                >
                  ↩ {t('payrollSheets.revert.button')}
                </button>
              )}
              {showSelection && (
                <button
                  className="ps-btn ps-btn--primary"
                  type="button"
                  onClick={() => setPdfOpen(true)}
                  disabled={selectableRows.length === 0}
                >
                  🖨 {t('payrollSheets.printButton')}
                </button>
              )}
              <button
                className="ps-btn ps-btn--ghost"
                type="button"
                onClick={() => setHistoryOpen(true)}
              >
                🕐 {t('payrollSheets.history.button')}
              </button>
            </div>
          )}
        </div>

        {isLoading || (!sheet && contractsLoading) ? (
          <p className="ps-empty">{t('payrollSheets.loading')}</p>
        ) : isError ? (
          <p className="ps-empty">{getApiErrorMessage(error, t('payrollSheets.loadError'))}</p>
        ) : !sheet && rows.length === 0 ? (
          <p className="ps-empty">{t('payrollSheets.notGenerated')}</p>
        ) : (
          <>
            {!sheet && (
              <div className="ps-alert ps-alert--warning">
                {t('payrollSheets.notGeneratedHint')}
              </div>
            )}

            {sheet?.status === 'rejected' && (
              <div className="ps-alert ps-alert--danger">
                <strong>{t('payrollSheets.alert.rejected')}</strong>
                {sheet.reject_reason ? ` — ${sheet.reject_reason}` : ''}
              </div>
            )}

            <div className="ps-table-scroll">
              <table className="ps-table">
                <thead>
                  <tr>
                    {showSelection && (
                      <th className="ps-check">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={toggleAll}
                          aria-label={t('payrollSheets.selectAll')}
                        />
                      </th>
                    )}
                    <th>№</th>
                    <th style={{ textAlign: 'left' }}>{t('payrollSheets.columns.fullName')}</th>
                    <th>{t('payrollSheets.columns.position')}</th>
                    <th className="ps-num">{t('payrollSheets.columns.oklad')}</th>
                    {showSalaryColumns && (
                      <>
                        <th className="ps-num">{t('payrollSheets.columns.advanceNonCash')}</th>
                        <th className="ps-num">{t('payrollSheets.columns.advanceCash')}</th>
                      </>
                    )}
                    <th className="ps-num">
                      {t('payrollSheets.columns.nonCash', { type: typeWord })}
                    </th>
                    <th className="ps-num">
                      {t('payrollSheets.columns.cash', { type: typeWord })}
                    </th>
                    {showSalaryColumns && (
                      <>
                        <th className="ps-num">{t('payrollSheets.columns.adjustment')}</th>
                        <th className="ps-num">{t('payrollSheets.columns.kpi')}</th>
                        <th className="ps-num">{t('payrollSheets.columns.vacationPay')}</th>
                      </>
                    )}
                    {/* Jarima — ikkala turda ham (Avans va Oylik) ko'rinadi. */}
                    <th className="ps-num">{t('payrollSheets.columns.fines')}</th>
                    <th className="ps-num">
                      {t('payrollSheets.columns.incomeTax')}
                    </th>
                    <th className="ps-num">
                      {t('payrollSheets.columns.pensionTax')}
                    </th>
                    <th className="ps-num">
                      {t('payrollSheets.columns.socialTax')}
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {!canShowRows ? (
                    <tr>
                      <td colSpan={columnCount} className="ps-empty">
                        {t('payrollSheets.needShow')}
                      </td>
                    </tr>
                  ) : rowsLoading || contractsLoading ? (
                    <tr>
                      <td colSpan={columnCount} className="ps-empty">
                        {t('payrollSheets.loading')}
                      </td>
                    </tr>
                  ) : rowsError ? (
                    <tr>
                      <td colSpan={columnCount} className="ps-empty">
                        {getApiErrorMessage(rowsErrorObj, t('payrollSheets.loadError'))}
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={columnCount} className="ps-empty">
                        {t('payrollSheets.noRows')}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => {
                      const contract = contractMap?.get(row.employee_id) ?? null;
                      const vacationPay = contractVacationPay(contract);
                      return (
                        <tr key={row.id} className={row.not_in_sheet ? 'ps-row--pending' : undefined}>
                          {showSelection && (
                            <td className="ps-check">
                              {!row.not_in_sheet && (
                                <input
                                  type="checkbox"
                                  checked={selected.includes(row.employee_id)}
                                  onChange={() => toggleRow(row.employee_id)}
                                  aria-label={row.employee_name}
                                />
                              )}
                            </td>
                          )}
                          <td>{i + 1}</td>
                          <td style={{ textAlign: 'left' }}>
                            <span className="ps-name">
                              {row.employee_name}
                              {row.is_pedagog && (
                                <span className="ps-badge" title={t('payrollSheets.pedagog')}>
                                  P
                                </span>
                              )}
                              {row.not_in_sheet && (
                                <span
                                  className="ps-badge ps-badge--pending"
                                  title={t('payrollSheets.notInSheetHint')}
                                >
                                  {t('payrollSheets.notInSheet')}
                                </span>
                              )}
                              {row.fines_amount > 0 && (
                                <span
                                  className="ps-badge ps-badge--fine"
                                  title={t('payrollSheets.badges.fine')}
                                >
                                  Ж
                                </span>
                              )}
                              {showSalaryColumns && row.adjustment_amount > 0 && (
                                <span
                                  className="ps-badge ps-badge--plus"
                                  title={t('payrollSheets.badges.adjustmentPlus')}
                                >
                                  +
                                </span>
                              )}
                              {showSalaryColumns && row.adjustment_amount < 0 && (
                                <span
                                  className="ps-badge ps-badge--minus"
                                  title={t('payrollSheets.badges.adjustmentMinus')}
                                >
                                  −
                                </span>
                              )}
                            </span>
                          </td>
                          <td>
                            <span className="ps-position">{row.position_name}</span>
                          </td>
                          <td className="ps-num">{formatMoney(row.oklad)}</td>
                          {showSalaryColumns && (
                            <>
                              <td className="ps-num">{formatMoney(row.advance_cashless)}</td>
                              <td className="ps-num">{formatMoney(row.advance_cash)}</td>
                            </>
                          )}
                          <td className="ps-num" title={shownPayout(row).fromNonCash > 0 ? `−${formatMoney(shownPayout(row).fromNonCash)}` : undefined}>
                            {formatMoney(shownPayout(row).nonCash)}
                          </td>
                          <td className="ps-num" title={shownPayout(row).fromCash > 0 ? `−${formatMoney(shownPayout(row).fromCash)}` : undefined}>
                            {formatMoney(shownPayout(row).cash)}
                          </td>
                          {showSalaryColumns && (
                            <>
                              <td className="ps-num">{formatMoney(row.adjustment_amount)}</td>
                              <td className="ps-num">{formatMoney(row.kpi_amount)}</td>
                              <td className="ps-num">
                                {vacationPay === null ? '—' : formatMoney(vacationPay)}
                              </td>
                            </>
                          )}
                          {/* Jarima — ikkala turda ham (Avans va Oylik) ko'rinadi. */}
                          <td className="ps-num ps-negative">
                            {row.fines_amount > 0 ? `−${formatMoney(row.fines_amount)}` : '0'}
                          </td>
                          <td
                            className={`ps-num${taxPayerByEmployee.get(row.employee_id) === 'employee' ? ' ps-negative' : ''}`}
                            title={taxPayerTitle(taxPayerByEmployee.get(row.employee_id))}
                          >
                            {taxPayerByEmployee.get(row.employee_id) === 'employee' && row.income_tax_amount > 0
                              ? `−${formatMoney(row.income_tax_amount)}`
                              : formatMoney(row.income_tax_amount)}
                          </td>
                          <td
                            className={`ps-num${taxPayerByEmployee.get(row.employee_id) === 'employee' ? ' ps-negative' : ' ps-muted'}`}
                            title={taxPayerTitle(taxPayerByEmployee.get(row.employee_id))}
                          >
                            {taxPayerByEmployee.get(row.employee_id) === 'employee' && row.pension_fund_amount > 0
                              ? `−${formatMoney(row.pension_fund_amount)}`
                              : formatMoney(row.pension_fund_amount)}
                          </td>
                          <td className="ps-num">{formatMoney(row.social_tax_amount)}</td>
                          <td className="ps-actions-cell">
                            <div className="ps-row-actions">
                            {canEditRows && sheet && !row.not_in_sheet && (sheet.status === 'draft' || sheet.status === 'rejected') && (

                              <button

                                className="ps-btn ps-btn--sm ps-btn--ghost ps-action-btn"

                                type="button"

                            
                                onClick={() => setAdjustRow(row)}

                              >

                                {t('payrollSheets.actions.adjust')}

                              </button>

                            )}
                            <button
                              className="ps-btn ps-btn--sm ps-btn--ghost ps-action-btn"
                              type="button"
                              onClick={() => setDetailsRow(row)}
                            >
                              {t('payrollSheets.actions.details')}
                            </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={showSelection ? 4 : 3} style={{ textAlign: 'center' }}>
                        {t('payrollSheets.total')}
                      </td>
                      <td className="ps-num">{formatMoney(totals.oklad)}</td>
                      {showSalaryColumns && (
                        <>
                          <td className="ps-num">{formatMoney(totals.advance_non_cash)}</td>
                          <td className="ps-num">{formatMoney(totals.advance_cash)}</td>
                        </>
                      )}
                      <td className="ps-num">{formatMoney(rows.reduce((a, r) => a + shownPayout(r).nonCash, 0))}</td>
                      <td className="ps-num">{formatMoney(rows.reduce((a, r) => a + shownPayout(r).cash, 0))}</td>
                      {showSalaryColumns && (
                        <>
                          <td className="ps-num">{formatMoney(totals.adjustment)}</td>
                          <td className="ps-num">{formatMoney(totals.kpi)}</td>
                          <td className="ps-num">{formatMoney(vacationTotal)}</td>
                        </>
                      )}
                      {/* Jarima — ikkala turda ham (Avans va Oylik) ko'rinadi. */}
                      <td className="ps-num">{formatMoney(totals.fines)}</td>
                      <td className="ps-num">{formatMoney(totals.income_tax)}</td>
                      <td className="ps-num">{formatMoney(totals.pension_fund)}</td>
                      <td className="ps-num">{formatMoney(totals.social_tax)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>

      {sheet?.status === 'approved' && postingsData?.is_posted && postingsData.postings.length > 0 && (
        <div className="ps-card">
          <div className="ps-card-head">
            <div className="ps-card-title">
              <h2>{t('payrollSheets.postings.title')}</h2>
            </div>
          </div>
          <ul className="ps-postings">
            {postingsData.postings.map((p, i) => {
              const reversed = p.status === 'reversed';
              const amount =
                p.direction === 'net_pay'
                  ? p.cash_amount + p.non_cash_amount
                  : p.non_cash_amount;
              const label =
                p.direction === 'net_pay'
                  ? t('payrollSheets.postings.netPay')
                  : t('payrollSheets.postings.taxTransfer');
              return (
                <li
                  key={`${p.direction}-${i}`}
                  className={`ps-posting${reversed ? ' ps-posting--reversed' : ''}`}
                >
                  <span className="ps-posting__label">{label}</span>
                  <span className="ps-posting__amount">
                    {formatMoney(amount)} {t('payrollSheets.soum')}
                  </span>
                  {p.direction === 'net_pay' && p.expense && (
                    <Link className="ps-posting__link" to={`/expenses/create?id=${p.expense.id}`}>
                      {t('payrollSheets.postings.expenseLink', { id: p.expense.id })}
                    </Link>
                  )}
                  {reversed && (
                    <span className="ps-posting__reversed">
                      {t('payrollSheets.postings.reversed')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {detailsSheet && (
        <DetailsModal
          sheet={detailsSheet}
          row={detailsRow}
          type={type}
          contract={detailsRow ? (contractMap?.get(detailsRow.employee_id) ?? null) : null}
          contractsAvailable={contractMap !== null}
          taxPayer={detailsRow ? (taxPayerByEmployee.get(detailsRow.employee_id) ?? null) : null}
          onClose={() => setDetailsRow(null)}
        />
      )}

      {sheet && (
        <>
          {historyOpen && (
            <HistoryModal
              logs={logs}
              documentNumber={documentNumber}
              onClose={() => setHistoryOpen(false)}
            />
          )}
          {pdfOpen && (
            <PdfPreviewModal
              sheetId={sheet.id}
              employeeIds={
                selected.length > 0 || hiddenNoContract === 0
                  ? selected
                  : selectableRows.map((r) => r.employee_id)
              }
              departmentId={departmentId}
              type={type}
              onClose={() => setPdfOpen(false)}
            />
          )}
          <ConfirmModal
            open={confirmAction !== null}
            title={confirmAction ? t(`payrollSheets.confirm.${confirmAction}.title`) : ''}
            message={confirmAction ? t(`payrollSheets.confirm.${confirmAction}.message`) : ''}
            confirmLabel={confirmAction ? t(`payrollSheets.actions.${confirmAction}`) : ''}
            cancelLabel={t('payrollSheets.confirm.cancel')}
            tone={confirmAction === 'reject' ? 'danger' : 'success'}
            busy={action.isPending}
            reasonRequired={confirmAction === 'reject'}
            reasonLabel={t('payrollSheets.confirm.reasonLabel')}
            onConfirm={runAction}
            onCancel={() => setConfirmAction(null)}
          />
          <ConfirmModal
            open={revertOpen}
            title={t('payrollSheets.confirm.revert.title')}
            message={t('payrollSheets.confirm.revert.message')}
            confirmLabel={t('payrollSheets.revert.button')}
            cancelLabel={t('payrollSheets.confirm.cancel')}
            tone="danger"
            busy={revert.isPending}
            reasonRequired
            reasonLabel={t('payrollSheets.confirm.reasonLabel')}
            onConfirm={runRevert}
            onCancel={() => setRevertOpen(false)}
          />
        </>
      )}
    </div>
  );
};

export default PayrollSheetPage;
