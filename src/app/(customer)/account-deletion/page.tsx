import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { readLang } from "@/lib/server/legal";
import { getPublicConfig } from "@/lib/server/publicConfig";
import { AccountDeletionView } from "./AccountDeletionView";

export async function generateMetadata({ searchParams }: PageProps<"/account-deletion">): Promise<Metadata> {
  const t = await getTranslations({ locale: readLang((await searchParams).lang), namespace: "customerWeb.accountDeletion" });
  return { title: t("title") };
}

// How to delete an account, for the app's WebView and the store listings (D-16, Phase 6): ?lang=ar|en.
export default async function AccountDeletionPage({ searchParams }: PageProps<"/account-deletion">) {
  const lang = readLang((await searchParams).lang);
  const [config, t, common] = await Promise.all([
    getPublicConfig(),
    getTranslations({ locale: lang, namespace: "customerWeb.accountDeletion" }),
    getTranslations({ locale: lang, namespace: "customerWeb.common" }),
  ]);
  return (
    <AccountDeletionView
      lang={lang}
      support={config?.support ?? null}
      graceDays={config?.deletion_grace_days ?? null}
      walletEnabled={config?.wallet_enabled === true}
      t={t as never}
      common={common as never}
    />
  );
}
