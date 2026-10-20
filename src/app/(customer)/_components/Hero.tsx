import { Car, CheckCircle2, Receipt, UserCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container } from "./Container";
import { HeroIllustration } from "./HeroIllustration";

export async function Hero() {
  const t = await getTranslations("landing.hero");
  const points = [
    { icon: UserCheck, text: t("point1") },
    { icon: Car, text: t("point2") },
    { icon: Receipt, text: t("point3") },
  ];

  return (
    <section aria-labelledby="hero-title" className="overflow-hidden">
      <Container className="grid items-center gap-10 py-12 sm:py-16 md:grid-cols-[1.1fr_1fr] md:py-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-pill bg-sage-100 px-3 py-1 text-sm font-medium text-success-700">
            <CheckCircle2 aria-hidden className="size-4" strokeWidth={1.75} />
            {t("eyebrow")}
          </span>
          <h1
            id="hero-title"
            className="mt-5 text-[40px]/[52px] font-bold text-petrol-700 sm:text-[52px]/[66px] lg:text-[60px]/[74px]"
          >
            {t("title")}
          </h1>
          <p className="mt-5 max-w-xl text-lg/8 text-ink-600">{t("body")}</p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#app"
              className="inline-flex h-[52px] items-center rounded-md bg-petrol-700 px-6 text-base font-bold text-white hover:bg-petrol-800 hover:text-white"
            >
              {t("primary")}
            </a>
            <a
              href="#services"
              className="inline-flex h-[52px] items-center rounded-md border border-petrol-700 px-6 text-base font-bold text-petrol-700 hover:bg-petrol-50"
            >
              {t("secondary")}
            </a>
          </div>

          <ul className="mt-10 grid gap-3 sm:grid-cols-3">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2.5 text-[15px] font-medium text-ink-900">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-surface shadow-card">
                  <Icon aria-hidden className="size-[18px] text-petrol-700" strokeWidth={1.75} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center md:justify-end">
          <HeroIllustration />
        </div>
      </Container>
    </section>
  );
}
