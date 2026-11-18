import type { Branch, ApiResponse } from './common.types';
import type { Group } from './groups.types';
import type { Course } from './course.types';

export interface Student {
  id: number;
  first_name: string;
  last_name: string;
  full_name?: string;
  student_code?: string;
  branch_id?: number;
  phone?: string;
}

interface PaymentEmployee {
  id: number;
  full_name: string;
  role?: string;
}

export interface Payment {
  id: number;
  amount: string | number;
  payment_method: string;
  payment_period?: string;
  paid_at?: string;
  created_at: string;
  updated_at: string;
  student_id: number;
  group_id: number;
  course_id: number;
  branch_id: number;
  user_id: number;
  branch?: Branch;
  cashier?: PaymentEmployee;
  student?: Student;
  group?: Group;
  course?: Course;
  teacher?: PaymentEmployee;
  payment_date: string;
  /** To'lov qabul qilinganda ushlab qolingan komissiya (`/payments` javobida keladi). */
  commission_percent?: string | number | null;
  commission_amount?: string | number | null;
  final_amount?: string | number | null;
  commission_log?: CommissionLog | null;
}

/** Bitta to'lovning komissiya yozuvi (`payment.commission_log`). */
export interface CommissionLog {
  id: number;
  payment_id: number;
  branch_id: number;
  payment_method: string;
  original_amount: string | number;
  commission_percent: string | number;
  commission_amount: string | number;
  final_amount: string | number;
  reference_number?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type PaymentsResponse = ApiResponse<Payment[]>;
export type PaymentListResponse = PaymentsResponse;

export interface PaymentPayload {
  full_name?: string;
  amount: number;
  payment_method: string;
  /** `YYYY-MM` — to'lov qaysi oy uchun. */
  payment_period?: string;
  course?: string;
  group?: string;
  teacher?: string;
  /** Maktabga tayyorlov (preschool) filial guruhida kurs yo'q — yuborilmaydi. */
  course_id?: number;
  branch_id: number;
  user_id: number;
  teacher_id?: number;
  group_id?: number;
  payment_date: string;
  student_id?: number;
  created_at?: string;
  updated_at?: string;
}
