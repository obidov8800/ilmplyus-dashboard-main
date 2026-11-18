import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTableColumns } from '../../hooks/useTableColumns';
import PaginationBar from '@/components/Pagination/PaginationBar';
import { API } from '@/api/api';
import { useFeaturePermission } from '@/hooks/usePermission';
import { fetchLids } from '@/pages/lid/lid.service';
import { useDataVersion } from '@/utils/dataSync';
import useAuthStore from '@/store/useAuthStore';
import './ipTelephone.css';
import { useSip } from './useSip';
import { CallStatusBadge, CallStatusLegend } from './callStatus';
import { useDuplicateSipTabs } from './useDuplicateSipTabs';

interface CallRecord {
  vaqt: string;
  raqam: string;
  davomiyligi: number;
  operator: string;
  /**
   * Asterisk disposition'i. Ilgari bu yerda uchta qiymat sanab o'tilgan
   * edi, PBX esa `BUSY` ham yuboradi (va nazariy jihatdan `CONGESTION`) —
   * shu sabab jadvalda tanilmagan holat rangsiz belgi bo'lib chiqardi.
   */
  status: string;
  baho: string;
  recordingfile: string;
  /**
   * Faqat `collapseCallLegs` natijasida bo'ladi: qo'ng'iroq nechta CDR qatordan
   * (oyoqdan) yig'ilgan. PBX javobida bu maydon yo'q.
   */
  legs?: number;
}

interface HistoryResponse {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  data: CallRecord[];
}

const BASE_URL = 'https://mainoffice.uz:8181';

/** Bitta so'rovda olinadigan yozuvlar soni. */
const HISTORY_PAGE_SIZE = 1000;
/**
 * Bir vaqtda parallel so'raladigan sahifalar. Gateway javobida jami son YO'Q,
 * shu sabab sahifalar guruh-guruh (oldindan, taxminan) so'raladi.
 */
const HISTORY_PARALLEL_PAGES = 4;
/** Himoya chegarasi — tarix o'sib ketsa ham cheksiz so'rov yuborilmasin. */
const HISTORY_MAX_PAGES = 10;

/**
 * Qo'ng'iroq tugagach olinadigan oxirgi qatorlar soni. Bitta qo'ng'iroq o'nlab
 * oyoqdan (jiringlash urinishlaridan) iborat bo'lishi mumkin, shu sabab oyna u
 * butunlay sig'adigan darajada katta: kichik oyna qo'ng'iroqni o'rtasidan kesib,
 * holatini noto'g'ri ko'rsatardi (masalan, javob berilganini "javobsiz").
 */
const HISTORY_LATEST_WINDOW = 200;

// ── Bitta qo'ng'iroq = bitta qator ──────────────────────────────────────────
// (User ilovasidagi `ip-telephone/callRecord.ts` bilan bir xil mantiq.)
// PBX (Asterisk CDR) har bir "oyoq"ni (leg) alohida yozuv qilib beradi: kiruvchi
// qo'ng'iroq ichki raqam(lar)ga yo'naltirilganda har bir jiringlash urinishi va
// har bir qurilma uchun alohida qator tushadi (FAILED / NO ANSWER / ANSWERED).
// Bitta qo'ng'iroqning hamma oyoqlari BIR XIL yozuv fayli nomiga ega (nomida
// Asterisk uniqueid bor), shu sabab shu nom qo'ng'iroqning o'zini bildiradi.
// Birlashtirmasdan jadvalda bitta qo'ng'iroq 4–60 marta takrorlanib chiqardi.
// Chiquvchi qo'ng'iroqlar doim bitta qatordan iborat — ularga ta'sir qilmaydi.

/** Bitta qo'ng'iroqning barcha oyoqlari uchun umumiy kalit. */
const recordKey = (r: CallRecord) => r.recordingfile || `${r.vaqt}|${r.raqam}|${r.operator}`;

/**
 * Holat ustuvorligi — qo'ng'iroq natijasini uning ENG yaxshi oyog'i belgilaydi:
 * birontasi javob bergan bo'lsa "javob berildi"; hech kim javob bermagan bo'lsa
 * "javobsiz" (jiringlagan, lekin olinmagan); qolgan oyoqlar (FAILED) — ulanmagan
 * qurilmalar shovqini, ular natijani buzmasligi kerak.
 */
const STATUS_RANK: Record<string, number> = { ANSWERED: 4, 'NO ANSWER': 3, BUSY: 2, FAILED: 1 };
const statusRank = (s: string): number => STATUS_RANK[s] ?? 0;
const durationOf = (r: CallRecord): number => Number(r.davomiyligi) || 0;

/** Yangisi birinchi. PBX `vaqt` formati qat'iy ("YYYY-MM-DDTHH:MM:SS"), satr taqqoslash yetadi. */
const byStartDesc = (a: CallRecord, b: CallRecord): number =>
  a.vaqt < b.vaqt ? 1 : a.vaqt > b.vaqt ? -1 : 0;

/**
 * Kiruvchi qo'ng'iroqlar avval tushadigan ichki raqam (guruh/navbat) — odam
 * emas: har bir kiruvchi qo'ng'iroqda unga jiringlash urinishlari (FAILED /
 * NO ANSWER) yoziladi va u hech qachon chiquvchi qo'ng'iroq qilmaydi. Haqiqiy
 * operator — shu qo'ng'iroqqa undan keyin javob bergan boshqa ichki raqam.
 * Faqat shu raqamning o'zi javob bergan qo'ng'iroq (hech bir operator ulanmagan —
 * avtojavob/ovozli xabar) operatorsiz hisoblanadi.
 */
const INBOUND_GROUP_EXT = '1000';

/**
 * Kiruvchi qo'ng'iroqqa javob bergan operatorning ichki raqami.
 *
 * Javob berilganda CDR'da odatda ikkita ANSWERED oyoq bo'ladi: guruh
 * (`INBOUND_GROUP_EXT`, butun suhbat davomiyligi bilan) va unga ulangan haqiqiy
 * operator (qisqa oyoq). Operator sifatida guruhdan BOSHQA ichki raqam olinadi
 * (bir nechta bo'lsa — eng uzun oyoqniki); topilmasa `null` (qo'ng'iroqqa guruhning
 * o'zi javob bergan — oyoqdagi raqam o'zgarishsiz qoladi).
 */
function answeringExt(group: CallRecord[]): string | null {
  let found: CallRecord | null = null;
  for (const leg of group) {
    if (leg.status !== 'ANSWERED') continue;
    // mijoz -> ichki raqam oyog'i (masalan `LC-1001` kabi ichki kanal oyoqlari emas)
    if (isOperatorNumber(leg.raqam) || !isOperatorNumber(leg.operator)) continue;
    if (leg.operator === INBOUND_GROUP_EXT || leg.operator === MAIN_TRUNK) continue;
    if (!found || durationOf(leg) > durationOf(found)) found = leg;
  }
  return found ? found.operator : null;
}

/**
 * CDR qatorlarini (oyoqlarni) qo'ng'iroqlarga birlashtiradi.
 *
 * - qo'ng'iroq vaqti — oyoqlarning ENG ERTA vaqti (qo'ng'iroq boshlangan payt;
 *   yozuv fayli nomidagi vaqt bilan mos);
 * - holat — eng yaxshi oyoqniki (`STATUS_RANK`);
 * - davomiyligi va qolgan maydonlar — o'sha holatdagi eng uzun oyoqdan (javob
 *   berilganda bu haqiqiy suhbat davomiyligi);
 * - javob berilgan KIRUVCHI qo'ng'iroqda `operator` — javob bergan operatorning
 *   ichki raqami (`answeringExt`), qolgan hollarda tanlangan oyoqniki;
 * - natija yangi qo'ng'iroqdan eskisiga tartiblanadi.
 */
function collapseCallLegs(legs: CallRecord[]): CallRecord[] {
  const groups = new Map<string, CallRecord[]>();
  for (const leg of legs) {
    const key = recordKey(leg);
    const group = groups.get(key);
    if (group) group.push(leg);
    else groups.set(key, [leg]);
  }

  const calls: CallRecord[] = [];
  for (const group of groups.values()) {
    let best = group[0];
    let start = group[0].vaqt;
    for (let i = 1; i < group.length; i++) {
      const leg = group[i];
      if (leg.vaqt < start) start = leg.vaqt;
      const byStatus = statusRank(leg.status) - statusRank(best.status);
      if (byStatus > 0 || (byStatus === 0 && durationOf(leg) > durationOf(best))) best = leg;
    }
    const answeredBy =
      best.status === 'ANSWERED' && getCallInfo(best).direction === 'in' ? answeringExt(group) : null;
    calls.push({
      ...best,
      ...(answeredBy ? { operator: answeredBy } : null),
      vaqt: start,
      legs: group.length,
    });
  }
  return calls.sort(byStartDesc);
}

/**
 * Mavjud qo'ng'iroqlar ro'yxatiga (`prev`) yangi olingan, ALLAQACHON birlashtirilgan
 * qo'ng'iroqlarni (`incoming`) qo'shadi.
 *
 * - yangi qo'ng'iroq (kaliti ro'yxatda yo'q) — qo'shiladi;
 * - ro'yxatdagi qo'ng'iroq — faqat yangi variantda oyoqlar KO'PROQ bo'lsa
 *   almashtiriladi (CDR oyoqlari bir necha soniya kechikib tushishi mumkin).
 *   Oxirgi qatorlar oynasi eski qo'ng'iroqni o'rtasidan kesib qo'yishi mumkin —
 *   unda oyoq KAMROQ bo'ladi va to'liq variant saqlanib qoladi;
 * - hech narsa o'zgarmasa, o'sha `prev` massivi qaytadi (ortiqcha render yo'q).
 */
