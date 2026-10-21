import { z } from "zod";
import { normalizeDigits, parseAedToFils } from "@/lib/money";
import type { Translatable } from "../types";

/*
 * zod building blocks for the A11 forms. Inputs stay strings (what the admin typed); the schemas turn them into the
 * API's types. Every issue message is a key under admin.catalog.errors (CATALOG_ERROR_KEYS lists them all, and a test
 * checks both languages have them), so the forms show our own copy; API messages (type "server") are shown as sent.
 */

export const CATALOG_ERROR_KEYS = [
  "required",
  "codeFormat",
  "couponCodeFormat",
  "zoneCodeFormat",
  "nameRequired",
  "textTooLong",
  "bilingualPair",
  "itemIncomplete",
  "itemsMax",
  "int",
  "duration",
  "workers",
  "maxWorkersBelowMin",
  "teamSizeOutOfRange",
  "sortOrder",
  "priority",
  "serviceRequired",
  "visitsPerWeek",
  "termWeeks",
  "termMonths",
  "percent0to100",
  "percent1to100",
  "minVisits",
  "maxSkips",
  "freezeDays",
  "serviceDays",
  "restDays",
  "workHours",
  "breakMinutes",
  "time",
  "windowOrder",
  "windowTooShort",
  "maxContracts",
  "usageLimit",
  "perCustomerLimit",
  "date",
  "dateRange",
  "money",
  "moneyRequired",
  "moneyPrecision",
  "moneyNegative",
  "moneyTooLarge",
  "moneyPositive",
  "travelBuffer",
  "hoursBefore",
  "tierHoursDistinct",
  "tiersRequired",
  "tiersMax",
  "maxPerBooking",
  "exceptionFormat",
  "exceptionDuplicate",
  "exceptionsMax",
  "sectionRequired",
  "json",
  "reasonRequired",
  "reasonLength",
] as const;

export type CatalogErrorKey = (typeof CATALOG_ERROR_KEYS)[number];

/** Largest amount the API accepts for any money field (CatalogWriteRequest::MAX_FILS). */
export const MAX_FILS = 100_000_000_000;
export const REASON_MAX = 500;

type Issue = CatalogErrorKey;

const fail = (ctx: z.RefinementCtx, message: Issue, path?: (string | number)[]) => {
  ctx.addIssue({ code: "custom", message, path });
  return z.NEVER;
};

/** "12" → 12; Arabic-Indic digits accepted; anything else is not a whole number. */
export function parseWholeNumber(raw: string): number | null {
  const v = normalizeDigits(raw).trim();
  return /^\d{1,12}$/.test(v) ? Number(v) : null;
}

/** A required whole number in [min, max] (optionally a multiple of `step`). */
export function intInput(message: Issue, min: number, max: number, step?: number) {
  return z.string().transform((raw, ctx): number => {
    if (raw.trim() === "") return fail(ctx, "required");
    const n = parseWholeNumber(raw);
    if (n === null || n < min || n > max || (step !== undefined && n % step !== 0)) return fail(ctx, message);
    return n;
  });
}

/** Like intInput, but empty means null ("not set"). */
export function optionalIntInput(message: Issue, min: number, max: number) {
  return z.string().transform((raw, ctx): number | null => {
    if (raw.trim() === "") return null;
    const n = parseWholeNumber(raw);
    if (n === null || n < min || n > max) return fail(ctx, message);
    return n;
  });
}

const MONEY_ERRORS: Record<string, Issue> = {
  empty: "moneyRequired",
  invalid: "money",
  precision: "moneyPrecision",
  negative: "moneyNegative",
  too_large: "moneyTooLarge",
};

/** Parses an AED amount typed by the admin into integer fils (no float math); `min` in fils. */
export function parseMoney(raw: string, min = 0): { ok: true; fils: number } | { ok: false; error: Issue } {
  const parsed = parseAedToFils(raw);
  if (!parsed.ok) return { ok: false, error: MONEY_ERRORS[parsed.error] ?? "money" };
  if (parsed.fils > MAX_FILS) return { ok: false, error: "moneyTooLarge" };
  if (parsed.fils < min) return { ok: false, error: "moneyPositive" };
  return { ok: true, fils: parsed.fils };
}

/** Required AED amount → fils. */
export function moneyInput(options: { min?: number } = {}) {
  return z.string().transform((raw, ctx): number => {
    const result = parseMoney(raw, options.min);
    return result.ok ? result.fils : fail(ctx, result.error);
  });
}

/** Optional AED amount → fils, or null when empty. */
export function optionalMoneyInput() {
  return z.string().transform((raw, ctx): number | null => {
    if (raw.trim() === "") return null;
    const result = parseMoney(raw);
    return result.ok ? result.fils : fail(ctx, result.error);
  });
}

