import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';

/** Selection belongs to the visible list scope; successful deletions are never retried. */
export function useBulkDelete<T extends { id: number }>({ rows, allowed, scope, remove, refresh, eligible = () => true }: {
  rows: T[]; allowed: boolean; scope: string; remove: (row: T) => Promise<unknown>;
  refresh: () => unknown; eligible?: (row: T) => boolean;
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<{ scope: string; ids: number[] }>({ scope, ids: [] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (selection.scope !== scope) {
    setSelection({ scope, ids: [] });
    if (open && !busy) setOpen(false);
  }
  const available = rows.filter(eligible);
  const ids = selection.scope === scope ? selection.ids : [];
  const selected = available.filter(row => ids.includes(row.id));
  const update = (next: number[]) => setSelection({ scope, ids: next });
  const run = async () => {
    if (!allowed || busy) return;
    setBusy(true); setFailed(false);
    let remaining = [...ids];
    try {
      for (const row of selected) {
        await remove(row);
        remaining = remaining.filter(id => id !== row.id);
        update(remaining);
      }
      setOpen(false);
    } catch { setFailed(true); }
    finally { setBusy(false); refresh(); }
  };
  return {
    columnCount: allowed ? 1 : 0,
    button: allowed && <button type="button" className="admin-bulk-delete" disabled={busy || selected.length === 0} onClick={() => { setFailed(false); setOpen(true); }}>{t('common.delete')}</button>,
    header: allowed && <th className="admin-selection"><input type="checkbox" aria-label={t('common.selectAll', 'Barchasini belgilash')} disabled={busy || available.length === 0} checked={available.length > 0 && selected.length === available.length} ref={el => { if (el) el.indeterminate = selected.length > 0 && selected.length < available.length; }} onChange={e => update(e.target.checked ? available.map(row => row.id) : [])} /></th>,
    cell: (row: T) => allowed && <td className="admin-selection"><input type="checkbox" aria-label={`${t('common.select', 'Belgilash')} ${row.id}`} disabled={busy || !eligible(row)} checked={ids.includes(row.id)} onChange={e => update(e.target.checked ? [...ids, row.id] : ids.filter(id => id !== row.id))} /></td>,
    modal: <ConfirmDeleteModal open={open} busy={busy} message={failed ? t('common.deleteError', 'O‘chirish amalga oshmadi. Qolgan yozuvlar uchun qayta urinib ko‘ring.') : `${t('common.delete')}: ${selected.length}`} onConfirm={() => void run()} onCancel={() => setOpen(false)} />,
  };
}
