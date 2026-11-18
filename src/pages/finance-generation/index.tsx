import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageTitle from '@/components/PageTitle';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { useOptions } from '@/hooks/useOptions';
import ConfirmModal from '@/components/ConfirmModal';
import { Protected } from '@/components/Protected';
import { usePermission } from '@/hooks/usePermission';
import { getApiErrorMessage } from '@/utils/apiError';
import {
  useGenerateSheet,
  useRevertSheet,
  useSheet,
  useSheetAction,
  useSheetRows,
} from '../payroll-sheets/api';
import {
  ACTION_PERMISSION,
  SHEET_PERMISSIONS,
  formatMoney,
  isActionAvailable,
  monthI18nKey,
  monthOptions,
  monthValue,
  parseMonthValue,
  statusClass,
  statusI18nKey,
  sumRows,
} from '../payroll-sheets/helpers';
import type { FundCheck, SheetAction, SheetType } from '../payroll-sheets/types';
import '../payroll-sheets/payrollSheets.css';

/* ------------------------------------------------------------------ *
 * Oylik / Avans generatsiyasi.
 *
 * «Generatsiya qilish» bosilgach shakllangan jadval natijasi karta bo'lib
 * chiqadi (xodimlar soni, jami netto, soliqlar) va «Jadvalga o'tish» tugmasi
 * turiga mos sahifaga olib boradi: avans → Avans jadvali, oylik → Oylik jadvali.
 *
 * Statusni shu yerdan (jadvalga o'tmasdan) o'zgartirish — PayrollSheetPage
 * bilan bir xil zanjir/tugmalar (`useSheetAction`, `isActionAvailable`),
 * faqat natija kartasiga ko'chirilgan.
 * ------------------------------------------------------------------ */

const MONTHS = monthOptions();

/** Zanjir tugmalarining ko'rinishi — PayrollSheetPage bilan bir xil. */
const ACTION_STYLE: Record<SheetAction, { cls: string; icon: string }> = {
  prepare: { cls: 'ps-btn--success', icon: '✓' },
  send: { cls: 'ps-btn--primary', icon: '→' },
  approve: { cls: 'ps-btn--success', icon: '✓' },
  reject: { cls: 'ps-btn--danger', icon: '✗' },
};

/** Generatsiya qilingan davr — natija kartasi shu bo'yicha yuklanadi. */
interface GeneratedRef {
  type: SheetType;
  branch_id: number;
  year: number;
  month: number;
}

