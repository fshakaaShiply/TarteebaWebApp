import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { readLang } from "@/lib/server/legal";
import { EmailVerifiedView, emailStatus } from "./EmailVerifiedView";

export async function generateMetadata({ searchParams }: PageProps<"/email-verified">): Promise<Metadata> {
  const t = await getTranslations({ locale: readLang((await searchParams).lang), namespace: "customerWeb.emailVerified" });
  return { title: t("metaTitle") };
}

// The landing of the e-mail verification link (C21): ?status=verified|expired|invalid, ?lang=ar|en.
export default async function EmailVerifiedPage({ searchParams }: PageProps<"/email-verified">) {
  const query = await searchParams;
  const lang = readLang(query.lang);
  const [t, common] = await Promise.all([getTranslations({ locale: lang, namespace: "customerWeb.emailVerified" }), getTranslations({ locale: lang, namespace: "customerWeb.common" })]);
  return <EmailVerifiedView lang={lang} status={emailStatus(query.status)} t={t as never} common={common as never} />;
}
