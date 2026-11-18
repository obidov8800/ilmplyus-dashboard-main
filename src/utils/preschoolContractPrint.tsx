import { PreschoolContractDocument } from './preschoolContractDocument';
import { PRINT_PAGE_CSS, buildPreschoolDocData } from './preschoolContractData';
import { A4_W_PX, closePdfWindow, openPdfWindow, pagesToPdf, paginateHtml, showPdf } from './pdfViewer';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PDF / chop etish — hujjat haqiqiy A4 PDF bo'lib PDF ko'ruvchida ochiladi (yoki darhol chop etiladi).
 * Ilgari HTML alohida oynada `window.print()` qilinardi va brauzer har sahifaga sana-vaqt, sarlavha,
 * `about:blank`, «1/3» yozuvlarini qo'shardi — endi ular yo'q. Chegaralar avvalgi `@page` bilan bir xil.
 * `extraHtml` — hujjat oxiriga qo'shiladigan blok (masalan tasdiqlash kartalari).
 */
export async function printPreschoolContract(
  contract: any,
  options: { mode?: 'pdf' | 'print'; extraHtml?: string } = {},
): Promise<void> {
  const mode = options.mode ?? 'pdf';
  const data = buildPreschoolDocData(contract);
  const title = `Shartnoma №${data.number}`.replace(/[<>&"]/g, '');
  // Oyna bosish paytida (birinchi `await` dan oldin) ochiladi — aks holda brauzer pop-up deb bloklaydi.
  const win = mode === 'print' ? openPdfWindow(title) : null;

  const host = document.createElement('div');
  try {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = renderToStaticMarkup(<PreschoolContractDocument data={data} />);

    // `@page`/`@media screen` qoidalari bu yerda kerak emas — chegaralarni sahifalovchi o'zi qo'yadi.
    const css = PRINT_PAGE_CSS.replace(/@page[^}]*}/g, '').replace(/@media screen\s*{[^}]*}\s*}/g, '');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_W_PX}px;background:#fff;`;
    host.innerHTML = `<style>${css}</style>${html}`;
    document.body.appendChild(host);

    const pages = paginateHtml(host, '.pcx', { top: 20, right: 15, bottom: 20, left: 30 }, options.extraHtml, { maxPages: 3 });
    const pdf = await pagesToPdf(pages);
    showPdf(pdf, title, mode, win);
  } catch (err) {
    closePdfWindow(win);
    throw err;
  } finally {
    host.remove();
  }
}
