import { useTranslation } from 'react-i18next';
import type { SyncProgressState } from './syncEmployees';
import { syncProgressPercent } from './syncEmployees';

interface SyncProgressModalProps {
  deviceName: string;
  status: SyncProgressState | null;
  onDismiss: () => void;
}

/**
 * Sinxronlash progressi — ham server `sync-batches/{id}` pollingidan, ham
 * frontendda bitta-bitta yuborilayotgan navbatdan keladigan holatni
 * ko'rsatadi (ikkalasi ham `{ total, processed, failed, finished }`
 * shaklida mos keladi).
 */
export function SyncProgressModal({ deviceName, status, onDismiss }: SyncProgressModalProps) {
  const { t } = useTranslation();
  const progress = syncProgressPercent(status);
  const finished = status?.finished ?? false;

  return (
    <div className="modal-overlay">
      <div className="modal small" style={{ width: 380 }}>
        <h2 className="modal-title" style={{ marginTop: 0 }}>
          {t('faceId.syncProgressTitle')}
        </h2>
        <p style={{ textAlign: 'center', color: '#444', marginBottom: 14 }}>
          <strong>{deviceName}</strong>
        </p>
        <div
          style={{
            background: '#eef2f7',
            borderRadius: 999,
            height: 10,
            overflow: 'hidden',
            marginBottom: 10,
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, progress))}%`,
              height: '100%',
              background: finished && (status?.failed ?? 0) > 0 ? '#eab308' : '#16a34a',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
        <p style={{ textAlign: 'center', color: '#003366', fontSize: 13, fontWeight: 600 }}>
          {status
            ? `${status.processed}/${status.total} (${progress}%)`
            : t('faceId.syncProgressStarting')}
        </p>
        {status && status.failed > 0 && (
          <p style={{ textAlign: 'center', color: '#dc2626', fontSize: 12, marginTop: -6 }}>
            {status.failed} {t('faceId.syncProgressFailed')}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="cancel" onClick={onDismiss}>
            {finished ? t('faceId.debugClose') : t('faceId.syncProgressBackground')}
          </button>
        </div>
      </div>
    </div>
  );
}
