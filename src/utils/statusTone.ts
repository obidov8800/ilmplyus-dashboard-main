/**
 * Backend holat satrini `StatusBadge` rangiga o'giradi. Noma'lum holat — kulrang (xato emas: yangi
 * holat qo'shilsa ham jadval buzilmaydi, faqat neytral ko'rinadi).
 */
export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export function statusTone(status?: string | null): StatusTone {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
    case 'approved':
    case 'confirmed':
    case 'success':
    case 'completed':
    case 'paid':
      return 'success';
    case 'inactive':
    case 'rejected':
    case 'cancelled':
    case 'canceled':
    case 'terminated':
    case 'failed':
    case 'blocked':
    case 'wrong_password':
    case 'user_not_found':
      return 'danger';
    case 'pending':
    case 'sent':
    case 'in_progress':
    case 'frozen':
      return 'warning';
    case 'director_approved':
    case 'new':
    case 'draft':
      return 'info';
    // 'expired' va noma'lum holatlar — kulrang.
    default:
      return 'neutral';
  }
}
