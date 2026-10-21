import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

// A01 sign-in pages (design AdminLogin.dc.html): brand panel at the start side, the form column beside it.
export default async function AdminAuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("admin.login");
  const common = await getTranslations("common");

  return (
    <div className="flex min-h-dvh flex-wrap">
      <section className="flex flex-[1_1_420px] flex-col justify-between gap-6 bg-petrol-700 p-8 text-white md:p-12">
        <div className="text-[36px] font-bold">
          {common("brand")} <span className="font-latin text-base font-medium text-sage-300">{t("brandSuffix")}</span>
        </div>
        <p className="max-w-[420px] text-xl/8 text-petrol-50">{t("intro")}</p>
        <div aria-hidden className="flex gap-2">
          <span className="size-12 rounded-pill bg-sage-300" />
          <span className="h-12 w-24 rounded-pill bg-apricot-400" />
          <span className="size-12 rounded-md bg-sage-100" />
        </div>
      </section>

      <main className="flex flex-[2_1_520px] items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[420px] flex-col gap-4">
          <div className="flex justify-end">
            <LocaleSwitcher className="border border-line text-ink-900" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
