import { filsToAedInput, normalizeDigits, parseAedToFils } from "@/lib/money";
import { isIsoDate } from "./format";
import {
  serializeWeeklyDraft,
  toWeeklyDraft,
  validateWeeklyDraft,
  WEEK_ORDER,
  type WeeklyHoursDraft,
} from "./ops/weeklyHours";
import type { Setting } from "./types";

/*
 * A11 global settings (spec §21): which editor each setting gets, and turning what the admin typed into the JSON
 * value PUT /admin/settings/{key} expects. The API checks the type again (INVALID_SETTING_VALUE); these checks give
 * the admin a clear message before saving.
 */

export type EditorKind =
  | "int"
  | "money"
  | "bool"
  | "enum"
  | "string"
  | "chips"
  | "json-list"
  | "time_range"
  | "json"
  /** booking.working_hours: seven weekday rows (R-13). */
  | "weekly_hours"
  /** calendar.public_holidays: a sorted list of YYYY-MM-DD dates. */
  | "dates"
  /** reminder.day_before_time: one local wall-clock time "HH:MM" (a string setting). */
  | "time"
  /** refund.estimated_arrival_text: the same text in Arabic and English, {ar, en} (a json setting). */
  | "bilingual";

/** List settings whose items are local dates (edited with a date picker, saved sorted without duplicates). */
export const DATE_LIST_SETTINGS: readonly string[] = ["calendar.public_holidays"];

/** String settings holding one 24-hour time (the API refuses anything but HH:MM for them). */
export const TIME_SETTINGS: readonly string[] = ["reminder.day_before_time"];

/** JSON settings holding one text in both languages (the API wants exactly {ar, en}, neither empty). */
export const BILINGUAL_TEXT_SETTINGS: readonly string[] = ["refund.estimated_arrival_text"];

export type BilingualDraft = { ar: string; en: string };

/**
 * Modes the API code understands for some string settings (from SettingsDefaults descriptions). A value outside the
 * list is still offered so nothing set elsewhere is lost.
 */
export const SETTING_OPTIONS: Readonly<Record<string, { messageKey: string; values: readonly string[] }>> = {
  "locale.default": { messageKey: "locale", values: ["ar", "en"] },
  "digits.style": { messageKey: "digits", values: ["latin", "arabic"] },
  "live_out.block_scope": { messageKey: "blockScope", values: ["whole_day", "window"] },
  "payments.mode": { messageKey: "paymentsMode", values: ["authorize_capture", "sale_then_refund"] },
};

export type SettingDraft = string | boolean | string[] | WeeklyHoursDraft | BilingualDraft;

export type SettingDraftError =
  | "hours_format"
  | "hours_order"
  | "date_format"
  | "date_duplicate"
  | "required"
  | "int"
  | "int_min"
  | "money"
  | "money_precision"
  | "money_negative"
  | "text_required"
  | "option"
  | "list_empty_item"
  | "list_duplicate"
  | "json"
  | "json_array"
  | "json_object"
  | "time_format"
  | "time_order"
  | "time"
  | "bilingual_required";

export type DraftResult = { ok: true; value: unknown } | { ok: false; error: SettingDraftError };

/** {ar, en} with text in both (or a value not set yet). */
function isBilingualValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2 && keys[0] === "ar" && keys[1] === "en" && typeof value.ar === "string" && typeof value.en === "string";
}

export function editorKind(setting: Pick<Setting, "key" | "type" | "value">): EditorKind {
  switch (setting.type) {
    case "int":
      return "int";
    case "money_fils":
      return "money";
    case "bool":
      return "bool";
    case "string":
      if (TIME_SETTINGS.includes(setting.key)) return "time";
      return SETTING_OPTIONS[setting.key] ? "enum" : "string";
    case "list":
      if (DATE_LIST_SETTINGS.includes(setting.key) && isStringList(setting.value)) return "dates";
      return isStringList(setting.value) ? "chips" : "json-list";
    case "time_range":
      return "time_range";
    case "weekly_hours":
      return "weekly_hours";
    case "json":
      return BILINGUAL_TEXT_SETTINGS.includes(setting.key) && isBilingualValue(setting.value) ? "bilingual" : "json";
    default:
      return "json";
  }
}

