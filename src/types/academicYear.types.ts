/**
 * O'quv yili (masalan «2026-2027»). Maktabga tayyorlov (preschool) filiallaridagi guruhlar shu yilga
 * bog'lanadi. Bir vaqtda faqat bitta yil `active`; eskilari o'chirilmaydi — `inactive` bo'lib qoladi.
 *
 * Sanalar backenddan `YYYY-MM-DD` ko'rinishida keladi.
 */
export type AcademicYearStatus = 'active' | 'inactive';

export interface AcademicYear {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: AcademicYearStatus;
  /** Faqat ro'yxat (`GET /academic-years`) va `show` javobida bor. */
  groups_count?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AcademicYearPayload {
  name: string;
  start_date: string;
  end_date: string;
  /** Faqat yaratishda: `active` bo'lsa yil darhol faol qilinadi (oldingisi nofaol bo'ladi). */
  status?: AcademicYearStatus;
}
