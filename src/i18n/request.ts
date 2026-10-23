import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, localeCookie, type Locale } from "./config";

// No locale prefix in URLs (paths stay /admin, /driver): the locale comes from the cookie,
// then the browser's Accept-Language, then Arabic.
async function resolveLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(localeCookie)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const accept = (await headers()).get("accept-language") ?? "";
  const preferred = accept.split(",")[0]?.trim().slice(0, 2);
  return isLocale(preferred) ? preferred : defaultLocale;
}

// An explicit locale (`getTranslations({ locale: "en" })`, e.g. the bilingual payment result page) wins.
export default getRequestConfig(async ({ locale: requested }) => {
  const locale = isLocale(requested) ? requested : await resolveLocale();
  return {
    locale,
    timeZone: "Asia/Dubai",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
