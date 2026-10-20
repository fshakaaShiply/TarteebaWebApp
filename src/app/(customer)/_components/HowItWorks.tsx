import { CalendarCheck, ClipboardList, Hourglass, MapPinCheck, Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container, SectionHeading } from "./Container";

const steps = [
  { n: 1, icon: ClipboardList },
  { n: 2, icon: CalendarCheck },
  { n: 3, icon: Hourglass },
  { n: 4, icon: MapPinCheck },
] as const;

export async function HowItWorks() {
  const t = await getTranslations("landing.how");

  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-20 py-16 sm:py-24">
      <Container>
        <SectionHeading id="how-title" title={t("title")} />

        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(({ n, icon: Icon }) => (
            <li key={n} className="relative rounded-lg bg-surface p-6 shadow-card">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-pill bg-petrol-700 font-latin text-base font-bold text-white">
                  {n}
                </span>
                <Icon aria-hidden className="size-6 text-petrol-700" strokeWidth={1.75} />
              </div>
              <h3 className="mt-5 text-lg/7 font-bold text-ink-900">{t(`step${n}Title`)}</h3>
              <p className="mt-2 text-[15px]/7 text-ink-600">{t(`step${n}Body`)}</p>
            </li>
          ))}
        </ol>

        <p className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-md bg-apricot-100 px-4 py-3.5 text-[15px]/7 font-medium text-warning-700">
          <Info aria-hidden className="mt-1 size-5 shrink-0" strokeWidth={1.75} />
          {t("note")}
        </p>
      </Container>
    </section>
  );
}
