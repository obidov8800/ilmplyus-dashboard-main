import { useMemo } from 'react';
import { useOptions, type OptionItem } from './useOptions';

/**
 * Kurs narxlari uchun filiallar. Maktabga tayyorlov filiali (`type: 'preschool'`, masalan «PARVOZ») kurs/daraja
 * bo'yicha narxga ega emas — uning narxi alohida «Maktabga tayyorlov narxi» sahifasida — shuning uchun bu ro'yxatda
 * chiqmaydi. `keepId` — tahrirlanayotgan yozuvning filiali: u har holda tanlov ichida qoladi.
 */
export const useCourseBranches = (keepId?: number | string | null) => {
  const query = useOptions('branches');
  const data = useMemo<OptionItem[]>(
    () => (query.data ?? []).filter((b) => b.type !== 'preschool' || String(b.id) === String(keepId ?? '')),
    [query.data, keepId],
  );
  return { ...query, data };
};
