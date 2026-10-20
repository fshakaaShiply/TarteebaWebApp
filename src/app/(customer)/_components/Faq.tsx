import { ChevronDown } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container, SectionHeading } from "./Container";

const items = [1, 2, 3, 4, 5, 6] as const;

export async function Faq() {
  const t = await getTranslations("landing.faq");

  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 bg-surface py-16 sm:py-24">
      <Container className="max-w-3xl">
        <SectionHeading id="faq-title" title={t("title")} />
        <div className="mt-10 divide-y divide-line rounded-lg border border-line bg-ivory-50">
          {items.map((n) => (
            <details key={n} className="group px-5 sm:px-6" name="faq">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px]/7 font-bold text-ink-900 [&::-webkit-details-marker]:hidden">
                {t(`q${n}`)}
                <ChevronDown
                  aria-hidden
                  className="size-5 shrink-0 text-petrol-700 transition-transform group-open:rotate-180"
                  strokeWidth={1.75}
                />
              </summary>
              <p className="pb-5 text-[15px]/7 text-ink-600">{t(`a${n}`)}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