/** Catalog codes (services, packages, plans, add-ons, policies): upper-cased like the API, ^[A-Z][A-Z0-9_]*$. */
export function catalogCodeInput() {
  return z.string().transform((raw, ctx): string => {
    const code = raw.trim().toUpperCase();
    if (code === "") return fail(ctx, "required");
    if (code.length > 40 || !/^[A-Z][A-Z0-9_]*$/.test(code)) return fail(ctx, "codeFormat");
    return code;
  });
}

/** Coupon codes: upper-case, 3–40 characters of A–Z, 0–9, "_" and "-" (CouponRequest). */
export function couponCodeInput() {
  return z.string().transform((raw, ctx): string => {
    const code = raw.trim().toUpperCase();
    if (code === "") return fail(ctx, "required");
    if (code.length < 3 || code.length > 40 || !/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) return fail(ctx, "couponCodeFormat");
    return code;
  });
}

/** Zone and sub-zone codes (StoreZoneRequest::CODE_PATTERN). */
export function zoneCodeInput() {
  return z.string().transform((raw, ctx): string => {
    const code = raw.trim().toUpperCase();
    if (code === "") return fail(ctx, "required");
    if (code.length > 40 || !/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) return fail(ctx, "zoneCodeFormat");
    return code;
  });
}

export const translatableValue = z.object({ ar: z.string(), en: z.string() });

/** {ar, en}, both required (spec §4.6). Errors land on name.ar / name.en. */
export function translatableInput(max: number) {
  return translatableValue.transform((value, ctx): Translatable => {
    const out = { ar: value.ar.trim(), en: value.en.trim() };
    let ok = true;
    for (const lang of ["ar", "en"] as const) {
      if (out[lang] === "") {
        fail(ctx, "nameRequired", [lang]);
        ok = false;
      } else if (out[lang].length > max) {
        fail(ctx, "textTooLong", [lang]);
        ok = false;
      }
    }
    return ok ? out : z.NEVER;
  });
}

/** Optional {ar, en}: both empty → null; otherwise both languages are needed. */
export function optionalTranslatableInput(max: number) {
  return translatableValue.transform((value, ctx): Translatable | null => {
    const out = { ar: value.ar.trim(), en: value.en.trim() };
    if (out.ar === "" && out.en === "") return null;
    let ok = true;
    for (const lang of ["ar", "en"] as const) {
      if (out[lang] === "") {
        fail(ctx, "bilingualPair", [lang]);
        ok = false;
      } else if (out[lang].length > max) {
        fail(ctx, "textTooLong", [lang]);
        ok = false;
      }
    }
    return ok ? out : z.NEVER;
  });
}

/** includes / excludes: rows of {ar, en}; fully empty rows are dropped, half-filled rows are errors. */
export function translatableListInput(maxItems = 30, max = 200) {
  return z.array(translatableValue).transform((rows, ctx): Translatable[] => {
    const out: Translatable[] = [];
    let ok = true;
    rows.forEach((row, i) => {
      const item = { ar: row.ar.trim(), en: row.en.trim() };
      if (item.ar === "" && item.en === "") return;
      for (const lang of ["ar", "en"] as const) {
        if (item[lang] === "") {
          fail(ctx, "itemIncomplete", [i, lang]);
          ok = false;
        } else if (item[lang].length > max) {
          fail(ctx, "textTooLong", [i, lang]);
          ok = false;
        }
      }
      out.push(item);
    });
    if (out.length > maxItems) {
      fail(ctx, "itemsMax");
      ok = false;
    }
    return ok ? out : z.NEVER;
  });
}

/** A <select> of record ids: "" → null. */
export const idSelect = z.string().transform((v): number | null => (v === "" ? null : Number(v)));

/** <input type="date"> value: "" → null, else YYYY-MM-DD. */
export const dateInput = z.string().transform((raw, ctx): string | null => {
  const v = raw.trim();
  if (v === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return fail(ctx, "date");
  return v;
});

/** "HH:MM" (24-hour). */
export const timeInput = z.string().transform((raw, ctx): string => {
  const v = normalizeDigits(raw).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return fail(ctx, "time");
  return v;
});

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Shared by every catalog write: the audit reason (required by our forms, optional for the API). */
export function checkReason(reason: string): CatalogErrorKey | null {
  const v = reason.trim();
  if (v === "") return "reasonRequired";
  if (v.length > REASON_MAX) return "reasonLength";
  return null;
}

/** Form text for an optional number. */
export const numText = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value));

export const emptyTranslatable = (): Translatable => ({ ar: "", en: "" });

/** Picks the UI-language text of a translatable field, falling back to Arabic (the primary language). */
export function pickText(value: Translatable | null | undefined, locale: string): string {
  if (!value) return "";
  return (locale === "en" ? value.en : value.ar) || value.ar || value.en || "";
}
