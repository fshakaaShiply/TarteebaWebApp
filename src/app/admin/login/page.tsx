import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.login");
  return { title: t("title") };
}

// A01 Login & access (spec §17, design AdminLogin.dc.html).
export default async function AdminLoginPage() {
  const t = await getTranslations("admin.login");
  const common = await getTranslations("common");

  return (
    <div className="flex min-h-dvh flex-wrap">
      <section className="flex flex-[1_1_420px] flex-col justify-between gap-6 bg-petrol-700 p-12 text-white">
        <div className="text-[36px] font-bold">
          {common("brand")} <span className="text-base font-medium text-sage-300">{t("brandSuffix")}</span>
        </div>
        <p className="max-w-[420px] text-xl/8 text-petrol-50">{t("intro")}</p>
        <div aria-hidden className="flex gap-2">
          <span className="size-12 rounded-pill bg-sage-300" />
          <span className="h-12 w-24 rounded-pill bg-apricot-400" />
          <span className="size-12 rounded-md bg-sage-100" />
        </div>
      </section>

      <section className="flex flex-[2_1_520px] items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[420px] flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-[28px]/[38px] font-bold">{t("title")}</h1>
            <LocaleSwitcher />
          </div>
          <LoginForm />
          <p className="rounded-md bg-neutral-100 px-3.5 py-3 text-[13px]/5 font-medium text-ink-600">
            {t("lockoutNote")}
          </p>
        </div>
      </section>
    </div>
  );
}
