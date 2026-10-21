import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.login");
  return { title: t("title") };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

// A01 Login & access (spec §17, §13.2; design AdminLogin.dc.html).
export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const t = await getTranslations("admin.login");
  const params = await searchParams;
  const reason = first(params.reason);

  return (
    <>
      <h1 className="text-[28px]/[38px] font-bold">{t("title")}</h1>
      <LoginForm next={first(params.next)} reason={reason === "expired" || reason === "signed_out" ? reason : null} />
      <p className="rounded-md bg-neutral-100 px-3.5 py-3 text-[13px]/5 font-medium text-ink-600">{t("lockoutNote")}</p>
    </>
  );
}
