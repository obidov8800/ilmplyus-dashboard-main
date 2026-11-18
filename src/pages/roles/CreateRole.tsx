import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import { useTranslation } from 'react-i18next';
import PermissionMatrix from '../../components/roles/PermissionMatrix';
import RoleSaveBar from '../../components/roles/RoleSaveBar';
import { useRoleMatrix } from './useRoleMatrix';
import { ALL_TABS, type MainTab } from '@/pages/roles/dashboardSettings.service';
import { fetchDashboardSettings, saveDashboardSettings } from '@/pages/roles/dashboardSettings.service';
import { notifications } from '@mantine/notifications';
import './roles.css';
import { useOptions } from '@/hooks/useOptions';

const TAB_LABEL_KEYS: Record<MainTab, string> = {
  umumiy: 'roles.dashboardTabs.general',
  sotuv: 'roles.dashboardTabs.sales',
  oquvchi: 'roles.dashboardTabs.students',
  oqituvchi: 'roles.dashboardTabs.teachers',
  moliya: 'roles.dashboardTabs.finance',
};

const CreateRole = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [roleName, setRoleName] = useState('');
  const [positionId, setPositionId] = useState('');
  const { data: positions = [] } = useOptions('positions');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // New roles start with no dashboard sections selected — the admin picks them explicitly.
  const [visibleTabs, setVisibleTabs] = useState<MainTab[]>([]);

  const { data: dashboardSettings, isLoading: isLoadingDash } = useQuery({
    queryKey: ['dashboard-settings'],
    queryFn: fetchDashboardSettings,
    staleTime: 5 * 60 * 1000,
  });

  const [featuresState, setFeaturesState] = useState<string[]>(
    () => dashboardSettings?.features ?? [],
  );

  useEffect(() => {
    if (dashboardSettings?.features) {
      setFeaturesState(dashboardSettings.features);
    }
  }, [dashboardSettings]);

  // Ruxsatlar, yorliqlar va saqlash qoidalari (`permissions/` papkasi).
  const matrix = useRoleMatrix();
  const isLoadingPerms = matrix.isLoading;

  const createRoleMutation = useMutation({
    mutationFn: async ({ name, positionId }: { name: string; positionId: string }) => {
      const { data } = await API.post('/roles', { name, position_id: positionId ? Number(positionId) : null });
      return data?.data || data;
    },
  });

  const assignPermissionsMutation = useMutation({
    mutationFn: async ({ roleId, permissions }: { roleId: number; permissions: number[] }) => {
      const { data } = await API.post(`/roles/${roleId}/permissions`, { permissions });
      return data;
    },
  });

  const saveDashMutation = useMutation({
    mutationFn: async (newVis: Record<string, string[]>) => {
      const payload = {
        tabNames: dashboardSettings?.tabNames ?? {},
        roleVisibility: newVis,
        pagePermissions: dashboardSettings?.pagePermissions ?? {},
        features: featuresState,
      };
      await saveDashboardSettings(payload);
      return payload;
    },
    // Keep the shared dashboard-settings cache in sync so the edit page reads
    // the just-saved visibility instead of stale data (which reverts to all-true).
    onSuccess: (payload) => {
      queryClient.setQueryData(['dashboard-settings'], payload);
    },
  });

  const handleSave = async () => {
    if (!roleName.trim()) return;

    try {
      const permissionIds: number[] = matrix.idsForSave(selected);

      const newRole = await createRoleMutation.mutateAsync({ name: roleName.trim(), positionId });
      const roleId = newRole?.id;
      const roleName_ = newRole?.name ?? roleName.trim();
      if (roleId) {
        await assignPermissionsMutation.mutateAsync({ roleId, permissions: permissionIds });
        const newVis: Record<string, string[]> = {
          ...(dashboardSettings?.roleVisibility ?? {}),
          [roleName_]: visibleTabs,
        };
        await saveDashMutation.mutateAsync(newVis);
        await queryClient.refetchQueries({ queryKey: ['roles'], type: 'all' });
      }

      notifications.show({
        title: t('roles.saveSuccessTitle', 'Muvaffaqiyatli'),
        message: t('roles.saveSuccessMessage', 'Rol huquqlari muvaffaqiyatli yangilandi.'),
        color: 'green',
      });

      navigate('/roles');
    } catch {
      notifications.show({
        title: t('roles.saveErrorTitle', 'Xatolik'),
        message: t('roles.saveErrorMessage', 'Rol huquqlarini yangilashda xatolik yuz berdi.'),
        color: 'red',
      });
    }
  };

  const isPending =
    createRoleMutation.isPending ||
    assignPermissionsMutation.isPending ||
    saveDashMutation.isPending;

  if (isLoadingPerms || isLoadingDash) {
    return (
      <div className="role-container container">
        <div className="permissions-header">
          <div className="skeleton skeleton-input" />
          <div className="skeleton skeleton-button" />
        </div>
        <div className="permission-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="permission-card skeleton-card">
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-select" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="role-container container">
      <h1 className="role-page-title">{t('roles.createRoleTitle', 'Yangi rol yaratish')}</h1>

      <div className="create-role-top-row">
        <div className="create-role-name-section">
          <label className="create-role-name-label">{t('roles.roleName', 'Rol nomi')}</label>
          <input
            type="text"
            className="create-role-name-input"
            placeholder={t('roles.rolePlaceholder', 'Nomini kiriting')}
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
          />
        </div>

        <div className="create-role-name-section">
          <label className="create-role-name-label">{t('roles.position', 'Lavozim')}</label>
          <select className="create-role-name-input" value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">{t('roles.noPosition', 'Lavozim biriktirilmagan')}</option>
            {positions.map((position) => <option key={position.id} value={position.id}>{position.label}</option>)}
          </select>
        </div>

      </div>

      <PermissionMatrix
        entries={matrix.entries}
        selected={selected}
        onChange={setSelected}
        moduleLabel={matrix.moduleLabel}
        actionLabel={matrix.actionLabel}
        renderInfo={matrix.renderInfo}
        extraTab={{
          key: 'dashboard',
          title: t('roles.tabs.dashboard', 'Dashboard'),
          content: (
        <div className="permission-card">
          <h3 className="permission-card-title">
            {t('roles.dashboardSections', 'Dashboard bo‘limlari')}
          </h3>
          <div className="permission-checkboxes">
            {ALL_TABS.map((tab) => (
              <label key={tab} className="permission-checkbox-label">
                <input
                  type="checkbox"
                  checked={visibleTabs.includes(tab)}
                  onChange={() =>
                    setVisibleTabs((prev) =>
                      prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab],
                    )
                  }
                />
                {(dashboardSettings?.tabNames?.[tab] ?? '').trim() || t(TAB_LABEL_KEYS[tab])}
              </label>
            ))}
            <label className="permission-checkbox-label">
              <input
                type="checkbox"
                checked={featuresState.includes('ip_telephone.view')}
                onChange={(e) =>
                  setFeaturesState((prev) =>
                    e.target.checked
                      ? prev.includes('ip_telephone.view')
                        ? prev
                        : [...prev, 'ip_telephone.view']
                      : prev.filter((f) => f !== 'ip_telephone.view'),
                  )
                }
              />
              {t('dashboard.settings.ipTelephoneView', 'IP Telephone')}
            </label>
            <label className="permission-checkbox-label">
              <input
                type="checkbox"
                checked={featuresState.includes('ip_telephone.listen_recordings')}
                onChange={(e) =>
                  setFeaturesState((prev) =>
                    e.target.checked
                      ? prev.includes('ip_telephone.listen_recordings')
                        ? prev
                        : [...prev, 'ip_telephone.listen_recordings']
                      : prev.filter((f) => f !== 'ip_telephone.listen_recordings'),
                  )
                }
              />
              {t('dashboard.settings.ipTelephoneListenRecordings', 'Listen Recordings')}
            </label>
          </div>
        </div>
          ),
        }}
      />

      <RoleSaveBar
        changes={selected.size}
        selected={selected.size}
        saving={isPending}
        saveDisabled={!roleName.trim()}
        onSave={handleSave}
        onBack={() => navigate('/roles')}
      />
    </section>
  );
};

export default CreateRole;
