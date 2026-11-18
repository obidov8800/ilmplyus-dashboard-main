import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { Protected } from '../../components/Protected';
import { useNavigate } from 'react-router-dom';
import { API, LONG_REQUEST_TIMEOUT } from '../../api/api';
import '../users/users.css';
import './face-id.css';
import type { HikvisionDevice, HikvisionDevicePayload } from '../../types/hikvision.types';
import type { Employee } from '../../types/employee.types';
import { useTableColumns } from '../../hooks/useTableColumns';
import { useOptions, type OptionItem } from '../../hooks/useOptions';
import { useCreateMutation, useUpdateMutation, useDeleteMutation } from '../../hooks/useMutations';
import { checkDevicesStatus, type DeviceLiveStatus } from './deviceStatus';
import { syncEmployeesToDevice, type SyncProgressState } from './syncEmployees';
import { SyncProgressModal } from './SyncProgressModal';
import PaginationBar from '../../components/Pagination/PaginationBar';
import { ActiveBadge } from '@/components/StatusBadge';
import { usePermission } from '@/hooks/usePermission';
import { fetchOptions } from '@/api/options';

const QUERY_KEY = ['hikvision-devices'];
const EMPLOYEES_QUERY_KEY = ['employees'];
const DEVICE_STATUS_QUERY_KEY = ['hikvision-device-status'];

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

const EMPTY_FORM: HikvisionDevicePayload = {
  name: '',
  ip_address: '',
  port: 80,
  username: '',
  password: '',
  branch_id: 0,
};

// ─── Delete confirm modal ─────────────────────────────────────────────────────

