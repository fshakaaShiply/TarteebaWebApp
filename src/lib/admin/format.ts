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

/** A local date "YYYY-MM-DD" (no time): "الثلاثاء، 20 أكتوبر 2026" / "Tuesday 20 October 2026". */
export function formatIsoDate(value: string | null | undefined, locale: string, style: "long" | "short" = "long"): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? "";
  // Noon UTC is the same calendar day in Asia/Dubai (UTC+4).
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    ...(style === "long" ? { weekday: "long", month: "long" } : { weekday: "short", month: "short" }),
    day: "numeric",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(date);
}

/** The month of a local date: "أكتوبر 2026" / "October 2026". */
export function formatMonth(value: string | null | undefined, locale: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? "";
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

/** The day of the month of a local date, Latin digits: "24". */
export function dayOfMonth(value: string): string {
  return String(Number(value.slice(8, 10)));
}

/** Today's business date "YYYY-MM-DD" in Asia/Dubai, whatever the browser's time zone. */
export function businessToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "YYYY-MM-DD" plus `days` (calendar arithmetic in UTC, so no daylight-saving surprises). */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` ("YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** True for a real calendar date written "YYYY-MM-DD" (no 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
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
