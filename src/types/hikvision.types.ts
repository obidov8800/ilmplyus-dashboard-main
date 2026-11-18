import type { BaseEntity } from './common.types';
import type { Branch } from './common.types';

export interface HikvisionDevice extends BaseEntity {
  branch_id: number;
  name: string;
  ip_address: string;
  port: number;
  username: string;
  is_active: boolean;
  deleted_at: string | null;
  branch?: Branch;
}

export interface HikvisionDevicePayload {
  name: string;
  ip_address: string;
  port: number;
  username: string;
  password: string;
  branch_id: number;
}

/**
 * Qurilma (Hikvision) ISAPI UserInfo/Search javobidagi bitta xodim yozuvi.
 * `employeeNo` — qurilmadagi xodim raqami, tizimdagi xodim `id`siga mos keladi.
 */
export interface HikvisionUserInfoItem {
  employeeNo: string;
  name?: string;
  numOfFace?: number;
  faceURL?: string;
  [key: string]: unknown;
}

/**
 * `GET /hikvision-devices/{id}/users` (va eski `debug/{employeeNo}`) xom javobi —
 * qurilmadagi barcha sinxronlangan xodimlar ro'yxati.
 */
export interface HikvisionUserInfoSearchResponse {
  success?: boolean;
  data?: {
    UserInfoSearch?: {
      searchID?: string;
      responseStatusStrg?: string;
      numOfMatches?: number;
      totalMatches?: number;
      UserInfo?: HikvisionUserInfoItem[];
    };
  };
}

/**
 * `POST .../sync-all` yoki `POST .../employees/{id}/sync` javobi — so'rov
 * darhol bajarilmaydi, navbatga qo'yiladi (202). `sync-all` uchun `batch_id`
 * keladi (progress kuzatish uchun), bitta xodim sync'ida bo'lmasligi mumkin.
 */
export interface HikvisionSyncQueuedResponse {
  message: string;
  batch_id?: string;
}

/** `GET /hikvision-devices/sync-batches/{batch_id}` — navbat holati (polling uchun). */
export interface HikvisionSyncBatchStatus {
  total: number;
  processed: number;
  failed: number;
  progress: number;
  finished: boolean;
  cancelled: boolean;
}
