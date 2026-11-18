import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { API } from '../../api/api';
import { getLocalized } from '../../utils/getLocalized';
import { formatDateTime } from '../../utils/date';
import type { CoursePrice, CoursePriceLog, CoursePricePerson, User } from '../../types';
import useAuthStore from '../../store/useAuthStore';
import './course-prices.css';
import { groupDigits } from '@/utils/formatNumber';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f2a900',
  approved: '#27ae60',
  rejected: '#e70a0a',
};

// Log `action` qiymatlari backendda erkin matn — mos kalit topilmasa xom qiymat ko'rsatiladi.
const ACTION_LABELS: Record<string, string> = {
  created: 'coursePrices.actionCreated',
  updated: 'coursePrices.actionUpdated',
  approved: 'coursePrices.actionApproved',
  rejected: 'coursePrices.actionRejected',
  deleted: 'coursePrices.actionDeleted',
  restored: 'coursePrices.actionRestored',
  status_changed: 'coursePrices.actionStatusChanged',
};

// Log `field` — jadval ustuni nomi; mavjud tarjimalarga bog'lanadi.
const FIELD_LABELS: Record<string, string> = {
  branch_id: 'coursePrices.branch',
  course_id: 'coursePrices.course',
  level_id: 'coursePrices.level',
  old_price: 'coursePrices.oldPrice',
  new_price: 'coursePrices.newPrice',
  lessons_count: 'coursePrices.lessonsCount',
  lesson_price: 'coursePrices.lessonPrice',
  percentage: 'coursePrices.changePercent',
  start_date: 'coursePrices.changeDate',
  comment: 'coursePrices.comment',
  status: 'coursePrices.status',
  rejection_reason: 'coursePrices.rejectionReason',
};

const MONEY_FIELDS = new Set(['old_price', 'new_price', 'lesson_price']);

function formatNarx(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '-';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(n) ? String(val) : groupDigits(n);
}

/**
 * Relation yuklanmagan bo'lsa: id login qilgan foydalanuvchiniki bo'lsa uning ismi,
 * aks holda xom id, u ham bo'lmasa chiziqcha.
 */
function personName(
  person: CoursePricePerson | null | undefined,
  id: number | null | undefined,
  currentUser: User | null,
) {
  if (person?.full_name) return person.full_name;
  if (!id) return '—';
  if (currentUser && currentUser.id === id) return currentUser.full_name;
  return `#${id}`;
}

interface RowProps {
  label: string;
  children: React.ReactNode;
  span?: boolean;
}

function DetailItem({ label, children, span }: RowProps) {
  return (
    <div className={`cp-detail-item${span ? ' cp-detail-item--wide' : ''}`}>
      <span className="cp-detail-label">{label}</span>
      <span className="cp-detail-value">{children}</span>
    </div>
  );
}

type TFn = ReturnType<typeof useTranslation>['t'];

/** Tarjima topilmasa i18next kalitning o'zini qaytaradi — bunda xom qiymat ko'rsatiladi. */
function translateOr(t: TFn, key: string | undefined, raw: string): string {
  if (!key) return raw;
  const label = t(key);
  return label === key ? raw : label;
}

