import { Menu } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Container } from "./Container";
import { Wordmark } from "./Wordmark";

const links = [
  { href: "#services", key: "services" },
  { href: "#how", key: "how" },
  { href: "#why", key: "why" },
  { href: "#faq", key: "faq" },
] as const;

export async function SiteHeader() {
  const t = await getTranslations("landing.nav");

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ivory-50/90 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-4">
        <a href="#top" className="shrink-0" aria-label="Tarteeba">
          <Wordmark />
        </a>

        <nav aria-label={t("label")} className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a key={l.key} href={l.href} className="text-[15px] font-medium text-ink-900 hover:text-petrol-700">
              {t(l.key)}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LocaleSwitcher className="text-ink-900" />
          <a
            href="#app"
            className="hidden h-10 items-center rounded-md bg-petrol-700 px-4 text-sm font-bold text-white hover:bg-petrol-800 hover:text-white sm:inline-flex"
          >
            {t("getApp")}
          </a>

          {/* Small screens: a no-JS disclosure menu. */}
          <details className="group relative md:hidden">
            <summary
              aria-label={t("menu")}
              className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-line bg-surface [&::-webkit-details-marker]:hidden"
            >
              <Menu aria-hidden className="size-5 text-ink-900" strokeWidth={1.75} />
            </summary>
            <nav
              aria-label={t("label")}
              className="absolute end-0 top-12 flex w-56 flex-col rounded-lg border border-line bg-surface p-2 shadow-card"
            >
              {links.map((l) => (
                <a key={l.key} href={l.href} className="rounded-sm px-3 py-2.5 font-medium text-ink-900 hover:bg-petrol-50">
                  {t(l.key)}
                </a>
              ))}
              <a href="#app" className="mt-1 rounded-sm bg-petrol-700 px-3 py-2.5 text-center font-bold text-white hover:text-white">
                {t("getApp")}
              </a>
            </nav>
          </details>
        </div>
      </Container>
    </header>
  );
}
