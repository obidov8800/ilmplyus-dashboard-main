/* ------------------------------------------------------------------ *
 * Narxlar Excel'dan import — fayl o'qish va nomlarni tizimdagi filial/kurs/darajaga moslash.
 *
 * Kutilgan tuzilma (o'quv markazlari prays-listi): har filial bloki
 *   A: filial nomi   B: «1 etab»  C: «2 etab»  D: «3 etab»
 *   A: kurs nomi     B: narx      C: narx      D: narx      ← kursning etab bo'yicha narxlari
 * bloklar bo'sh qator bilan ajratiladi. Kirill va lotin yozuvi aralash bo'lishi mumkin.
 *
 * `.xlsx` — oddiy zip (`xl/sharedStrings.xml` + `xl/worksheets/sheet1.xml`): yangi kutubxona qo'shilmaydi, loyihada
 * allaqachon bor `pizzip` yetarli.
 * ------------------------------------------------------------------ */
import PizZip from 'pizzip';

export interface ParsedPrice {
  /** Excel'dagi qator raqami (xato xabarlari uchun). */
  excelRow: number;
  branchName: string;
  courseName: string;
  /** 1, 2, 3 … — «1 etab» ustuni. */
  stage: number;
  price: number;
}

/** A1 → 0, B → 1 … */
function colIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(node: Element): string {
  return Array.from(node.getElementsByTagName('t'))
    .map((t) => t.textContent ?? '')
    .join('');
}

const STAGE_HEADER = /(этаб|этап|etab|etap|bosqich|stage)/i;

/** `.xlsx` ning birinchi varag'ini `[qator][ustun] → matn/son` jadvaliga aylantiradi. */
export function readFirstSheet(buffer: ArrayBuffer): Map<number, Map<number, string | number>> {
  const zip = new PizZip(buffer);
  const parser = new DOMParser();

  const sharedXml = zip.file('xl/sharedStrings.xml')?.asText();
  const shared: string[] = sharedXml
    ? Array.from(parser.parseFromString(sharedXml, 'application/xml').getElementsByTagName('si')).map(textOf)
    : [];

  const sheetPath =
    Object.keys(zip.files)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))[0] ?? '';
  const sheetXml = sheetPath ? zip.file(sheetPath)?.asText() : undefined;
  if (!sheetXml) throw new Error('sheet');

  const rows = new Map<number, Map<number, string | number>>();
  const cells = parser.parseFromString(sheetXml, 'application/xml').getElementsByTagName('c');
  for (const cell of Array.from(cells)) {
    const ref = cell.getAttribute('r') ?? '';
    const rowNo = parseInt(ref.replace(/\D/g, ''), 10);
    if (!rowNo) continue;
    const type = cell.getAttribute('t');
    const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
    let value: string | number | undefined;
    if (type === 's') value = shared[parseInt(raw, 10)];
    else if (type === 'inlineStr') value = textOf(cell);
    else if (type === 'str') value = raw;
    else if (raw !== '' && Number.isFinite(Number(raw))) value = Number(raw);
    if (value === undefined || value === '') continue;
    const row = rows.get(rowNo) ?? new Map<number, string | number>();
    row.set(colIndex(ref), value);
    rows.set(rowNo, row);
  }
  return rows;
}

/** Filial bloklari: sarlavha qatori (A = filial, B.. = «N etab») + undagi kurs qatorlari. */
export function parsePriceSheet(rows: Map<number, Map<number, string | number>>): ParsedPrice[] {
  const result: ParsedPrice[] = [];
  let branchName = '';
  let stageCols: { col: number; stage: number }[] = [];

  for (const rowNo of Array.from(rows.keys()).sort((a, b) => a - b)) {
    const row = rows.get(rowNo)!;
    const first = String(row.get(0) ?? '').trim();

    const headerCols = Array.from(row.entries()).filter(
      ([col, value]) => col > 0 && typeof value === 'string' && STAGE_HEADER.test(value),
    );
    if (headerCols.length > 0) {
      branchName = first;
      stageCols = headerCols.map(([col, value], index) => ({
        col,
        stage: parseInt(String(value).replace(/\D/g, ''), 10) || index + 1,
      }));
      continue;
    }

    if (!branchName || !first) continue;
    for (const { col, stage } of stageCols) {
      const price = row.get(col);
      if (typeof price === 'number' && price > 0) {
        result.push({ excelRow: rowNo, branchName, courseName: first, stage, price });
      }
    }
  }
  return result;
}

// ── Nomlarni moslash (kirill/lotin, imlo farqlari) ────────────────────────────────────────────────────────────
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 's', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: '', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya', қ: 'k', ў: 'o', ғ: 'g', ҳ: 'h',
};

/** Qidirish uchun yagona ko'rinish: kichik harf, lotin, `x→h`, `q→k`, tinish belgilarsiz, filial/markaz so'zlarisiz. */
export function normalizeName(value: string): string {
  let s = value.toLowerCase();
  s = Array.from(s)
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join('');
  s = s
    .replace(/\b(filiali|filial|markazi|markaz|kursi|kurs)\b/g, ' ')
    .replace(/[xh]/g, 'h')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/[^a-z0-9]/g, '');
  return s;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

/** 0..1 — qanchalik o'xshash (1 = bir xil). */
export function similarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ratio = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // Biri ikkinchisini o'z ichiga olsa («arabtili» ⊂ «arabtilicefr») — bir xil emas, lekin yaqin.
  const contained = short.length >= 4 && long.includes(short) ? 0.7 + 0.25 * (short.length / long.length) : 0;
  return Math.max(ratio, contained);
}

export interface NamedOption {
  id: number;
  label: string;
}

/** Eng o'xshash variant (`min` dan past bo'lsa — topilmadi). */
export function bestMatch<T extends NamedOption>(name: string, options: T[], min: number): T | null {
  let best: T | null = null;
  let bestScore = min;
  for (const option of options) {
    const score = similarity(name, option.label);
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }
  return best;
}

/**
 * «N etab» → kursning N-darajasi: avval nomida shu raqam bor yagona daraja, bo'lmasa tartib bo'yicha N-daraja
 * (kursda bitta daraja bo'lsa — faqat 1-etab unga mos).
 */
export function guessLevel(levels: NamedOption[], stage: number): NamedOption | null {
  const sorted = [...levels].sort((a, b) => a.id - b.id);
  const withDigit = sorted.filter((l) => new RegExp(`(^|\\D)${stage}(\\D|$)`).test(l.label));
  if (withDigit.length === 1) return withDigit[0];
  return sorted[stage - 1] ?? null;
}
