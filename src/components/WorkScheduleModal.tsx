import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../api/api';
import { useTranslation } from 'react-i18next';
import WeekTimesEditor from './WeekTimesEditor';
import { hm, makeWeek, weekHasError, type DayTime } from './WeekTimesEditor/weekTimes';
import { usePermission } from '../hooks/usePermission';
import useAuthStore from '../store/useAuthStore';

interface WorkSchedule {
  id: number;
  user_id: number;
  week_day: number;
  start_time: string;
  end_time: string;
}

interface UserScheduleStatus {
  message?: string;
  restricted?: boolean;
  can_write?: boolean;
}

interface Props {
  userId: number;
  onClose: () => void;
  /** Payload va so'rovda qaysi kalit yuborilsin. Users sahifasi `user_id`,
   *  xodimlar shartnomasi sahifasi `employee_id` bilan ishlaydi. */
  idKey?: 'user_id' | 'employee_id';
}

const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';

interface FormProps extends Props {
  existing: WorkSchedule[];
  canEdit: boolean;
}

const WorkScheduleForm = ({ userId, onClose, existing, idKey = 'user_id', canEdit }: FormProps) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const first = existing[0];

  // Har kun o'z vaqti bilan: bazada bor kun belgilangan, vaqti o'zi; yo'q kunlar — dam olish
  // (belgilansa, mavjud kunlarning vaqti taklif qilinadi).
  const [week, setWeek] = useState<DayTime[]>(() => {
    const byDay = new Map(existing.map((s) => [s.week_day, s]));
    const base = makeWeek(hm(first?.start_time, DEFAULT_START), hm(first?.end_time, DEFAULT_END), []);
    return base.map((d) => {
      const row = byDay.get(d.day);
      return row
        ? { day: d.day, enabled: true, start: hm(row.start_time, DEFAULT_START), end: hm(row.end_time, DEFAULT_END) }
        : d;
    });
  });
  const hasEnabled = week.some((d) => d.enabled);
  const invalid = weekHasError(week, false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const schedules = week.filter((d) => d.enabled).map((d) => ({
        week_day: d.day,
        start_time: d.start,
        end_time: d.end,
      }));
      if (idKey === 'employee_id') {
        await API.put('/work_schedules/bulk', {
          employee_id: userId,
          replace: true,
          schedules,
        });
      } else {
        await API.put(`/users/${userId}/work-schedules`, { schedules });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work_schedules', idKey, userId] });
      onClose();
    },
  });

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 8 }}>
          {t('workSchedule.chooseDays')}
        </label>
        <WeekTimesEditor
          value={week}
          onChange={setWeek}
          startLabel={t('workSchedule.startTime')}
          endLabel={t('workSchedule.endTime')}
        />
        {invalid && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#b42318' }}>{t('workSchedule.invalidTime')}</p>
        )}
      </div>

      <div className="modal-actions">
        <button
          className="primary"
          onClick={() => saveMutation.mutate()}
          disabled={
            !canEdit || saveMutation.isPending ||
            invalid ||
            // Hech narsa belgilanmagan va saqlangan jadval ham yo'q — saqlanadigan narsa yo'q.
            (!hasEnabled && existing.length === 0)
          }
        >
          {saveMutation.isPending ? t('workSchedule.saving') : t('workSchedule.save')}
        </button>
        <button className="cancel" onClick={onClose}>{canEdit ? t('workSchedule.cancel') : t('workSchedule.close')}</button>
      </div>
    </>
  );
};

const WorkScheduleModal = ({ userId, onClose, idKey = 'user_id' }: Props) => {
  const { t } = useTranslation();
  const canView = usePermission(idKey === 'user_id' ? 'user_work_schedules.view' : 'work_schedules.view');
  const hasEditPermission = usePermission(idKey === 'user_id' ? 'user_work_schedules.edit' : 'work_schedules.create');
  const currentUserId = useAuthStore((state) => state.user?.id);
  const canBypassSelfEdit = usePermission('user_work_schedules.bypass');
  const canEdit = hasEditPermission && !(idKey === 'user_id' && userId === currentUserId && !canBypassSelfEdit);

  const { data: scheduleResponse, isLoading } = useQuery<{ rows: WorkSchedule[]; status?: UserScheduleStatus }>({
    queryKey: ['work_schedules', idKey, userId],
    queryFn: async () => {
      const { data } = idKey === 'user_id'
        ? await API.get(`/users/${userId}/work-schedules`)
        : await API.get(`/work_schedules/employee/${userId}`);
      const payload = data?.data ?? data;
      const rows = Array.isArray(payload) ? payload : payload?.schedules ?? [];
      return { rows, status: data?.status ?? payload?.status };
    },
    enabled: canView,
  });

  return (
    <div className="modal-overlay">
      <div className="modal work-schedule-modal">
        <h3 className="modal-title">
          {t(idKey === 'user_id' ? 'workSchedule.userTitle' : 'workSchedule.employeeTitle')}
        </h3>
        {/* Ikki xil jadval: foydalanuvchiniki — tizimga yozishni cheklaydi; xodimniki — davomat (Face ID) uchun. */}
        <p className="work-hours-status work-hours-status--hint">
          {t(idKey === 'user_id' ? 'workSchedule.userHint' : 'workSchedule.employeeHint')}
        </p>

        {!canView ? (
          <p style={{ textAlign: 'center', padding: '20px', color: '#666' }}>{t('workSchedule.noAccess')}</p>
        ) : isLoading || scheduleResponse === undefined ? (
          <p style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
            {t('workSchedule.loading')}
          </p>
        ) : (
          <>
            {idKey === 'user_id' && scheduleResponse.status?.message && (
              <p className={`work-hours-status${scheduleResponse.status.can_write ? '' : ' work-hours-status--restricted'}`}>
                {scheduleResponse.status.message}
              </p>
            )}
            <WorkScheduleForm
              key={userId}
              userId={userId}
              idKey={idKey}
              onClose={onClose}
              existing={scheduleResponse.rows}
              canEdit={canEdit}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default WorkScheduleModal;
