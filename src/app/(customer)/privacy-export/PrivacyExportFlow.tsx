"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export type PrivacyExportProps = {
  lang: "ar" | "en";
  /** The data copy request's ULID, as the SMS link carries it. */
  request: string | null;
  /** The link's own proof (`expires` and `signature`): posted back to the API with each step, never kept. */
  expires: string | null;
  signature: string | null;
  /** `?status=` of the link: the API redirects an expired or forged link here instead of to the file. */
  status: "expired" | "invalid" | null;
  fetcher?: Fetcher;
  /** Where the signed file URL goes: the browser downloads it (a test replaces this). */
  redirect?: (url: string) => void;
};

type Phase = "ask" | "sending" | "sent" | "downloading" | "started";
type Failure = "invalid" | "expired" | "wrongCode" | "codeExpired" | "locked" | "wait" | "network" | null;

const REQUEST_ID = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

/** The proof parameters of a link are opaque strings; only their shape is checked before they are sent. */
export function linkIsUsable(p: Pick<PrivacyExportProps, "request" | "expires" | "signature">): boolean {
  return !!p.request && REQUEST_ID.test(p.request) && !!p.expires && /^\d{1,12}$/.test(p.expires) && !!p.signature && /^[A-Za-z0-9_+=./-]{8,200}$/.test(p.signature);
}

/** The API's error code and the attempts left, from its `{error: {code, details}}` body. */
async function errorOf(response: Response): Promise<{ code: string; attemptsLeft: number | null }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; details?: { attempts_left?: unknown } } };
    const left = body.error?.details?.attempts_left;
    return { code: typeof body.error?.code === "string" ? body.error.code : "", attemptsLeft: typeof left === "number" ? left : null };
  } catch {
    return { code: "", attemptsLeft: null };
  }
}

function failureOf(status: number, code: string): Failure {
  if (status === 403 || code === "PRIVACY_LINK_INVALID") return "invalid";
  if (status === 410 || code === "EXPORT_EXPIRED") return "expired";
  if (code === "OTP_INVALID") return "wrongCode";
  if (code === "OTP_EXPIRED") return "codeExpired";
  if (code === "OTP_LOCKED" || code === "OTP_ATTEMPTS_EXCEEDED") return "locked";
  if (status === 429) return "wait";
  return "network";
}

/**
 * The download of a data copy for a customer who followed the link in her SMS (customers §7.2, P5-C54): it works without
 * signing in, so before anything is handed over the page asks for the code the API sends to her registered phone (shown
 * masked). With the right code the API answers a short-lived signed URL, which the browser follows at once; the URL is
 * never shown, stored or logged here. A link that expired or is not valid, a wrong or expired code and a locked one each
 * say so, and the next step is always the app or support.
 */
