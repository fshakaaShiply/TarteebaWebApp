// Dates and times in the admin panel: always Asia/Dubai wall-clock time (spec §4.1) with Latin digits in both
// languages (D-13), whatever the browser's own time zone is.

export const BUSINESS_TIME_ZONE = "Asia/Dubai";

function intlLocale(locale: string): string {
  return locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB";
}

type Input = string | number | Date | null | undefined;

function toDate(value: Input): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "الثلاثاء، 20 أكتوبر 2026" / "Tuesday 20 October 2026" */
export function formatLongDate(value: Input, locale: string): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(date);
}

/** "20 أكتوبر 2026، 09:12" / "20 Oct 2026, 09:12" (24-hour). */
export function formatDateTime(value: Input, locale: string): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(date);
}
