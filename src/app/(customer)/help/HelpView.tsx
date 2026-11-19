import type { PublicConfig } from "@/lib/admin/types";
import type { FaqEntry, LegalLocale, Loaded } from "@/lib/server/legal";
import { CustomerPageShell, SupportContacts, otherLanguageHref } from "../_components/CustomerPageShell";

type T = (key: string, values?: Record<string, string>) => string;

/**
 * Help (customers §7.2): the contact options the API publishes (each hidden when unset) and the FAQ, in the order staff set
 * it. The answers are the API's own text, placeholders already filled in, so the page never states a policy value itself.
 * A support request is made in the app (Help → Support request), which the page says.
 */
export function HelpView({ lang, faq, support, t, common }: { lang: LegalLocale; faq: Loaded<FaqEntry[]>; support: PublicConfig["support"] | null; t: T; common: T }) {
  return (
    <CustomerPageShell lang={lang} switchHref={otherLanguageHref("/help", lang)} switchLabel={common("switchLanguage")}>
      <h1 className="text-[28px]/[38px] font-bold text-ink-900">{t("title")}</h1>
      <p className="mt-2 text-base/7 text-ink-600">{t("subtitle")}</p>

      <section aria-labelledby="help-contact" className="mt-6 rounded-lg bg-surface p-5 shadow-card">
        <h2 id="help-contact" className="text-lg/7 font-bold text-ink-900">
          {t("contactTitle")}
        </h2>
        <div className="mt-3">
          <SupportContacts support={support} t={(key) => t(key)} />
          {!support || (!support.phone && !support.whatsapp && !support.email) ? <p className="text-sm text-ink-600">{t("contactNone")}</p> : null}
        </div>
        <p className="mt-3 text-sm text-ink-600">{t("supportRequest")}</p>
      </section>

      <section aria-labelledby="help-faq" className="mt-6">
        <h2 id="help-faq" className="text-lg/7 font-bold text-ink-900">
          {t("faqTitle")}
        </h2>
        {faq.status === "ok" && faq.data.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {faq.data.map((item) => (
              <li key={item.id}>
                <details className="group rounded-lg bg-surface p-4 shadow-card">
                  <summary className="cursor-pointer text-base font-bold text-ink-900">{item.question}</summary>
                  <p className="mt-2 whitespace-pre-line text-base/7 text-ink-900">{item.answer}</p>
                </details>
              </li>
            ))}
          </ul>
        ) : faq.status === "ok" ? (
          <p className="mt-3 text-base text-ink-600">{t("faqEmpty")}</p>
        ) : (
          <p role="alert" className="mt-3 text-base text-ink-600">
            {t("faqUnavailable")}
          </p>
        )}
      </section>

      <nav aria-label={t("policiesTitle")} className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {(["terms", "privacy", "cancellation"] as const).map((slug) => (
          <a key={slug} href={`/policies/${slug}?lang=${lang}`} className="font-medium">
            {t(`policies.${slug}`)}
          </a>
        ))}
      </nav>
    </CustomerPageShell>
  );
}
