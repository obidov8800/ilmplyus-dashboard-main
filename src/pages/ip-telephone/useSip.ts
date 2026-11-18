import { useEffect, useRef, useState, useCallback } from "react";
import { SimpleUser, type SimpleUserOptions } from "sip.js/lib/platform/web";
import { Invitation } from "sip.js";
import { API } from "@/api/api";
import useAuthStore from "@/store/useAuthStore";

/**
 * `SimpleUser` joriy sessiyani ochiq API orqali bermaydi (ichki `session` maydoni) — kiruvchi qo'ng'iroqni
 * rad etish/qabul qilish va o'tkazish uchun shu yerdan o'qiladi.
 */
const sessionOf = (su: unknown): Invitation | undefined =>
  (su as { session?: Invitation } | null | undefined)?.session;

const SIP_SERVER =
  import.meta.env.VITE_SIP_SERVER || "wss://mainoffice.uz:8089/ws";
const SIP_DOMAIN = import.meta.env.VITE_SIP_DOMAIN || "mainoffice.uz";

/**
 * Ilgari HAMMA (qaysi admin/operator kim bo'lishidan qat'i nazar) shu bitta
 * qattiq yozilgan "sip:1001@..." hisobi bilan ro'yxatdan o'tardi — ya'ni
 * bitta umumiy "yo'l" (tunnel). Ikkita brauzer/foydalanuvchi bir vaqtda ochsa,
 * ikkalasi ham AYNAN BITTA SIP identifikatori bilan register qilardi — bu
 * ayniqsa tashqi raqamga yo'naltirishda modal osilib qolishiga sabab bo'lgan
 * ziddiyatlar (bitta hisobga ikkita parallel session) keltirib chiqarardi.
 * Endi (ko'plab operator liniyalari — "tunnel"lar ko'paytirilgani sabab)
 * `ilmplyus-main`dagi kabi HAR BIR foydalanuvchi `user_id` orqali
 * topilgan `/ip-telefon-operators` yozuvidagi O'Z login+parolidan
 * foydalanadi.
 */
interface IpTelefonOperatorLite {
  login: number | string;
  password?: string;
  user_id: number;
}

export type CallState =
  | "idle"
  | "connecting"
  | "ringing"
  | "active"
  | "ended"
  | "error";

export interface UseSipReturn {
  callState: CallState;
  callTarget: string | null;
  registered: boolean;
  makeCall: (phoneNumber: string) => Promise<void>;
  hangup: () => Promise<void>;
  answer: () => Promise<void>;
  mute: (muted: boolean) => void;
  hold: (held: boolean) => Promise<void>;
  sendDtmf: (tone: string) => void;
  blindTransfer: (ext: string) => Promise<void>;
  attendedTransfer: (ext: string) => Promise<void>;
  elapsed: number;
}

const sdpSanitizer = (sdp: string): string => {
  const lines = sdp.split("\n");
  const filtered = lines
    .map((line) => {
      const cleanLine = line.trim();
      if (/a=fingerprint:/i.test(cleanLine)) {
        const parts = cleanLine.split(/\s+/);
        if (parts.length < 2 || parts[1].length < 10) return null;
        return `${parts[0]} ${parts[1]}`;
      }
      return line;
    })
    .filter((line): line is string => line !== null);
  return filtered.join("\n") + "\n";
};