function mergeCalls(prev: CallRecord[], incoming: CallRecord[]): CallRecord[] {
  if (!incoming.length) return prev;

  const indexByKey = new Map<string, number>();
  prev.forEach((r, i) => indexByKey.set(recordKey(r), i));

  let replaced: CallRecord[] | null = null;
  const added: CallRecord[] = [];
  for (const call of incoming) {
    const i = indexByKey.get(recordKey(call));
    if (i === undefined) {
      added.push(call);
    } else if ((call.legs ?? 1) > (prev[i].legs ?? 1)) {
      replaced ??= prev.slice();
      replaced[i] = call;
    }
  }
  if (!added.length && !replaced) return prev;
  return [...added, ...(replaced ?? prev)].sort(byStartDesc);
}

/** PBXdan yangi olingan OXIRGI qatorlarni (oyoqlarni) birlashtirib, ro'yxatga qo'shadi. */
function mergeLatestCalls(prev: CallRecord[], latestLegs: CallRecord[]): CallRecord[] {
  return mergeCalls(prev, collapseCallLegs(latestLegs));
}

/** Bitta sahifa; tarmoq xatosida bir marta qayta uriniladi. `null` — olinmadi. */
async function fetchHistoryPage(page: number, limit: number): Promise<CallRecord[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/history?limit=${limit}&page=${page}`);
      if (!res.ok) continue;
      const json = (await res.json()) as HistoryResponse;
      if (Array.isArray(json?.data)) return json.data;
    } catch {
      /* qayta uriniladi */
    }
  }
  return null;
}

/**
 * Butun qo'ng'iroqlar tarixini yuklaydi.
 *
 * Gateway javobida `total` va `totalPages` YO'Q — faqat `page`, `limit`, `data`.
 * Shu sabab jami sonni bilishning yagona yo'li sahifalarni oxirigacha o'qish.
 * Yozuvlar yengil (~3000 ta ≈ 650 KB), shuning uchun hammasi bir marta olinadi:
 * "Jami" aniq chiqadi, filtr va sahifalash butun tarix bo'yicha ishlaydi.
 *
 * Sahifalar ketma-ket emas, guruh-guruh PARALLEL so'raladi (jami son noma'lum,
 * shu sabab oldindan, taxminan): ketma-ket kutish har sahifa uchun alohida server
 * vaqtini qo'shardi (4 sahifa ≈ 1,8 s o'rniga ≈ 0,5 s).
 *
 * PBX har bir qo'ng'iroq uchun bir nechta CDR qatorini (oyoqni) qaytaradi —
 * ular barcha sahifalar o'qilgach `collapseCallLegs` bilan bitta qo'ng'iroqqa
 * birlashtiriladi (oyoqlar sahifa chegarasida bo'linib qolishi mumkin, shu
 * sabab birlashtirish eng oxirida bajariladi).
 */
async function fetchAllHistory(): Promise<CallRecord[]> {
  const legs: CallRecord[] = [];
  for (let first = 1; first <= HISTORY_MAX_PAGES; first += HISTORY_PARALLEL_PAGES) {
    const pages = Array.from(
      { length: Math.min(HISTORY_PARALLEL_PAGES, HISTORY_MAX_PAGES - first + 1) },
      (_, i) => first + i,
    );
    const chunks = await Promise.all(pages.map((p) => fetchHistoryPage(p, HISTORY_PAGE_SIZE)));

    // Sahifalar tartibida qo'shiladi; birinchi xato yoki to'lmagan sahifadan keyin
    // to'xtaymiz — aks holda tarixda "teshik" qolardi.
    let more = true;
    for (const chunk of chunks) {
      if (!chunk) {
        more = false;
        break;
      }
      legs.push(...chunk);
      if (chunk.length < HISTORY_PAGE_SIZE) {
        more = false;
        break;
      }
    }
    if (!more) break;
  }
  return collapseCallLegs(legs);
}

function formatDuration(sec: number): string {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// PBX (`mainoffice.uz`) qo'ng'iroq vaqtini zona belgisisiz qaytaradi
// (masalan "2026-08-24T13:24:00") — bu UTC EMAS, serverning o'z (Toshkent)
// devor vaqti, chunki PBX mahalliy qurilma, bulutdagi UTC xizmat emas.
// Shu sabab `new Date(iso)` + `timeZone: 'Asia/Tashkent'` orqali formatlash
// XATO edi: brauzer bu satrni o'zining mahalliy zonasida deb o'qiydi, so'ng
// Toshkentga qayta aylantirilganda vaqt ikkinchi marta suriladi (masalan
// brauzer/server UTC bo'lsa, haqiqiy 13:24 → 18:24 bo'lib ko'rinadi).
// To'g'ri yo'l — raqamlarni `Date`dan umuman o'tkazmasdan, to'g'ridan-to'g'ri
// satrning o'zidan olish: qaysi qurilmadan ko'rilishidan qat'i nazar bir xil.
function formatDateTime(iso: string): string {
  if (!iso) return '-';
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    return `${hour}:${minute} ${day}.${month}.${year}`;
  }
  // Kutilmagan format uchun zaxira — hech bo'lmasa nimadir ko'rsatiladi.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const time = d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString('ru-RU');
  return `${time} ${date}`;
}

interface IpTelefonOperator {
  id: number;
  user_id: number;
  login: number;
  branch?: { id: number; name_uz?: string; name_ru?: string; name_en?: string };
  user?: { id: number; full_name: string; username: string; phone: string };
  filial?: string;
  name?: string;
  /**
   * `GET /ip-telefon-operators/{id}/contacts` qaytaradi 405 — alohida ro'yxat
   * endpointi yo'q. Kontaktlar ro'yxati operatorning shu maydonida,
   * `/ip-telefon-operators` javobining ICHIDA keladi.
   */
  contacts?: IpTelefonContact[];
}

/** Operatorning o'zi oldindan saqlab qo'ygan tashqi raqam (tezkor yo'naltirish uchun). */
interface IpTelefonContact {
  id: number;
  name: string;
  phone: string;
}

interface CallModalProps {
  initialNumber: string;
  onCall: (number: string) => void;
  onHangup: () => void;
  onMute: (muted: boolean) => void;
  onHold: (held: boolean) => Promise<void>;
  onSendDtmf: (tone: string) => void;
  onAnswer: () => Promise<void>;
  callState: string;
  elapsed: number;
  onClose: () => void;
  onBlindTransfer: (ext: string) => Promise<void>;
  onAttendedTransfer: (ext: string) => Promise<void>;
  operators: IpTelefonOperator[];
  /** Joriy operatorning oldindan saqlangan tashqi raqamlari — shu yerning
   *  o'zida (Kontaktlar tabida) qo'shiladi/tahrirlanadi/o'chiriladi. */
  contacts: IpTelefonContact[];
  contactsLoading: boolean;
  hasOwnOperator: boolean;
  contactForm: { name: string; phone: string };
  onContactFormChange: (updater: (prev: { name: string; phone: string }) => { name: string; phone: string }) => void;
  editingContactId: number | null;
  onContactSubmit: (e: React.FormEvent) => void;
  onContactEdit: (c: IpTelefonContact) => void;
  onContactCancelEdit: () => void;
  onContactDelete: (id: number) => void;
}

const DIALPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

const CallModal: React.FC<CallModalProps> = ({
  initialNumber,
  onCall,
  onHangup,
  onMute,
  onHold,
  onSendDtmf,
  onAnswer,
  callState,
  elapsed,
  onClose,
  onBlindTransfer,
  onAttendedTransfer,
  operators,
  contacts,
  contactsLoading,
  hasOwnOperator,
  contactForm,
  onContactFormChange,
  editingContactId,
  onContactSubmit,
  onContactEdit,
  onContactCancelEdit,
  onContactDelete,
}) => {
  const { t } = useTranslation();
  const [number, setNumber] = useState(initialNumber);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [showDialpad, setShowDialpad] = useState(true);
  const [showDrawer, setShowDrawer] = useState(false);
  const [transferMode, setTransferMode] = useState<'direct' | 'hold'>('direct');
  const [drawerTab, setDrawerTab] = useState<'operators' | 'contacts'>('operators');
  const [showAddContact, setShowAddContact] = useState(false);
  const [selectedOpId, setSelectedOpId] = useState<number | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const keyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // FIX: answering state - javob berish jarayonida tugmani ikki marta bosilishini oldini olish
  const [isAnswering, setIsAnswering] = useState(false);

  const isInCall = callState === 'active' || callState === 'connecting';
  const isIncoming = callState === 'ringing';

  useEffect(() => {
    setNumber(initialNumber);
  }, [initialNumber]);

  useEffect(() => {
    if (isInCall || isIncoming) setShowDialpad(false);
    else {
      setShowDialpad(true);
      setShowDrawer(false);
      setSelectedOpId(null);
      setMuted(false);
      setHeld(false);
      // FIX: State tozalash
      setIsAnswering(false);
    }
  }, [isInCall, isIncoming]);

  const pressKey = (k: string) => {
    if (isInCall) onSendDtmf(k);
    setNumber((v) => v + k);
    activateKey(k);
  };

  const backspace = () => {
    setNumber((v) => v.slice(0, -1));
    activateKey('Backspace');
  };

  const activateKey = (k: string) => {
    setActiveKey(k);
    if (keyTimeoutRef.current) clearTimeout(keyTimeoutRef.current);
    keyTimeoutRef.current = setTimeout(() => setActiveKey(null), 150);
  };

  const toggleHold = async () => {
    const n = !held;
    setHeld(n);
    await onHold(n);
  };

  const toggleMute = () => {
    const n = !muted;
    setMuted(n);
    onMute(n);
  };

  // FIX: Keyboard handler - stale closure muammosini hal qilish
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Modal ichida input focused bo'lsa ignore
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target !== document.activeElement) return;

      if (/^[\d*#]$/.test(e.key)) {
        e.preventDefault();
        pressKey(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter' && number.length > 0 && callState === 'idle') {
        e.preventDefault();
        onCall(number);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [callState, number]); // eslint-disable-line react-hooks/exhaustive-deps

  // FIX: Answer handler - loading state bilan
  const handleAnswer = async () => {
    if (isAnswering) return;
    setIsAnswering(true);
    try {
      await onAnswer();
    } catch (err) {
      console.error('Answer error in modal:', err);
      setIsAnswering(false);
    }
    // Note: isAnswering state ni callState o'zgarganda useEffect tozalaydi
  };

  const handleOperatorClick = async (op: IpTelefonOperator) => {
    setSelectedOpId(op.id);
    const ext = String(op.login);
    if (transferMode === 'direct') await onBlindTransfer(ext);
    else await onAttendedTransfer(ext);
  };

  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);

  const handleContactClick = async (contact: IpTelefonContact) => {
    setSelectedContactId(contact.id);
    // Kontaktlar (tashqi raqamlar) uchun faqat kutib yo'naltirish (attended) —
    // to'g'ridan-to'g'ri (blind) endi faqat ichki operatorlarga xos.
    await onAttendedTransfer(contact.phone);
  };

  const elapsed_m = Math.floor(elapsed / 60);
  const elapsed_s = (elapsed % 60).toString().padStart(2, '0');

  if (minimized && (isInCall || isIncoming)) {
    return (
      <div className="ipt-minimized-bar">
        <div className="ipt-min-info">
          <div className="ipt-min-number">
            <i
              className="fas fa-phone-alt"
              style={{ marginRight: '10px', fontSize: '14px', opacity: 0.8 }}
            />
            {number || initialNumber}
          </div>
          <div className="ipt-min-timer">
            <span className="ipt-timer-dot" />
            {elapsed_m}:{elapsed_s}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button
            onClick={toggleMute}
            className="ipt-tg-btn"
            title={muted ? t('ipTelephone.muteOff') : t('ipTelephone.muteOn')}
          >
            <i
              className={`fas ${muted ? 'fa-microphone-slash' : 'fa-microphone'}`}
              style={{ color: muted ? '#E70A0A' : '#fff' }}
            />
          </button>

          <button
            onClick={() => setMinimized(false)}
            className="ipt-tg-btn"
            title={t('ipTelephone.maximize')}
          >
            <i className="fas fa-expand-alt" />
          </button>

          <button
            onClick={onHangup}
            className="ipt-btn-hangup"
            style={{
              borderRadius: '6px',
              height: '32px',
              padding: '0 15px',
              width: 'auto',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <i className="fas fa-phone-slash" />
            {t('ipTelephone.end')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ipt-modal-overlay">
      <div className="ipt-modal-wrapper" style={{ width: showDrawer ? '680px' : '380px' }}>
        {/* ── LEFT PANEL ── */}
        <div className="ipt-unified-modal">
          {/* Header Buttons (Telegram Style) */}
          <div className="ipt-tg-header">
            <button
              onClick={() => setMinimized(true)}
              className="ipt-tg-btn"
              title={t('ipTelephone.minimize')}
            >
              <i className="fas fa-minus" />
            </button>
            <button onClick={onClose} className="ipt-tg-btn" title={t('ipTelephone.close')}>
              <i className="fas fa-times" />
            </button>
          </div>

          {/* ── ACTIVE CALL VIEW ── */}
          {isInCall || isIncoming ? (
            <div
              className="ipt-unified-modal"
              style={{ padding: 0, minHeight: 'auto', width: '100%' }}
            >
              <div className="ipt-avatar-circle">
                <i className="fa-solid fa-user" />
              </div>
              <div className="ipt-call-number">{number || initialNumber}</div>

              {callState === 'active' && (
                <div className="ipt-call-timer">
                  <span className="ipt-timer-dot" />
                  <span className="ipt-timer-text">
                    {elapsed_m}:{elapsed_s}
                  </span>
                </div>
              )}
              {isIncoming && (
                <div className="ipt-timer-text" style={{ fontSize: '14px', opacity: 0.7 }}>
                  {t('ipTelephone.incoming')}
                </div>
              )}
              {callState === 'connecting' && (
                <div className="ipt-timer-text" style={{ fontSize: '14px', opacity: 0.7 }}>
                  {t('ipTelephone.connecting')}
                </div>
              )}
            </div>
          ) : (
            /* ── DIALPAD VIEW ── */
            <>
              <div
                style={{
                  width: '160px',
                  background: 'rgba(255,255,255,0.3)',
                  marginBottom: '20px',
                  borderRadius: '2px',
                }}
              />
              <div className="ipt-dial-input-area">
                <span className="ipt-dial-display">
                  {number || t('ipTelephone.dialpadPlaceholder')}
                </span>
                <button
                  onClick={backspace}
                  disabled={!number}
                  className={`ipt-backspace-btn ${activeKey === 'Backspace' ? 'active' : ''}`}
                >
                  <i className="fa-solid fa-delete-left" />
                </button>
              </div>

              {showDialpad && (
                <div className="ipt-dial-grid">
                  {DIALPAD_KEYS.map((k) => (
                    <button
                      key={k}
                      onClick={() => pressKey(k)}
                      className={`ipt-dial-key ${activeKey === k ? 'active' : ''}`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── BUTTON ROW ── */}
          <div className="ipt-action-row">
            <button
              onClick={toggleHold}
              disabled={callState !== 'active'}
              className={`ipt-round-btn ipt-btn-hold`}
              title={t('ipTelephone.hold')}
            >
              <i className={`fas ${held ? 'fa-play' : 'fa-pause'}`} />
            </button>

            <button
              onClick={toggleMute}
              disabled={callState !== 'active'}
              className={`ipt-round-btn ipt-btn-mute`}
              title={muted ? t('ipTelephone.muteOff') : t('ipTelephone.muteOn')}
            >
              <i className={`fas ${muted ? 'fa-microphone-slash' : 'fa-microphone'}`} />
            </button>

            {/* Yo'naltirish - active qo'ng'iroqlarda ko'rinadigan */}
            <button
              onClick={() => setShowDrawer((v) => !v)}
              disabled={callState !== 'active'}
              className={`ipt-round-btn ipt-btn-share`}
              title={t('ipTelephone.transfer')}
            >
              <i className="fa-solid fa-share" />
            </button>

            {/* FIX: Cancel/Hangup - barcha holatlarda ishlaydi */}
            <button
              onClick={callState !== 'idle' ? onHangup : onClose}
              className="ipt-round-btn ipt-btn-hangup"
              title={callState !== 'idle' ? t('ipTelephone.hangup') : t('ipTelephone.close')}
              style={{ cursor: 'pointer' }}
            >
              <i className={`fas ${callState !== 'idle' ? 'fa-phone-slash' : 'fa-times'}`} />
            </button>

            {/* FIX: Answer/Call tugmasi - to'g'ri disable logikasi */}
            <button
              disabled={
                isAnswering ||
                callState === 'active' ||
                callState === 'connecting' ||
                (callState === 'idle' && !number)
              }
              onClick={() => {
                if (callState === 'ringing') {
                  handleAnswer();
                } else if (callState === 'idle' && number) {
                  onCall(number);
                }
              }}
              className="ipt-round-btn ipt-btn-answer"
              title={
                callState === 'ringing'
                  ? isAnswering
                    ? t('ipTelephone.connecting')
                    : t('ipTelephone.answer')
                  : t('ipTelephone.callBtn')
              }
              style={{ cursor: 'pointer' }}
            >
              {isAnswering ? (
                <i className="fas fa-spinner fa-spin" />
              ) : (
                <i className="fas fa-phone-alt" />
              )}
            </button>

            <button
              onClick={() => setShowDialpad((v) => !v)}
              className={`ipt-round-btn ipt-btn-dialpad`}
              title={t('ipTelephone.dialpad')}
            >
              <i className="fas fa-th" />
            </button>
          </div>
        </div>

        {/* ── RIGHT DRAWER ── */}
        {showDrawer && (
          <div className="ipt-right-drawer">
            {/* To'g'ridan-to'g'ri (blind) yo'naltirish faqat ICHKI operatorlar
                uchun qoldi — tashqi raqam (Kontaktlar) uchun endi faqat
                kutib yo'naltirish (attended) bor, shuning uchun bu tanlov
                Operatorlar tabida ko'rinadi, Kontaktlar tabida yo'q. */}
            {drawerTab === 'operators' && (
              <div className="ipt-mode-tabs">
                {(['direct', 'hold'] as const).map((mode) => {
                  const active = transferMode === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => setTransferMode(mode)}
                      className={`ipt-mode-btn ${active ? 'active' : ''}`}
                    >
                      {mode === 'direct'
                        ? t('ipTelephone.transferDirect')
                        : t('ipTelephone.transferHold')}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Operatorlar / Kontaktlar — kimga yo'naltirilishini tanlash
                HAMDA (Kontaktlar tabida) kontaktlarni shu yerning o'zida
                qo'shish/tahrirlash/o'chirish. */}
            <div className="ipt-mode-tabs" style={{ position: 'relative' }}>
              {(['operators', 'contacts'] as const).map((tab) => {
                const active = drawerTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setDrawerTab(tab)}
                    className={`ipt-mode-btn ${active ? 'active' : ''}`}
                  >
                    {tab === 'operators'
                      ? t('ipTelephone.tabOperators', 'Operatorlar')
                      : t('ipTelephone.tabContacts', 'Kontaktlar')}
                  </button>
                );
              })}
              {drawerTab === 'contacts' && hasOwnOperator && (
                <button
                  type="button"
                  onClick={() => {
                    if (showAddContact) onContactCancelEdit();
                    setShowAddContact((v) => !v);
                  }}
                  title={t('ipTelephone.addContact', 'Kontakt qo‘shish')}
                  style={{
                    marginLeft: 'auto',
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: 'none',
                    background: showAddContact ? '#e2e8f0' : '#FE9100',
                    color: showAddContact ? '#334155' : '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <i className={`fa-solid ${showAddContact ? 'fa-xmark' : 'fa-plus'}`} />
                </button>
              )}
            </div>

            {drawerTab === 'contacts' && showAddContact && (
              <form
                onSubmit={(e) => {
                  onContactSubmit(e);
                  setShowAddContact(false);
                }}
                style={{ display: 'flex', gap: 8, padding: '0 16px 12px', flexWrap: 'wrap' }}
              >
                <input
                  type="text"
                  placeholder={t('ipTelephone.contactNamePlaceholder', 'Ism')}
                  value={contactForm.name}
                  onChange={(e) => onContactFormChange((p) => ({ ...p, name: e.target.value }))}
                  style={{ flex: 1, minWidth: 100, padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd' }}
                  required
                />
                <input
                  type="tel"
                  placeholder={t('ipTelephone.contactPhonePlaceholder', 'Telefon raqam')}
                  value={contactForm.phone}
                  onChange={(e) =>
                    onContactFormChange((p) => ({ ...p, phone: e.target.value.replace(/[^\d+]/g, '') }))
                  }
                  style={{ flex: 1, minWidth: 100, padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd' }}
                  required
                />
                <button type="submit" className="ipt-call-btn" style={{ padding: '6px 14px' }}>
                  {editingContactId ? t('common.save', 'Saqlash') : t('users.addNew', 'Qo‘shish')}
                </button>
              </form>
            )}

            <div
              style={{
                height: '1px',
                background: 'rgba(0,0,0,0.05)',
                margin: '0 16px',
              }}
            />

            {drawerTab === 'operators' ? (
              <div className="ipt-operator-list">
                {operators.length === 0 ? (
                  <div
                    style={{
                      padding: '20px',
                      textAlign: 'center',
                      color: '#999',
                      fontSize: '13px',
                    }}
                  >
                    {t('ipTelephone.noOperators')}
                  </div>
                ) : (
                  operators.map((op) => {
                    const selected = selectedOpId === op.id;
                    return (
                      <div
                        key={op.id}
                        onClick={() => handleOperatorClick(op)}
                        className="ipt-operator-item"
                        style={{ background: selected ? '#FE9100' : '' }}
                      >
                        <div>
                          <div className="ipt-op-login" style={{ color: selected ? '#fff' : '' }}>
                            {op.branch?.name_uz || op.filial || t('ipTelephone.branchDefault')}
                          </div>
                          <div className="ipt-op-name" style={{ color: selected ? '#fff' : '' }}>
                            {op.user?.full_name
                              ? op.user.full_name
                              : op.name || 'Operator'}
                          </div>
                        </div>
                        <div
                          className="ipt-op-login"
                          style={{
                            fontSize: '18px',
                            color: selected ? '#fff' : '#003366',
                            fontWeight: 'bold',
                          }}
                        >
                          {op.login}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="ipt-operator-list">
                {contactsLoading ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '13px' }}>
                    <i className="fas fa-spinner fa-spin" /> {t('ipTelephone.loading')}
                  </div>
                ) : contacts.length === 0 ? (
                  <div
                    style={{
                      padding: '20px',
                      textAlign: 'center',
                      color: '#999',
                      fontSize: '13px',
                    }}
                  >
                    {t('ipTelephone.noContacts', 'Kontaktlar yo‘q')}
                  </div>
                ) : (
                  contacts.map((c) => {
                    const selected = selectedContactId === c.id;
                    return (
                      <div
                        key={c.id}
                        onClick={() => handleContactClick(c)}
                        className="ipt-operator-item"
                        style={{
                          background: selected ? '#FE9100' : '',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div>
                          <div className="ipt-op-name" style={{ color: selected ? '#fff' : '' }}>
                            {c.name}
                          </div>
                          <div
                            className="ipt-op-login"
                            style={{
                              fontSize: '13px',
                              color: selected ? '#fff' : '#003366',
                              fontWeight: 'bold',
                            }}
                          >
                            {c.phone}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onContactEdit(c);
                              setShowAddContact(true);
                            }}
                            title={t('common.edit', 'Tahrirlash')}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: '50%',
                              border: 'none',
                              background: selected ? 'rgba(255,255,255,0.3)' : '#eef2f7',
                              color: selected ? '#fff' : '#334155',
                              cursor: 'pointer',
                            }}
                          >
                            <i className="fa-solid fa-pen" style={{ fontSize: 11 }} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onContactDelete(c.id);
                            }}
                            title={t('common.delete', 'O‘chirish')}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: '50%',
                              border: 'none',
                              background: selected ? 'rgba(255,255,255,0.3)' : '#fee2e2',
                              color: selected ? '#fff' : '#dc2626',
                              cursor: 'pointer',
                            }}
                          >
                            <i className="fa-solid fa-trash" style={{ fontSize: 11 }} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface AudioPlayerProps {
  filename: string;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ filename }) => {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const fetchAndPlay = useCallback(async () => {
    if (audioUrl) {
      const audio = audioRef.current!;
      if (playing) {
        audio.pause();
        setPlaying(false);
      } else {
        window.dispatchEvent(new CustomEvent('stopAllAudio', { detail: filename }));
        audio.play();
        setPlaying(true);
      }
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/v1/get_link/${filename}`);
      const json = await res.json();

      let url: string =
        json.download_url || json.url || json.link || json.file_url || json.path || '';

      if (url.startsWith('/')) {
        url = `${BASE_URL}${url}`;
      }

      if (!url) {
        throw new Error('Audio URL topilmadi');
      }

      setAudioUrl(url);
    } catch {
      setLoading(false);
    }
  }, [audioUrl, playing, filename]);

  useEffect(() => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
      setLoading(false);
    });
    audio.addEventListener('timeupdate', () => {
      setProgress(audio.currentTime / audio.duration || 0);
    });
    audio.addEventListener('ended', () => {
      setPlaying(false);
      setProgress(0);
    });
    audio
      .play()
      .then(() => {
        window.dispatchEvent(new CustomEvent('stopAllAudio', { detail: filename }));
        setPlaying(true);
      })
      .catch(() => setLoading(false));

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audioUrl, filename]);

  useEffect(() => {
    const handleStopOtherAudio = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail !== filename) {
        if (audioRef.current && playing) {
          audioRef.current.pause();
          setPlaying(false);
        }
      }
    };

    window.addEventListener('stopAllAudio', handleStopOtherAudio);
    return () => window.removeEventListener('stopAllAudio', handleStopOtherAudio);
  }, [playing, filename]);

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setProgress(val);
    if (audioRef.current) audioRef.current.currentTime = val * audioRef.current.duration;
  };

  const displayTime = duration ? formatDuration(Math.round(duration)) : '';

  return (
    <div className="ipt-audio-player">
      <button
        className={`ipt-play-btn${loading ? ' ipt-loading' : ''}`}
        onClick={fetchAndPlay}
        disabled={loading}
        title={playing ? t('ipTelephone.audioPause') : t('ipTelephone.audioPlay')}
      >
        {loading ? (
          <i className="fas fa-spinner fa-spin" />
        ) : playing ? (
          <i className="fas fa-pause" />
        ) : (
          <i className="fas fa-play" />
        )}
      </button>

      <input
        type="range"
        className="ipt-progress"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        onChange={seek}
      />

      {displayTime && <span className="ipt-duration">{displayTime}</span>}
    </div>
  );
};