interface DeleteModalProps {
  deviceName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function DeleteModal({ deviceName, onConfirm, onCancel, loading }: DeleteModalProps) {
  const { t } = useTranslation();
  return (
    <div className="modal-overlay">
      <div className="modal small" style={{ width: 360 }}>
        <h2 className="modal-title" style={{ marginTop: 0 }}>
          {t('faceId.deleteModalTitle')}
        </h2>
        <p style={{ textAlign: 'center', color: '#444', marginBottom: 0 }}>
          <strong>{deviceName}</strong> {t('faceId.deleteModalText')}
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="danger"
            style={{ background: '#c90000', color: '#fff' }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t('faceId.deleting') : t('faceId.delete')}
          </button>
          <button type="button" className="cancel" onClick={onCancel} disabled={loading}>
            {t('faceId.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

interface DeviceModalProps {
  initial: HikvisionDevicePayload & { id?: number };
  branches: OptionItem[];
  onClose: () => void;
  onSave: (payload: HikvisionDevicePayload, id?: number) => void;
  loading: boolean;
}

function DeviceModal({ initial, branches, onClose, onSave, loading }: DeviceModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(initial.id);
  const [form, setForm] = useState<HikvisionDevicePayload>({
    name: initial.name,
    ip_address: initial.ip_address,
    port: initial.port,
    username: initial.username,
    password: initial.password ?? '',
    branch_id: initial.branch_id,
  });

  const set =
    (field: keyof HikvisionDevicePayload) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({
        ...prev,
        [field]:
          field === 'port' || field === 'branch_id' ? Number(e.target.value) : e.target.value,
      }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form, initial.id);
  };

  return (
    <div className="modal-overlay">
      <div className="modal fid-modal">
        <h2 className="modal-title" style={{ marginTop: 0 }}>
          {isEdit ? t('faceId.editModalTitle') : t('faceId.addModalTitle')}
        </h2>
        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="fid-form-grid">
            <div className="fid-form-group">
              <label>{t('faceId.fieldName')}</label>
              <input
                required
                autoComplete="off"
                value={form.name}
                onChange={set('name')}
                placeholder={t('faceId.namePlaceholder')}
              />
            </div>
            <div className="fid-form-group">
              <label>{t('faceId.fieldBranch')}</label>
              <select required value={form.branch_id || ''} onChange={set('branch_id')}>
                <option value="">{t('faceId.selectPlaceholder')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="fid-form-group">
              <label>{t('faceId.fieldIp')}</label>
              <input
                required
                autoComplete="off"
                value={form.ip_address}
                onChange={set('ip_address')}
                placeholder="192.168.1.100"
              />
            </div>
            <div className="fid-form-group">
              <label>{t('faceId.fieldPort')}</label>
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={set('port')}
              />
            </div>
            <div className="fid-form-group">
              <label>{t('faceId.fieldUsername')}</label>
              <input
                required
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={form.username}
                onChange={set('username')}
                placeholder="admin"
              />
            </div>
            <div className="fid-form-group">
              <label>
                {t('faceId.fieldPassword')}{' '}
                {isEdit && (
                  <span style={{ fontSize: 11, color: '#888' }}>
                    {t('faceId.passwordChangeHint')}
                  </span>
                )}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                value={form.password}
                onChange={set('password')}
                placeholder={isEdit ? '••••••••' : t('faceId.fieldPassword')}
                {...(!isEdit && { required: true })}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button type="submit" className="primary" disabled={loading}>
              {loading ? t('faceId.saving') : isEdit ? t('faceId.save') : t('faceId.save')}
            </button>
            <button type="button" className="cancel" onClick={onClose} disabled={loading}>
              {t('faceId.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Clear confirm modal ──────────────────────────────────────────────────────

interface ClearConfirmModalProps {
  deviceName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function ClearConfirmModal({ deviceName, onConfirm, onCancel, loading }: ClearConfirmModalProps) {
  const { t } = useTranslation();
  return (
    <div className="modal-overlay">
      <div className="modal small" style={{ width: 380 }}>
        <h2 className="modal-title" style={{ marginTop: 0, color: '#b91c1c' }}>
          {t('faceId.clearModalTitle')}
        </h2>
        <p style={{ textAlign: 'center', color: '#444', marginBottom: 0 }}>
          <strong>{deviceName}</strong> {t('faceId.clearModalText')}
        </p>
        <div className="modal-actions">
          <button
            type="button"
            style={{
              background: '#b91c1c',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '10px 22px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t('faceId.clearing') : t('faceId.clearConfirmBtn')}
          </button>
          <button type="button" className="cancel" onClick={onCancel} disabled={loading}>
            {t('faceId.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Debug modal ──────────────────────────────────────────────────────────────

interface DebugModalProps {
  device: HikvisionDevice;
  onClose: () => void;
}

function DebugModal({ device, onClose }: DebugModalProps) {
  const { t } = useTranslation();
  const [employeeNo, setEmployeeNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDebug = async () => {
    if (!employeeNo.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await API.get(`/hikvision-devices/${device.id}/debug/${employeeNo.trim()}`);
      setResult(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Xatolik yuz berdi';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 560 }}>
        <h2 className="modal-title" style={{ marginTop: 0 }}>
          {t('faceId.debugTitle')} — {device.name}
        </h2>

        <input
          value={employeeNo}
          onChange={(e) => setEmployeeNo(e.target.value)}
          placeholder={t('faceId.debugInputPlaceholder')}
          onKeyDown={(e) => e.key === 'Enter' && handleDebug()}
          style={{
            width: '100%',
            height: 42,
            padding: '0 14px',
            border: '1.5px solid #d0d9e6',
            borderRadius: 10,
            fontSize: 14,
            color: '#003366',
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: 16,
          }}
        />

        {result && (
          <pre
            style={{
              background: '#f4f7fb',
              border: '1px solid #d0d9e6',
              borderRadius: 10,
              padding: 16,
              fontSize: 12,
              color: '#003366',
              maxHeight: 280,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              marginBottom: 16,
            }}
          >
            {result}
          </pre>
        )}
        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: 10,
              padding: '12px 16px',
              color: '#b91c1c',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}
        {!result && !error && !loading && (
          <div
            style={{ padding: '12px 0 16px', textAlign: 'center', color: '#a0b0c8', fontSize: 13 }}
          >
            {t('faceId.debugEmptyHint')}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="primary"
            onClick={handleDebug}
            disabled={loading || !employeeNo.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              opacity: loading || !employeeNo.trim() ? 0.6 : 1,
            }}
          >
            {loading ? (
              <i className="fa-solid fa-spinner fa-spin" />
            ) : (
              <i className="fa-solid fa-magnifying-glass" />
            )}
            {t('faceId.debugSearch')}
          </button>
          <button type="button" className="cancel" onClick={onClose}>
            {t('faceId.debugClose')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FaceId() {
  const { t } = useTranslation();

  const { isVisible, visibleColumns } = useTableColumns('faceId');
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editDevice, setEditDevice] = useState<HikvisionDevice | null>(null);
  const [deleteDevice, setDeleteDevice] = useState<HikvisionDevice | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [clearingId, setClearingId] = useState<number | null>(null);
  const [clearConfirmDevice, setClearConfirmDevice] = useState<HikvisionDevice | null>(null);
  const [syncConfirmDevice, setSyncConfirmDevice] = useState<HikvisionDevice | null>(null);
  const [syncBatch, setSyncBatch] = useState<{
    deviceId: number;
    deviceName: string;
    status: SyncProgressState | null;
  } | null>(null);
  const [debugDevice, setDebugDevice] = useState<HikvisionDevice | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const checkboxAllRef = useRef<HTMLInputElement | null>(null);

  const { data, isLoading, isError } = useQuery<HikvisionDevice[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data } = await API.get('/hikvision-devices');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const { data: branches = [] } = useOptions('branches');

  /* Sinxronlash uchun kerak: har bir qurilma o'z filialidagi xodimlarnigina
     olishi kerak — pastdagi `handleSyncAll` shu ro'yxatni filtrlab ishlatadi. */
  // `employees.view` bo'lmasa — tanlov ro'yxatidan (sinxronlashga faqat id va filial kerak).
  const canViewEmployees = usePermission('employees.view');
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: [...EMPLOYEES_QUERY_KEY, canViewEmployees],
    queryFn: async () => {
      if (!canViewEmployees) {
        const rows = await fetchOptions('employees');
        return rows.map((o) => ({ id: o.id, first_name: o.label, last_name: '', branch_id: o.branch_id }) as unknown as Employee);
      }
      const { data } = await API.get('/employees');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  /* Qurilma holati bazadagi statik `is_active`dan emas, real vaqtda
     `/users` so'roviga javob kelish-kelmasligidan aniqlanadi. */
  const deviceIdsKey = useMemo(() => (data ?? []).map((d) => d.id).join(','), [data]);
  const { data: statusMap, isFetching: isStatusChecking } = useQuery<Map<number, DeviceLiveStatus>>({
    queryKey: [...DEVICE_STATUS_QUERY_KEY, deviceIdsKey],
    queryFn: () => checkDevicesStatus((data ?? []).map((d) => d.id)),
    enabled: (data?.length ?? 0) > 0,
    // Qurilma holati har safar `/users` orqali jonli tekshiriladi (qimmat) — tinmasdan emas: sahifa ochilganda, oynaga
    // qaytganda (2 daqiqadan eski bo'lsa) va amaldan keyin (`invalidateQueries`).
    staleTime: 2 * 60_000,
    retry: false,
  });

  const list = useMemo(() => {
    let all = data ?? [];
    if (branchFilter) {
      all = all.filter((d) => String(d.branch_id) === branchFilter);
    }
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.ip_address.toLowerCase().includes(q) ||
        d.branch?.name_uz?.toLowerCase().includes(q),
    );
  }, [data, search, branchFilter]);

  const faceIdTotal = list.length;
  const faceIdTotalPages = Math.max(1, Math.ceil(faceIdTotal / pageSize));
  const pagedList = useMemo(
    () => list.slice((page - 1) * pageSize, page * pageSize),
    [list, page, pageSize],
  );

  const allSelected = list.length > 0 && list.every((d) => selectedIds.has(d.id));
  const someSelected = list.some((d) => selectedIds.has(d.id)) && !allSelected;

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
      const allSel = list.every((d) => prev.has(d.id));
      const next = new Set(prev);
      list.forEach((d) => (allSel ? next.delete(d.id) : next.add(d.id)));
      return next;
    });
  }, [list]);

  const createMutation = useCreateMutation<HikvisionDevice, Error, HikvisionDevicePayload>(
    (payload) => API.post('/hikvision-devices', payload).then((r) => r.data),
    [QUERY_KEY],
  );

  const updateMutation = useUpdateMutation<
    HikvisionDevice,
    Error,
    { id: number; payload: Partial<HikvisionDevicePayload> }
  >(
    ({ id, payload }) => API.put(`/hikvision-devices/${id}`, payload).then((r) => r.data),
    [QUERY_KEY],
  );

  const deleteMutation = useDeleteMutation<HikvisionDevice, Error, number>(
    (id) => API.delete(`/hikvision-devices/${id}`).then((r) => r.data),
    [QUERY_KEY],
  );

  const handleSave = useCallback(
    async (payload: HikvisionDevicePayload, id?: number) => {
      try {
        if (id) {
          const { password, ...rest } = payload;
          const updatePayload = password ? payload : rest;
          await updateMutation.mutateAsync({ id, payload: updatePayload });
          notifications.show({
            color: 'green',
            title: t('faceId.notifySuccess'),
            message: t('faceId.notifyUpdated'),
          });
          setEditDevice(null);
        } else {
          await createMutation.mutateAsync(payload);
          notifications.show({
            color: 'green',
            title: t('faceId.notifySuccess'),
            message: t('faceId.notifyAdded'),
          });
          setShowAdd(false);
        }
      } catch {
        // API interceptor shows error notification
      }
    },
    [createMutation, updateMutation, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteDevice) return;
    try {
      await deleteMutation.mutateAsync(deleteDevice.id);
      notifications.show({
        color: 'green',
        title: t('faceId.notifySuccess'),
        message: t('faceId.notifyDeleted'),
      });
      setDeleteDevice(null);
    } catch {
      // API interceptor handles notification
    }
  }, [deleteDevice, deleteMutation, t]);

  const handleBulkDelete = useCallback(async () => {
    setBulkDeleting(true);
    try {
      await Promise.all([...selectedIds].map((id) => API.delete(`/hikvision-devices/${id}`)));
      notifications.show({
        color: 'green',
        title: t('faceId.notifySuccess'),
        message: `${selectedIds.size} ${t('faceId.notifyBulkDeleted')}`,
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

  /**
   * DIQQAT: backend `/sync-all` filial bo'yicha filtrlamay, TIZIMDAGI BARCHA
   * xodimlarni shu qurilmaga yuborib yuborardi. Shu sabab endi backend
   * endpointi chaqirilmaydi — frontend qurilma filialiga tegishli
   * xodimlarnigina tanlab, ularni BITTALAB (`syncEmployeesToDevice`) yuboradi.
   * Bu qaysi xodim yuborilishini to'liq nazorat qiladi.
   */
  const handleSyncAll = useCallback(async () => {
    if (!syncConfirmDevice) return;
    const device = syncConfirmDevice;
    setSyncConfirmDevice(null);

    const branchEmployees = employees.filter((e) => (e.work_branch_ids ?? [e.branch_id]).map(Number).includes(Number(device.branch_id)));
    if (branchEmployees.length === 0) {
      notifications.show({
        color: 'yellow',
        title: t('faceId.notifySuccess'),
        message: `${device.name}: ${t('faceId.noEmployeesForBranch')}`,
      });
      return;
    }

    setSyncingId(device.id);
    setSyncBatch({ deviceId: device.id, deviceName: device.name, status: null });

    const final = await syncEmployeesToDevice(device, branchEmployees, (state) => {
      setSyncBatch((prev) => (prev && prev.deviceId === device.id ? { ...prev, status: state } : prev));
    });

    setSyncingId(null);
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['hikvision-device-face-map'] });
    queryClient.invalidateQueries({ queryKey: DEVICE_STATUS_QUERY_KEY });
    notifications.show({
      color: final.failed > 0 ? 'yellow' : 'green',
      title: t('faceId.notifySuccess'),
      message:
        final.failed > 0
          ? `${device.name}: ${final.processed}/${final.total} ${t('faceId.notifySynced')}, ${final.failed} ${t('faceId.syncProgressFailed')}`
          : `${device.name}: ${final.total} ${t('faceId.notifySynced')}`,
    });
  }, [syncConfirmDevice, employees, queryClient, t]);

  const handleClear = useCallback(async () => {
    if (!clearConfirmDevice) return;
    setClearingId(clearConfirmDevice.id);
    try {
      await API.post(`/hikvision-devices/${clearConfirmDevice.id}/clear`, undefined, {
        timeout: LONG_REQUEST_TIMEOUT,
      });
      notifications.show({
        color: 'green',
        title: t('faceId.notifySuccess'),
        message: `${clearConfirmDevice.name} ${t('faceId.notifyCleared')}`,
      });
      setClearConfirmDevice(null);
    } catch {
      // API interceptor handles notification
    } finally {
      setClearingId(null);
    }
  }, [clearConfirmDevice, t]);

  return (
    <section className="users container">
      <h1 className="main-title">{t('faceId.pageTitle')}</h1>

      <div className="users-filters">
        <Protected permission="hikvision_devices.create">
          <button type="button" className="add-new-user" onClick={() => setShowAdd(true)}>
            {t('faceId.add')}
          </button>
        </Protected>
        <Protected permission="hikvision_devices.delete">
          <button
            type="button"
            className="delete-all"
            disabled={selectedIds.size === 0}
            onClick={() => setShowBulkDelete(true)}
          >
            {t('faceId.delete')}
          </button>
        </Protected>
        <select
          value={branchFilter}
          onChange={(e) => {
            setBranchFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('faceId.tableBranch')}</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <input
          placeholder={t('faceId.search')}
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
          {t('faceId.loading')}
        </div>
      )}
      {isError && (
        <div style={{ padding: 40, textAlign: 'center', color: '#e70a0a' }}>
          {t('faceId.error')}
        </div>
      )}
      {!isLoading && !isError && list.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: '#7a8fa6' }}>
          {t('faceId.noData')}
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
                {isVisible('id') && <th>{t('faceId.tableId')}</th>}
                {visibleColumns.map((colId) => (
                  <th key={colId} style={colId === 'name' ? { textAlign: 'left' } : undefined}>
                    {columnHeader(colId)}
                  </th>
                ))}
                <th>{t('faceId.tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {pagedList.map((device) => (
                <tr
                  key={device.id}
                  style={selectedIds.has(device.id) ? { background: '#eef4ff' } : undefined}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(device.id)}
                      onChange={() => toggleOne(device.id)}
                      style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#003366' }}
                    />
                  </td>
                  {isVisible('id') && (
                    <td style={{ fontWeight: 600, color: '#003366' }}>{device.id}</td>
                  )}
                  {visibleColumns.map((colId) => {
                    switch (colId) {
                      case 'name':
                        return (
                          <td key={colId} style={{ textAlign: 'left', fontWeight: 500 }}>
                            {device.name}
                          </td>
                        );
                      case 'branch':
                        return <td key={colId}>{device.branch?.name_uz ?? '-'}</td>;
                      case 'port':
                        return <td key={colId}>{device.port}</td>;
                      case 'ip':
                        return <td key={colId}>{device.ip_address}</td>;
                      case 'status': {
                        if (!statusMap && isStatusChecking) {
                          return (
                            <td key={colId}>
                              <span style={{ fontSize: 12, color: '#a0b0c8' }}>
                                {t('faceId.checkingStatus')}
                              </span>
                            </td>
                          );
                        }
                        const isActive = statusMap?.get(device.id)?.alive ?? false;
                        return (
                          <td key={colId}>
                            <ActiveBadge
                              active={isActive}
                              activeLabel={t('faceId.statusActive')}
                              inactiveLabel={t('faceId.statusInactive')}
                            />
                          </td>
                        );
                      }
                      case 'created_at':
                        return <td key={colId}>{formatDate(device.created_at)}</td>;
                      case 'updated_at':
                        return <td key={colId}>{formatDate(device.updated_at)}</td>;
                      default:
                        return <td key={colId}>-</td>;
                    }
                  })}
                  <td>
                    <div className="actions">
                      <Protected permission="hikvision_devices.show">
                        <button
                          type="button"
                          title={t('faceId.employeesTooltip')}
                          className="archive-restore-btn"
                          onClick={() => navigate(`/face-id/${device.id}`)}
                          style={{ fontSize: 17, color: '#003366' }}
                        >
                          <i className="fa-solid fa-eye" />
                        </button>
                      </Protected>
                      <Protected permission="hikvision_devices.edit">
                        <button
                          type="button"
                          title={t('faceId.syncTooltip')}
                          className="archive-restore-btn"
                          onClick={() => setSyncConfirmDevice(device)}
                          disabled={syncingId === device.id}
                          style={{ fontSize: 17, color: '#003366' }}
                        >
                          <i
                            className={`fa-solid fa-rotate${syncingId === device.id ? ' fa-spin' : ''}`}
                          />
                        </button>
                      </Protected>
                      <Protected permission="hikvision_devices.edit">
                        <button
                          type="button"
                          title={t('faceId.editTooltip')}
                          className="user-edit-btn"
                          onClick={() => setEditDevice(device)}
                        >
                          <i className="fa-solid fa-pen" />
                        </button>
                      </Protected>
                      <Protected permission="hikvision_devices.delete">
                        <button
                          type="button"
                          title={t('faceId.deleteTooltip')}
                          className="user-delete-btn"
                          onClick={() => setDeleteDevice(device)}
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
          page={page}
          totalPages={faceIdTotalPages}
          total={faceIdTotal}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {showAdd && (
        <DeviceModal
          initial={{ ...EMPTY_FORM }}
          branches={branches}
          onClose={() => setShowAdd(false)}
          onSave={handleSave}
          loading={createMutation.isPending}
        />
      )}

      {editDevice && (
        <DeviceModal
          initial={{
            id: editDevice.id,
            name: editDevice.name,
            ip_address: editDevice.ip_address,
            port: editDevice.port,
            username: editDevice.username,
            password: '',
            branch_id: editDevice.branch_id,
          }}
          branches={branches}
          onClose={() => setEditDevice(null)}
          onSave={handleSave}
          loading={updateMutation.isPending}
        />
      )}

      {deleteDevice && (
        <DeleteModal
          deviceName={deleteDevice.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteDevice(null)}
          loading={deleteMutation.isPending}
        />
      )}

      {showBulkDelete && (
        <DeleteModal
          deviceName={`${selectedIds.size} ta`}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDelete(false)}
          loading={bulkDeleting}
        />
      )}

      {syncConfirmDevice && (
        <div className="modal-overlay">
          <div className="modal small" style={{ width: 380 }}>
            <h2 className="modal-title" style={{ marginTop: 0 }}>
              {t('faceId.syncConfirmTitle')}
            </h2>
            <p style={{ textAlign: 'center', color: '#444', marginBottom: 0 }}>
              <strong>{syncConfirmDevice.name}</strong> {t('faceId.syncConfirmText')}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="primary"
                onClick={handleSyncAll}
                disabled={syncingId === syncConfirmDevice.id}
              >
                {syncingId === syncConfirmDevice.id
                  ? t('faceId.syncing')
                  : t('faceId.syncConfirmBtn')}
              </button>
              <button type="button" className="cancel" onClick={() => setSyncConfirmDevice(null)}>
                {t('faceId.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {syncBatch && (
        <SyncProgressModal
          deviceName={syncBatch.deviceName}
          status={syncBatch.status}
          onDismiss={() => {
            setSyncBatch(null);
            setSyncingId(null);
          }}
        />
      )}

      {clearConfirmDevice && (
        <ClearConfirmModal
          deviceName={clearConfirmDevice.name}
          onConfirm={handleClear}
          onCancel={() => setClearConfirmDevice(null)}
          loading={clearingId === clearConfirmDevice.id}
        />
      )}

      {debugDevice && <DebugModal device={debugDevice} onClose={() => setDebugDevice(null)} />}
    </section>
  );
}
