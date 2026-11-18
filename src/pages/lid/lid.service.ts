import { API } from "@/api/api";
import { normalizeInterestColor } from "@/types/lid.types";
import type {
  LidComment,
  LidOperator,
  Lid,
  LidStatus,
  LidInterestColor,
} from "@/types/lid.types";

export interface LidsQueryParams {
  page: number;
  per_page: number;
}

// Backend ba'zan sahifalash maydonlarini `meta` ichiga joylab qaytaradi
// (JSON:API uslubidagi resurs kolleksiyalari), ba'zan esa `data` bilan
// bir qatorda tekis (Laravel'ning standart `paginate()` chiqishi) —
// shu ikkalasini ham qo'llab-quvvatlash uchun ikkovi ham ixtiyoriy
// qilib qo'yildi (pastda `data.meta?.X ?? data.X` orqali o'qiladi).
export interface PaginatedLids {
  data: Lid[];
  meta?: {
    current_page?: number;
    per_page?: number;
    total?: number;
    last_page?: number;
  };
  current_page?: number;
  per_page?: number;
  total?: number;
  last_page?: number;
}

/**
 * BACKEND BUG (aniqlangan 2026-09-22): `GET /lids*` `status`ni RAQAM emas, MATN
 * qaytaradi (`"1"`, TS tipi `LidStatus` esa 1..10 raqam union'i). Natijada har
 * qanday qattiq (`===`) taqqoslash jimgina hech qachon mos kelmasdi. Tuzatish
 * shu YAGONA joyda — barcha o'qish yo'llari shu orqali o'tadi.
 *
 * Qiziqish rangi backendda `color` ustunida saqlanadi (`l_i_d_s.color`,
 * `PATCH /lids/{id} { color }`; model/validatsiyada `interest_color` YO'Q) —
 * UI ichida `interest_color` ga normallashtiriladi (`normalizeInterestColor`).
 * Ilgari frontend `interest_color` yuborib/o'qigani uchun rang hech qachon
 * saqlanmasdi: backend nomaʼlum maydonni jimgina tashlab yuborardi.
 */
function normalizeLid<T extends Lid>(lid: T): T {
  const status =
    typeof lid.status === "string" ? (Number(lid.status) as LidStatus) : lid.status;
  return {
    ...lid,
    status,
    interest_color: normalizeInterestColor(lid.color ?? lid.interest_color),
  };
}

export async function fetchLids(params: LidsQueryParams): Promise<PaginatedLids> {
  const { data } = await API.get<PaginatedLids>("/lids", { params });
  return { ...data, data: data.data.map(normalizeLid) };
}

export async function deleteLid(id: number): Promise<void> {
  await API.delete(`/lids/${id}`);
}

// export async function getLidComments(lidId: number): Promise<LidComment[]> {
//   const { data } = await API.get<LidComment[]>(`/lids/${lidId}/comment`);
//   return data;
// }

export async function addLidComment(
  lidId: number,
  text: string,
): Promise<LidComment> {
  const { data } = await API.post<LidComment>(`/lids/${lidId}/comment`, {
    text,
  });
  return data;
}

export function getOperatorFullName(
  operator: LidOperator | null | undefined,
): string {
  if (!operator) return "—";
  return operator.full_name || operator.username || '—';
}

export async function updateLidStatus(
  id: number,
  status: LidStatus,
  operator_id: number,
  comment?: string,
): Promise<Lid> {
  const { data } = await API.patch<Lid>(`/lids/${id}`, {
    status,
    operator_id,
    comment,
  });

  return data;
}

/**
 * Lidning "qiziqish rangi" belgisini backendda saqlaydi:
 * `PATCH /lids/{id} { color }` (backend ustuni — `color`, `nullable|string`).
 * `color: null` — belgini tozalash. Xato (422/500) chaqiruvchiga uzatiladi —
 * `useLidInterestColor` eski rangni qaytaradi.
 */
export async function updateLidInterestColor(
  id: number,
  color: LidInterestColor | null,
): Promise<void> {
  await API.patch(`/lids/${id}`, { color });
}