const isOperatorNumber = (num: string) => {
  if (!num) return false;
  return num === '552051515' || (num.length === 4 && Number(num) >= 1000);
};

const getCallInfo = (r: CallRecord) => {
  let client = r.operator;
  let op = r.raqam;
  let direction = 'unknown';

  if (isOperatorNumber(r.raqam) && !isOperatorNumber(r.operator)) {
    op = r.raqam;
    client = r.operator;
    direction = 'out';
  } else if (!isOperatorNumber(r.raqam) && isOperatorNumber(r.operator)) {
    client = r.raqam;
    op = r.operator;
    direction = 'in';
  } else {
    if (r.recordingfile?.startsWith('in-')) direction = 'in';
    else if (r.recordingfile?.startsWith('out-')) direction = 'out';
  }

  if (r.recordingfile) {
    if (r.recordingfile.startsWith('in-')) direction = 'in';
    if (r.recordingfile.startsWith('out-')) direction = 'out';
  }

  return { client, op, direction };
};

const MAIN_TRUNK = '552051515';

/** Yozuv fayli nomidagi ichki raqam: `out-<trunk>-<login>-<sana>-...wav`. */
function getLoginFromRecordingFile(filename: string): string | null {
  if (!filename) return null;
  const match = filename.match(/^(?:in|out)-\d+-(\d+)-/);
  return match ? match[1] : null;
}

