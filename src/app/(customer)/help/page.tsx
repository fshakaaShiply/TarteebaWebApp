import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getFaq, readLang } from "@/lib/server/legal";
import { getPublicConfig } from "@/lib/server/publicConfig";
import { HelpView } from "./HelpView";

export async function generateMetadata({ searchParams }: PageProps<"/help">): Promise<Metadata> {
  const t = await getTranslations({ locale: readLang((await searchParams).lang), namespace: "customerWeb.help" });
  return { title: t("title") };
}

// Help for the app's WebView (D-16): the support contacts and the FAQ, in ?lang=ar|en (Arabic by default).
export default async function HelpPage({ searchParams }: PageProps<"/help">) {
  const lang = readLang((await searchParams).lang);
  const [faq, config, t, common] = await Promise.all([
    getFaq(lang),
    getPublicConfig(),
    getTranslations({ locale: lang, namespace: "customerWeb.help" }),
    getTranslations({ locale: lang, namespace: "customerWeb.common" }),
  ]);
  return <HelpView lang={lang} faq={faq} support={config?.support ?? null} t={t as never} common={common as never} />;
}
