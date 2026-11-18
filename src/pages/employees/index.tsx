import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { API } from '../../api/api';
import '../users/users.css';
import type { Employee, EmployeePayload } from '../../types/employee.types';
import { omitEmpty } from '../../utils/payload';
import type { HikvisionDevice } from '../../types/hikvision.types';
import { buildFaceMap, checkDevicesStatus } from '../face-id/deviceStatus';
import { useOptions, type OptionItem } from '../../hooks/useOptions';
import { useDeleteMutation } from '../../hooks/useMutations';
import { useMutation } from '@tanstack/react-query';
import { formatPhone, isValidUzPhone, normalizePhone } from '../../utils/phone';
import { Protected } from '../../components/Protected';
import { useTableColumns } from '../../hooks/useTableColumns';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { normalizePaginated } from '../../utils/normalizePaginated';
import WorkScheduleModal from '../../components/WorkScheduleModal';
import { usePermission } from '../../hooks/usePermission';
import { getLocalized } from '../../utils/getLocalized';

const QUERY_KEY = ['employees'];
const DEVICES_QUERY_KEY = ['hikvision-devices'];
const DEVICE_FACE_MAP_QUERY_KEY = ['hikvision-device-face-map'];

interface DeviceFaceState {
  /** `employeeNo -> yuz rasmi bor/yo'q`. */
  map: Map<string, boolean>;
  /** Nechta qurilma haqiqatan javob berdi. */
  reachable: number;
}

interface EmployeeDepartment {
  id: number;
  name_uz?: string | null;
  name_ru?: string | null;
  name_en?: string | null;
  code?: string | null;
  is_pedagogical?: boolean;
}

interface EmployeeContractSummary {
  employee_id?: number;
  employee?: { id?: number } | null;
  status?: string;
  department?: EmployeeDepartment | null;
}