/**
 * Qo'ng'iroqni bajargan operatorning ichki raqami.
 *
 * Kiruvchida CDR `operator` maydonida ichki raqam turadi, yozuv fayli nomida esa
 * (`in-<shahar raqami>-<MIJOZ>-…`) ichki raqam YO'Q — ikkinchi raqam mijozning
 * o'zi. Ilgari fayl nomi avval o'qilardi va "Operator" ustunida mijozning o'z
 * raqami chiqardi. Javob berilmagan kiruvchini hech kim bajarmagan (bo'sh qator);
 * faqat guruh (`INBOUND_GROUP_EXT`) javob bergan bo'lsa ham operator yo'q.
 *
 * Chiquvchida hammasi bitta shahar raqamidan (`MAIN_TRUNK`) ketadi va ichki raqam
 * faqat yozuv fayli nomida (`out-<mijoz>-<ICHKI>-…`) qoladi.
 */
function resolveOperatorLogin(r: CallRecord): string {
  const { op, direction } = getCallInfo(r);

  if (direction === 'in') {
    const answeredByOperator =
      r.status === 'ANSWERED' && op !== MAIN_TRUNK && op !== INBOUND_GROUP_EXT;
    return answeredByOperator && isOperatorNumber(op) ? op : '';
  }
  return getLoginFromRecordingFile(r.recordingfile) ?? '';
}

// ── Hozirgina tugagan qo'ng'iroq ────────────────────────────────────────────
// Asterisk CDR yozuvini kanal butunlay yopilgandan KEYIN yozadi va bu bir
// necha soniya kechikadi. Shu sabab "suhbat tugadi -> jadvalda ko'rindi"
// oralig'ida bo'shliq bor edi. Endi suhbat tugashi bilan SIP seansidagi
// ma'lumotdan VAQTINCHA qator yasaladi va darhol jadval boshiga qo'yiladi;
// PBX yozuvi kelgach o'sha vaqtinchalik qator o'chiriladi.

