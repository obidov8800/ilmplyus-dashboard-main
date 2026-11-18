import { notifications } from '@mantine/notifications';

/**
 * Yagona bildirishnoma: ekranning o'ng tepasida chiqadigan Mantine xabari (`<Notifications position="top-right" />`).
 *
 * Brauzerning `alert()` oynasi o'rniga ham, shartnoma sahifalaridagi sahifa ichidagi qizil/yashil/sariq bloklar
 * o'rniga ham shu ishlatiladi — xabarlar hamma joyda bir xil ko'rinishda bo'lishi uchun. User ilovasida ham xuddi shu fayl.
 */

/** Ko'p qatorli xabar (`\n`) alohida qatorlarda chiqsin. */
const STYLES = { description: { whiteSpace: 'pre-line' as const } };

/** Bir xil xabar ketma-ket bosilganda (masalan «Keyingisi») ustma-ust to'planib qolmasligi uchun — xabar matnidan olingan id. */
function idOf(message: string): string {
  let h = 0;
  for (let i = 0; i < message.length; i += 1) h = (h * 31 + message.charCodeAt(i)) | 0;
  return `notify-${h}`;
}

/** Ogohlantirish (masalan, to'ldirilmagan maydon, noto'g'ri telefon formati). */
export function notifyWarning(message: string, title?: string): void {
  notifications.show({ id: idOf(message), color: 'yellow', title, message, autoClose: 5000, styles: STYLES });
}

/** Xatolik (amal bajarilmadi). */
export function notifyError(message: string, title?: string): void {
  notifications.show({ id: idOf(message), color: 'red', title, message, autoClose: 6000, styles: STYLES });
}

/** Muvaffaqiyat (masalan, avtomatik yaratish natijasi, shartnoma yaratildi). */
export function notifySuccess(message: string, title?: string): void {
  notifications.show({ id: idOf(message), color: 'green', title, message, autoClose: 5000, styles: STYLES });
}
