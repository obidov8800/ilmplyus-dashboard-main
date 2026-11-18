import QRCode from 'qrcode';

/** Fayl nomi uchun xavfsiz slug: bo'shliq va maxsus belgilar `-` ga aylanadi. */
const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9Ѐ-ӿ]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'qr-code';

/**
 * Havoladan QR kod yasab, PNG holatida darhol yuklab beradi —
 * hech qanday dialog yoki tasdiqlashsiz.
 */
export const downloadQrPng = async (text: string, fileName: string) => {
  const dataUrl = await QRCode.toDataURL(text, {
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#003366', light: '#ffffff' },
  });

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `${slugify(fileName)}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
};