export function useSip(
  remoteAudioRef: React.RefObject<HTMLAudioElement>,
): UseSipReturn {
  const suRef = useRef<SimpleUser | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callTarget, setCallTarget] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStateRef = useRef<CallState>("idle");

  const userId = useAuthStore((s) => s.user?.id);

  const updateCallState = useCallback((state: CallState) => {
    callStateRef.current = state;
    setCallState(state);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsed(0);
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
  }, [stopTimer]);

  useEffect(() => {
    if (!remoteAudioRef.current || suRef.current || !userId) return;

    let alive = true;

    const init = async () => {
      // Har bir operator O'ZINING login+parolidan foydalanishi kerak —
      // bitta umumiy hisobga bir nechta brauzer bir vaqtda register
      // bo'lishi tashqi raqamga yo'naltirishda ziddiyat/osilib qolishga
      // sabab bo'lardi (yuqoridagi izohga qarang).
      let aor: string;
      let password: string | undefined;
      try {
        const res = await API.get("/ip-telefon-operators");
        const operators: IpTelefonOperatorLite[] = Array.isArray(res.data)
          ? res.data
          : (res.data?.data ?? []);
        const operator = operators.find((o) => o.user_id === userId);
        if (!operator) {
          console.warn(`SIP: user_id=${userId} uchun operator topilmadi — ro'yxatdan o'tilmadi`);
          return;
        }
        if (!operator.password) {
          console.warn(`SIP: user_id=${userId} operator yozuvida parol yo'q — ro'yxatdan o'tilmadi`);
          return;
        }
        aor = `sip:${operator.login}@${SIP_DOMAIN}`;
        password = operator.password;
      } catch (err) {
        console.error("SIP: operator kredensiallarini olishda xato", err);
        return;
      }
      if (!alive || !remoteAudioRef.current || suRef.current) return;

      const options: SimpleUserOptions = {
        aor,
        userAgentOptions: {
          authorizationPassword: password,
          authorizationUsername: aor.split(":")[1]?.split("@")[0],
          transportOptions: {
            server: SIP_SERVER,
            reconnectionAttempts: 10,
            reconnectionDelay: 5,
          },
          sessionDescriptionHandlerFactoryOptions: {
            iceGatheringTimeout: 3000,
            peerConnectionConfiguration: {
              iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
              rtcpMuxPolicy: "require",
              bundlePolicy: "max-bundle",
            },
          },
        } as never,
        media: { remote: { audio: remoteAudioRef.current } },
        delegate: {
          onRegistered: () => setRegistered(true),
          onUnregistered: () => setRegistered(false),
          onCallReceived: () => {
            updateCallState("ringing");
            const session = sessionOf(suRef.current);
            if (session?.remoteIdentity?.uri?.user) {
              setCallTarget(session.remoteIdentity.uri.user);
            }
          },
          onCallAnswered: () => {
            updateCallState("active");
            startTimer();
            remoteAudioRef.current
              ?.play()
              .catch(() => console.error("Audio play blocked"));
          },
          onCallHangup: () => {
            updateCallState("idle");
            setCallTarget(null);
            stopTimer();
          },
        },
      };

      const su = new SimpleUser(SIP_SERVER, options);
      suRef.current = su;
      su.connect()
        .then(() => su.register())
        .catch((err) => console.error("SIP Connect Error:", err));
    };

    init();

    return () => {
      alive = false;
      if (suRef.current) {
        suRef.current.disconnect();
        suRef.current = null;
      }
    };
  }, [remoteAudioRef, userId, startTimer, stopTimer, updateCallState]);

  const makeCall = useCallback(
    async (phoneNumber: string) => {
      const su = suRef.current;
      if (!su) return;
      const cleanDigits = phoneNumber.replace(/[^\d+]/g, "").replace(/^\+/, "");
      const target = `sip:${cleanDigits}@${SIP_DOMAIN}`;
      setCallTarget(phoneNumber);
      updateCallState("connecting");
      try {
        await su.call(target, {
          sessionDescriptionHandlerOptions: {
            constraints: { audio: true, video: false },
            sdpTransform: sdpSanitizer,
          } as never,
        });
      } catch (err) {
        console.error("Call Error:", err);
        updateCallState("error");
        setTimeout(() => updateCallState("idle"), 2000);
      }
    },
    [updateCallState],
  );

  const answer = useCallback(async () => {
    const su = suRef.current;
    if (!su) return;
    try {
      await su.answer({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
          sdpTransform: sdpSanitizer,
        } as never,
      });
    } catch (err) {
      console.warn("SimpleUser answer failed, trying session accept:", err);
      const session = sessionOf(su);
      if (session) await session.accept();
    }
  }, []);

  const hangup = useCallback(async () => {
    const su = suRef.current;
    if (!su) return;
    try {
      const session = sessionOf(su);
      if (callStateRef.current === "ringing" && session) {
        await (session as Invitation).reject();
      } else {
        await su.hangup();
      }
    } catch (err) {
      console.error("Hangup Error:", err);
    } finally {
      updateCallState("idle");
      setCallTarget(null);
      stopTimer();
    }
  }, [updateCallState, stopTimer]);

  const mute = useCallback(
    (m: boolean) => (m ? suRef.current?.mute() : suRef.current?.unmute()),
    [],
  );
  const hold = useCallback(
    async (h: boolean) => (h ? suRef.current?.hold() : suRef.current?.unhold()),
    [],
  );
  const sendDtmf = useCallback((t: string) => suRef.current?.sendDTMF(t), []);

  const blindTransfer = useCallback(async (ext: string) => {
    const session = sessionOf(suRef.current);
    // `makeCall` yuqorida "+"/probel/tire kabi belgilarni tozalaydi — PBX
    // dial-plani faqat raqamlarni taniydi. Bu yerda bunday tozalash yo'q
    // edi: operator ichki raqamlariga (allaqachon toza raqam) muammo
    // bermasdi, lekin Kontaktlar bo'limida saqlangan tashqi raqam "+" bilan
    // saqlangan bo'lsa, yo'naltirish PBX'dan 503 (mos yo'nalish topilmadi)
    // bilan qaytishi mumkin edi.
    const cleanDigits = ext.replace(/[^\d+]/g, "").replace(/^\+/, "");
    // Kutubxona turi `URI | Session` deydi, amalda SIP manzil satrini ham qabul qiladi (avvalgi xatti-harakat).
    if (session) await session.refer(`sip:${cleanDigits}@${SIP_DOMAIN}` as never);
  }, []);

  return {
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
    attendedTransfer: blindTransfer,
    elapsed,
  };
}
