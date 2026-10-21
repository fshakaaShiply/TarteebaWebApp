import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.forgot");
  return { title: t("title") };
}

// A01 forgot password (spec §13.2).
export default async function ForgotPasswordPage() {
  const t = await getTranslations("admin.forgot");
  return (
    <>
      <h1 className="text-[28px]/[38px] font-bold">{t("title")}</h1>
      <p className="text-sm/6 text-ink-600">{t("intro")}</p>
      <ForgotPasswordForm />
    </>
  );
}
