import { API } from '../../api/api';
import type {
  HikvisionUserInfoItem,
  HikvisionUserInfoSearchResponse,
} from '../../types/hikvision.types';

export interface DeviceLiveStatus {
  /** Qurilmadan javob keldimi (aktiv/noaktiv shu asosda aniqlanadi). */
  alive: boolean;
  /** Javob kelgan bo'lsa — shu qurilmadagi sinxronlangan xodimlar. */
  users: HikvisionUserInfoItem[];
}

/**
 * Qurilmaning haqiqiy holatini tekshiradi — bazadagi statik `is_active`
 * bayrog'iga emas, `/users` so'roviga real javob kelish-kelmasligiga
 * qaraladi: javob kelsa (va `success !== false`) — aktiv, tarmoq xatosi,
 * timeout yoki `success:false` bo'lsa — noaktiv.
 */
export async function checkDeviceStatus(deviceId: number): Promise<DeviceLiveStatus> {
  try {
    const { data } = await API.get<HikvisionUserInfoSearchResponse>(
      `/hikvision-devices/${deviceId}/users`,
      { silentError: true },
    );
    const users = data?.data?.UserInfoSearch?.UserInfo ?? [];
    const alive = data?.success !== false;
    return { alive, users };
  } catch {
    return { alive: false, users: [] };
  }
}

/** Bir nechta qurilmani parallel tekshiradi — ro'yxat sahifasida ishlatiladi. */
export async function checkDevicesStatus(
  deviceIds: number[],
): Promise<Map<number, DeviceLiveStatus>> {
  const map = new Map<number, DeviceLiveStatus>();
  await Promise.allSettled(
    deviceIds.map(async (id) => {
      map.set(id, await checkDeviceStatus(id));
    }),
  );
  return map;
}

/** `HikvisionUserInfoItem[]` dan `employeeNo -> yuz bor/yo'q` xaritasi. */
export function buildFaceMap(users: HikvisionUserInfoItem[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  users.forEach((u) => {
    const employeeNo = String(u.employeeNo ?? '').trim();
    if (!employeeNo) return;
    const hasFace = (u.numOfFace ?? 0) > 0 || Boolean(u.faceURL);
    map.set(employeeNo, hasFace || (map.get(employeeNo) ?? false));
  });
  return map;
}
