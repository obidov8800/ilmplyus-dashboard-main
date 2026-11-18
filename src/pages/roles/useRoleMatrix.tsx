import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { API } from '../../api/api';
import { fetchOptions } from '../../api/options';
import { usePermission } from '../../hooks/usePermission';
import InfoHint from '../../components/InfoHint';
import PermissionInfo from '../../components/roles/PermissionInfo';
import { actionLabel as getActionLabel, moduleLabel as getModuleLabel } from '../../components/roles/permissionLabels';
import { indexPermissions, isHiddenPermission, isKeptHiddenPermission, rowEntries, type ModuleRow } from '../../permissions/permissionPolicy';
import { finalizeForSave } from '../../permissions/permissionDeps';

/**
 * Rol sahifalari (`RolePermissions`, `CreateRole`) uchun umumiy: tizimdagi ruxsatlar, yorliqlar, undov oynasi va
 * saqlanadigan id ro'yxati (`lookups.view` avtomatik, eskirganlar tushadi, yashirin `permissions.*` saqlanib qoladi).
 */
export function useRoleMatrix() {
  const { t, i18n } = useTranslation();
  const detailed = (i18n.resolvedLanguage || i18n.language).toLowerCase().startsWith('uz');

  // `permissions.view` bo'lsa `/permissions`, bo'lmasa tanlov ro'yxati `/options/permissions` (backend stage15 B4).
  const canViewPermissions = usePermission('permissions.view');
  const { data: rawPermissions, isLoading } = useQuery({
    queryKey: ['permissions-all', canViewPermissions],
    queryFn: async () => {
      if (canViewPermissions) return (await API.get('/permissions')).data;
      const rows: { id: number; label: string }[] = (await fetchOptions('permissions')) as { id: number; label: string }[];
      return rows.map((row) => ({ id: row.id, name: row.label }));
    },
    staleTime: 60 * 1000,
  });

  const { entries, byName } = useMemo(() => indexPermissions(rawPermissions), [rawPermissions]);
  const exists = useCallback((name: string) => byName.has(name), [byName]);

  const moduleLabel = useCallback((module: string) => getModuleLabel(t, module), [t]);
  const actionLabel = useCallback((module: string, action: string) => getActionLabel(t, module, action), [t]);

  const renderInfo = useCallback(
    (row: ModuleRow) => (
      <InfoHint wide>
        <PermissionInfo
          moduleName={row.module}
          moduleTitle={getModuleLabel(t, row.module)}
          actions={rowEntries(row).map((entry) => entry.action)}
          detailed={detailed}
        />
      </InfoHint>
    ),
    [t, detailed],
  );

  /** Matritsada ko'rinadigan (yashirin bo'lmagan) nomlar — rol holati shu to'plamda. */
  const visibleOf = useCallback(
    (names: Iterable<string>) => new Set([...names].filter((name) => byName.has(name) && !isHiddenPermission(name))),
    [byName],
  );

  /** Saqlanadigan id'lar: belgilanganlar + avtomatik `lookups.view` + roldagi yashirin `permissions.*`. */
  const idsForSave = useCallback(
    (selected: Set<string>, roleNames: Iterable<string> = []) => {
      const kept = [...roleNames].filter(isKeptHiddenPermission);
      const final = finalizeForSave([...selected, ...kept], exists);
      return [...final].map((name) => byName.get(name)?.id).filter((id): id is number => typeof id === 'number');
    },
    [byName, exists],
  );

  return { entries, isLoading, moduleLabel, actionLabel, renderInfo, visibleOf, idsForSave };
}