/** Vaqtinchalik qator — PBX yozuvi kelmaguncha ko'rsatiladi. */
type PendingRecord = CallRecord & {
  __pending: true;
  /** Qo'ng'iroqni bajargan ichki raqam (yozuv fayli yo'q, shu sabab alohida). */
  __opLogin: string | null;
  /** Qachon qo'shilgani — eskirganini tashlash uchun. */
  __addedAt: number;
};

const isPendingRecord = (r: CallRecord): r is PendingRecord =>
  (r as PendingRecord).__pending === true;

/** PBX `vaqt` formatidagi (zona belgisisiz, mahalliy) satr. */
function toPbxTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

interface FinishedCall {
  direction: 'in' | 'out';
  remote: string;
  answered: boolean;
  startedAt: number;
  duration: number;
}

/** Tugagan suhbatdan vaqtinchalik jadval qatorini yasaydi. */
function finishedToPending(c: FinishedCall, extension: string | null): PendingRecord {
  const digits = (c.remote || '').replace(/\D/g, '');
  const ext = extension || '';
  const isIn = c.direction === 'in';

  return {
    // `getCallInfo` yo'nalishni raqamlarning o'zidan aniqlaydi: ichki raqam
    // qaysi maydonda turgani "kiruvchi"/"chiquvchi"ni belgilaydi.
    raqam: isIn ? digits : ext || MAIN_TRUNK,
    operator: isIn ? ext || MAIN_TRUNK : digits,
    vaqt: toPbxTime(c.startedAt),
    davomiyligi: Math.max(0, Math.round(c.duration)),
    status: c.answered ? 'ANSWERED' : 'NO ANSWER',
    baho: '',
    recordingfile: '',
    __pending: true,
    __opLogin: ext || null,
    __addedAt: Date.now(),
  };
}

/** Vaqtinchalik qator PBX yozuvi bilan bir xilmi. */
function pendingMatchesReal(p: PendingRecord, real: CallRecord): boolean {
  const tail = (n: string) => n.replace(/\D/g, '').slice(-9);
  const pClient = tail(getCallInfo(p).client);
  const rClient = tail(getCallInfo(real).client);
  if (!pClient || pClient !== rClient) return false;
  // Vaqt ham taxminan mos kelishi kerak (±3 daqiqa) — aks holda o'sha raqam
  // bilan bo'lgan ESKI suhbat ham mos kelib qolardi.
  const pt = new Date(p.vaqt).getTime();
  const rt = new Date(real.vaqt).getTime();
  return Number.isFinite(pt) && Number.isFinite(rt) && Math.abs(pt - rt) < 3 * 60 * 1000;
}

