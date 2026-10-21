import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.reset");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// A01 password reset, also used by A13 invitations: /admin/reset-password?token=…&email=… (P1-12).
export default async function ResetPasswordPage({ searchParams }: PageProps<"/admin/reset-password">) {
  const t = await getTranslations("admin.reset");
  const params = await searchParams;
  return (
    <>
      <h1 className="text-[28px]/[38px] font-bold">{t("title")}</h1>
      <p className="text-sm/6 text-ink-600">{t("intro")}</p>
      <ResetPasswordForm token={first(params.token)} email={first(params.email)} />
    </>
  );
}
