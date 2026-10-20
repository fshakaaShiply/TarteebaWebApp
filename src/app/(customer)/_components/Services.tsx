import { Check, Repeat, Sparkles, Sun, type LucideIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { getFromPrices, type PublicPrice, type ServiceKind } from "@/lib/catalog";
import { formatAed } from "@/lib/money";
import { Container, SectionHeading } from "./Container";

const services: { kind: ServiceKind; key: "visit" | "recurring" | "liveOut"; icon: LucideIcon; featured?: boolean }[] = [
  { kind: "standard_visit", key: "visit", icon: Sparkles },
  { kind: "recurring", key: "recurring", icon: Repeat, featured: true },
  { kind: "live_out", key: "liveOut", icon: Sun },
];

export async function Services() {
  const t = await getTranslations("landing.services");
  const locale = await getLocale();
  const prices = await getFromPrices();

  const priceLine = (p: PublicPrice | undefined) =>
    p
      ? `${t("from", { price: formatAed(p.from_fils, locale) })} ${p.unit === "per_month" ? t("perMonth") : t("perWorker")}`
      : null;

  return (
    <section id="services" aria-labelledby="services-title" className="scroll-mt-20 bg-surface py-16 sm:py-24">
      <Container>
        <SectionHeading id="services-title" title={t("title")} body={t("body")} />

        <ul className="mt-12 grid gap-5 md:grid-cols-3">
          {services.map(({ kind, key, icon: Icon, featured }) => {
            const price = priceLine(prices[kind]);
            return (
              <li
                key={kind}
                className={`flex flex-col rounded-lg border p-6 ${
                  featured ? "border-petrol-700 bg-petrol-50" : "border-line bg-ivory-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex size-12 items-center justify-center rounded-md bg-petrol-700">
                    <Icon aria-hidden className="size-6 text-white" strokeWidth={1.75} />
                  </span>
                  {key === "liveOut" && (
                    <span className="rounded-pill bg-apricot-100 px-2.5 py-1 font-latin text-xs font-semibold text-warning-700">
                      {t("liveOut.badge")}
                    </span>
                  )}
                </div>
                <h3 className="mt-5 text-[22px]/8 font-bold text-ink-900">{t(`${key}.title`)}</h3>
                {price && <p className="mt-1 text-[15px] font-bold text-petrol-700">{price}</p>}
                <p className="mt-3 text-[15px]/7 text-ink-600">{t(`${key}.body`)}</p>
                <ul className="mt-5 flex flex-col gap-2.5 border-t border-line pt-5">
                  {(["point1", "point2", "point3"] as const).map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-[15px]/6 text-ink-900">
                      <Check aria-hidden className="mt-0.5 size-[18px] shrink-0 text-success-700" strokeWidth={2} />
                      {t(`${key}.${p}`)}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 text-center text-sm text-ink-600">{t("excluded")}</p>
      </Container>
    </section>
  );
}
