import { Clock, CreditCard, Heart, MessageSquareHeart, Receipt, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container, SectionHeading } from "./Container";

const reasons = [
  { key: "punctual", icon: Clock },
  { key: "preferred", icon: Heart },
  { key: "trained", icon: ShieldCheck },
  { key: "clear", icon: Receipt },
  { key: "secure", icon: CreditCard },
  { key: "care", icon: MessageSquareHeart },
] as const;

export async function WhyUs() {
  const t = await getTranslations("landing.why");

  return (
    <section id="why" aria-labelledby="why-title" className="scroll-mt-20 bg-surface py-16 sm:py-24">
      <Container>
        <SectionHeading id="why-title" title={t("title")} />
        <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {reasons.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-sage-100">
                <Icon aria-hidden className="size-6 text-success-700" strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="text-lg/7 font-bold text-ink-900">{t(`${key}Title`)}</h3>
                <p className="mt-1.5 text-[15px]/7 text-ink-600">{t(`${key}Body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