function statusText(t: TFn, status: string | null | undefined): string {
  if (!status) return '—';
  const key = `coursePrices.status${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  return translateOr(t, key, status);
}

function fieldValueText(field: string | null, value: string | null): string {
  if (value === null || value === '') return '—';
  return field && MONEY_FIELDS.has(field) ? formatNarx(value) : value;
}

function CoursePriceHistoryItem({ log }: { log: CoursePriceLog }) {
  const { t } = useTranslation();
  const statusChanged = log.from_status !== log.to_status;

  return (
    <div className="course-price-history-item">
      <div className="course-price-history-header">
        <span
          className="cp-history-action"
          style={{ color: STATUS_COLORS[log.to_status ?? ''] ?? '#003366' }}
        >
          {translateOr(t, ACTION_LABELS[log.action], log.action)}
        </span>
        <span className="course-price-history-date">{formatDateTime(log.created_at)}</span>
      </div>

      <div className="course-price-history-body">
        {statusChanged && (
          <p>
            <strong>{t('coursePrices.status')}:</strong>{' '}
            <span style={{ color: STATUS_COLORS[log.from_status ?? ''] ?? '#8b97a7' }}>
              {statusText(t, log.from_status)}
            </span>{' '}
            →{' '}
            <span style={{ color: STATUS_COLORS[log.to_status ?? ''] ?? '#003366' }}>
              {statusText(t, log.to_status)}
            </span>
          </p>
        )}

        {log.field && (
          <p>
            <strong>{translateOr(t, FIELD_LABELS[log.field], log.field)}:</strong>{' '}
            <span className="cp-history-old">{fieldValueText(log.field, log.old_value)}</span> →{' '}
            <span className="cp-history-new">{fieldValueText(log.field, log.new_value)}</span>
          </p>
        )}

        {log.note && (
          <p>
            <strong>{t('coursePrices.comment')}:</strong> {log.note}
          </p>
        )}

        <p>
          <strong>{t('coursePrices.historyUser')}:</strong> {log.user?.full_name ?? 'System'}
        </p>
      </div>
    </div>
  );
}

export default function CoursePriceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const currentUser = useAuthStore((s) => s.user);

  const { data, isLoading, isError } = useQuery<CoursePrice>({
    queryKey: ['course_price_show', id],
    // Backend `show` ba'zi endpointlarda { data: {...} } bilan o'raydi, ba'zilarida yo'q.
    queryFn: () => API.get(`/course_prices/${id}`).then((r) => r.data?.data ?? r.data),
    enabled: Boolean(id),
  });

  const percentColor = useMemo(() => {
    const p = data?.percentage ?? 0;
    return p > 0 ? '#27ae60' : p < 0 ? '#e70a0a' : '#003366';
  }, [data]);

  if (isLoading) {
    return (
      <section className="cp-detail-page container">
        <p className="cp-detail-state">{t('coursePrices.loading')}</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="cp-detail-page container">
        <p className="cp-detail-state cp-detail-state--error">{t('coursePrices.error')}</p>
        <div className="cp-detail-header__actions">
          <button type="button" className="cp-detail-btn" onClick={() => navigate('/course-prices')}>
            <i className="fa-solid fa-arrow-left" /> {t('coursePrices.back')}
          </button>
        </div>
      </section>
    );
  }

  const logs = data.logs ?? [];

  return (
    <section className="cp-detail-page container">
      <div className="cp-detail-header">
        <h1 className="cp-detail-title">
          {t('coursePrices.viewTitle')} <span className="cp-detail-id">#{data.id}</span>
        </h1>
        <div className="cp-detail-header__actions">
          <button type="button" className="cp-detail-btn" onClick={() => navigate('/course-prices')}>
            <i className="fa-solid fa-arrow-left" /> {t('coursePrices.back')}
          </button>
        </div>
      </div>

      <div className="cp-detail-section">
        <h2 className="cp-detail-section-title">
          <i className="fa-solid fa-circle-info" /> {t('coursePrices.sectionGeneral')}
        </h2>
        <div className="cp-detail-grid">
          <DetailItem label="ID">#{data.id}</DetailItem>
          <DetailItem label={t('coursePrices.status')}>
            <span
              className="cp-detail-status"
              style={{ color: STATUS_COLORS[data.status ?? ''] ?? '#003366' }}
            >
              {data.status ? statusText(t, data.status) : '-'}
            </span>
          </DetailItem>
          <DetailItem label={t('coursePrices.course')}>
            {getLocalized(data.course, 'name', i18n.language)}
          </DetailItem>
          <DetailItem label={t('coursePrices.branch')}>
            {getLocalized(data.branch, 'name', i18n.language)}
          </DetailItem>
          <DetailItem label={t('coursePrices.level')}>
            {getLocalized(data.level, 'name', i18n.language)}
          </DetailItem>
          <DetailItem label={t('coursePrices.changeDate')}>{data.start_date || '-'}</DetailItem>
        </div>
      </div>

      <div className="cp-detail-section">
        <h2 className="cp-detail-section-title">
          <i className="fa-solid fa-money-bill-wave" /> {t('coursePrices.sectionPrice')}
        </h2>
        <div className="cp-detail-grid">
          <DetailItem label={t('coursePrices.oldPrice')}>{formatNarx(data.old_price)}</DetailItem>
          <DetailItem label={t('coursePrices.newPrice')}>{formatNarx(data.new_price)}</DetailItem>
          <DetailItem label={t('coursePrices.changePercent')}>
            <span className="cp-detail-percent" style={{ color: percentColor }}>
              {data.percentage > 0 ? '+' : ''}
              {data.percentage}%
            </span>
          </DetailItem>
          <DetailItem label={t('coursePrices.comment')}>{data.comment || '-'}</DetailItem>
          {data.status === 'rejected' && data.rejection_reason && (
            <DetailItem label={t('coursePrices.rejectionReason')} span>
              <span style={{ color: '#e70a0a' }}>{data.rejection_reason}</span>
            </DetailItem>
          )}
        </div>
      </div>

      <div className="cp-detail-section">
        <h2 className="cp-detail-section-title">
          <i className="fa-solid fa-clock" /> {t('coursePrices.sectionDates')}
        </h2>
        <div className="cp-detail-grid">
          <DetailItem label={t('coursePrices.tableCreatedDate')}>
            {formatDateTime(data.created_at)}
          </DetailItem>
          <DetailItem label={t('coursePrices.updatedAt')}>
            {formatDateTime(data.updated_at)}
          </DetailItem>
        </div>
      </div>

      <div className="cp-detail-section">
        <h2 className="cp-detail-section-title">
          <i className="fa-solid fa-user-check" /> {t('coursePrices.sectionResponsible')}
        </h2>
        <div className="cp-detail-grid">
          <DetailItem label={t('coursePrices.tableCreatedBy')}>
            {personName(data.creator, data.created_by, currentUser)}
          </DetailItem>
          <DetailItem label={t('coursePrices.tableApprovedBy')}>
            {personName(data.approver, data.approved_by, currentUser)}
          </DetailItem>
          <DetailItem label={t('coursePrices.tableApprovedAt')}>
            {data.approved_at ? formatDateTime(data.approved_at) : '—'}
          </DetailItem>
          <DetailItem label={t('coursePrices.tableRejectedBy')}>
            {personName(data.rejecter, data.rejected_by, currentUser)}
          </DetailItem>
          <DetailItem label={t('coursePrices.tableRejectedAt')}>
            {data.rejected_at ? formatDateTime(data.rejected_at) : '—'}
          </DetailItem>
        </div>
      </div>

      <div className="cp-detail-section course-price-history">
        <h2 className="cp-detail-section-title">
          <i className="fa-solid fa-clock-rotate-left" /> {t('coursePrices.history')}
          {logs.length > 0 && <span className="cp-history-count">{logs.length}</span>}
        </h2>
        {logs.length === 0 ? (
          <p className="cp-detail-state">{t('coursePrices.noHistory')}</p>
        ) : (
          logs.map((log) => <CoursePriceHistoryItem key={log.id} log={log} />)
        )}
      </div>
    </section>
  );
}
