import type { Branch, ApiResponse } from "./common.types";

export interface DepartmentType {
  id: number;
  name_uz: string;
  name_ru?: string;
  name_en?: string;
  code: string;
  is_active: boolean;
  /** Pedagogik bo'lim: shu bo'limda faol shartnomasi bor xodimlar guruhga O'QITUVCHI bo'lib tanlanadi. */
  is_pedagogical?: boolean;
  /** Bo'lim bir nechta filialga biriktiriladi. */
  branches?: Branch[];
  /** Eski (bitta filialli) javob shakli — backend yangilanmagan bo'lsa keladi. */
  branch_id?: number;
  branch?: Branch;
}

export type DepartmentsResponse = ApiResponse<DepartmentType[]>;

export interface DepartmentPayload {
  name_uz: string;
  name_ru?: string;
  name_en?: string;
  code: string;
  branch_ids: number[];
  is_active: boolean;
  is_pedagogical?: boolean;
}
