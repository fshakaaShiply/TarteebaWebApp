import { Mail, MessageCircle, Phone } from "lucide-react";
import type { PublicConfig } from "@/lib/admin/types";
import { Wordmark } from "../../_components/Wordmark";

/*
 * Where a customer lands after paying a manual-booking link (backend BOOKING_MANUAL_PAYMENT_RETURN_URL; spec §16 copy
 * rules, D-16). The customer may not have chosen a language here, so the page speaks both: Arabic first, then English.
 * It never says the payment succeeded: the URL's status is not the provider's answer, and the booking is only a
 * request until our team confirms it. The app shows the payment state from the provider.
 */

type Translate = (key: string, values?: Record<string, string>) => string;

const ULID = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;

/** The payment reference from the return URL, when it looks like one (shown to quote to support). */
export function paymentReference(value: unknown): string | null {
  return typeof value === "string" && ULID.test(value) ? value : null;
}

function Block({ t, lang, reference, support }: { t: Translate; lang: "ar" | "en"; reference: string | null; support: PublicConfig["support"] | null }) {
  const whatsapp = support?.whatsapp ? support.whatsapp.replace(/\D/g, "") : null;
  const hasContact = !!(support?.phone || whatsapp || support?.email);
  return (
    <section lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={lang === "ar" ? "font-arabic" : "font-latin"} aria-labelledby={`result-${lang}`}>
      <h1 id={`result-${lang}`} className="text-[26px]/[36px] font-bold text-ink-900">
        {t("title")}
      </h1>
      <p className="mt-3 text-base/7 text-ink-900">{t("body")}</p>
      <p className="mt-2 text-sm/6 text-ink-600">{t("note")}</p>
      {reference && (
        <p className="mt-3 text-sm text-ink-600">
          {t("reference")}{" "}
          <bdi dir="ltr" className="font-latin text-ink-900">
            {reference}
          </bdi>
        </p>
      )}
      <h2 className="mt-5 text-base font-bold text-ink-900">{t("helpTitle")}</h2>
      {hasContact ? (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {support?.phone && (
            <li className="flex items-center gap-2">
              <Phone aria-hidden className="size-4 text-petrol-700" />
              <a href={`tel:${support.phone}`}>
                {t("call")}{" "}
                <bdi dir="ltr" className="font-latin">
                  {support.phone}
                </bdi>
              </a>
            </li>
          )}
          {whatsapp && (
            <li className="flex items-center gap-2">
              <MessageCircle aria-hidden className="size-4 text-petrol-700" />
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                {t("whatsapp")}
              </a>
            </li>
          )}
          {support?.email && (
            <li className="flex items-center gap-2">
              <Mail aria-hidden className="size-4 text-petrol-700" />
              <a href={`mailto:${support.email}`}>
                <bdi dir="ltr" className="font-latin">
                  {support.email}
                </bdi>
              </a>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-600">{t("helpApp")}</p>
      )}
    </section>
  );
}

export function PaymentResult({ ar, en, reference, support }: { ar: Translate; en: Translate; reference: string | null; support: PublicConfig["support"] | null }) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-ivory-50 px-4 py-10 sm:items-center">
      <div className="flex w-full max-w-xl flex-col gap-6 rounded-lg bg-surface p-6 shadow-card sm:p-8">
        <Wordmark />
        <Block t={ar} lang="ar" reference={reference} support={support} />
        <hr className="border-line" />
        <Block t={en} lang="en" reference={reference} support={support} />
      </div>
    </main>
  );
}
