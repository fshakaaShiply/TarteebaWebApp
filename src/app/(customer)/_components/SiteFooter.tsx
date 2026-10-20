import { getTranslations } from "next-intl/server";
import { Container } from "./Container";
import { Wordmark } from "./Wordmark";

export async function SiteFooter() {
  const t = await getTranslations("landing.footer");
  const nav = await getTranslations("landing.nav");

  return (
    <footer className="bg-ink-900 py-12 text-petrol-50">
      <Container className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div>
          <Wordmark inverted />
          <p className="mt-3 text-sm text-sage-300">{t("tagline")}</p>
        </div>
        <nav aria-label={nav("label")} className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {(["services", "how", "why", "faq"] as const).map((k) => (
            <a key={k} href={`#${k}`} className="text-petrol-50 hover:text-white">
              {nav(k)}
            </a>
          ))}
        </nav>
      </Container>
      <Container className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-sage-300 sm:flex-row sm:justify-between">
        <span>{t("rights", { year: new Date().getFullYear() })}</span>
        <span>{t("vat")}</span>
      </Container>
    </footer>
  );
}
