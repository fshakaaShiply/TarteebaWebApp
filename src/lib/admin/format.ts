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

/** The UTC offset of `timeZone` at an instant, in minutes east of UTC. */
function zoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - Math.floor(instant / 1000) * 1000) / 60_000);
}

/**
 * A wall-clock date and time in a time zone (business clock Asia/Dubai by default) as an ISO 8601 instant with that
 * moment's offset: ("2026-10-24", "09:20") → "2026-10-24T09:20:00+04:00". Spec §4.1: the UAE has no daylight saving,
 * but the offset is never assumed; it is read from the zone's rules for that date. Null for a malformed date or time.
 */
export function zonedDateTimeIso(date: string, time: string, timeZone: string = BUSINESS_TIME_ZONE): string | null {
  if (!isIsoDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // The offset at the instant this wall time names (a second pass settles a daylight-saving change in between).
  const guess = wall - zoneOffsetMinutes(wall, timeZone) * 60_000;
  const offset = zoneOffsetMinutes(guess, timeZone);
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date}T${time}:00${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
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

/**
 * Text set into a translated sentence as its own bidi run: a first-strong isolate (U+2068 … U+2069) for names, a
 * left-to-right isolate (U+2066) for codes and times. A Latin name ending in "." then keeps its period at its end in
 * an Arabic sentence ("Maria S.", never ".Maria S"), and an Arabic name stays whole in English. Elements use <bdi>.
 */
export function isolate(text: string, dir: "auto" | "ltr" = "auto"): string {
  return `${dir === "ltr" ? "\u2066" : "\u2068"}${text}\u2069`;
}

/**
 * A sentence that ends with an isolated name: the sentence's own "." after a name that already ends with a mark is
 * dropped ("serving: \u2068Siti R.\u2069." reads "Siti R.." otherwise), as the API's TemplateRenderer does (P4-265).
 */
export function endAfterName(sentence: string): string {
  return sentence.replace(/([.!?\u061f\u2026]\u2069)\.$/u, "$1");
}

const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u;

/**
 * The direction of a text from its first strong letter outside isolates (U+2066/U+2067/U+2068 \u2026 U+2069), as the
 * Unicode bidi algorithm's rule P2 finds it; "auto" without one. A browser's dir="auto" does not skip isolates, so an
 * Arabic alert that starts with an isolated Latin name ("\u2068Omar Khalid\u2069 \u00b7 \u0627\u0634\u062a\u0631\u0627\u0643 \u0634\u0647\u0631\u064a \u2026", P4-265) would read left to
 * right there; the SMS and push copies of the same text read right to left.
 */
export function textDir(text: string | null | undefined): "rtl" | "ltr" | "auto" {
  let depth = 0;
  for (const ch of text ?? "") {
    if (ch === "\u2066" || ch === "\u2067" || ch === "\u2068") depth++;
    else if (ch === "\u2069") depth = Math.max(0, depth - 1);
    else if (depth > 0) continue;
    else if (ch === "\u200f") return "rtl";
    else if (ch === "\u200e") return "ltr";
    else if (/\p{L}/u.test(ch)) return RTL_SCRIPT.test(ch) ? "rtl" : "ltr";
  }
  return "auto";
}
