import { MapPin } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Container } from "./Container";

// Service zones are settings (spec §6.2, D-15), so the page names no specific areas; the app checks the address.
export async function Areas() {
  const t = await getTranslations("landing.areas");

  return (
    <section aria-labelledby="areas-title" className="py-16 sm:py-24">
      <Container>
        <div className="grid items-center gap-8 overflow-hidden rounded-xl bg-petrol-700 p-8 text-white sm:p-12 md:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 id="areas-title" className="text-[28px]/[38px] font-bold sm:text-[34px]/[46px]">
              {t("title")}
            </h2>
            <p className="mt-4 max-w-xl text-lg/8 text-petrol-50">{t("body")}</p>
            <a
              href="#app"
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-md bg-surface px-5 font-bold text-petrol-700 hover:bg-petrol-50 hover:text-petrol-800"
            >
              <MapPin aria-hidden className="size-5" strokeWidth={1.75} />
              {t("cta")}
            </a>
          </div>

          {/* Abstract zone map: dots for coverage, no real boundaries. */}
          <svg viewBox="0 0 260 200" aria-hidden className="mx-auto h-auto w-full max-w-[300px]">
            <path
              d="M30 150 C 20 90, 70 40, 130 34 C 196 28, 238 70, 232 120 C 226 170, 168 182, 118 176 C 70 172, 36 176, 30 150 Z"
              fill="var(--color-petrol-800)"
            />
            {[
              [80, 110],
              [110, 80],
              [140, 120],
              [170, 90],
              [196, 128],
              [124, 150],
            ].map(([cx, cy], i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r="14" fill="var(--color-sage-300)" opacity="0.35" />
                <circle cx={cx} cy={cy} r="5" fill={i === 2 ? "var(--color-apricot-400)" : "var(--color-sage-300)"} />
              </g>
            ))}
          </svg>
        </div>
      </Container>
    </section>
  );
}
