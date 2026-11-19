import { renderLegalText } from "@/lib/legal/renderLegalText";
import type { LegalLocale, LegalPage, Loaded } from "@/lib/server/legal";
import { CustomerPageShell, otherLanguageHref } from "../../_components/CustomerPageShell";

type T = (key: string, values?: Record<string, string>) => string;

/** "1 October 2026" / "1 أكتوبر 2026": the day a version takes effect, Latin digits, no weekday (it is a legal date, not an appointment). */
export function policyDate(iso: string, lang: LegalLocale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(`${iso}T12:00:00Z`));
}

/**
 * One legal page (terms, privacy, cancellation; customers §7.2): its title, "Version 2026-10 · 1 October 2026" and the
 * text, rendered by the one renderer the A11 preview uses. It shows what the API publishes and nothing of its own, so a
 * policy is never quoted from here: the cancellation page itself says the fee and refund are shown with the amounts before
 * the customer confirms.
 */
export function PolicyView({
  slug,
  lang,
  state,
  t,
  common,
}: {
  slug: string;
  lang: LegalLocale;
  state: Loaded<LegalPage>;
  t: T;
  common: T;
}) {
  return (
    <CustomerPageShell lang={lang} switchHref={otherLanguageHref(`/policies/${slug}`, lang)} switchLabel={common("switchLanguage")}>
      {state.status === "ok" ? (
        <article aria-labelledby="policy-title">
          <h1 id="policy-title" className="text-[28px]/[38px] font-bold text-ink-900">
            {state.data.title}
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            {t("version", { version: state.data.version_label, date: policyDate(state.data.effective_date, lang) })}
          </p>
          <div className="mt-6">{renderLegalText(state.data.body)}</div>
        </article>
      ) : (
        <section role="alert" aria-labelledby="policy-unavailable">
          <h1 id="policy-unavailable" className="text-[24px]/[34px] font-bold text-ink-900">
            {t("unavailableTitle")}
          </h1>
          <p className="mt-2 text-base/7 text-ink-600">{t("unavailableBody")}</p>
        </section>
      )}
    </CustomerPageShell>
  );
}
