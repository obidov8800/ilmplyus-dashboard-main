import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { API } from '../../api/api';
import '../users/users.css';
import './face-id.css';
import type { HikvisionDevice } from '../../types/hikvision.types';
import type { Employee } from '../../types/employee.types';
import { checkDeviceStatus, buildFaceMap } from './deviceStatus';
import { syncEmployeesToDevice, syncSingleEmployee, type SyncProgressState } from './syncEmployees';
import { SyncProgressModal } from './SyncProgressModal';
import { Protected } from '../../components/Protected';
import StatusBadge, { ActiveBadge } from '@/components/StatusBadge';
import { Avatar } from '@mantine/core';

const DEVICES_QUERY_KEY = ['hikvision-devices'];
const EMPLOYEES_QUERY_KEY = ['employees'];

/**
 * Bitta qurilmaning o'z sahifasi — "Ko'rish" bosilganda ochiladi (avval
 * umumiy /employees sahifasiga olib borardi). Faqat shu qurilma filialiga
 * tegishli xodimlarni va ularning AYNAN SHU qurilmadagi sinxron holatini
 * ko'rsatadi.
 */
export default function FaceIdDeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const deviceId = Number(id);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncAllConfirm, setSyncAllConfirm] = useState(false);
  const [syncBatch, setSyncBatch] = useState<SyncProgressState | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteConfirmEmployee, setDeleteConfirmEmployee] = useState<Employee | null>(null);

  const { data: devices = [], isLoading: isDevicesLoading } = useQuery<HikvisionDevice[]>({
    queryKey: DEVICES_QUERY_KEY,
    queryFn: async () => {
      const { data } = await API.get('/hikvision-devices');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const device = useMemo(() => devices.find((d) => d.id === deviceId), [devices, deviceId]);

  const { data: employees = [], isLoading: isEmployeesLoading } = useQuery<Employee[]>({
    queryKey: EMPLOYEES_QUERY_KEY,
    queryFn: async () => {
      const { data } = await API.get('/employees');
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
  });

  const branchEmployees = useMemo(
    () => employees.filter((e) => device && (e.work_branch_ids ?? [e.branch_id]).map(Number).includes(Number(device.branch_id))),
    [employees, device],
  );

  /* Qurilmaning haqiqiy holati + shu qurilmadagi sinxronlangan xodimlar —
     bitta so'rovdan ikkalasi ham olinadi. */
  const {
    data: status,
    isFetching: isStatusChecking,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['hikvision-device-status', deviceId],
    queryFn: () => checkDeviceStatus(deviceId),
    enabled: Number.isFinite(deviceId) && deviceId > 0,
    // Jonli tekshiruv qimmat: tinmasdan emas — sahifa ochilganda, oynaga qaytganda (2 daqiqadan eski bo'lsa) va har
    // amaldan keyin (`refetchStatus()`).
    staleTime: 2 * 60_000,
    retry: false,
  });

  const faceMap = useMemo(() => buildFaceMap(status?.users ?? []), [status]);

  const handleSyncOne = async (employee: Employee) => {
    if (!device) return;
    setSyncingId(employee.id);
    try {
      const result = await syncSingleEmployee(device, employee);
      notifications.show({
        color: result.timedOut ? 'yellow' : result.success ? 'green' : 'red',
        title: result.success ? t('employees.notifySuccess') : t('employees.notifyError'),
        message: result.timedOut
          ? `${employee.full_name}: ${t('employees.syncStillProcessing')}`
          : `${employee.full_name}: ${
              result.success
                ? result.confirmed
                  ? t('employees.notifySyncedConfirmed')
                  : (result.message ?? t('employees.notifySynced'))
                : t('employees.syncFailed')
            }`,
      });
      refetchStatus();
    } catch {
      // API interceptor handles notification
    } finally {
      setSyncingId(null);
    }
  };

  const handleSyncAllBranch = async () => {
    if (!device) return;
    setSyncAllConfirm(false);
    if (branchEmployees.length === 0) {
      notifications.show({
        color: 'yellow',
        title: t('faceId.notifySuccess'),
        message: t('faceId.noEmployeesForBranch'),
      });
      return;
    }
    setSyncingAll(true);
    setSyncBatch(null);
    const final = await syncEmployeesToDevice(device, branchEmployees, setSyncBatch);
    setSyncingAll(false);
    queryClient.invalidateQueries({ queryKey: DEVICES_QUERY_KEY });
    refetchStatus();
    notifications.show({
      color: final.failed > 0 ? 'yellow' : 'green',
      title: t('faceId.notifySuccess'),
      message:
        final.failed > 0
          ? `${device.name}: ${final.processed}/${final.total} ${t('faceId.notifySynced')}, ${final.failed} ${t('faceId.syncProgressFailed')}`
          : `${device.name}: ${final.total} ${t('faceId.notifySynced')}`,
    });
  };

  /**
   * Bitta xodimni FAQAT shu qurilmadan o'chiradi — darhol bajariladi
   * (`DELETE /hikvision-devices/{id}/employees/{employeeId}`), boshqa
   * qurilmalarga (agar bo'lsa) ta'sir qilmaydi.
   */
  const handleDeleteFromDevice = async () => {
    if (!device || !deleteConfirmEmployee) return;
    const employee = deleteConfirmEmployee;
    setDeleteConfirmEmployee(null);
    setDeletingId(employee.id);
    try {
      await API.delete(`/hikvision-devices/${device.id}/employees/${employee.id}`);
      notifications.show({
        color: 'green',
        title: t('faceId.notifySuccess'),
        message: `${employee.full_name}: ${t('faceId.notifyRemovedFromDevice')}`,
      });
      refetchStatus();
    } catch {
      // API interceptor handles notification
    } finally {
      setDeletingId(null);
    }
  };

  const isActive = status?.alive ?? false;

  return (
    <section className="users container fid-detail-page">
      <button type="button" className="fid-back-btn" onClick={() => navigate('/face-id')}>
        <i className="fa-solid fa-arrow-left" /> {t('faceId.deviceDetailBack')}
      </button>

      {isDevicesLoading ? (
        <div className="fid-detail-empty" role="status">
          {t('faceId.loading')}
        </div>
      ) : !device ? (
        <div className="fid-detail-empty">
          {t('faceId.deviceNotFound')}
        </div>
      ) : (
        <>
          <div className="fid-detail-header">
            <div className="fid-detail-heading">
              <span className="fid-device-icon" aria-hidden="true"><i className="fa-solid fa-fingerprint" /></span>
              <h1 className="main-title">
                {device.name}
              </h1>
            </div>
            <button
              type="button"
              className="add-new-user fid-sync-all"
              onClick={() => setSyncAllConfirm(true)}
              disabled={syncingAll || branchEmployees.length === 0}
            >
              <i className={`fa-solid fa-rotate${syncingAll ? ' fa-spin' : ''}`} aria-hidden="true" />
              {t('faceId.syncConfirmBtn')}
            </button>
              <dl className="fid-detail-meta">
                <div>
                  <dt>{t('faceId.tableBranch')}</dt>
                  <dd>{device.branch?.name_uz ?? '-'}</dd>
                </div>
                <div>
                  <dt>{t('faceId.tableIp')}</dt>
                  <dd className="fid-ip-address">{device.ip_address}</dd>
                </div>
                <div>
                  <dt>{t('faceId.deviceDetailStatusLabel')}</dt>
                  <dd>
                  {isStatusChecking && !status ? (
                    <StatusBadge>{t('faceId.checkingStatus')}</StatusBadge>
                  ) : (
                    <ActiveBadge
                      active={isActive}
                      activeLabel={t('faceId.statusActive')}
                      inactiveLabel={t('faceId.statusInactive')}
                    />
                  )}
                  </dd>
                </div>
              </dl>
          </div>

          <div className="fid-employees-card">
          <h2 className="fid-detail-subtitle" id="fid-employees-title">
            {t('faceId.deviceDetailEmployeesTitle')}
            <span className="fid-employee-count">{branchEmployees.length}</span>
          </h2>

          {isEmployeesLoading ? (
            <div className="fid-detail-empty" role="status">
              {t('faceId.loading')}
            </div>
          ) : branchEmployees.length === 0 ? (
            <div className="fid-detail-empty">
              {t('faceId.deviceDetailNoEmployees')}
            </div>
          ) : (
            <div className="users-table-wrapper fid-employees-scroll" tabIndex={0} role="region" aria-labelledby="fid-employees-title">
              <table className="users-table fid-emp-table" aria-labelledby="fid-employees-title">
                <thead>
                  <tr>
                    <th className="fid-col-fullname">{t('employees.tableFish')}</th>
                    <th>{t('employees.tablePhone')}</th>
                    <th>{t('employees.faceSynced')}</th>
                    <th>{t('faceId.tableActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {branchEmployees.map((employee) => {
                    const synced = faceMap.get(String(employee.id)) === true;
                    return (
                      <tr key={employee.id}>
                        <td className="fid-col-fullname">
                          <div className="fid-employee-name">
                            <Avatar
                              src={employee.photo_url}
                              alt={employee.full_name}
                              size={40}
                              radius="xl"
                              color="blue"
                            >
                              {employee.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}
                            </Avatar>
                            <span>
                              {employee.full_name}
                            </span>
                          </div>
                        </td>
                        <td className="fid-employee-phone">{employee.phone}</td>
                        <td>
                          {isStatusChecking && !status ? (
                            <StatusBadge>
                              {t('employees.faceSyncChecking')}
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone={synced ? 'success' : 'warning'}>
                              {synced ? t('employees.faceSynced') : t('employees.faceNotSynced')}
                            </StatusBadge>
                          )}
                        </td>
                        <td>
                          <div className="actions fid-row-actions">
                            <button
                              type="button"
                              title={t('employees.syncTooltip')}
                              aria-label={t('employees.syncTooltip')}
                              className="archive-restore-btn"
                              onClick={() => handleSyncOne(employee)}
                              disabled={syncingId === employee.id || syncingAll}
                            >
                              <i
                                className={`fa-solid fa-rotate${
                                  syncingId === employee.id ? ' fa-spin' : ''
                                }`}
                              />
                            </button>
                            <Protected permission="hikvision_devices.delete">
                              <button
                                type="button"
                                title={t('faceId.removeFromDeviceTooltip')}
                                aria-label={t('faceId.removeFromDeviceTooltip')}
                                className="user-delete-btn"
                                onClick={() => setDeleteConfirmEmployee(employee)}
                                disabled={deletingId === employee.id}
                              >
                                <i
                                  className={`fa-solid ${deletingId === employee.id ? 'fa-spinner fa-spin' : 'fa-trash'}`}
                                />
                              </button>
                            </Protected>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </>
      )}

      {syncAllConfirm && device && (
        <div className="modal-overlay">
          <div className="modal small" style={{ width: 380 }}>
            <h2 className="modal-title" style={{ marginTop: 0 }}>
              {t('faceId.syncConfirmTitle')}
            </h2>
            <p style={{ textAlign: 'center', color: '#444', marginBottom: 0 }}>
              <strong>{device.name}</strong> {t('faceId.syncConfirmText')}
            </p>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={handleSyncAllBranch}>
                {t('faceId.syncConfirmBtn')}
              </button>
              <button type="button" className="cancel" onClick={() => setSyncAllConfirm(false)}>
                {t('faceId.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {syncingAll && device && (
        <SyncProgressModal
          deviceName={device.name}
          status={syncBatch}
          onDismiss={() => setSyncingAll(false)}
        />
      )}

      {deleteConfirmEmployee && (
        <div className="modal-overlay">
          <div className="modal small" style={{ width: 380 }}>
            <h2 className="modal-title" style={{ marginTop: 0, color: '#b91c1c' }}>
              {t('faceId.removeFromDeviceTitle')}
            </h2>
            <p style={{ textAlign: 'center', color: '#444', marginBottom: 0 }}>
              <strong>{deleteConfirmEmployee.full_name}</strong> {t('faceId.removeFromDeviceText')}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="danger"
                style={{ background: '#c90000', color: '#fff' }}
                onClick={handleDeleteFromDevice}
              >
                {t('faceId.removeFromDeviceConfirmBtn')}
              </button>
              <button
                type="button"
                className="cancel"
                onClick={() => setDeleteConfirmEmployee(null)}
              >
                {t('faceId.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