export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** The editor's starting draft for a stored value. */
export function toDraft(kind: EditorKind, value: unknown): SettingDraft {
  switch (kind) {
    case "bool":
      return value === true;
    case "int":
      return typeof value === "number" ? String(value) : "";
    case "money":
      return typeof value === "number" ? filsToAedInput(value) : "";
    case "chips":
      return isStringList(value) ? [...value] : [];
    case "dates":
      return isStringList(value) ? sortDates(value) : [];
    case "weekly_hours":
      return toWeeklyDraft(value);
    case "bilingual": {
      const text = isPlainObject(value) ? value : {};
      return { ar: typeof text.ar === "string" ? text.ar : "", en: typeof text.en === "string" ? text.en : "" };
    }
    case "enum":
    case "string":
    case "time":
      return typeof value === "string" ? value : "";
    default:
      return value === undefined ? "" : JSON.stringify(value, null, 2);
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Checks {start, end} wall-clock times (HH:MM, start before end) when an object carries them. */
function checkTimes(value: Record<string, unknown>): SettingDraftError | null {
  if (!("start" in value) && !("end" in value)) return null;
  const { start, end } = value;
  if (typeof start !== "string" || typeof end !== "string" || !TIME.test(start) || !TIME.test(end)) {
    return "time_format";
  }
  return start < end ? null : "time_order";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export type ParseOptions = {
  /** Allow clearing the value (null = "pending decision"); only when the stored value is already null. */
  allowNull?: boolean;
  /** Values an enum editor may pick. */
  options?: readonly string[];
};

/** Validates a draft and returns the JSON value to save. */
export function parseDraft(kind: EditorKind, draft: SettingDraft, opts: ParseOptions = {}): DraftResult {
  switch (kind) {
    case "bool":
      return { ok: true, value: draft === true };

    case "int": {
      const text = String(draft).trim();
      if (text === "") return opts.allowNull ? { ok: true, value: null } : { ok: false, error: "required" };
      if (!/^-?\d+$/.test(text)) return { ok: false, error: "int" };
      const n = Number(text);
      if (!Number.isSafeInteger(n)) return { ok: false, error: "int" };
      if (n < 0) return { ok: false, error: "int_min" };
      return { ok: true, value: n };
    }

    case "money": {
      const parsed = parseAedToFils(String(draft));
      if (parsed.ok) return { ok: true, value: parsed.fils };
      if (parsed.error === "empty") return opts.allowNull ? { ok: true, value: null } : { ok: false, error: "required" };
      if (parsed.error === "precision") return { ok: false, error: "money_precision" };
      if (parsed.error === "negative") return { ok: false, error: "money_negative" };
      return { ok: false, error: "money" };
    }

    case "enum": {
      const value = String(draft);
      if (opts.options && !opts.options.includes(value)) return { ok: false, error: "option" };
      return { ok: true, value };
    }

    case "string": {
      const value = String(draft).trim();
      return value === "" ? { ok: false, error: "text_required" } : { ok: true, value };
    }

    case "time": {
      const value = normalizeDigits(String(draft)).trim();
      if (value === "") return { ok: false, error: "required" };
      return TIME.test(value) ? { ok: true, value } : { ok: false, error: "time" };
    }

    case "bilingual": {
      const text = isBilingualDraft(draft) ? draft : { ar: "", en: "" };
      const ar = text.ar.trim();
      const en = text.en.trim();
      if (ar === "" || en === "") return { ok: false, error: "bilingual_required" };
      // Exactly {ar, en}, Arabic first (the API compares the keys in this order).
      return { ok: true, value: { ar, en } };
    }

    case "chips": {
      const items = (Array.isArray(draft) ? draft : []).map((v) => v.trim());
      if (items.some((v) => v === "")) return { ok: false, error: "list_empty_item" };
      if (new Set(items).size !== items.length) return { ok: false, error: "list_duplicate" };
      return { ok: true, value: items };
    }

    case "dates": {
      const items = (Array.isArray(draft) ? draft : []).map((v) => normalizeDigits(v).trim());
      if (items.some((v) => !isIsoDate(v))) return { ok: false, error: "date_format" };
      if (new Set(items).size !== items.length) return { ok: false, error: "date_duplicate" };
      return { ok: true, value: sortDates(items) };
    }

    case "weekly_hours": {
      if (!isWeeklyDraft(draft)) return { ok: false, error: "hours_format" };
      const errors = validateWeeklyDraft(draft);
      // First problem in display order (Monday first), so the summary matches the first highlighted row.
      const first = WEEK_ORDER.map((d) => errors[d]).find(Boolean);
      return first ? { ok: false, error: first } : { ok: true, value: serializeWeeklyDraft(draft) };
    }

    case "json-list": {
      const parsed = parseJson(String(draft));
      if (!parsed.ok) return { ok: false, error: "json" };
      if (!Array.isArray(parsed.value)) return { ok: false, error: "json_array" };
      for (const item of parsed.value) {
        if (isPlainObject(item)) {
          const error = checkTimes(item);
          if (error) return { ok: false, error };
        }
      }
      return { ok: true, value: parsed.value };
    }

    case "time_range": {
      const parsed = parseJson(String(draft));
      if (!parsed.ok) return { ok: false, error: "json" };
      if (!isPlainObject(parsed.value)) return { ok: false, error: "json_object" };
      const error = checkTimes(parsed.value);
      return error ? { ok: false, error } : { ok: true, value: parsed.value };
    }

    case "json": {
      const parsed = parseJson(String(draft));
      if (!parsed.ok) return { ok: false, error: "json" };
      if (parsed.value === null || typeof parsed.value !== "object") return { ok: false, error: "json_object" };
      return { ok: true, value: parsed.value };
    }
  }
}

function isWeeklyDraft(draft: SettingDraft): draft is WeeklyHoursDraft {
  return draft !== null && typeof draft === "object" && !Array.isArray(draft) && !isBilingualDraft(draft);
}

export function isBilingualDraft(draft: SettingDraft): draft is BilingualDraft {
  return (
    draft !== null &&
    typeof draft === "object" &&
    !Array.isArray(draft) &&
    typeof (draft as Partial<BilingualDraft>).ar === "string" &&
    typeof (draft as Partial<BilingualDraft>).en === "string"
  );
}

/** "خلال 5 إلى 10 أيام عمل" / "within 5 to 10 business days" from a bilingual setting value. */
export function bilingualText(value: unknown): BilingualDraft | null {
  if (!isPlainObject(value) || typeof value.ar !== "string" || typeof value.en !== "string") return null;
  return { ar: value.ar, en: value.en };
}

/** Dates ascending ("YYYY-MM-DD" sorts as text). */
export function sortDates(dates: readonly string[]): string[] {
  return [...dates].sort();
}

export type AddDateResult = { ok: true; dates: string[] } | { ok: false; error: "date_format" | "date_duplicate" };

/** Adds one date to a holiday list: it must be a real YYYY-MM-DD date and not already listed; the list stays sorted. */
export function addDate(dates: readonly string[], raw: string): AddDateResult {
  const date = normalizeDigits(raw).trim();
  if (!isIsoDate(date)) return { ok: false, error: "date_format" };
  if (dates.includes(date)) return { ok: false, error: "date_duplicate" };
  return { ok: true, dates: sortDates([...dates, date]) };
}

/** "09:00–18:00" for {start, end}; null when the value is not a time range. */
export function formatTimeRange(value: unknown): string | null {
  if (!isPlainObject(value) || typeof value.start !== "string" || typeof value.end !== "string") return null;
  return `${value.start}–${value.end}`;
}

/** Settings grouped in a stable order (known groups first, then any new group alphabetically). */
export const SETTING_GROUP_ORDER = [
  "booking",
  "scheduling",
  "operations",
  "notifications",
  "subscriptions",
  "finance",
  "catalog",
  "quality",
  "workforce",
  "auth",
  "legal",
  "locale",
] as const;

export function groupSettings(settings: readonly Setting[]): { group: string; items: Setting[] }[] {
  const byGroup = new Map<string, Setting[]>();
  for (const s of settings) {
    const list = byGroup.get(s.group) ?? [];
    list.push(s);
    byGroup.set(s.group, list);
  }
  const known = SETTING_GROUP_ORDER.filter((g) => byGroup.has(g));
  const others = [...byGroup.keys()].filter((g) => !(SETTING_GROUP_ORDER as readonly string[]).includes(g)).sort();
  return [...known, ...others].map((group) => ({ group, items: byGroup.get(group)! }));
}
