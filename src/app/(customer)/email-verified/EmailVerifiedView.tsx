import { CircleAlert, CircleCheck, Clock } from "lucide-react";
import type { LegalLocale } from "@/lib/server/legal";
import { CustomerPageShell, otherLanguageHref } from "../_components/CustomerPageShell";

type T = (key: string) => string;

export const EMAIL_STATUSES = ["verified", "expired", "invalid"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** The `status` the API's link sends (302 → /email-verified?status=): anything else reads as an invalid link. */
export function emailStatus(value: unknown): EmailStatus {
  const first = Array.isArray(value) ? value[0] : value;
  return (EMAIL_STATUSES as readonly string[]).includes(first as string) ? (first as EmailStatus) : "invalid";
}

const ICONS = { verified: CircleCheck, expired: Clock, invalid: CircleAlert } as const;

/**
 * Where the e-mail verification link lands (customers §7.2, C21): verified, a link that has expired (the customer asks for
 * a new one in the app) or a link that is not valid. The page says what happened to the address and nothing about the
 * account: it has no session and shows no personal data.
 */
export function EmailVerifiedView({ lang, status, t, common }: { lang: LegalLocale; status: EmailStatus; t: T; common: T }) {
  const Icon = ICONS[status];
  return (
    <CustomerPageShell lang={lang} switchHref={otherLanguageHref("/email-verified", lang, { status })} switchLabel={common("switchLanguage")}>
      <section role="status" aria-labelledby="email-title" className="flex flex-col items-center gap-3 rounded-lg bg-surface p-8 text-center shadow-card">
        <Icon aria-hidden className={status === "verified" ? "size-10 text-success-700" : status === "expired" ? "size-10 text-warning-700" : "size-10 text-danger-700"} strokeWidth={1.75} />
        <h1 id="email-title" className="text-[24px]/[34px] font-bold text-ink-900">
          {t(`${status}.title`)}
        </h1>
        <p className="text-base/7 text-ink-600">{t(`${status}.body`)}</p>
        <p className="text-sm text-ink-600">{t("backToApp")}</p>
      </section>
    </CustomerPageShell>
  );
}
