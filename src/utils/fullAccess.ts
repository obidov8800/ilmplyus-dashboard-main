/*
 * To'liq huquqli rollar (admin / «Super admin») — ruxsat tekshiruvlaridan tashqari
 * ayrim umumiy admin istisnolari uchun ishlatiladi.
 *
 * Nega: «Super admin» roli bazada bor (barcha ruxsatlari bilan), lekin avval UI faqat aynan `admin` / `superadmin`
 * nomlarini admin deb bilardi. «Super admin» (bo'shliqli yozuv) admin hisoblanmay, ruxsat NOMI bo'yicha tekshirilardi —
 * bazada yo'q nomlar (`commissions.*`, `operators.*`, `teachers.*`, `lessons.start`, `trash.delete`…) yoki rolga hali
 * biriktirilmagan yangi ruxsat (masalan `payments.create`) sabab tugma/menyu jimgina yo'qolardi. Backend baribir har
 * so'rovni o'z ruxsatlari bilan tekshiradi — bu faqat ko'rinishni ochadi.
 */
const FULL_ACCESS_ROLES = new Set(['admin', 'superadmin']);

/** `Super admin`, `super_admin`, `super-admin`, `SuperAdmin`, `Admin` → to'liq huquq. */
export const isFullAccessRoleName = (name?: string | null): boolean =>
  FULL_ACCESS_ROLES.has((name ?? '').toLowerCase().replace(/[\s_-]/g, ''));

export const hasFullAccess = (user?: { roles?: { name?: string | null }[] | null } | null): boolean =>
  !!user?.roles?.some((role) => isFullAccessRoleName(role.name));

/** Super admin ham ko'rinadigan menyu va amallarni o'z ruxsatlari bilan cheklaydi. */
export const hasPermissionBypass = (user?: { roles?: { name?: string | null }[] | null } | null): boolean =>
  !!user?.roles?.some((role) => (role.name ?? '').toLowerCase().replace(/[\s_-]/g, '') === 'admin');
