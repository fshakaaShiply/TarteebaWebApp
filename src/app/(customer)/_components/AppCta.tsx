import { Smartphone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container } from "./Container";

// Store links go live with the store listings (spec §25 Phase 6); until then the badges are inert.
export async function AppCta() {
  const t = await getTranslations("landing.app");
  const stores = [t("appStore"), t("googlePlay")];

  return (
    <section id="app" aria-labelledby="app-title" className="scroll-mt-20 py-16 sm:py-24">
      <Container>
        <div className="flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-12 text-center shadow-card sm:px-12">
          <span className="flex size-14 items-center justify-center rounded-lg bg-petrol-700">
            <Smartphone aria-hidden className="size-7 text-white" strokeWidth={1.75} />
          </span>
          <h2 id="app-title" className="mt-6 text-[28px]/[38px] font-bold text-ink-900 sm:text-[34px]/[46px]">
            {t("title")}
          </h2>
          <p className="mt-3 max-w-xl text-lg/8 text-ink-600">{t("body")}</p>
          <ul className="mt-8 flex flex-wrap justify-center gap-3">
            {stores.map((store) => (
              <li
                key={store}
                className="flex h-14 min-w-[180px] flex-col items-center justify-center rounded-md bg-ink-900 px-5 text-white"
              >
                <span className="font-latin text-base font-semibold">{store}</span>
                <span className="text-xs text-sage-300">{t("soon")}</span>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