const isPedagogicalDepartment = (department?: EmployeeDepartment | null) => {
  if (!department) return false;
  if (department.is_pedagogical) return true;
  const text = [department.code, department.name_uz, department.name_ru, department.name_en]
    .filter(Boolean).join(' ').toLowerCase().replace(/[ʼ’‘'`ʻ]/g, '');
  return text.includes('pedagog') || text.includes('педагог');
};

/**
 * Har bir qurilmadan (Hikvision) sinxronlangan xodimlar ro'yxatini olib,
 * `employeeNo -> rasm bor/yo'q` xaritasini yig'adi. Bitta qurilma
 * o'chirilgan/ulanmagan bo'lsa ham qolganlari ishlashda davom etadi
 * (`checkDevicesStatus` ichida `allSettled` + `silentError`).
 *
 * Javob bergan qurilmalar SONI ham qaytariladi. Sababi: hech bir qurilma
 * javob bermasa (backend "cURL error 28: Connection timed out ... 192.168.0.x"
 * qaytaradi — qurilmalar lokal tarmoqda, server ularga yeta olmaydi) xarita
 * bo'sh chiqadi va har bir xodim qizil "Sinxronlash kerak" deb belgilanardi.
 * Bu noto'g'ri xulosa: xodim sinxronlangan bo'lishi ham mumkin, biz shunchaki
 * BILMAYMIZ. `reachable === 0` da jadval neytral "Qurilma ulanmagan" yozadi.
 */
async function fetchDeviceFaceMap(devices: HikvisionDevice[]): Promise<DeviceFaceState> {
  const statuses = await checkDevicesStatus(devices.map((d) => d.id));
  const map = new Map<string, boolean>();
  let reachable = 0;
  statuses.forEach((status) => {
    if (!status.alive) return;
    reachable += 1;
    // Bir nechta qurilmada uchrasa — kamida bittasida rasmi bo'lsa yetarli.
    buildFaceMap(status.users).forEach((hasFace, employeeNo) => {
      map.set(employeeNo, hasFace || (map.get(employeeNo) ?? false));
    });
  });
  return { map, reachable };
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return `${num.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} so'm`;
}

// ─── Delete confirm modal ─────────────────────────────────────────────────────

interface DeleteModalProps {
  employeeName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function DeleteModal({ employeeName, onConfirm, onCancel, loading }: DeleteModalProps) {
  const { t } = useTranslation();
  return (
    <div className="modal-overlay">
      <div className="modal small" style={{ width: 360 }}>
        <h2 className="modal-title" style={{ marginTop: 0 }}>
          {t('employees.deleteModalTitle')}
        </h2>
        <p style={{ textAlign: 'center', color: '#444', marginBottom: 0 }}>
          <strong>{employeeName}</strong> {t('employees.deleteModalText')}
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="danger"
            style={{ background: '#c90000', color: '#fff' }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t('employees.deleting') : t('employees.delete')}
          </button>
          <button type="button" className="cancel" onClick={onCancel} disabled={loading}>
            {t('employees.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

interface EmployeeModalProps {
  initial: EmployeePayload & { id?: number; photo_url?: string };
  branches: OptionItem[];
  onClose: () => void;
  onSave: (payload: EmployeePayload, id?: number, photoFile?: File | null) => void;
  loading: boolean;
}

function EmployeeModal({ initial, branches, onClose, onSave, loading }: EmployeeModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(initial.id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Eski/import qilingan xodimlarda ba'zi ustunlar NULL bo'lishi mumkin — `value={null}` (React ogohlantirishi,
  // maydon "uncontrolled" bo'lib qoladi) bo'lmasligi uchun bo'sh qatorga aylantiriladi.
  const [form, setForm] = useState<EmployeePayload>({
    first_name: initial.first_name ?? '',
    last_name: initial.last_name ?? '',
    middle_name: initial.middle_name ?? '',
    branch_id: initial.branch_id,
    pinfl: initial.pinfl ?? '',
    passport_series: initial.passport_series ?? '',
    passport_number: initial.passport_number ?? '',
    passport_given_date: initial.passport_given_date ?? '',
    passport_given_by: initial.passport_given_by ?? '',
    birth_date: initial.birth_date ?? '',
    phone: formatPhone(initial.phone),
    address_registration: initial.address_registration ?? '',
    address_living: initial.address_living ?? '',
  });

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>(initial.photo_url ?? '');

  const set =
    (field: keyof EmployeePayload) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({
        ...prev,
        [field]: field === 'branch_id' ? Number(e.target.value) : e.target.value,
      }));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidUzPhone(form.phone)) {
      notifications.show({ color: 'red', message: t('common.phoneFormatError') });
      return;
    }
    const body = { ...form, phone: normalizePhone(form.phone) };
    // Backend `UpdateEmployeeRequest`: `sometimes|required|string` — bo'sh maydon yuborilsa (masalan, pasport
    // ma'lumoti kiritilmagan xodim) butun saqlash 422 bilan rad etiladi. Bo'sh maydonlar yuborilmaydi.
    onSave((isEdit ? omitEmpty(body) : body) as EmployeePayload, initial.id, photoFile);
  };

  const fieldStyle: React.CSSProperties = {
    height: 46,
    padding: '0 14px',
    border: '1.5px solid #d0d9e6',
    borderRadius: 12,
    fontSize: 14,
    color: '#003366',
    background: '#fff',
    outline: 'none',
  };

  const groupStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  };

  const labelStyle: React.CSSProperties = { fontSize: 13, color: '#003366', fontWeight: 500 };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 660, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 className="modal-title" style={{ marginTop: 0 }}>
          {isEdit ? t('employees.editModalTitle') : t('employees.addModalTitle')}
        </h2>
        <form onSubmit={handleSubmit}>
          {/* Photo upload */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 20,
              marginBottom: 24,
              padding: '16px 20px',
              background: '#f4f7fb',
              borderRadius: 14,
            }}
          >
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                overflow: 'hidden',
                border: '2px solid #d0d9e6',
                flexShrink: 0,
                background: '#e8eef5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Rasm"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <i className="fa-solid fa-user" style={{ fontSize: 32, color: '#a0b0c8' }} />
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#003366', fontWeight: 500 }}>
                {t('employees.photoLabel')}
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '8px 18px',
                  background: '#003366',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                <i className="fa-solid fa-upload" style={{ fontSize: 12 }} />
                {photoFile
                  ? t('employees.photoChange')
                  : isEdit
                    ? t('employees.photoUpdate')
                    : t('employees.photoAdd')}
              </button>
              {photoFile && (
                <span style={{ fontSize: 12, color: '#7a8fa6' }}>{photoFile.name}</span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          </div>

          {/* Fields grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px 24px',
              marginBottom: 20,
            }}
          >
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldLastName')}</label>
              <input
                style={fieldStyle}
                required
                value={form.last_name}
                onChange={set('last_name')}
                placeholder={t('employees.fieldLastName')}
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldFirstName')}</label>
              <input
                style={fieldStyle}
                required
                value={form.first_name}
                onChange={set('first_name')}
                placeholder={t('employees.fieldFirstName')}
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldMiddleName')}</label>
              <input
                style={fieldStyle}
                value={form.middle_name}
                onChange={set('middle_name')}
                placeholder={t('employees.fieldMiddleName')}
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldBranch')}</label>
              <select
                required
                value={form.branch_id || ''}
                onChange={set('branch_id')}
                style={fieldStyle}
              >
                <option value="">{t('employees.selectBranch')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldPhone')}</label>
              <input
                style={fieldStyle}
                required
                type="tel"
                value={form.phone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, phone: formatPhone(e.target.value) }))
                }
                placeholder="+998901234567"
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldPinfl')}</label>
              <input
                style={fieldStyle}
                value={form.pinfl}
                onChange={set('pinfl')}
                placeholder="14 raqam"
                maxLength={14}
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldPassportSeries')}</label>
              <input
                style={fieldStyle}
                value={form.passport_series}
                onChange={set('passport_series')}
                placeholder="AB"
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldPassportNumber')}</label>
              <input
                style={fieldStyle}
                value={form.passport_number}
                onChange={set('passport_number')}
                placeholder="1234567"
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldPassportDate')}</label>
              <input
                style={fieldStyle}
                type="date"
                value={form.passport_given_date?.split('T')[0] ?? ''}
                onChange={set('passport_given_date')}
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldPassportGiven')}</label>
              <input
                style={fieldStyle}
                value={form.passport_given_by}
                onChange={set('passport_given_by')}
                placeholder="IIB"
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldBirthDate')}</label>
              <input
                style={fieldStyle}
                type="date"
                value={form.birth_date?.split('T')[0] ?? ''}
                onChange={set('birth_date')}
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>{t('employees.fieldAddressReg')}</label>
              <input
                style={fieldStyle}
                value={form.address_registration}
                onChange={set('address_registration')}
                placeholder={t('employees.fieldAddressReg')}
              />
            </div>
            <div style={{ ...groupStyle, gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('employees.fieldAddressLiving')}</label>
              <input
                style={fieldStyle}
                value={form.address_living}
                onChange={set('address_living')}
                placeholder={t('employees.fieldAddressLiving')}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button type="submit" className="primary" disabled={loading}>
              {loading ? t('employees.saving') : t('employees.save')}
            </button>
            <button type="button" className="cancel" onClick={onClose} disabled={loading}>
              {t('employees.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ID tooltip / ask-desk ───────────────────────────────────────────────────

function IdTooltip({
  employee,
  anchorRect,
  onClose,
}: {
  employee: Employee;
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  const top = anchorRect.bottom + window.scrollY + 6;
  const left = anchorRect.left + window.scrollX;

  return (
    <div
      ref={tooltipRef}
      style={{
        position: 'absolute',
        top,
        left,
        zIndex: 9000,
        background: '#fff',
        border: '1.5px solid #d0d9e6',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,51,102,0.13)',
        padding: '14px 18px',
        minWidth: 230,
        maxWidth: 280,
      }}
    >
      {/* arrow */}
      <div
        style={{
          position: 'absolute',
          top: -7,
          left: 16,
          width: 12,
          height: 12,
          background: '#fff',
          border: '1.5px solid #d0d9e6',
          borderBottom: 'none',
          borderRight: 'none',
          transform: 'rotate(45deg)',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <img
          src={employee.photo_url}
          alt={employee.full_name}
          style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#003366', lineHeight: 1.3 }}>
            {employee.full_name}
          </div>
          <div style={{ fontSize: 11, color: '#7a8fa6', marginTop: 2 }}>
            ID: <strong style={{ color: '#003366' }}>{employee.id}</strong>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {[
          { icon: 'fa-building', text: employee.branch?.name_uz ?? '—' },
          { icon: 'fa-phone', text: employee.phone },
          { icon: 'fa-calendar', text: formatDate(employee.birth_date) },
        ].map(({ icon, text }) => (
          <div
            key={icon}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#444' }}
          >
            <i
              className={`fa-solid ${icon}`}
              style={{ width: 14, color: '#7a8fa6', fontSize: 11 }}
            />
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Employee detail card ─────────────────────────────────────────────────────

function EmployeeDetailCard({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accountQuery = useQuery({
    queryKey: ['employee-account', employee.id],
    queryFn: async () => {
      const { data } = await API.get(`/employees/${employee.id}/account`);
      return (data?.data ?? data) as {
        login_via: 'user' | 'employee' | null;
        user?: { username: string; full_name: string } | null;
        username?: string | null;
        credentials_sent_at?: string | null;
        role?: { name: string } | null;
        can_login: boolean;
      };
    },
  });
  const sendCredentials = useMutation({
    mutationFn: async () => {
      const { data } = await API.post(`/employees/${employee.id}/send-credentials`);
      return data?.data ?? data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employee-account', employee.id] }),
  });
  const row = (label: string, value: string | number | null | undefined) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '9px 0',
        borderBottom: '1px solid #f0f3f8',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12, color: '#7a8fa6', flexShrink: 0, minWidth: 140 }}>{label}</span>
      <span style={{ fontSize: 13, color: '#003366', fontWeight: 500, textAlign: 'right' }}>
        {value || '—'}
      </span>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 440, maxHeight: '90vh', overflowY: 'auto', padding: '24px 28px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <img
            src={employee.photo_url}
            alt={employee.full_name}
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              objectFit: 'cover',
              border: '2px solid #d0d9e6',
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#003366' }}>
              {employee.full_name}
            </div>
            <div style={{ fontSize: 12, color: '#7a8fa6', marginTop: 3 }}>ID: {employee.id}</div>
            <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, marginTop: 2 }}>
              {employee.branch?.name_uz ?? '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              fontSize: 18,
              color: '#a0b0c8',
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Details */}
        <div>
          {row(t('employees.detailPhone'), employee.phone)}
          {row(t('employees.detailBalance'), formatMoney(employee.balance))}
          {row(t('employees.fieldPinfl'), employee.pinfl)}
          {row(
            t('employees.detailPassport'),
            `${employee.passport_series ?? ''} ${employee.passport_number ?? ''}`.trim(),
          )}
          {row(t('employees.fieldPassportGiven'), employee.passport_given_by)}
          {row(t('employees.detailPassportDate'), formatDate(employee.passport_given_date))}
          {row(t('employees.detailBirthDate'), formatDate(employee.birth_date))}
          {row(t('employees.detailAddressReg'), employee.address_registration)}
          {row(t('employees.detailAddressLiving'), employee.address_living)}
          {row(t('employees.detailCreatedAt'), formatDate(employee.created_at))}
          {row(t('employees.detailUpdatedAt'), formatDate(employee.updated_at))}
          <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid #e7edf4' }}>
            <strong style={{ color: '#003366', fontSize: 14 }}>{t('employees.systemAccess')}</strong>
            {accountQuery.isLoading ? <p style={{ marginTop: 8 }}>…</p> : accountQuery.data?.login_via === 'user' ? (
              <p style={{ marginTop: 8, fontSize: 13, color: '#526071' }}>
                {t('employees.systemUserAccount', { name: accountQuery.data.user?.full_name ?? accountQuery.data.user?.username ?? '' })}
              </p>
            ) : accountQuery.data?.login_via === 'employee' ? (
              <>
                <p style={{ marginTop: 8, fontSize: 13, color: '#526071' }}>
                  {t('employees.systemLogin', { login: accountQuery.data.username ?? employee.username ?? '—' })}
                </p>
                {accountQuery.data.credentials_sent_at && <p style={{ fontSize: 12, color: '#7a8fa6' }}>{t('employees.credentialsSentAt')}: {formatDate(accountQuery.data.credentials_sent_at)}</p>}
                <Protected permission="employees.edit">
                  <button type="button" className="add-new-user" style={{ marginTop: 10 }} onClick={() => {
                    if (window.confirm(t('employees.resendCredentialsConfirm'))) sendCredentials.mutate();
                  }} disabled={!accountQuery.data.can_login || sendCredentials.isPending}>
                    {sendCredentials.isPending ? t('employees.loading') : t('employees.sendCredentials')}
                  </button>
                </Protected>
              </>
            ) : accountQuery.data?.login_via === null ? (
              <p style={{ marginTop: 8, fontSize: 13, color: '#7a8fa6' }}>{t('employees.noSystemAccess')}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Photo lightbox ───────────────────────────────────────────────────────────

function PhotoLightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 20,
          right: 28,
          background: 'none',
          border: 'none',
          color: '#fff',
          fontSize: 28,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        <i className="fa-solid fa-xmark" />
      </button>
      <img
        src={url}
        alt={name}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Employees() {
  const { t, i18n } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('employees');
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [deleteEmployee, setDeleteEmployee] = useState<Employee | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  const [workTimeEmployeeId, setWorkTimeEmployeeId] = useState<number | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ employee: Employee; rect: DOMRect } | null>(
    null,
  );
  const [lightboxUrl, setLightboxUrl] = useState<{ url: string; name: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const checkboxAllRef = useRef<HTMLInputElement | null>(null);

  const { data: employeesRaw, isLoading, isError } = useQuery<unknown>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data } = await API.get('/employees');
      return data;
    },
    placeholderData: keepPreviousData,
  });

  // `/employees` barcha yozuvlarni bitta javobda qaytaradi va `page`/`per_page`/
  // `branch_id` parametrlarini e'tiborsiz qoldiradi. Shu sabab filtr va qidiruv
  // BUTUN ro'yxatga qo'llanadi, sahifalash esa undan keyin klient tomonda
  // bajariladi — aks holda filial filtri faqat ekrandagi 20 qatorni filtrlardi.
  const allEmployees = useMemo<Employee[]>(() => {
    if (Array.isArray(employeesRaw)) return employeesRaw as Employee[];
    const d = (employeesRaw as { data?: unknown } | null)?.data;
    return Array.isArray(d) ? (d as Employee[]) : [];
  }, [employeesRaw]);

  const { data: branches = [] } = useOptions('branches');
  const canViewContracts = usePermission('employee_contracts.view');
  const { data: employeeContracts = [] } = useQuery<EmployeeContractSummary[]>({
    queryKey: ['contracts'],
    queryFn: async () => {
      const { data } = await API.get('/contracts');
      if (Array.isArray(data)) return data;
      return Array.isArray(data?.data) ? data.data : [];
    },
    enabled: canViewContracts,
    staleTime: 60_000,
  });

  const employeeDepartments = useMemo(() => {
    const byEmployee = new Map<number, EmployeeDepartment[]>();
    employeeContracts.forEach((contract) => {
      if (String(contract.status ?? '').toLowerCase() !== 'active' || !contract.department?.id) return;
      const employeeId = Number(contract.employee_id ?? contract.employee?.id);
      if (!employeeId) return;
      const departments = byEmployee.get(employeeId) ?? [];
      if (!departments.some((department) => department.id === contract.department!.id)) {
        departments.push(contract.department);
      }
      byEmployee.set(employeeId, departments);
    });
    return byEmployee;
  }, [employeeContracts]);

  const departmentTabs = useMemo(() => {
    const unique = new Map<number, EmployeeDepartment>();
    employeeDepartments.forEach((departments) => {
      departments.forEach((department) => unique.set(department.id, department));
    });
    return [...unique.values()]
      .map((department) => ({
        id: department.id,
        label: getLocalized(department, 'name', i18n.language),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language));
  }, [employeeDepartments, i18n.language]);

  // Face ID qurilmalari — faqat rolda «Face ID» sahifasi bo'lsa (ruxsatsiz so'rov yuborilmaydi).
  const canViewDevices = usePermission('hikvision_devices.view');
  const { data: devices = [] } = useQuery<HikvisionDevice[]>({
    queryKey: DEVICES_QUERY_KEY,
    queryFn: async () => {
      const { data } = await API.get('/hikvision-devices');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    enabled: canViewDevices,
  });

  const deviceIdsKey = useMemo(() => devices.map((d) => d.id).join(','), [devices]);

  const { data: faceState, isLoading: isFaceMapLoading } = useQuery<DeviceFaceState>({
    queryKey: [...DEVICE_FACE_MAP_QUERY_KEY, deviceIdsKey],
    queryFn: () => fetchDeviceFaceMap(devices),
    enabled: devices.length > 0,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    let all = allEmployees;
    if (branchFilter) {
      // Xodim bir nechta filialda ishlashi mumkin (shartnoma filiali) — `work_branch_ids` bo'yicha
      all = all.filter((e) =>
        ((e as { work_branch_ids?: number[] }).work_branch_ids ?? [e.branch_id]).map(String).includes(branchFilter),
      );
    }
    if (departmentFilter !== 'all') {
      const departmentId = Number(departmentFilter);
      all = all.filter((employee) =>
        employeeDepartments.get(employee.id)?.some((department) => department.id === departmentId),
      );
    }
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        e.phone.toLowerCase().includes(q) ||
        e.branch?.name_uz?.toLowerCase().includes(q),
    );
  }, [allEmployees, search, branchFilter, departmentFilter, employeeDepartments]);

  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));

  const {
    items: list,
    total: employeesTotal,
    totalPages: employeesTotalPages,
  } = normalizePaginated<Employee>(filtered, safePage, pageSize);

  const allSelected = list.length > 0 && list.every((e) => selectedIds.has(e.id));
  const someSelected = list.some((e) => selectedIds.has(e.id)) && !allSelected;

  useEffect(() => {
    if (checkboxAllRef.current) checkboxAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleOne = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSel = list.every((e) => prev.has(e.id));
      const next = new Set(prev);
      list.forEach((e) => (allSel ? next.delete(e.id) : next.add(e.id)));
      return next;
    });
  }, [list]);

  const updateMutation = useMutation<Employee, Error, { id: number; body: EmployeePayload }>({
    mutationFn: ({ id, body }) => API.put(`/employees/${id}`, body).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const photoMutation = useMutation<Employee, Error, { id: number; file: File }>({
    mutationFn: ({ id, file }) => {
      const fd = new FormData();
      fd.append('photo', file);
      return API.post(`/employees/${id}/update-photo`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const deleteMutation = useDeleteMutation<Employee, Error, number>(
    (id) => API.delete(`/employees/${id}`).then((r) => r.data),
    [QUERY_KEY],
  );

  const handleSave = useCallback(
    async (payload: EmployeePayload, id?: number, photoFile?: File | null) => {
      if (!id) return;
      try {
        await updateMutation.mutateAsync({ id, body: payload });

        if (photoFile) {
          await photoMutation.mutateAsync({ id, file: photoFile });
        }

        notifications.show({
          color: 'green',
          title: t('employees.notifySuccess'),
          message: t('employees.notifyUpdated'),
        });
        setEditEmployee(null);
      } catch {
        // API interceptor shows error notification
      }
    },
    [updateMutation, photoMutation, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteEmployee) return;
    try {
      await deleteMutation.mutateAsync(deleteEmployee.id);
      notifications.show({
        color: 'green',
        title: t('employees.notifySuccess'),
        message: t('employees.notifyDeleted'),
      });
      setDeleteEmployee(null);
    } catch {
      // API interceptor handles notification
    }
  }, [deleteEmployee, deleteMutation, t]);

  const handleBulkDelete = useCallback(async () => {
    setBulkDeleting(true);
    try {
      await Promise.all([...selectedIds].map((id) => API.delete(`/employees/${id}`)));
      notifications.show({
        color: 'green',
        title: t('employees.notifySuccess'),
        message: `${selectedIds.size} ${t('employees.notifyBulkDeleted')}`,
      });
      setSelectedIds(new Set());
      setShowBulkDelete(false);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch {
      // API interceptor handles notification
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedIds, queryClient, t]);

  return (
    <section className="users container">
      {workTimeEmployeeId !== null && (
        <WorkScheduleModal
          userId={workTimeEmployeeId}
          idKey="employee_id"
          onClose={() => setWorkTimeEmployeeId(null)}
        />
      )}
      <h1 className="main-title">{t('employees.pageTitle')}</h1>

      {departmentTabs.length > 0 && (
        <div className="employees-dept-tabs" role="tablist" aria-label={t('employees.departmentTabs')}>
          <button
            type="button"
            role="tab"
            aria-selected={departmentFilter === 'all'}
            className={`employees-dept-tab${departmentFilter === 'all' ? ' active' : ''}`}
            onClick={() => {
              setDepartmentFilter('all');
              setPage(1);
              setSelectedIds(new Set());
            }}
          >
            {t('employees.tabs.all')}
          </button>
          {departmentTabs.map((department) => (
            <button
              key={department.id}
              type="button"
              role="tab"
              aria-selected={departmentFilter === String(department.id)}
              className={`employees-dept-tab${departmentFilter === String(department.id) ? ' active' : ''}`}
              onClick={() => {
                setDepartmentFilter(String(department.id));
                setPage(1);
                setSelectedIds(new Set());
              }}
            >
              {department.label}
            </button>
          ))}
        </div>
      )}

      <div className="users-filters">
        <Protected permission="employees.create">
          <button
            type="button"
            className="add-new-user"
            onClick={() => navigate('/contracts/create')}
          >
            {t('employees.add')}
          </button>
        </Protected>
        <Protected permission="employees.delete">
          <button
            type="button"
            className="delete-all"
            disabled={selectedIds.size === 0}
            onClick={() => setShowBulkDelete(true)}
          >
            {t('employees.delete')}
          </button>
        </Protected>
        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('employees.tableBranch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <input
          placeholder={t('employees.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ marginLeft: 'auto' }}
        />
      </div>

      {isLoading && (
        <div style={{ padding: 40, textAlign: 'center', color: '#7a8fa6' }}>
          {t('employees.loading')}
        </div>
      )}
      {isError && (
        <div style={{ padding: 40, textAlign: 'center', color: '#e70a0a' }}>
          {t('employees.error')}
        </div>
      )}
      {!isLoading && !isError && list.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: '#7a8fa6' }}>
          {t('employees.noData')}
        </div>
      )}

      {!isLoading && !isError && list.length > 0 && (
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th style={{ width: 46 }}>
                  <input
                    ref={checkboxAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#003366' }}
                  />
                </th>
                {isVisible('id') && <th>ID</th>}
                {visibleColumns.map((colId) => (
                  <th key={colId} style={colId === 'full_name' ? { textAlign: 'left' } : undefined}>
                    {columnHeader(colId)}
                  </th>
                ))}
                <th>{t('employees.tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((employee) => (
                <tr
                  key={employee.id}
                  style={selectedIds.has(employee.id) ? { background: '#eef4ff' } : undefined}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(employee.id)}
                      onChange={() => toggleOne(employee.id)}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#003366' }}
                    />
                  </td>
                  {isVisible('id') && (
                    <td>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setTooltipAnchor(
                            tooltipAnchor?.employee.id === employee.id
                              ? null
                              : {
                                  employee,
                                  rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                                },
                          );
                        }}
                        style={{
                          fontWeight: 600,
                          color: '#003366',
                          cursor: 'pointer',
                          textDecoration: 'underline dotted',
                        }}
                      >
                        {employee.id}
                      </span>
                    </td>
                  )}
                  {visibleColumns.map((colId) => {
                    if (colId === 'branch')
                      return <td key={colId}>{employee.branch?.name_uz ?? '-'}</td>;
                    if (colId === 'phone') return <td key={colId}>{employee.phone}</td>;
                    if (colId === 'face_sync') {
                      if (isFaceMapLoading) {
                        return (
                          <td key={colId}>
                            <span style={{ fontSize: 12, color: '#a0b0c8' }}>
                              {t('employees.faceSyncChecking')}
                            </span>
                          </td>
                        );
                      }
                      // Hech bir qurilma javob bermadi — xodim sinxronlanganmi
                      // yoki yo'qmi, aniqlab bo'lmaydi. Qizil "Sinxronlash kerak"
                      // o'rniga neytral holat ko'rsatiladi.
                      if (faceState && faceState.reachable === 0) {
                        return (
                          <td key={colId}>
                            <span
                              style={{
                                background: '#f1f5f9',
                                color: '#64748b',
                                padding: '3px 10px',
                                borderRadius: 5,
                                fontSize: 12,
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                              }}
                              title={t('employees.faceDeviceOfflineHint')}
                            >
                              {t('employees.faceDeviceOffline')}
                            </span>
                          </td>
                        );
                      }
                      const synced = faceState?.map.get(String(employee.id)) === true;
                      return (
                        <td key={colId}>
                          <span
                            style={{
                              background: synced ? '#dcfce7' : '#fef2f2',
                              color: synced ? '#16a34a' : '#dc2626',
                              padding: '3px 10px',
                              borderRadius: 5,
                              fontSize: 12,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {synced ? t('employees.faceSynced') : t('employees.faceNotSynced')}
                          </span>
                        </td>
                      );
                    }
                    if (colId === 'created_at')
                      return <td key={colId}>{formatDate(employee.created_at)}</td>;
                    if (colId === 'updated_at')
                      return <td key={colId}>{formatDate(employee.updated_at)}</td>;
                    if (colId !== 'full_name') return <td key={colId}>-</td>;
                    return (
                      <td key={colId} style={{ textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <img
                            src={employee.photo_url}
                            alt={employee.full_name}
                            onClick={() =>
                              setLightboxUrl({ url: employee.photo_url, name: employee.full_name })
                            }
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              objectFit: 'cover',
                              flexShrink: 0,
                              cursor: 'zoom-in',
                            }}
                          />
                          <span
                            onClick={() => setDetailEmployee(employee)}
                            style={{ fontWeight: 500, cursor: 'pointer', color: '#003366' }}
                          >
                            {employee.full_name}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td>
                    <div className="actions">
                      <Protected permission="work_schedules.view">
                        {employeeDepartments.get(employee.id)?.some(isPedagogicalDepartment) ? (
                          // O'qituvchi: backend ish jadvalini qabul qilmaydi (422) — davomati dars jadvalidan olinadi.
                          // Tugma yashirilmaydi (yo'qolib qolgandek tuyulmasin), o'chirilgan va sababi yozilgan.
                          <span className="user-workTime-note" title={t('workSchedule.teacherNote')}>
                            <button
                              type="button"
                              className="user-workTime-btn user-workTime-btn--teacher"
                              aria-label={`${t('workSchedule.teacherNote')}: ${employee.full_name}`}
                              disabled
                            >
                              <i className="fa-solid fa-clock" />
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="user-workTime-btn"
                            title={t('workSchedule.title')}
                            aria-label={`${t('workSchedule.title')}: ${employee.full_name}`}
                            onClick={() => setWorkTimeEmployeeId(employee.id)}
                          >
                            <i className="fa-solid fa-clock" />
                          </button>
                        )}
                      </Protected>
                      <Protected permission="employees.show">
                        <button
                          type="button"
                          title={t('employees.viewTooltip')}
                          className="user-view-btn"
                          onClick={() => setDetailEmployee(employee)}
                        >
                          <i className="fa-solid fa-eye" />
                        </button>
                      </Protected>
                      <Protected permission="employees.edit">
                        <button
                          type="button"
                          title={t('employees.editTooltip')}
                          className="user-edit-btn"
                          onClick={() => setEditEmployee(employee)}
                        >
                          <i className="fa-solid fa-pen" />
                        </button>
                      </Protected>
                      <Protected permission="employees.delete">
                        <button
                          type="button"
                          title={t('employees.deleteTooltip')}
                          className="user-delete-btn"
                          onClick={() => setDeleteEmployee(employee)}
                        >
                          <i className="fa-solid fa-trash" />
                        </button>
                      </Protected>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !isError && (
        <PaginationBar
          page={safePage}
          totalPages={employeesTotalPages}
          total={employeesTotal}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {editEmployee && (
        <EmployeeModal
          initial={{
            id: editEmployee.id,
            photo_url: editEmployee.photo_url,
            first_name: editEmployee.first_name,
            last_name: editEmployee.last_name,
            middle_name: editEmployee.middle_name,
            branch_id: editEmployee.branch_id,
            pinfl: editEmployee.pinfl,
            passport_series: editEmployee.passport_series,
            passport_number: editEmployee.passport_number,
            passport_given_date: editEmployee.passport_given_date,
            passport_given_by: editEmployee.passport_given_by,
            birth_date: editEmployee.birth_date,
            phone: editEmployee.phone,
            address_registration: editEmployee.address_registration,
            address_living: editEmployee.address_living,
          }}
          branches={branches}
          onClose={() => setEditEmployee(null)}
          onSave={handleSave}
          loading={updateMutation.isPending || photoMutation.isPending}
        />
      )}

      {deleteEmployee && (
        <DeleteModal
          employeeName={deleteEmployee.full_name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteEmployee(null)}
          loading={deleteMutation.isPending}
        />
      )}

      {showBulkDelete && (
        <DeleteModal
          employeeName={`${selectedIds.size} ta`}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDelete(false)}
          loading={bulkDeleting}
        />
      )}


      {tooltipAnchor && (
        <IdTooltip
          employee={tooltipAnchor.employee}
          anchorRect={tooltipAnchor.rect}
          onClose={() => setTooltipAnchor(null)}
        />
      )}

      {detailEmployee && (
        <EmployeeDetailCard employee={detailEmployee} onClose={() => setDetailEmployee(null)} />
      )}

      {lightboxUrl && (
        <PhotoLightbox
          url={lightboxUrl.url}
          name={lightboxUrl.name}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </section>
  );
}
