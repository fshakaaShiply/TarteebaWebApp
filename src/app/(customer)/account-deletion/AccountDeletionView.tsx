import type { PublicConfig } from "@/lib/admin/types";
import type { LegalLocale } from "@/lib/server/legal";
import { CustomerPageShell, SupportContacts, otherLanguageHref } from "../_components/CustomerPageShell";

type T = (key: string, values?: Record<string, string | number>) => string;

const REMOVED = ["profile", "addresses", "devices", "notes"] as const;
const KEPT = ["invoices", "payments", "records"] as const;
const STEPS = ["open", "bookings", "code", "signedOut"] as const;

/**
 * How to delete a Tarteeba account (customers §7.2; the store listings link here, Phase 6): what deletion removes and what
 * the law makes us keep, the cooling-off, and the two ways to ask (in the app, with a code sent to the registered phone, or
 * through support, who check who is asking and file it). It states the facts of the process, never a promise about a
 * date or an amount: the app shows the exact figures before the customer confirms.
 */
export function AccountDeletionView({ lang, support, graceDays, t, common }: { lang: LegalLocale; support: PublicConfig["support"] | null; graceDays: number | null; t: T; common: T }) {
  return (
    <CustomerPageShell lang={lang} switchHref={otherLanguageHref("/account-deletion", lang)} switchLabel={common("switchLanguage")}>
      <h1 className="text-[28px]/[38px] font-bold text-ink-900">{t("title")}</h1>
      <p className="mt-2 text-base/7 text-ink-900">{t("intro")}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section aria-labelledby="del-removed" className="rounded-lg bg-surface p-5 shadow-card">
          <h2 id="del-removed" className="text-lg/7 font-bold text-ink-900">
            {t("removedTitle")}
          </h2>
          <ul className="mt-2 list-disc ps-5 text-sm/6 text-ink-900">
            {REMOVED.map((k) => (
              <li key={k}>{t(`removed.${k}`)}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="del-kept" className="rounded-lg bg-surface p-5 shadow-card">
          <h2 id="del-kept" className="text-lg/7 font-bold text-ink-900">
            {t("keptTitle")}
          </h2>
          <ul className="mt-2 list-disc ps-5 text-sm/6 text-ink-900">
            {KEPT.map((k) => (
              <li key={k}>{t(`kept.${k}`)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-600">{t("keptNote")}</p>
        </section>
      </div>

      <section aria-labelledby="del-cooling" className="mt-4 rounded-lg bg-surface p-5 shadow-card">
        <h2 id="del-cooling" className="text-lg/7 font-bold text-ink-900">
          {t("coolingTitle")}
        </h2>
        <p className="mt-2 text-base/7 text-ink-900">{graceDays !== null ? t("coolingDays", { days: graceDays }) : t("coolingGeneric")}</p>
        <p className="mt-2 text-sm/6 text-ink-600">{t("coolingNote")}</p>
      </section>

      <section aria-labelledby="del-how" className="mt-4 rounded-lg bg-surface p-5 shadow-card">
        <h2 id="del-how" className="text-lg/7 font-bold text-ink-900">
          {t("howTitle")}
        </h2>
        <h3 className="mt-3 text-base font-bold text-ink-900">{t("inAppTitle")}</h3>
        <ol className="mt-1 list-decimal ps-5 text-sm/6 text-ink-900">
          {STEPS.map((k) => (
            <li key={k}>{t(`steps.${k}`)}</li>
          ))}
        </ol>
        <p className="mt-2 text-sm/6 text-ink-600">{t("cancelNote")}</p>
        <h3 className="mt-4 text-base font-bold text-ink-900">{t("supportTitle")}</h3>
        <p className="mt-1 text-sm/6 text-ink-900">{t("supportBody")}</p>
        <div className="mt-3">
          <SupportContacts support={support} t={(key) => t(key)} />
          {!support || (!support.phone && !support.whatsapp && !support.email) ? <p className="text-sm text-ink-600">{t("contactNone")}</p> : null}
        </div>
      </section>
    </CustomerPageShell>
  );
}
