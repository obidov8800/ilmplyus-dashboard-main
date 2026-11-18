import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { API } from '../../api/api';
import logoRaw from '../../assets/images/logo.svg?raw';
import type { Branch, CoursePrice, CoursePriceListResponse } from '../../types';

/**
 * Prays-list PDF — kurs narxlari sahifasidagi "Prays list" tugmasi uchun.
 *
 * PDF ga faqat TASDIQLANGAN narxlar tushadi va har bir filial + kurs + daraja
 * uchun ularning ENG OXIRGISI olinadi (`approved_at` bo'yicha, yo'q bo'lsa
 * `start_date` → `created_at`, teng bo'lsa katta `id`).
 *
 * Print oynasi ochilmaydi: DOM ekrandan tashqarida yig'iladi → html2canvas →
 * jsPDF → to'g'ridan-to'g'ri .pdf fayl yuklab olinadi.
 */

const MM_PER_PX = 25.4 / 96; // CSS px → mm (96 dpi)

const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const MARGIN_X_MM = 12;
const MARGIN_Y_MM = 12;

const CONTENT_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_X_MM * 2;
const CONTENT_HEIGHT_MM = PAGE_HEIGHT_MM - MARGIN_Y_MM * 2;
const CONTENT_WIDTH_PX = Math.round(CONTENT_WIDTH_MM / MM_PER_PX);
const CONTENT_HEIGHT_PX = Math.round(CONTENT_HEIGHT_MM / MM_PER_PX);

const ORANGE = '#ed7d31';
const ORANGE_BORDER = '#c55a11';
const NAVY = '#1f3864';
const SERIF = "'Times New Roman', Times, serif";

/** Bitta so'rovda olinadigan yozuvlar soni va himoya limiti (cheksiz sikl bo'lmasligi uchun). */
const PER_PAGE = 200;
const MAX_PAGES = 50;

const UZ_MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
];

/** `2026-yil 01-sentabr` ko'rinishi. */
function formatUzDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-yil ${day}-${UZ_MONTHS[d.getMonth()]}`;
}

/** `390000` → `390 000`. */
function formatMoney(val: string | number | null | undefined): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (n === null || n === undefined || isNaN(n)) return '—';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Prays-list hujjati o'zbek tilida — nomlar ham doim `*_uz` dan olinadi. */
function uzName(obj: { name_uz?: string } | null | undefined): string {
  const v = obj?.name_uz;
  return v && String(v).trim() !== '' ? String(v).trim() : '';
}

/**
 * Backend `status` bermasa (eski yozuvlar), tasdiqlanganlik `approved_at`/`approved_by`
 * bo'yicha aniqlanadi.
 */
function isApproved(row: CoursePrice): boolean {
  const status = (row.status ?? '').toLowerCase();
  if (status) return status === 'approved';
  return Boolean(row.approved_at || row.approved_by);
}

/** Qaysi yozuv "oxirgisi" ekanini aniqlash uchun vaqt. */
function approvalTime(row: CoursePrice): number {
  const raw = row.approved_at || row.start_date || row.created_at;
  const t = raw ? new Date(raw).getTime() : NaN;
  return isNaN(t) ? 0 : t;
}

/** Barcha sahifalarni ketma-ket yig'ib qaytaradi (jadval pagination bilan cheklangan). */
async function fetchAllCoursePrices(): Promise<CoursePrice[]> {
  const all: CoursePrice[] = [];
  let page = 1;
  let lastPage = 1;

  do {
    const { data } = await API.get<CoursePriceListResponse>('/course_prices', {
      params: { page, per_page: PER_PAGE },
    });
    all.push(...(data?.data ?? []));
    lastPage = data?.last_page ?? 1;
    page += 1;
  } while (page <= lastPage && page <= MAX_PAGES);

  return all;
}

export interface PriceListRow {
  title: string;
  price: string;
}

export interface PriceListBranchGroup {
  branch: Branch | null;
  branchName: string;
  rows: PriceListRow[];
}

/**
 * Tasdiqlangan narxlardan filial + kurs + daraja kesimida eng oxirgisini tanlab,
 * filiallar bo'yicha guruhlaydi.
 */
export function buildPriceListGroups(prices: CoursePrice[]): PriceListBranchGroup[] {
  const latest = new Map<string, CoursePrice>();

  for (const row of prices) {
    if (!isApproved(row)) continue;

    const key = `${row.branch_id}|${row.course_id}|${row.level_id}`;
    const prev = latest.get(key);
    if (!prev) {
      latest.set(key, row);
      continue;
    }

    const a = approvalTime(row);
    const b = approvalTime(prev);
    if (a > b || (a === b && row.id > prev.id)) latest.set(key, row);
  }

  const byBranch = new Map<number, { branch: Branch | null; items: CoursePrice[] }>();

  for (const row of latest.values()) {
    const bucket = byBranch.get(row.branch_id);
    if (bucket) bucket.items.push(row);
    else byBranch.set(row.branch_id, { branch: row.branch ?? null, items: [row] });
  }

  return Array.from(byBranch.values())
    .map(({ branch, items }) => {
      const rows = items
        .map((item) => {
          const course = uzName(item.course) || '—';
          const level = uzName(item.level);
          // Daraja kurs nomida allaqachon bo'lsa takrorlanmaydi ("Nemis tili A1" kabi).
          const title =
            level && !course.toLowerCase().includes(level.toLowerCase())
              ? `${course} (${level})`
              : course;
          return { title, price: formatMoney(item.new_price) };
        })
        .sort((a, b) => a.title.localeCompare(b.title, 'uz'));

      return { branch, branchName: uzName(branch) || '—', rows };
    })
    .sort((a, b) => a.branchName.localeCompare(b.branchName, 'uz'));
}

/* ------------------------------------------------------------------ DOM qismi */

const LOGO_DATA_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoRaw)}`;