const FinanceGeneration = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: branches = [] } = useOptions('branches');
  const generate = useGenerateSheet();
  const action = useSheetAction();
  const revert = useRevertSheet();

  const canView = usePermission(SHEET_PERMISSIONS.view);
  const canRevert = usePermission(SHEET_PERMISSIONS.revert);

  const [type, setType] = useState<SheetType>('advance');
  const [branchId, setBranchId] = useState('');
  const [period, setPeriod] = useState(() => monthValue(MONTHS[0].year, MONTHS[0].month));
  const [generated, setGenerated] = useState<GeneratedRef | null>(null);
  const [fundCheck, setFundCheck] = useState<FundCheck | null>(null);
  const [confirmAction, setConfirmAction] = useState<SheetAction | null>(null);
  const [revertOpen, setRevertOpen] = useState(false);

  const effectiveBranchId = branchId ? Number(branchId) : (branches[0]?.id ?? null);

  // Natija kartasi vedomostning o'zidan o'qiladi — generatsiya javobining
  // shakliga bog'lanib qolmaslik uchun.
  const { data: sheet, isLoading: sheetLoading } = useSheet(
    generated ?? { type, branch_id: null, year: 0, month: 0 },
    generated !== null,
  );
  const { data: rowsData } = useSheetRows(sheet?.id ?? null, {});

  const rows = rowsData?.rows ?? [];
  const totals = sumRows(rows, generated?.type ?? type);
  const branchName =
    sheet?.branch_name ?? branches.find((b) => b.id === generated?.branch_id)?.label ?? '—';

  const onGenerate = () => {
    if (effectiveBranchId == null) return;
    const { year, month } = parseMonthValue(period);
    // Backend faqat shu to'rt maydonni kutadi; naqd puldan soliq olinishi
    // (`tax_on_cash`) filial sozlamasida turadi — `/payroll/settings`.
    generate.mutate(
      { branch_id: effectiveBranchId, year, month, type },
      {
        onSuccess: (res) => {
          setFundCheck(res.fundCheck);
          setGenerated({ type, branch_id: effectiveBranchId, year, month });
          notifications.show({
            title: t('financeGeneration.doneTitle'),
            message: t(`financeGeneration.done.${type}`),
            color: 'green',
          });
        },
        onError: (error) => {
          notifications.show({
            title: t('financeGeneration.errorTitle'),
            message: getApiErrorMessage(error, t('financeGeneration.error')),
            color: 'red',
          });
        },
      },
    );
  };

  const openSheet = () => {
    if (!generated) return;
    // Turiga mos jadval: avans → Avans jadvali, oylik → Oylik jadvali.
    const path = generated.type === 'advance' ? '/advance-schedule' : '/salary-schedule';
    navigate(
      `${path}?branch_id=${generated.branch_id}&year=${generated.year}&month=${generated.month}`,
    );
  };

  // Statusni shu yerdan o'zgartirish — PayrollSheetPage'dagi `runAction` bilan bir xil.
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

  return (
    <div className="ps-container container">
      <div className="ps-header">
        <div>
          <PageTitle title={t('financeGeneration.title')} icon="fa-gears" spaced={false} />
          <p className="ps-subtitle">{t('financeGeneration.subtitle')}</p>
        </div>
      </div>

      <div className="ps-card">
        <div className="ps-filters">
          <div className="ps-field">
            <label htmlFor="fg-type">{t('financeGeneration.fields.type')}</label>
            <select id="fg-type" value={type} onChange={(e) => setType(e.target.value as SheetType)}>
              <option value="advance">{t('payrollSheets.type.advance')}</option>
              <option value="salary">{t('payrollSheets.type.salary')}</option>
            </select>
          </div>

          <div className="ps-field">
            <label htmlFor="fg-branch">{t('financeGeneration.fields.branch')}</label>
            <select
              id="fg-branch"
              value={branchId || String(effectiveBranchId ?? '')}
              onChange={(e) => setBranchId(e.target.value)}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ps-field">
            <label htmlFor="fg-month">{t('financeGeneration.fields.month')}</label>
            <select id="fg-month" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {MONTHS.map((m) => (
                <option key={monthValue(m.year, m.month)} value={monthValue(m.year, m.month)}>
                  {t(monthI18nKey(m.month))} {m.year}
                </option>
              ))}
            </select>
          </div>

          <Protected permission={SHEET_PERMISSIONS.generate}>
            <button
              className="ps-btn ps-btn--primary ps-btn--generate"
              type="button"
              onClick={onGenerate}
              disabled={generate.isPending || effectiveBranchId == null}
            >
              ⚡ {t('financeGeneration.generate')}
            </button>
          </Protected>
        </div>

        <p className="ps-info-banner">ℹ {t('financeGeneration.rule')}</p>
      </div>

      {/* Jamg'arma pul yetishmasligi haqida ogohlantirish — bloklamaydi. */}
      {generated && fundCheck && fundCheck.jamgarma_id == null && (
        <div className="ps-alert ps-alert--warning">
          ⚠ {t('financeGeneration.fundWarn.noFund')}
        </div>
      )}
      {generated && fundCheck && fundCheck.jamgarma_id != null && !fundCheck.sufficient && (
        <div className="ps-alert ps-alert--warning">
          ⚠{' '}
          {t('financeGeneration.fundWarn.shortfall', {
            fund: fundCheck.jamgarma_name,
            cash: formatMoney(fundCheck.shortfall_cash),
            nonCash: formatMoney(fundCheck.shortfall_non_cash),
          })}
        </div>
      )}

      {/* Natija kartasi — generatsiyadan keyin */}
      {generated && (
        <div className="ps-card">
          <div className="ps-card-head">
            <div className="ps-card-title">
              <h2>
                {t(`payrollSheets.type.${generated.type}`)} — {branchName}
              </h2>
              <span className="ps-card-meta">
                {t(monthI18nKey(generated.month))} {generated.year}
                {rowsData
                  ? ` · ${t('payrollSheets.filters.totalEmployees', { n: rowsData.total })}`
                  : ''}
              </span>
            </div>
            <div className="ps-card-actions">
              {sheet && (
                <span className={`ps-status ${statusClass(sheet.status)}`}>
                  <span className="ps-dot" aria-hidden />
                  {t(statusI18nKey(sheet.status))}
                </span>
              )}
              {/* Statusni bu yerdan ham o'zgartirish mumkin — jadvalga o'tmasdan. */}
              {actionButton('prepare')}
              {actionButton('send')}
              {actionButton('approve')}
              {actionButton('reject')}
              {sheet?.status === 'approved' && canRevert && (
                <button
                  type="button"
                  className="ps-btn ps-btn--danger"
                  disabled={revert.isPending}
                  onClick={() => setRevertOpen(true)}
                >
                  ↩ {t('payrollSheets.revert.button')}
                </button>
              )}
              <button className="ps-btn ps-btn--primary" type="button" onClick={openSheet}>
                {t('financeGeneration.openSheet')} →
              </button>
            </div>
          </div>

          {sheetLoading ? (
            <p className="ps-empty">{t('payrollSheets.loading')}</p>
          ) : !sheet ? (
            <p className="ps-empty">{t('payrollSheets.notGenerated')}</p>
          ) : (
            <div className="ps-stats">
              <div className="ps-stat">
                <span className="ps-stat-label">{t('financeGeneration.stats.employees')}</span>
                <span className="ps-stat-value">{rowsData?.total ?? rows.length}</span>
              </div>
              <div className="ps-stat">
                <span className="ps-stat-label">{t('financeGeneration.stats.net')}</span>
                <span className="ps-stat-value">
                  {formatMoney(totals.total)} {t('payrollSheets.soum')}
                </span>
              </div>
              <div className="ps-stat">
                <span className="ps-stat-label">{t('payrollSheets.details.incomeTax')}</span>
                <span className="ps-stat-value">
                  {formatMoney(totals.income_tax)} {t('payrollSheets.soum')}
                </span>
              </div>
              <div className="ps-stat">
                <span className="ps-stat-label">{t('payrollSheets.details.pensionTax')}</span>
                <span className="ps-stat-value">
                  {formatMoney(totals.pension_fund)} {t('payrollSheets.soum')}
                </span>
              </div>
              <div className="ps-stat">
                <span className="ps-stat-label">{t('payrollSheets.details.socialTax')}</span>
                <span className="ps-stat-value">
                  {formatMoney(totals.social_tax)} {t('payrollSheets.soum')}
                </span>
              </div>
            </div>
          )}
        </div>
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
    </div>
  );
};

export default FinanceGeneration;