const IPTelephone: React.FC = () => {
  const { t } = useTranslation();
  const canListenRecordings = useFeaturePermission('ip_telephone.listen_recordings');

  const { visibleColumns } = useTableColumns('ipTelephone');
  const colCount = 1 + visibleColumns.length;
  const columnHeader = (colId: string) => t(`columns.${colId}`, { defaultValue: colId });
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const location = useLocation();

  const FILTERS = useMemo(
    () => [
      { key: 'all', label: t('ipTelephone.filterAll') },
      { key: 'in', label: t('ipTelephone.filterIn') },
      { key: 'out', label: t('ipTelephone.filterOut') },
      { key: 'missed', label: t('ipTelephone.filterMissed') },
      { key: 'rejected', label: t('ipTelephone.filterRejected') },
    ],
    [t],
  );

  const {
    callState,
    callTarget,
    registered,
    makeCall,
    hangup,
    answer,
    mute,
    hold,
    sendDtmf,
    blindTransfer,
    attendedTransfer,
    elapsed,
  } = useSip(remoteAudioRef as React.RefObject<HTMLAudioElement>);

  const [phoneToName, setPhoneToName] = useState<Record<string, string>>({});
  const [records, setRecords] = useState<CallRecord[]>([]);
  /** Hozirgina tugagan, PBX yozuvi hali kelmagan qatorlar. */
  const [pendingRows, setPendingRows] = useState<PendingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const filterWrapRef = useRef<HTMLDivElement>(null);

  // "Operatorlar / Kontaktlar" paneli — Saralash tugmasidan OLDIN turadi.
  const [showContactsPanel, setShowContactsPanel] = useState(false);
  const [contactsPanelTab, setContactsPanelTab] = useState<'operators' | 'contacts'>('operators');
  const contactsPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contactsPanelRef.current && !contactsPanelRef.current.contains(e.target as Node)) {
        setShowContactsPanel(false);
      }
    };
    if (showContactsPanel) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showContactsPanel]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterWrapRef.current && !filterWrapRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
    };
    if (showFilterMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilterMenu]);
  const [showCallModal, setShowCallModal] = useState(false);
  const [modalInitialNumber, setModalInitialNumber] = useState('');
  const [operators, setOperators] = useState<IpTelefonOperator[]>([]);

  const showCallModalRef = useRef(false);
  const pendingCallRef = useRef<string | null>(null);

  // ── "Operatorlar / Kontaktlar" bo'limi (Yo'naltirish oynasida) ──
  // Kontaktlar — shu foydalanuvchining o'ziga tegishli operator yozuviga
  // (user_id orqali topiladi) bog'langan, tezkor yo'naltirish uchun oldindan
  // saqlab qo'yiladigan tashqi raqamlar. `GET .../contacts` 405 qaytaradi —
  // alohida ro'yxat endpointi yo'q; ro'yxat operatorning o'zi bilan birga
  // (`/ip-telefon-operators` javobi ichidagi `contacts` maydonidan) keladi.
  const authUser = useAuthStore((s) => s.user);
  const myOperators = useMemo(
    () => operators.filter((o) => o.user_id === authUser?.id),
    [operators, authUser?.id],
  );
  const myOperator = myOperators[0] ?? null;
  const contacts = myOperator?.contacts ?? [];

  /**
   * Operator yozuvlaridagi TAKRORLANISH ogohlantirishlari.
   *
  * SIP kredensiali `user_id` bo'yicha TOPILGAN BIRINCHI yozuvdan olinadi, ichki
   * raqam esa PBX'da bitta qurilmaga hisoblanadi. Shu sabab quyidagi ikki holat
   * "SIP ulangan, lekin qo'ng'iroq qilinganda uzilib qoladi" degan natijaga
   * olib keladi va ikkalasi ham FAQAT ma'lumotlar bazasida tuzatiladi —
   * frontend ularni tuzata olmaydi, lekin ko'rsatib bera oladi:
  *   1) bitta foydalanuvchiga bir nechta operator yozuvi;
   *   2) bitta ichki raqam (login) bir nechta operator yozuvida — ikki brauzer
   *      bir xil raqam bilan ro'yxatdan o'tsa, PBX eskisini uzadi.
   * Boshqaruv panelida ro'yxat BUTUN tashkilot bo'yicha tekshiriladi: bu yerda
   * ularni tuzatadigan odam o'tiradi.
   */
  // `useSip` bu yerda ichki raqamni qaytarmaydi — u operator yozuvidan olinadi.
  const myExtension = myOperator ? String(myOperator.login) : null;
  const sipTabConflict = useDuplicateSipTabs(myExtension, registered);

  const operatorWarnings = useMemo(() => {
    const list: string[] = [];

    if (sipTabConflict && myExtension) {
      list.push(t('ipTelephone.duplicateTabWarn', { ext: myExtension }));
    }

    // Bir xil ism bilan bir nechta operator — masalan ikkita "Maxfuza".
    const byName = new Map<string, number>();
    operators.forEach((o) => {
      const name = o.user?.full_name?.trim().toLowerCase() ?? '';
      if (name) byName.set(name, (byName.get(name) ?? 0) + 1);
    });

    // Bir xil ichki raqam bir nechta yozuvda.
    const byLogin = new Map<string, number>();
    operators.forEach((o) => {
      const login = String(o.login ?? '').trim();
      if (login) byLogin.set(login, (byLogin.get(login) ?? 0) + 1);
    });

    operators
      .filter((o) => o.user)
      .forEach((o) => {
        const name = o.user!.full_name.trim();
        if ((byName.get(name.toLowerCase()) ?? 0) > 1) {
          const msg = t('ipTelephone.duplicateOperatorWarn', { name });
          if (!list.includes(msg)) list.push(msg);
        }
      });

    [...byLogin.entries()]
      .filter(([, count]) => count > 1)
      .forEach(([ext]) => {
        const msg = t('ipTelephone.duplicateExtensionWarn', { ext });
        if (!list.includes(msg)) list.push(msg);
      });

    return list;
  }, [operators, sipTabConflict, myExtension, t]);

  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', phone: '' });
  const [editingContactId, setEditingContactId] = useState<number | null>(null);

  const refetchOperators = useCallback(async () => {
    setContactsLoading(true);
    try {
      const { data } = await API.get('/ip-telefon-operators');
      setOperators(
        Array.isArray(data) ? data : ((data as { data?: unknown[] })?.data ?? []),
      );
    } catch {
      /* eskisi (myOperator.contacts) ko'rsatilishda davom etadi */
    } finally {
      setContactsLoading(false);
    }
  }, []);

  // Chaqiruv oynasi ochilganda eng yangi kontaktlar ko'rinishi uchun —
  // `operators` sahifa ochilganda bir marta olingan, boshqa sessiyada
  // qo'shilgan kontakt shu paytgacha ko'rinmagan bo'lishi mumkin.
  useEffect(() => {
    if (showCallModal) refetchOperators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCallModal]);

  const resetContactForm = () => {
    setContactForm({ name: '', phone: '' });
    setEditingContactId(null);
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myOperator) return;
    const name = contactForm.name.trim();
    // Backend "+998..." formatini xatosiz saqlaydi (tasdiqlangan) — shu
    // sabab bu yerda "+" saqlab qolinadi (o'qish uchun standart ko'rinish).
    // Yo'naltirishda PBX faqat raqam talab qiladi — bu tozalash useSip.ts'da
    // (blindTransfer) chaqiruv PAYTIDA, alohida, amalga oshiriladi.
    const phone = contactForm.phone.replace(/[^\d+]/g, '');
    if (!name || !phone) return;

    if (editingContactId) {
      await API.put(`/ip-telefon-operators/${myOperator.id}/contacts/${editingContactId}`, {
        name,
        phone,
      });
    } else {
      await API.post(`/ip-telefon-operators/${myOperator.id}/contacts`, { name, phone });
    }
    resetContactForm();
    await refetchOperators();
  };

  const handleContactEdit = (c: IpTelefonContact) => {
    setEditingContactId(c.id);
    setContactForm({ name: c.name, phone: c.phone });
  };

  const handleContactDelete = async (id: number) => {
    if (!myOperator) return;
    await API.delete(`/ip-telefon-operators/${myOperator.id}/contacts/${id}`);
    if (editingContactId === id) resetContactForm();
    await refetchOperators();
  };

  const getLidName = useCallback(
    (phone: string): string | null => {
      const digits = phone.replace(/\D/g, '');
      return phoneToName[digits] ?? phoneToName[digits.slice(-9)] ?? null;
    },
    [phoneToName],
  );

  const getOperatorName = useCallback(
    (opLogin: string): string => {
      const found = operators.find((o) => String(o.login) === opLogin);
      if (!found) return opLogin;
      if (found.user?.full_name) return found.user.full_name;
      return found.name || opLogin;
    },
    [operators],
  );

  useEffect(() => {
    const state = location.state as { callNumber?: string } | null;
    if (state?.callNumber) {
      pendingCallRef.current = state.callNumber;
      window.history.replaceState({}, '');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Manbalar (tarix, operatorlar, lidlar) BIR-BIRINI KUTMAYDI: har biri kelishi
    // bilan o'z holatini yangilaydi. Ilgari hammasi `Promise.all` da kutilardi —
    // jadval eng sekin (og'ir lidlar) so'rov tugamaguncha bo'sh turardi.
    // Jadval tarix + operatorlar kelgach chiziladi (operatorlarsiz operator nomi
    // avval ichki raqam bo'lib, so'ng "sakrab" o'zgarardi); lidlar kelgach
    // mijoz ismlari qo'shiladi.
    let historyReady = false;
    let operatorsReady = false;
    const settle = () => {
      if (historyReady && operatorsReady) setLoading(false);
    };
    setLoading(true);

    fetchAllHistory()
      .then((calls) => {
        // `calls` qo'ng'iroqlarga birlashtirilgan (bitta qo'ng'iroq = bitta qator).
        // Yangilash (`refreshLatest`) orqali kelgan qatorlar yo'qolmasligi uchun qo'shiladi.
        setRecords((prev) => mergeCalls(prev, calls));
      })
      .catch(() => {
        /* jadval bo'sh holatda qoladi */
      })
      .finally(() => {
        historyReady = true;
        settle();
      });

    API.get('/ip-telefon-operators')
      .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? [])) as IpTelefonOperator[])
      .then((ops) => setOperators(ops))
      .catch(() => {
        /* operatorlarsiz ham jadval ishlaydi */
      })
      .finally(() => {
        operatorsReady = true;
        settle();
      });

    fetchLids({ page: 1, per_page: 1000 })
      .then((list) => {
        const map: Record<string, string> = {};
        list.data.forEach((lid) => {
          if (!lid.phone) return;
          const digits = lid.phone.replace(/\D/g, '');
          const fish = [lid.last_name, lid.first_name].filter(Boolean).join(' ');
          map[digits] = fish;
          if (digits.length >= 9) map[digits.slice(-9)] = fish;
        });
        setPhoneToName(map);
      })
      .catch(() => {
        /* ismlar chiqmaydi, jadval ishlayveradi */
      });
    // Sahifa hajmi endi server so'roviga ta'sir qilmaydi — butun tarix bir marta
    // yuklanadi, shuning uchun `limit` bu yerda bog'liqlik emas.
  }, []);

  // Yozuvchi so'rovdan keyin (yangi lid qo'shildi, operator o'zgardi...) operatorlar va lidlar (mijoz ismlari)
  // qayta yuklanadi — aks holda yangi lidning raqami F5 gacha "noma'lum" bo'lib qolardi (utils/dataSync.ts).
  // Tarix (PBX) bu yerda QAYTA yuklanmaydi: u og'ir va Laravel ma'lumotiga bog'liq emas.
  const dataVersion = useDataVersion();
  const seenDataVersion = useRef(dataVersion);
  useEffect(() => {
    if (seenDataVersion.current === dataVersion) return; // birinchi ochilishda asosiy effekt yuklaydi
    seenDataVersion.current = dataVersion;
    API.get('/ip-telefon-operators')
      .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? [])) as IpTelefonOperator[])
      .then((ops) => setOperators(ops))
      .catch(() => {
        /* eski ro'yxat qoladi */
      });
    fetchLids({ page: 1, per_page: 1000 })
      .then((list) => {
        const map: Record<string, string> = {};
        list.data.forEach((lid) => {
          if (!lid.phone) return;
          const digits = lid.phone.replace(/\D/g, '');
          const fish = [lid.last_name, lid.first_name].filter(Boolean).join(' ');
          map[digits] = fish;
          if (digits.length >= 9) map[digits.slice(-9)] = fish;
        });
        setPhoneToName(map);
      })
      .catch(() => {
        /* eski ismlar qoladi */
      });
  }, [dataVersion]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (callState === 'ringing') {
        if (!showCallModalRef.current) {
          showCallModalRef.current = true;
          setShowCallModal(true);
        }
      } else if (callState === 'idle') {
        const pending = pendingCallRef.current;
        if (pending) {
          pendingCallRef.current = null;
          setModalInitialNumber(pending);
          showCallModalRef.current = true;
          setShowCallModal(true);
        } else {
          showCallModalRef.current = false;
          setShowCallModal(false);
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [callState]);

  const handleCallClick = useCallback(
    (raqam: string) => {
      if (callState !== 'idle') return;
      setModalInitialNumber(raqam);
      showCallModalRef.current = true;
      setShowCallModal(true);
    },
    [callState],
  );

  const handleHangup = useCallback(async () => {
    // FIX: Avval UI ni tozalash, keyin SIP hangup
    showCallModalRef.current = false;
    setShowCallModal(false);
    try {
      await hangup();
    } catch (err) {
      console.error('Hangup error:', err);
    }
  }, [hangup]);

  const handleAnswer = useCallback(async () => {
    try {
      await answer();
    } catch (err) {
      console.error('Answer error:', err);
    }
  }, [answer]);

  // FIX: Modal yopilganda - agar qo'ng'iroq davom etayotgan bo'lsa hangup qilish
  const handleModalClose = useCallback(async () => {
    showCallModalRef.current = false;
    setShowCallModal(false);
    // Agar qo'ng'iroq davom etayotgan bo'lsa - yakunlash
    if (callState !== 'idle') {
      try {
        await hangup();
      } catch (err) {
        console.error('Close hangup error:', err);
      }
    }
  }, [callState, hangup]);

  const branches = useMemo(() => {
    const map = new Map<string, string>();
    operators.forEach((o) => {
      const name = o.branch?.name_uz || o.filial || 'Asosiy';
      map.set(String(o.branch?.id ?? '0'), name);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [operators]);

  /**
   * Qatorni bajargan ichki raqam.
   *
   * Vaqtinchalik (hozirgina tugagan) qatorda yozuv fayli yo'q, shu sabab
   * ichki raqam SIP seansidan bevosita olinadi.
   */
  const recordOpLogin = (r: CallRecord): string =>
    isPendingRecord(r) ? (r.__opLogin ?? '') : resolveOperatorLogin(r);

  // Hozirgina tugagan qo'ng'iroqlar PBX yozuvidan oldin keladi — ular
  // ro'yxatning boshiga qo'yiladi va oddiy qatorlar kabi filtrlanadi.
  const allRows: CallRecord[] = pendingRows.length ? [...pendingRows, ...records] : records;

  const displayed = allRows.filter((r) => {
    const { client, direction } = getCallInfo(r);
    const op = recordOpLogin(r);

    const matchSearch = !search || client.includes(search) || op.includes(search);

    let matchTab = true;
    if (activeFilter === 'missed') matchTab = r.status === 'NO ANSWER';
    else if (activeFilter === 'rejected') matchTab = r.status === 'FAILED';
    else if (activeFilter === 'in') matchTab = direction === 'in';
    else if (activeFilter === 'out') matchTab = direction === 'out';

    const matchDate = (() => {
      if (!dateFrom && !dateTo) return true;
      const recDate = new Date(r.vaqt);
      if (dateFrom && recDate < new Date(dateFrom)) return false;
      if (dateTo && recDate > new Date(dateTo + 'T23:59:59')) return false;
      return true;
    })();

    const matchOperator = !operatorFilter || op === operatorFilter;

    const matchBranch =
      !branchFilter ||
      (() => {
        const found = operators.find((o) => String(o.login) === op);
        return String(found?.branch?.id ?? '0') === branchFilter;
      })();

    return matchSearch && matchTab && matchDate && matchOperator && matchBranch;
  });

  // ── Sahifalash ──
  // Filtr butun tarix bo'yicha ishlaydi, ekranga faqat joriy sahifa chiqadi.
  const totalFiltered = displayed.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
  const safePage = Math.min(page, totalPages);
  const paged = displayed.slice((safePage - 1) * limit, safePage * limit);

  // Filtr yoki sahifa hajmi o'zgarsa — birinchi sahifaga.
  useEffect(() => {
    setPage(1);
  }, [search, activeFilter, dateFrom, dateTo, operatorFilter, branchFilter, limit]);

  /**
   * Qo'ng'iroq tugagach faqat OXIRGI yozuvlarni olib, ro'yxatga qo'shadi.
   * Olingan qatorlar ham qo'ng'iroqlarga birlashtiriladi; ro'yxatda allaqachon
   * bor qo'ng'iroq faqat oyoqlari ko'proq bo'lsagina yangilanadi, shuning uchun
   * bir necha marta chaqirish xavfsiz — `mergeLatestCalls`.
   */
  const refreshLatest = useCallback(async () => {
    const res = await fetch(`${BASE_URL}/api/v1/history?limit=${HISTORY_LATEST_WINDOW}&page=1`)
      .then((r) => r.json() as Promise<HistoryResponse>)
      .catch(() => null);
    const latest = res?.data ?? [];
    if (!latest.length) return;
    setRecords((prev) => mergeLatestCalls(prev, latest));
  }, []);

  /**
   * Suhbat tugashi bilan jadvalni yangilaydi.
   *
   * Asterisk CDR ni kanal yopilgandan KEYIN yozadi va bu ba'zan bir necha
   * soniya kechikadi — shu sabab bir necha marta qayta uriniladi. Ilgari admin
   * panelda umuman yangilanish yo'q edi: gaplashilgan qo'ng'iroq sahifa qo'lda
   * yangilanmaguncha jadvalda chiqmasdi.
   */
  // `callTarget` qo'ng'iroq tugashi bilan `null` ga o'tadi va ba'zida bu
  // `callState` dan OLDIN sodir bo'ladi — oxirgi bo'sh bo'lmagan qiymat
  // alohida saqlanadi, aks holda vaqtinchalik qator raqamsiz qolardi.
  const prevCallTargetRef = useRef<string>('');
  useEffect(() => {
    if (callTarget) prevCallTargetRef.current = callTarget;
  }, [callTarget]);

  /**
   * Joriy suhbat haqidagi ma'lumot.
   *
   * `useSip` bu yerda tugagan qo'ng'iroq haqida xulosa (summary) bermaydi,
   * shu sabab kerakli narsa holat o'tishlaridan yig'iladi: chiquvchi qo'ng'iroq
   * `connecting` dan, kiruvchi `ringing` dan boshlanadi; `active` ga o'tsa —
   * javob berilgan.
   */
  const activeCallRef = useRef<{
    direction: 'in' | 'out';
    remote: string;
    startedAt: number;
    answeredAt: number | null;
  } | null>(null);
  const callTargetRef = useRef(callTarget);
  callTargetRef.current = callTarget;
  const myLoginRef = useRef<string | null>(null);
  myLoginRef.current = myOperator ? String(myOperator.login) : null;

  const prevCallStateRef = useRef(callState);
  useEffect(() => {
    const prev = prevCallStateRef.current;
    prevCallStateRef.current = callState;
    if (prev === callState) return;

    if (prev === 'idle' && (callState === 'connecting' || callState === 'ringing')) {
      activeCallRef.current = {
        direction: callState === 'ringing' ? 'in' : 'out',
        remote: callTargetRef.current ?? '',
        startedAt: Date.now(),
        answeredAt: null,
      };
      return;
    }

    if (callState === 'active' && activeCallRef.current) {
      activeCallRef.current.answeredAt = Date.now();
      if (!activeCallRef.current.remote && callTargetRef.current) {
        activeCallRef.current.remote = callTargetRef.current;
      }
      return;
    }

    if (prev !== 'idle' && callState === 'idle') {
      // 1) DARHOL: vaqtinchalik qator — foydalanuvchi PBX yozuvini kutmaydi.
      const call = activeCallRef.current;
      activeCallRef.current = null;
      const remote = call?.remote || prevCallTargetRef.current || '';
      if (remote) {
        setPendingRows((rows) => [
          finishedToPending(
            {
              direction: call?.direction ?? 'out',
              remote,
              answered: !!call?.answeredAt,
              startedAt: call?.startedAt ?? Date.now(),
              duration: call?.answeredAt ? (Date.now() - call.answeredAt) / 1000 : 0,
            },
            myLoginRef.current,
          ),
          ...rows,
        ]);
      }

      // 2) KEYIN: Asterisk CDR ni kanal yopilgandan KEYIN yozadi va bu ba'zan
      //    bir necha soniya kechikadi — shu sabab bir necha marta uriniladi.
      [800, 2000, 4000, 8000, 15000].forEach((ms) => {
        window.setTimeout(() => {
          void refreshLatest();
        }, ms);
      });
    }
  }, [callState, refreshLatest]);

  // Vaqtinchalik qatorni PBX yozuvi almashtirgach olib tashlaymiz. Yozuv
  // umuman kelmasa ham qator abadiy qolib ketmasin — 3 daqiqadan keyin
  // baribir o'chadi.
  useEffect(() => {
    if (!pendingRows.length) return;
    setPendingRows((prev) => {
      const next = prev.filter(
        (p) =>
          Date.now() - p.__addedAt < 3 * 60 * 1000 && !records.some((r) => pendingMatchesReal(p, r)),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [records, pendingRows.length]);

  useEffect(() => {
    if (!pendingRows.length) return;
    const timer = window.setTimeout(
      () => setPendingRows((prev) => prev.filter((p) => Date.now() - p.__addedAt < 3 * 60 * 1000)),
      3 * 60 * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [pendingRows]);

  const isCallActive = callState !== 'idle';

  return (
    <>
      {/* FIX: audio element - autoPlay + playsInline + to'g'ri atributlar */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      <div className="ipt-page container">
        <div className="ipt-header">
          <h1 className="ipt-title">
            {t('ipTelephone.pageTitle')}
            <span className="ipt-title-icon">
              <i className="fas fa-phone-volume" />
            </span>
          </h1>

          <div className="ipt-header-right">
            <span className={`ipt-sip-status ${registered ? 'registered' : 'unregistered'}`}>
              <span className="ipt-sip-dot" />
              {registered ? t('ipTelephone.sipConnected') : t('ipTelephone.sipDisconnected')}
            </span>

            <button
              className="ipt-call-btn"
              disabled={isCallActive}
              onClick={() => {
                setModalInitialNumber('');
                showCallModalRef.current = true;
                setShowCallModal(true);
              }}
            >
              {t('ipTelephone.callBtn')}
            </button>
          </div>
        </div>

        {operatorWarnings.length > 0 && (
          <div className="ipt-warnings" role="alert">
            {operatorWarnings.map((w) => (
              <p key={w} className="ipt-warning">
                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                <span>{w}</span>
              </p>
            ))}
          </div>
        )}

        <div className="ipt-card">
          <div className="ipt-toolbar">
            <div className="ipt-tabs">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`ipt-tab${activeFilter === f.key ? ' active' : ''}`}
                  onClick={() => setActiveFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
              <CallStatusLegend />
            </div>

            <div className="ipt-toolbar-right">
              <div className="ipt-search-wrap">
                <i className="fas fa-search ipt-search-icon" />
                <input
                  className="ipt-search"
                  placeholder={t('ipTelephone.searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="ipt-date-wrap">
                <input
                  type="date"
                  className="ipt-date-input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  title={t('ipTelephone.dateFrom')}
                />
                <span className="ipt-date-sep">—</span>
                <input
                  type="date"
                  className="ipt-date-input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  title={t('ipTelephone.dateTo')}
                />
              </div>

              <div className="ipt-filter-wrap" ref={contactsPanelRef}>
                <button
                  className={`ipt-filter-btn ${showContactsPanel ? 'active' : ''}`}
                  onClick={() => setShowContactsPanel((v) => !v)}
                >
                  <i className="fa-solid fa-address-book" /> {t('ipTelephone.contactsPanelBtn', 'Kontaktlar')}
                </button>
                {showContactsPanel && (
                  <div className="ipt-filter-menu ipt-contacts-menu">
                    <div className="ipt-contacts-panel-header">
                      <span className="ipt-contacts-panel-title">
                        <i className="fa-solid fa-address-book" />
                        {t('ipTelephone.contactsPanelBtn', 'Kontaktlar')}
                      </span>
                      <button
                        type="button"
                        className="ipt-contacts-panel-close"
                        onClick={() => setShowContactsPanel(false)}
                        title={t('common.cancel', 'Yopish')}
                      >
                        <i className="fas fa-times" />
                      </button>
                    </div>
                    <div className="ipt-mode-tabs">
                      <button
                        className={`ipt-mode-btn ${contactsPanelTab === 'operators' ? 'active' : ''}`}
                        onClick={() => setContactsPanelTab('operators')}
                      >
                        {t('ipTelephone.tabOperators', 'Operatorlar')}
                      </button>
                      <button
                        className={`ipt-mode-btn ${contactsPanelTab === 'contacts' ? 'active' : ''}`}
                        onClick={() => setContactsPanelTab('contacts')}
                      >
                        {t('ipTelephone.tabContacts', 'Kontaktlar')}
                      </button>
                    </div>

                    {contactsPanelTab === 'operators' ? (
                      <div className="ipt-operator-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                        {operators.length === 0 ? (
                          <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 13 }}>
                            {t('ipTelephone.noOperators')}
                          </div>
                        ) : (
                          operators.map((op) => (
                            <div key={op.id} className="ipt-operator-item">
                              <div>
                                <div className="ipt-op-login">
                                  {op.branch?.name_uz || op.filial || t('ipTelephone.branchDefault')}
                                </div>
                                <div className="ipt-op-name">
                                  {op.user?.full_name
                                    ? op.user.full_name
                                    : op.name || 'Operator'}
                                </div>
                              </div>
                              <div className="ipt-op-login" style={{ fontWeight: 'bold', color: '#003366' }}>
                                {op.login}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    ) : !myOperator ? (
                      <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 13 }}>
                        {t('ipTelephone.noOwnOperator', 'Sizga bog‘langan operator topilmadi')}
                      </div>
                    ) : (
                      <div style={{ padding: 12 }}>
                        <form
                          onSubmit={handleContactSubmit}
                          style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}
                        >
                          <input
                            type="text"
                            placeholder={t('ipTelephone.contactNamePlaceholder', 'Ism')}
                            value={contactForm.name}
                            onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))}
                            style={{ flex: 1, minWidth: 90, padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd' }}
                            required
                          />
                          <input
                            type="tel"
                            placeholder={t('ipTelephone.contactPhonePlaceholder', 'Telefon raqam')}
                            value={contactForm.phone}
                            onChange={(e) =>
                              setContactForm((p) => ({ ...p, phone: e.target.value.replace(/[^\d+]/g, '') }))
                            }
                            style={{ flex: 1, minWidth: 90, padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd' }}
                            required
                          />
                          <button type="submit" className="ipt-call-btn" style={{ padding: '6px 14px' }}>
                            {editingContactId ? t('common.save', 'Saqlash') : t('users.addNew', 'Qo‘shish')}
                          </button>
                          {editingContactId && (
                            <button type="button" className="ipt-filter-clear" onClick={resetContactForm}>
                              {t('common.cancel', 'Bekor qilish')}
                            </button>
                          )}
                        </form>

                        <div className="ipt-operator-list" style={{ maxHeight: 280, overflowY: 'auto' }}>
                          {contactsLoading ? (
                            <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 13 }}>
                              <i className="fas fa-spinner fa-spin" /> {t('ipTelephone.loading')}
                            </div>
                          ) : contacts.length === 0 ? (
                            <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 13 }}>
                              {t('ipTelephone.noContacts', 'Kontaktlar yo‘q')}
                            </div>
                          ) : (
                            contacts.map((c) => (
                              <div
                                key={c.id}
                                className="ipt-operator-item"
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                              >
                                <div>
                                  <div className="ipt-op-name">{c.name}</div>
                                  <div className="ipt-op-login" style={{ fontSize: 12, color: '#003366' }}>
                                    {c.phone}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    type="button"
                                    onClick={() => handleContactEdit(c)}
                                    title={t('common.edit', 'Tahrirlash')}
                                    style={{
                                      width: 26,
                                      height: 26,
                                      borderRadius: '50%',
                                      border: 'none',
                                      background: '#eef2f7',
                                      color: '#334155',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <i className="fa-solid fa-pen" style={{ fontSize: 11 }} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleContactDelete(c.id)}
                                    title={t('common.delete', 'O‘chirish')}
                                    style={{
                                      width: 26,
                                      height: 26,
                                      borderRadius: '50%',
                                      border: 'none',
                                      background: '#fee2e2',
                                      color: '#dc2626',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <i className="fa-solid fa-trash" style={{ fontSize: 11 }} />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="ipt-filter-wrap" ref={filterWrapRef}>
                <button
                  className={`ipt-filter-btn ${showFilterMenu ? 'active' : ''}`}
                  onClick={() => setShowFilterMenu((v) => !v)}
                >
                  <i className="fas fa-sliders-h" /> {t('ipTelephone.filterBtn')}
                  {(operatorFilter || branchFilter || dateFrom || dateTo) && (
                    <span className="ipt-filter-dot" />
                  )}
                </button>
                {showFilterMenu && (
                  <div className="ipt-filter-menu">
                    <div className="ipt-filter-field">
                      <label>{t('ipTelephone.filterBranch')}</label>
                      <select
                        value={branchFilter}
                        onChange={(e) => setBranchFilter(e.target.value)}
                      >
                        <option value="">{t('ipTelephone.allOperators')}</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="ipt-filter-field">
                      <label>{t('ipTelephone.filterOperator')}</label>
                      <select
                        value={operatorFilter}
                        onChange={(e) => setOperatorFilter(e.target.value)}
                      >
                        <option value="">{t('ipTelephone.allOperators')}</option>
                        {operators.map((o) => (
                          <option key={o.id} value={String(o.login)}>
                            {o.user?.full_name
                              ? o.user.full_name
                              : o.name || String(o.login)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="ipt-filter-clear"
                      onClick={() => {
                        setOperatorFilter('');
                        setBranchFilter('');
                        setDateFrom('');
                        setDateTo('');
                      }}
                    >
                      {t('ipTelephone.filterClear')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="ipt-table-scroll">
          <table className="ipt-table">
            {/* Ustun kengliklari sinf orqali beriladi: ustunlar sozlamada
                yoqib-o'chirilgani uchun `nth-child` bilan bog'lash noto'g'ri
                natija berardi (masalan "Holati" yashirilsa, uning tor
                kengligi keyingi ustunga o'tib qolardi). */}
            <colgroup>
              {visibleColumns.map((colId) => (
                <col key={colId} className={`ipt-col--${colId}`} />
              ))}
              <col className="ipt-col--actions" />
            </colgroup>
            <thead>
              <tr>
                {visibleColumns.map((colId) => (
                  <th key={colId} className={`ipt-col--${colId}`}>
                    {columnHeader(colId)}
                  </th>
                ))}
                <th className="ipt-col--actions">{t('ipTelephone.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="ipt-loading-cell">
                    <i className="fas fa-spinner fa-spin" /> {t('ipTelephone.loading')}
                  </td>
                </tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="ipt-empty-cell">
                    {t('ipTelephone.noData')}
                  </td>
                </tr>
              ) : (
                paged.map((rec, idx) => {
                  const { client, direction } = getCallInfo(rec);
                  const op = recordOpLogin(rec);
                  const pending = isPendingRecord(rec);
                  const recOperator = operators.find((o) => String(o.login) === op) ?? null;
                  const hasRecording = !!rec.recordingfile && rec.status === 'ANSWERED';
                  const isCalling = isCallActive && callTarget === `+${client}`;

                  return (
                    <tr
                      key={pending ? `pending-${rec.__addedAt}` : idx}
                      className={`${isCalling ? 'ipt-row-active' : ''}${pending ? ' ipt-row-pending' : ''}`}
                    >
                      {visibleColumns.map((colId) => {
                        switch (colId) {
                          case 'status':
                            return (
                              <td key={colId} className="ipt-col--status">
                                <CallStatusBadge
                                  status={rec.status}
                                  direction={direction}
                                  pending={pending}
                                />
                              </td>
                            );
                          case 'client':
                            return (
                              <td key={colId} className="ipt-phone-cell">
                                {getLidName(client) ? (
                                  <span>
                                    <span style={{ fontWeight: 600, color: '#003366' }}>
                                      {getLidName(client)}
                                    </span>
                                    <br />
                                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                                      {client}
                                    </span>
                                  </span>
                                ) : (
                                  client
                                )}
                              </td>
                            );
                          case 'branch':
                            // Ilgari bu yerda hamma qator uchun qat'iy "Asosiy"
                            // yozilardi — filial aslida operatorning ichki
                            // raqami orqali aniqlanadi, aniqlanmasa "—".
                            return (
                              <td key={colId} className="ipt-branch-cell">
                                {recOperator?.branch?.name_uz || recOperator?.filial || '—'}
                              </td>
                            );
                          case 'duration':
                            return (
                              <td key={colId} className="ipt-duration-cell">
                                {rec.status === 'ANSWERED' && rec.davomiyligi > 0
                                  ? formatDuration(rec.davomiyligi)
                                  : '—'}
                              </td>
                            );
                          case 'operator':
                            return (
                              <td key={colId} className="ipt-operator-cell">
                                {op ? getOperatorName(op) : '—'}
                              </td>
                            );
                          case 'datetime':
                            return (
                              <td key={colId} className="ipt-date-cell">
                                {formatDateTime(rec.vaqt)}
                                {pending && (
                                  <span
                                    className="ipt-pending-tag"
                                    title={t('ipTelephone.pendingHint')}
                                  >
                                    {t('ipTelephone.justNow')}
                                  </span>
                                )}
                              </td>
                            );
                          default:
                            return <td key={colId}>-</td>;
                        }
                      })}

                      <td className="ipt-col--actions">
                        <div className="ipt-actions-cell">
                          <button
                            className={`ipt-row-call-btn${isCalling ? ' calling' : ''}`}
                            title={
                              isCalling ? t('ipTelephone.callActive') : t('ipTelephone.callAction')
                            }
                            disabled={isCallActive && !isCalling}
                            onClick={() => handleCallClick(client)}
                          >
                            <i className={`fas ${isCalling ? 'fa-phone-volume' : 'fa-phone'}`} />
                          </button>

                          {hasRecording && canListenRecordings ? (
                            <AudioPlayer filename={rec.recordingfile} />
                          ) : (
                            <span className="ipt-no-record" />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>

          {totalFiltered > 0 && (
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              total={totalFiltered}
              pageSize={limit}
              onPageChange={setPage}
              onPageSizeChange={setLimit}
            />
          )}
        </div>

        {showCallModal && (
          <CallModal
            initialNumber={modalInitialNumber || callTarget || ''}
            onClose={handleModalClose}
            onCall={(num) => {
              setModalInitialNumber(num);
              makeCall(num);
            }}
            onHangup={handleHangup}
            onAnswer={handleAnswer}
            onMute={mute}
            onHold={hold}
            onSendDtmf={sendDtmf}
            onBlindTransfer={blindTransfer}
            onAttendedTransfer={attendedTransfer}
            callState={callState}
            elapsed={elapsed}
            operators={operators}
            contacts={contacts}
            contactsLoading={contactsLoading}
            hasOwnOperator={!!myOperator}
            contactForm={contactForm}
            onContactFormChange={setContactForm}
            editingContactId={editingContactId}
            onContactSubmit={handleContactSubmit}
            onContactEdit={handleContactEdit}
            onContactCancelEdit={resetContactForm}
            onContactDelete={handleContactDelete}
          />
        )}
      </div>
    </>
  );
};

const IPTelephoneWrapper: React.FC = () => {
  const canView = useFeaturePermission('ip_telephone.view');

  // Ilgari `isAllowedUser` ham tekshirilardi — rol NOMIda "operator" yoki
  // "admin" so'zi borligiga qarab. `canView` (Dashboard sozlamalaridagi
  // `ip_telephone.view` feature) allaqachon to'g'ri ruxsatni bildiradi;
  // rol nomi ustidan qo'shimcha tekshiruv boshqa nomdagi rolga shu feature
  // yoqilgan taqdirda ham sahifani ko'rsatmay qo'yardi.
  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return <IPTelephone />;
};

export default IPTelephoneWrapper;
