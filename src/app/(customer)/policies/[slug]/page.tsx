import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getLegalPage, isLegalSlug, readLang } from "@/lib/server/legal";
import { PolicyView } from "./PolicyView";

export async function generateMetadata({ params, searchParams }: PageProps<"/policies/[slug]">): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  if (!isLegalSlug(slug)) return {};
  const t = await getTranslations({ locale: readLang(query.lang), namespace: "customerWeb.policies" });
  return { title: t(`slugs.${slug}`) };
}

// A legal page for the app's WebView (D-16): /policies/{terms|privacy|cancellation}?lang=ar|en, from the API's published
// version. An unknown slug, or a page the API has no published version of, is a 404.
export default async function PolicyPage({ params, searchParams }: PageProps<"/policies/[slug]">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  if (!isLegalSlug(slug)) notFound();
  const lang = readLang(query.lang);
  const state = await getLegalPage(slug, lang);
  if (state.status === "not_found") notFound();
  const [t, common] = await Promise.all([getTranslations({ locale: lang, namespace: "customerWeb.policies" }), getTranslations({ locale: lang, namespace: "customerWeb.common" })]);
  return <PolicyView slug={slug} lang={lang} state={state} t={t as never} common={common as never} />;
}
