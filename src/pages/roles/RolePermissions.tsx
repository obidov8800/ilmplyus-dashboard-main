import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '../../api/api';
import { useTranslation } from 'react-i18next';
import PermissionMatrix from '../../components/roles/PermissionMatrix';
import RoleSaveBar from '../../components/roles/RoleSaveBar';
import PermissionLegend from '../../components/roles/PermissionLegend';
import { useRoleMatrix } from './useRoleMatrix';
import { namesOf } from '../../permissions/permissionPolicy';
import { ALL_TABS, type MainTab } from '@/pages/roles/dashboardSettings.service';
import { fetchDashboardSettings, saveDashboardSettings } from '@/pages/roles/dashboardSettings.service';
import { notifications } from '@mantine/notifications';
import './roles.css';

const TAB_LABEL_KEYS: Record<MainTab, string> = {
  umumiy: 'roles.dashboardTabs.general',
  sotuv: 'roles.dashboardTabs.sales',
  oquvchi: 'roles.dashboardTabs.students',
  oqituvchi: 'roles.dashboardTabs.teachers',
  moliya: 'roles.dashboardTabs.finance',
};

const RolePermissions = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const [visibleTabs, setVisibleTabs] = useState<MainTab[]>([...ALL_TABS]);
  const [tabsInitialized, setTabsInitialized] = useState(false);
  const [isSaving, setIsSaving] = useState(false);


  // Ruxsatlar, yorliqlar va saqlash qoidalari (`permissions/` papkasi).
  const matrix = useRoleMatrix();
  const isLoadingAll = matrix.isLoading;

  // Fetch the role's current permissions
  const { data: roleData, isLoading: isLoadingRole } = useQuery({
    queryKey: ['role', id],
    queryFn: async () => {
      const { data } = await API.get(`/roles/${id}`);
      return data?.data || data;
    },
    enabled: !!id,
  });

  // Fetch dashboard section visibility settings
  const { data: dashboardSettings, isLoading: isLoadingDash } = useQuery({
    queryKey: ['dashboard-settings'],
    queryFn: fetchDashboardSettings,
    staleTime: 5 * 60 * 1000,
  });

  const [featuresState, setFeaturesState] = useState<string[]>(() => dashboardSettings?.features ?? []);

  useEffect(() => {
    if (dashboardSettings?.features) {
      setFeaturesState(dashboardSettings.features);
    }
  }, [dashboardSettings]);

  // Initialize visible dashboard tabs from saved settings
  useEffect(() => {
    if (roleData && dashboardSettings && !tabsInitialized) {
      if (roleData.name !== 'admin') {
        const stored = dashboardSettings.roleVisibility[roleData.name];
        setVisibleTabs(stored ? ([...stored] as MainTab[]) : [...ALL_TABS]);
      }
      setTabsInitialized(true);
    }
  }, [roleData, dashboardSettings, tabsInitialized]);

  // Rolning saqlangan ruxsatlari (barchasi) va matritsada ko'rinadiganlari (yashirin/eskirganlarsiz).
  const roleNames = useMemo(() => namesOf(roleData?.permissions), [roleData]);
  // `visibleOf` — barqaror funksiya (useCallback): `matrix` obyektining o'ziga bog'lansa har renderda yangi to'plam
  // hosil bo'lib, quyidagi effekt foydalanuvchi tanlovini qaytarib qo'yardi.
  const { visibleOf } = matrix;
  const savedSelected = useMemo(() => visibleOf(roleNames), [visibleOf, roleNames]);

  useEffect(() => {
    if (roleData?.permissions) setSelected(savedSelected);
  }, [roleData, savedSelected]);

  // Saqlanmagan o'zgarishlar: qo'shilgan + olib tashlangan ruxsatlar.
  const changes =
    [...selected].filter((name) => !savedSelected.has(name)).length +
    [...savedSelected].filter((name) => !selected.has(name)).length;

  const savePermissionsMutation = useMutation({
    mutationFn: async (payload: number[]) => {
      const { data } = await API.post(`/roles/${id}/permissions`, {
        permissions: payload,
      });
      return data;
    },
  });

  const saveDashMutation = useMutation({
    mutationFn: async (settings: {
      roleVisibility: Record<string, string[]>;
      pagePermissions: Record<string, string[]>;
      features: string[];
    }) => {
      const payload = {
        tabNames: dashboardSettings?.tabNames ?? {},
        roleVisibility: settings.roleVisibility,
        pagePermissions: settings.pagePermissions,
        features: settings.features,
      };
      await saveDashboardSettings(payload);
      return payload;
    },
    // Sync the shared dashboard-settings cache so re-opening this page reflects
    // the saved (possibly unchecked) tabs instead of falling back to all-true.
    onSuccess: (payload) => {
      queryClient.setQueryData(['dashboard-settings'], payload);
    },
  });

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);

    try {
      // `lookups.view` avtomatik, eskirganlar tushadi, yashirin `permissions.*` saqlanib qoladi.
      const payload: number[] = matrix.idsForSave(selected, roleNames);

      await savePermissionsMutation.mutateAsync(payload);

      if (roleData?.name && roleData.name !== 'admin') {
        const newVis: Record<string, string[]> = {
          ...(dashboardSettings?.roleVisibility ?? {}),
          [roleData.name]: visibleTabs,
        };
        await saveDashMutation.mutateAsync({
          roleVisibility: newVis,
          pagePermissions: dashboardSettings?.pagePermissions ?? {},
          features: featuresState,
        });
      }

      await queryClient.invalidateQueries({ queryKey: ['role', id] });

      notifications.show({
        title: t('roles.saveSuccessTitle', 'Muvaffaqiyatli'),
        message: t('roles.saveSuccessMessage', 'Rol huquqlari muvaffaqiyatli yangilandi.'),
        color: 'green',
      });
    } catch {
      notifications.show({
        title: t('roles.saveErrorTitle', 'Xatolik'),
        message: t('roles.saveErrorMessage', 'Rol huquqlarini yangilashda xatolik yuz berdi.'),
        color: 'red',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingAll || isLoadingRole || isLoadingDash) {
    return (
      <div className="role-container container">
        {/* HEADER SKELETON */}
        <div className="permissions-header">
          <div className="skeleton skeleton-input" />
          <div className="skeleton skeleton-button" />
        </div>

        {/* CARDS GRID */}
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
      <h1 className="role-page-title">
        {t('roles.permissionsTitle', 'Huquqlarni boshqarish: ')}
        {roleData?.name}
        {/* Undov (!) — ruxsatlar qanday ishlashi haqida umumiy qoidalar; har bo'lim kartochkasida o'z izohi bor. */}
        <PermissionLegend />
      </h1>
      <PermissionMatrix
        entries={matrix.entries}
        selected={selected}
        onChange={setSelected}
        saved={savedSelected}
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
                {roleData?.name === 'admin' ? (
                  <input type="checkbox" checked disabled />
                ) : (
                  <input
                    type="checkbox"
                    checked={visibleTabs.includes(tab)}
                    onChange={() =>
                      setVisibleTabs((prev) =>
                        prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab],
                      )
                    }
                  />
                )}

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
        changes={changes}
        selected={selected.size}
        saving={isSaving}
        onSave={handleSave}
        onBack={() => navigate('/roles')}
        onDiscard={() => setSelected(savedSelected)}
      />
    </section>
  );
};

export default RolePermissions;
