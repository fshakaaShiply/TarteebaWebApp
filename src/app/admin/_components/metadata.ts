import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/** Page title from the navigation label (admin.nav.<key>), e.g. `export const generateMetadata = () => navMetadata("settings")`. */
export async function navMetadata(key: string): Promise<Metadata> {
  const t = await getTranslations("admin.nav");
  return { title: t(key) };
}