function div(style: string, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Hujjat sarlavhasi: tasdiqlash bloki + logotip + "PRAYS-LIST" + filial nomi. */
function buildHeader(group: PriceListBranchGroup, today: Date): HTMLElement {
  const branch = group.branch;
  const wrap = div('width:100%;');

  const top = div('display:flex;align-items:flex-start;justify-content:space-between;gap:16px;');

  const approve = div(
    `flex:1;text-align:center;font-family:${SERIF};font-weight:bold;font-size:14px;line-height:1.45;color:#000;padding-top:6px;`,
  );
  approve.appendChild(div('', '“TASDIQLAYMAN”'));
  approve.appendChild(div('', `“${(branch?.legal_name || group.branchName).toUpperCase()}” NTM`));

  const signRow = div('display:flex;justify-content:center;gap:60px;');
  signRow.appendChild(div('', 'M.O’'));
  signRow.appendChild(div('', branch?.director_name || '____________'));
  approve.appendChild(signRow);

  approve.appendChild(div('', formatUzDate(today)));
  approve.appendChild(div('', branch?.city || ''));

  const logo = div('display:flex;align-items:center;gap:10px;padding-top:4px;');
  const img = document.createElement('img');
  img.src = LOGO_DATA_URI;
  img.width = 62;
  img.height = 62;
  img.style.cssText = 'width:62px;height:62px;display:block;';
  logo.appendChild(img);

  const logoText = div('display:flex;flex-direction:column;');
  logoText.appendChild(
    div(
      `font-family:Arial, Helvetica, sans-serif;font-weight:bold;font-size:30px;letter-spacing:1px;color:${NAVY};line-height:1;`,
      'ILM PLYUS',
    ),
  );
  logoText.appendChild(
    div(
      `font-family:Arial, Helvetica, sans-serif;font-weight:bold;font-size:13px;letter-spacing:4px;color:${NAVY};line-height:1;padding-top:6px;`,
      'O’QUV MARKAZI',
    ),
  );
  logo.appendChild(logoText);

  top.appendChild(approve);
  top.appendChild(logo);
  wrap.appendChild(top);

  wrap.appendChild(
    div(
      `text-align:center;font-family:${SERIF};font-weight:bold;font-size:22px;color:#000;padding:26px 0 8px;`,
      'PRAYS-LIST',
    ),
  );
  wrap.appendChild(
    div(
      `text-align:center;font-family:${SERIF};font-weight:bold;font-size:15px;color:#000;padding-bottom:14px;`,
      `${branch?.city ? `${branch.city} shahar ` : ''}“${group.branchName}”`,
    ),
  );

  return wrap;
}

const TH_STYLE =
  `background:${ORANGE};border:1px solid ${ORANGE_BORDER};font-family:${SERIF};font-weight:bold;` +
  'font-size:17px;color:#000;text-align:center;padding:8px 6px;';

function buildTable(): { table: HTMLTableElement; tbody: HTMLTableSectionElement } {
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;';

  const colgroup = document.createElement('colgroup');
  ['6%', '54%', '40%'].forEach((w) => {
    const col = document.createElement('col');
    col.style.width = w;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  ['№', 'Kurs nomi', 'Narx'].forEach((label) => {
    const th = document.createElement('th');
    th.style.cssText = TH_STYLE;
    th.textContent = label;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  return { table, tbody };
}

function buildRow(index: number, row: PriceListRow): HTMLTableRowElement {
  const tr = document.createElement('tr');

  const base = `border:1px solid ${ORANGE_BORDER};font-family:${SERIF};font-weight:bold;text-align:center;padding:5px 6px;color:#000;`;

  const num = document.createElement('td');
  num.style.cssText = `${base}font-size:13px;background:#fff;`;
  num.textContent = String(index);

  const name = document.createElement('td');
  name.style.cssText = `${base}font-size:16px;background:#fff;`;
  name.textContent = row.title;

  const price = document.createElement('td');
  price.style.cssText = `${base}font-size:16px;background:${ORANGE};`;
  price.textContent = row.price;

  tr.appendChild(num);
  tr.appendChild(name);
  tr.appendChild(price);
  return tr;
}

/**
 * Sahifalarni yig'adi: har bir filial yangi sahifadan boshlanadi, jadval
 * sig'masa qatorlar butunligicha keyingi sahifaga o'tadi (jadval sarlavhasi
 * takrorlanadi).
 */
function buildPages(
  stage: HTMLElement,
  groups: PriceListBranchGroup[],
  today: Date,
): HTMLElement[] {
  const pages: HTMLElement[] = [];

  const newPage = (): HTMLElement => {
    const page = div(
      `width:${CONTENT_WIDTH_PX}px;background:#fff;box-sizing:border-box;font-family:${SERIF};color:#000;`,
    );
    stage.appendChild(page);
    pages.push(page);
    return page;
  };

  for (const group of groups) {
    let page = newPage();
    page.appendChild(buildHeader(group, today));

    let { table, tbody } = buildTable();
    page.appendChild(table);

    group.rows.forEach((row, i) => {
      const tr = buildRow(i + 1, row);
      tbody.appendChild(tr);

      if (page.scrollHeight > CONTENT_HEIGHT_PX && tbody.childElementCount > 1) {
        tbody.removeChild(tr);
        page = newPage();
        ({ table, tbody } = buildTable());
        page.appendChild(table);
        tbody.appendChild(tr);
      }
    });
  }

  return pages;
}

/**
 * Tasdiqlangan (eng oxirgi) kurs narxlaridan prays-list PDF yasab, avtomatik
 * yuklab beradi. Ma'lumot topilmasa `false` qaytaradi.
 */
export async function downloadPriceListPdf(): Promise<boolean> {
  const prices = await fetchAllCoursePrices();
  const groups = buildPriceListGroups(prices).filter((g) => g.rows.length > 0);
  if (!groups.length) return false;

  const today = new Date();

  const stage = div(
    `position:fixed;left:-10000px;top:0;width:${CONTENT_WIDTH_PX}px;background:#fff;z-index:-1;`,
  );
  document.body.appendChild(stage);

  try {
    const pages = buildPages(stage, groups, today);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 0,
      });

      const imgHeightMm = Math.min(
        (canvas.height / canvas.width) * CONTENT_WIDTH_MM,
        CONTENT_HEIGHT_MM,
      );

      if (i > 0) pdf.addPage();
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.95),
        'JPEG',
        MARGIN_X_MM,
        MARGIN_Y_MM,
        CONTENT_WIDTH_MM,
        imgHeightMm,
      );
    }

    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`;
    pdf.save(`Prays-list_${stamp}.pdf`);
    return true;
  } finally {
    document.body.removeChild(stage);
  }
}
