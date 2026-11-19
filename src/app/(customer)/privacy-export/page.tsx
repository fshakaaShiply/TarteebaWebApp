import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { readLang } from "@/lib/server/legal";
import { CustomerPageShell, otherLanguageHref } from "../_components/CustomerPageShell";
import { PrivacyExportFlow } from "./PrivacyExportFlow";

export async function generateMetadata({ searchParams }: PageProps<"/privacy-export">): Promise<Metadata> {
  const t = await getTranslations({ locale: readLang((await searchParams).lang), namespace: "customerWeb.privacyExport" });
  // The link carries a signature: no indexing, and the address is not leaked in a referrer.
  return { title: t("metaTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

function one(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first !== "" ? first : null;
}

// The download of a data copy (C23 export, P5-C54): the SMS link lands here as ?request=&expires=&signature= (or ?status=
// expired|invalid), ?lang=ar|en. The page speaks to the API through the /backend proxy and keeps nothing of the link.
export default async function PrivacyExportPage({ searchParams }: PageProps<"/privacy-export">) {
  const query = await searchParams;
  const lang = readLang(query.lang);
  const status = one(query.status);
  const [messages, common] = await Promise.all([getMessages({ locale: lang }), getTranslations({ locale: lang, namespace: "customerWeb.common" })]);
  const request = one(query.request);
  const expires = one(query.expires);
  const signature = one(query.signature);
  const only = { customerWeb: { privacyExport: (messages as { customerWeb: { privacyExport: unknown } }).customerWeb.privacyExport } };
  return (
    <CustomerPageShell lang={lang} switchHref={otherLanguageHref("/privacy-export", lang, { request: request ?? undefined, expires: expires ?? undefined, signature: signature ?? undefined, status: status ?? undefined })} switchLabel={common("switchLanguage")}>
      <NextIntlClientProvider locale={lang} messages={only as never}>
        <PrivacyExportFlow lang={lang} request={request} expires={expires} signature={signature} status={status === "expired" ? "expired" : status === "invalid" ? "invalid" : null} />
      </NextIntlClientProvider>
    </CustomerPageShell>
  );
}