export function PrivacyExportFlow({ lang, request, expires, signature, status, fetcher = fetch, redirect = (url) => window.location.assign(url) }: PrivacyExportProps) {
  const t = useTranslations("customerWeb.privacyExport");
  const usable = status === null && linkIsUsable({ request, expires, signature });
  const [phase, setPhase] = useState<Phase>("ask");
  const [phone, setPhone] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<Failure>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const call = async (step: "otp" | "download", body: Record<string, string>): Promise<Response | null> => {
    try {
      return await fetcher(`/backend/api/v1/public/privacy-exports/${encodeURIComponent(request ?? "")}/${step}`, {
        method: "POST",
        // No cookies: the page is public, and the link's own signature is the proof.
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json", "Accept-Language": lang },
        body: JSON.stringify(body),
      });
    } catch {
      return null;
    }
  };

  const sendCode = async () => {
    setFailure(null);
    setPhase("sending");
    const res = await call("otp", { expires: expires ?? "", signature: signature ?? "" });
    if (!res) {
      setFailure("network");
      setPhase(phone ? "sent" : "ask");
      return;
    }
    if (!res.ok) {
      const { code: errorCode } = await errorOf(res);
      setFailure(failureOf(res.status, errorCode));
      setPhase(phone ? "sent" : "ask");
      return;
    }
    const data = ((await res.json()) as { data?: { phone_masked?: unknown; resend_in?: unknown } }).data;
    setPhone(typeof data?.phone_masked === "string" ? data.phone_masked : "");
    setWait(typeof data?.resend_in === "number" ? Math.max(0, data.resend_in) : 0);
    setCode("");
    setPhase("sent");
  };

  const download = async (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() === "") return setFailure("wrongCode");
    setFailure(null);
    setPhase("downloading");
    const res = await call("download", { expires: expires ?? "", signature: signature ?? "", code: code.trim() });
    if (!res) {
      setFailure("network");
      setPhase("sent");
      return;
    }
    if (!res.ok) {
      const { code: errorCode, attemptsLeft: left } = await errorOf(res);
      setAttemptsLeft(left);
      setFailure(failureOf(res.status, errorCode));
      setPhase("sent");
      return;
    }
    const url = ((await res.json()) as { data?: { url?: unknown } }).data?.url;
    if (typeof url !== "string" || url === "") {
      setFailure("network");
      setPhase("sent");
      return;
    }
    setCode("");
    setPhase("started");
    redirect(url);
  };

  const terminal = !usable ? (status === "expired" ? "expired" : "invalid") : failure === "invalid" || failure === "expired" ? failure : null;

  if (terminal) {
    return (
      <section role="alert" aria-labelledby="export-title" className="rounded-lg bg-surface p-6 shadow-card">
        <h1 id="export-title" className="text-[24px]/[34px] font-bold text-ink-900">
          {t(`${terminal}.title`)}
        </h1>
        <p className="mt-2 text-base/7 text-ink-600">{t(`${terminal}.body`)}</p>
      </section>
    );
  }

  if (phase === "started") {
    return (
      <section role="status" aria-labelledby="export-title" className="rounded-lg bg-surface p-6 shadow-card">
        <h1 id="export-title" className="text-[24px]/[34px] font-bold text-ink-900">
          {t("started.title")}
        </h1>
        <p className="mt-2 text-base/7 text-ink-600">{t("started.body")}</p>
      </section>
    );
  }

  const busy = phase === "sending" || phase === "downloading";
  return (
    <section aria-labelledby="export-title" className="flex flex-col gap-4 rounded-lg bg-surface p-6 shadow-card">
      <div>
        <h1 id="export-title" className="text-[24px]/[34px] font-bold text-ink-900">
          {t("title")}
        </h1>
        <p className="mt-2 text-base/7 text-ink-900">{t("intro")}</p>
        <p className="mt-1 text-sm text-ink-600">{t("note")}</p>
      </div>

      {phase === "ask" || phase === "sending" ? (
        <div>
          <button type="button" onClick={() => void sendCode()} disabled={busy} className="touch-target inline-flex h-11 items-center rounded-md bg-petrol-700 px-5 text-sm font-bold text-white hover:bg-petrol-800 disabled:opacity-60">
            {phase === "sending" ? t("sending") : t("sendCode")}
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void download(e)} className="flex flex-col gap-3" noValidate>
          <p role="status" className="text-sm text-ink-900">
            {/* The masked number ("+971•••••1234") is its own left-to-right run: in an Arabic sentence the bidi algorithm
                would otherwise move the "+" and swap the digit groups around the bullets. */}
            {phone
              ? t.rich("codeSent", {
                  phone,
                  ltr: (chunks) => (
                    <bdi dir="ltr" className="font-latin">
                      {chunks}
                    </bdi>
                  ),
                })
              : t("codeSentRegistered")}
          </p>
          <label className="flex max-w-xs flex-col gap-1.5 text-sm font-medium text-ink-900">
            {t("code")}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={failure === "wrongCode" || failure === "codeExpired" ? true : undefined}
              className="h-11 rounded-md border border-line-strong bg-surface px-3 text-base text-ink-900"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || failure === "locked"} className="touch-target inline-flex h-11 items-center rounded-md bg-petrol-700 px-5 text-sm font-bold text-white hover:bg-petrol-800 disabled:opacity-60">
              {phase === "downloading" ? t("downloading") : t("download")}
            </button>
            <button type="button" onClick={() => void sendCode()} disabled={busy || wait > 0} className="touch-target inline-flex h-11 items-center rounded-md border border-line-strong px-4 text-sm font-medium text-ink-900 disabled:opacity-60">
              {wait > 0 ? t("resendIn", { seconds: wait }) : t("resend")}
            </button>
          </div>
        </form>
      )}

      {failure && failure !== "invalid" && failure !== "expired" && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {failure === "wrongCode" && attemptsLeft !== null ? t("failures.wrongCodeLeft", { count: attemptsLeft }) : t(`failures.${failure}`)}
        </p>
      )}
    </section>
  );
}
