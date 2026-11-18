/**
 * Matnni buferga nusxalash — `navigator.clipboard` mavjud bo'lsa o'sha,
 * aks holda (eski brauzer / xavfsiz bo'lmagan kontekst) yashirin
 * `<textarea>` + `execCommand('copy')` orqali.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* pastdagi zaxira usulга o'tamiz */
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
