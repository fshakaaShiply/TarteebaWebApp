import { getTranslations } from "next-intl/server";

// Driver D01–D03 live in the mobile app (decision R-04); this route is the optional web fallback.
export default async function DriverHome() {
  const t = await getTranslations("driver");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-md rounded-lg bg-surface p-8 text-center shadow-card">
        <h1 className="text-ar-title">{t("title")}</h1>
        <p className="mt-3 text-ink-600">{t("body")}</p>
      </section>
    </main>
  );
}
