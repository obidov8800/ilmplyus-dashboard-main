import type { Branch } from './common.types';
import type { Course } from './course.types';
import type { Level } from './level.types';

/** `creator` / `approver` / `rejecter` relation — backend faqat id va ismni qaytaradi. */
export interface CoursePricePerson {
  id: number;
  full_name: string;
}

export interface CoursePrice {
  id: number;
  branch_id: number;
  course_id: number;
  level_id: number;
  old_price: string;
  new_price: string;
  lessons_count: number;
  lesson_price: string;
  percentage: number;
  start_date: string;
  comment: string | null;
  status?: string;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Mas'ul shaxslar: *_by — user id, mos `creator`/`approver`/`rejecter` esa obyekt (yuklanmasa null).
  created_by?: number | null;
  approved_by?: number | null;
  approved_at?: string | null;
  rejected_by?: number | null;
  rejected_at?: string | null;
  creator?: CoursePricePerson | null;
  approver?: CoursePricePerson | null;
  rejecter?: CoursePricePerson | null;
  course: Course;
  level: Level;
  branch: Branch;
  logs: CoursePriceLog[];
}

export interface CoursePriceLog {
  id: number;
  course_price_id: number;
  branch_id: number;
  course_id: number;
  level_id: number;
  user_id: number | null;

  action: string;
  from_status: string | null;
  to_status: string | null;

  field: string | null;
  old_value: string | null;
  new_value: string | null;

  note: string | null;

  meta: Record<string, unknown> | null;

  created_at: string;

  user: {
    id: number;
    full_name: string;
  } | null;
}

export interface CoursePriceListResponse {
  data: CoursePrice[];
  current_page: number;
  last_page: number;
  from: number;
  to: number;
  total: number;
  per_page: number;
}

export interface CoursePricePayload {
  branch_id: number;
  course_id: number;
  level_id: number;
  old_price: number;
  new_price: number;
  lessons_count: number;
  lesson_price: number;
  percentage: number;
  start_date: string;
  comment: string;
  /** Yaratuvchi — login qilgan foydalanuvchi id'si (faqat POST'da yuboriladi). */
  created_by?: number;
}
