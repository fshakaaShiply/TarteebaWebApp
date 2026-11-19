import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./Wordmark";

/**
 * The frame of the customer web pages the app opens in its WebView (policies, help, account deletion, e-mail verified, data
 * copy; D-16): the wordmark, a link to the same page in the other language, and a narrow reading column. The page speaks
 * the language of `?lang=` (Arabic when absent), not the cookie's: the app links with it, and a customer opening a link
 * from an SMS or an e-mail has no cookie. `lang` and `dir` are set on the wrapper, so the text keeps its direction whatever
 * the document's own locale is.
 */
export function CustomerPageShell({
  lang,
  switchHref,
  switchLabel,
  children,
}: {
  lang: "ar" | "en";
  /** The same page in the other language. */
  switchHref: string;
  /** The other language's name, written in that language. */
  switchLabel: string;
  children: ReactNode;
}) {
  const other = lang === "ar" ? "en" : "ar";
  return (
    <div lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`min-h-dvh bg-ivory-50 ${lang === "ar" ? "font-arabic" : "font-latin"}`}>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-2xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Tarteeba" className="shrink-0">
            <Wordmark />
          </Link>
          <a href={switchHref} lang={other} hrefLang={other} className="touch-target inline-flex items-center text-sm font-medium">
            {switchLabel}
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

/** `?lang=` toggled, the page's other parameters kept (a data copy's link carries its signature). */
export function otherLanguageHref(path: string, lang: "ar" | "en", params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && key !== "lang") query.set(key, value);
  query.set("lang", lang === "ar" ? "en" : "ar");
  return `${path}?${query.toString()}`;
}

/**
 * A link the customer taps in the app's WebView: at least 44 px tall (the phase's touch-target rule) and as wide as its
 * text, so links stacked or side by side never share a tap area. The height is real, not a pseudo-element's hit area: a
 * 44 px overlay on a 20 px line would reach into the link next to it.
 */
export const TAP_LINK = "inline-flex min-h-11 items-center font-medium";

/** A support contact line: the phone and e-mail are Latin text, isolated so they keep their order in Arabic. */
export function SupportContacts({
  support,
  t,
}: {
  support: { phone: string | null; whatsapp: string | null; email: string | null } | null;
  t: (key: "call" | "whatsapp" | "email") => string;
}) {
  const whatsapp = support?.whatsapp ? support.whatsapp.replace(/\D/g, "") : null;
  if (!support || (!support.phone && !whatsapp && !support.email)) return null;
  return (
    <ul className="flex flex-col text-sm">
      {support.phone && (
        <li>
          <a href={`tel:${support.phone}`} className={`${TAP_LINK} gap-1`}>
            {t("call")}{" "}
            <bdi dir="ltr" className="font-latin">
              {support.phone}
            </bdi>
          </a>
        </li>
      )}
      {whatsapp && (
        <li>
          <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className={TAP_LINK}>
            {t("whatsapp")}
          </a>
        </li>
      )}
      {support.email && (
        <li>
          <a href={`mailto:${support.email}`} className={TAP_LINK}>
            <bdi dir="ltr" className="font-latin">
              {support.email}
            </bdi>
          </a>
        </li>
      )}
    </ul>
  );
}
