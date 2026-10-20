import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

// Customer web (spec §3.2): policies, help, invoices and payment return pages live under this group.
export default async function CustomerHome() {
  const t = await getTranslations("home");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-md rounded-lg bg-surface p-8 text-center shadow-card">
        <div aria-hidden className="relative mx-auto mb-5 size-14 rounded-lg bg-petrol-700">
          <span className="absolute end-2.5 top-2.5 size-3 rounded-pill bg-apricot-400" />
        </div>
        <h1 className="text-ar-display text-petrol-700">{t("title")}</h1>
        <p className="mt-3 text-ink-600">{t("tagline")}</p>
        <p className="mt-2 text-sm text-ink-600">{t("body")}</p>
        <LocaleSwitcher className="mt-6" />
      </section>
    </main>
  );
}
