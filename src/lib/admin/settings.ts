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
  | "bilingual"
  /** subscription.renewal_retry_hours: a short ascending list of whole numbers (draft: strings, saved as numbers). */
  | "int_list"
  /** subscription.allowed_weekdays: a multi-select of weekdays 0 (Sunday) to 6 (Saturday) (draft: strings, saved as numbers). */
  | "weekdays"
  /** complaint.sla_targets: first reply and resolution minutes for each of the four priorities (Phase 5, quality §6.4). */
  | "sla_targets"
  /** complaint.default_priorities: one priority for each of the 11 categories and low ratings. */
  | "priorities"
  /** compensation.types: a subset of a fixed list of choices, in the list's own order (an empty list is allowed). */
  | "choices"
  /** waitlist.quiet_hours: {from, to} wall-clock times that may cross midnight; equal times mean no quiet hours. */
  | "quiet_hours";

/** List settings whose items are local dates (edited with a date picker, saved sorted without duplicates). */
export const DATE_LIST_SETTINGS: readonly string[] = ["calendar.public_holidays"];

/** String settings holding one 24-hour time (the API refuses anything but HH:MM for them). */
export const TIME_SETTINGS: readonly string[] = ["reminder.day_before_time", "subscription.renewal_time"];

/** Time settings the API only accepts on the quarter hour (HH:00, :15, :30, :45). */
export const QUARTER_HOUR_TIME_SETTINGS: readonly string[] = ["subscription.renewal_time"];

/** Whole-number settings with the range the API enforces (SettingsController), inclusive. */
export const INT_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  "subscription.horizon_weeks": [4, 26],
  "subscription.renew_days_before": [1, 14],
  "subscription.renewal_notice_days": [0, 14],
  "subscription.suspended_cancel_days": [0, 60],
  // Phase 5 (design section 6.2). A null is refused for every one of them, including the three keys that already existed
  // (rating.low_threshold, waitlist.notify_batch, waitlist.renotify_after_minutes) and now have a range.
  "reconciliation.settlement_lag_days": [0, 7],
  "reconciliation.amount_tolerance_fils": [0, 100],
  "wallet.credit_validity_days": [0, 3650],
  "wallet.expiry_notice_days": [0, 60],
  "rating.low_threshold": [1, 4],
  "rating.request_delay_minutes": [0, 1440],
  "rating.window_days": [1, 60],
  "rating.series_request_interval_days": [0, 60],
  "complaint.window_days": [1, 90],
  "complaint.auto_close_days": [1, 30],
  "complaint.sla_alert_minutes": [5, 1440],
  "privacy.deletion_grace_days": [0, 30],
  "privacy.export_available_days": [1, 30],
  "privacy.deletion_stuck_alert_days": [1, 90],
  "otp.retention_days": [1, 365],
  "documents.default_alert_days": [1, 365],
  "fleet.document_alert_days": [1, 365],
  "attendance.backdate_days": [1, 90],
  // The API's lower bound is the re-derive days + 1 when that is above 4; the API says so when it refuses.
  "incentives.compute_day_of_month": [4, 28],
  "workers.rating_window_days": [30, 730],
  "waitlist.notify_batch": [1, 20],
  "waitlist.renotify_after_minutes": [10, 240],
  "waitlist.max_offers_per_entry": [1, 5],
  "waitlist.max_open_per_customer": [1, 20],
};

/**
 * List-of-whole-numbers settings: item range, at most `maxItems` items, strictly ascending (spec section 7.4) unless
 * `order` says descending (the document reminders count down: 30, 14, 7).
 */
export const INT_LIST_SETTINGS: Readonly<
  Record<string, { min: number; max: number; maxItems: number; allowEmpty: boolean; order?: "asc" | "desc" }>
> = {
  "subscription.renewal_retry_hours": { min: 1, max: 336, maxItems: 5, allowEmpty: true },
  "documents.expiry_reminder_days": { min: 1, max: 90, maxItems: 3, allowEmpty: true, order: "desc" },
};

/** The four complaint priorities, most urgent first (the order of the SLA table). */
export const COMPLAINT_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

/** The 11 keys of complaint.default_priorities: the six categories, support requests and the four low ratings. */
export const COMPLAINT_PRIORITY_KEYS = [
  "quality",
  "lateness",
  "conduct",
  "damage",
  "billing",
  "other",
  "support",
  "rating_1",
  "rating_2",
  "rating_3",
  "rating_4",
] as const;

/** complaint.sla_targets: each target in whole minutes, from 5 minutes to 14 days (the API's range). */
export const SLA_TARGET_RANGE = [5, 20160] as const;

/** Settings that pick a subset of fixed choices (saved in the choices' own order, an empty list allowed). */
export const CHOICE_LIST_SETTINGS: Readonly<Record<string, readonly string[]>> = {
  "compensation.types": ["refund", "credit", "free_visit"],
};

/** The time_range settings written as {from, to} (a window that may cross midnight; equal = none). */
export const QUIET_HOURS_SETTINGS: readonly string[] = ["waitlist.quiet_hours"];

/** List settings holding weekdays (0 = Sunday ... 6 = Saturday), at least one. */
export const WEEKDAY_SETTINGS: readonly string[] = ["subscription.allowed_weekdays"];

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
  // Phase 4 (design section 8.3)
  "subscription.skip_freeze_effect": { messageKey: "skipFreezeEffect", values: ["extend_term", "forfeit"] },
  "subscription.company_miss_effect": { messageKey: "companyMissEffect", values: ["extend_term", "none"] },
  "live_out.absence_without_substitute": { messageKey: "absenceWithoutSubstitute", values: ["credit_day", "none"] },
  "subscription.hold_next_period": { messageKey: "holdNextPeriod", values: ["ahead", "after_payment"] },
  "subscription.public_holiday_effect": { messageKey: "publicHolidayEffect", values: ["serve", "skip_extend"] },
  "live_out.day_notifications": { messageKey: "dayNotifications", values: ["quiet", "all"] },
  // Phase 5 (design section 6.2)
  "complaint.sla_clock": { messageKey: "slaClock", values: ["working_hours", "calendar"] },
  "compensation.types": { messageKey: "compensationType", values: CHOICE_LIST_SETTINGS["compensation.types"]! },
};

export type SlaTargetsDraft = Record<ComplaintPriority, { first_response: string; resolution: string }>;
export type PrioritiesDraft = Record<string, string>;
export type QuietHoursDraft = { from: string; to: string };

export type SettingDraft =
  | string
  | boolean
  | string[]
  | WeeklyHoursDraft
  | BilingualDraft
  | SlaTargetsDraft
  | PrioritiesDraft
  | QuietHoursDraft;

export type SettingDraftError =
  | "hours_format"
  | "hours_order"
  | "date_format"
  | "date_duplicate"
  | "required"
  | "int"
  | "int_min"
  | "int_range"
  | "int_list_item"
  | "int_list_order"
  | "int_list_order_desc"
  | "int_list_count"
  | "sla_int"
  | "sla_range"
  | "sla_order"
  | "priority_missing"
  | "quiet_time"
  | "weekdays_empty"
  | "time_quarter"
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
      if (isChoiceList(setting.key, setting.value)) return "choices";
      if (setting.key in INT_LIST_SETTINGS && isIntList(setting.value)) return "int_list";
      if (WEEKDAY_SETTINGS.includes(setting.key) && isIntList(setting.value)) return "weekdays";
      if (DATE_LIST_SETTINGS.includes(setting.key) && isStringList(setting.value)) return "dates";
      return isStringList(setting.value) ? "chips" : "json-list";
    case "time_range":
      return QUIET_HOURS_SETTINGS.includes(setting.key) && isQuietHoursValue(setting.value) ? "quiet_hours" : "time_range";
    case "weekly_hours":
      return "weekly_hours";
    case "json":
      if (setting.key === "complaint.sla_targets" && isSlaTargetsValue(setting.value)) return "sla_targets";
      if (setting.key === "complaint.default_priorities" && isPrioritiesValue(setting.value)) return "priorities";
      return BILINGUAL_TEXT_SETTINGS.includes(setting.key) && isBilingualValue(setting.value) ? "bilingual" : "json";
    default:
      return "json";
  }
}

function isChoiceList(key: string, value: unknown): value is string[] {
  const choices = CHOICE_LIST_SETTINGS[key];
  return choices !== undefined && isStringList(value) && value.every((v) => choices.includes(v));
}

/** {from, to} in whatever key order the database returns them (MySQL's JSON column sorts its own way). */
export function isQuietHoursValue(value: unknown): value is { from: string; to: string } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2 && keys[0] === "from" && keys[1] === "to" && typeof value.from === "string" && typeof value.to === "string";
}

/** The four priorities, each with whole-number first_response and resolution. */
export function isSlaTargetsValue(value: unknown): value is Record<ComplaintPriority, { first_response: number; resolution: number }> {
  if (!isPlainObject(value) || Object.keys(value).length !== COMPLAINT_PRIORITIES.length) return false;
  return COMPLAINT_PRIORITIES.every((p) => {
    const row = value[p];
    return isPlainObject(row) && Number.isInteger(row.first_response) && Number.isInteger(row.resolution);
  });
}

/** Exactly the 11 keys, each one of the four priorities. */
export function isPrioritiesValue(value: unknown): value is Record<string, ComplaintPriority> {
  if (!isPlainObject(value) || Object.keys(value).length !== COMPLAINT_PRIORITY_KEYS.length) return false;
  return COMPLAINT_PRIORITY_KEYS.every((k) => (COMPLAINT_PRIORITIES as readonly unknown[]).includes(value[k]));
}

export function isIntList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isInteger(v));
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
    case "int_list":
      return isIntList(value) ? value.map(String) : [];
    case "weekdays":
      return isIntList(value) ? [...value].sort((a, b) => a - b).map(String) : [];
    case "dates":
      return isStringList(value) ? sortDates(value) : [];
    case "weekly_hours":
      return toWeeklyDraft(value);
    case "bilingual": {
      const text = isPlainObject(value) ? value : {};
      return { ar: typeof text.ar === "string" ? text.ar : "", en: typeof text.en === "string" ? text.en : "" };
    }
    case "sla_targets": {
      const targets = isPlainObject(value) ? value : {};
      const draft = {} as SlaTargetsDraft;
      for (const priority of COMPLAINT_PRIORITIES) {
        const row = isPlainObject(targets[priority]) ? (targets[priority] as Record<string, unknown>) : {};
        draft[priority] = {
          first_response: typeof row.first_response === "number" ? String(row.first_response) : "",
          resolution: typeof row.resolution === "number" ? String(row.resolution) : "",
        };
      }
      return draft;
    }
    case "priorities": {
      const stored = isPlainObject(value) ? value : {};
      const draft: PrioritiesDraft = {};
      for (const key of COMPLAINT_PRIORITY_KEYS) draft[key] = typeof stored[key] === "string" ? stored[key] : "";
      return draft;
    }
    case "choices":
      return isStringList(value) ? [...value] : [];
    case "quiet_hours": {
      const window = isPlainObject(value) ? value : {};
      return { from: typeof window.from === "string" ? window.from : "", to: typeof window.to === "string" ? window.to : "" };
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
  /** Inclusive bounds of a whole number (the API's own range for the key). */
  range?: readonly [number, number];
  /** The setting key: some keys carry rules of their own (quarter-hour time, int lists). */
  key?: string;
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
      if (opts.range && (n < opts.range[0] || n > opts.range[1])) return { ok: false, error: "int_range" };
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
      if (!TIME.test(value)) return { ok: false, error: "time" };
      if (opts.key && QUARTER_HOUR_TIME_SETTINGS.includes(opts.key) && Number(value.slice(3)) % 15 !== 0) {
        return { ok: false, error: "time_quarter" };
      }
      return { ok: true, value };
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

    case "int_list": {
      const rule = (opts.key && INT_LIST_SETTINGS[opts.key]) || { min: 0, max: Number.MAX_SAFE_INTEGER, maxItems: 100, allowEmpty: true };
      const raw = (Array.isArray(draft) ? draft : []).map((v) => normalizeDigits(v).trim());
      if (raw.length === 0 && !rule.allowEmpty) return { ok: false, error: "required" };
      if (raw.length > rule.maxItems) return { ok: false, error: "int_list_count" };
      const numbers: number[] = [];
      for (const item of raw) {
        if (!/^[0-9]+$/.test(item)) return { ok: false, error: "int_list_item" };
        const n = Number(item);
        if (!Number.isSafeInteger(n) || n < rule.min || n > rule.max) return { ok: false, error: "int_list_item" };
        numbers.push(n);
      }
      const descending = rule.order === "desc";
      for (let i = 1; i < numbers.length; i += 1) {
        if (descending ? numbers[i]! >= numbers[i - 1]! : numbers[i]! <= numbers[i - 1]!) {
          return { ok: false, error: descending ? "int_list_order_desc" : "int_list_order" };
        }
      }
      return { ok: true, value: numbers };
    }

    case "choices": {
      const allowed = opts.options ?? (opts.key ? CHOICE_LIST_SETTINGS[opts.key] : undefined) ?? [];
      const chosen = Array.isArray(draft) ? draft : [];
      if (chosen.some((v) => !allowed.includes(v))) return { ok: false, error: "option" };
      if (new Set(chosen).size !== chosen.length) return { ok: false, error: "list_duplicate" };
      // The list's own order, so the same choice always saves the same value.
      return { ok: true, value: allowed.filter((v) => chosen.includes(v)) };
    }

    case "sla_targets": {
      if (!isSlaDraft(draft)) return { ok: false, error: "sla_int" };
      const value: Record<string, { first_response: number; resolution: number }> = {};
      for (const priority of COMPLAINT_PRIORITIES) {
        const first = wholeMinutes(draft[priority].first_response);
        const resolution = wholeMinutes(draft[priority].resolution);
        if (first === null || resolution === null) return { ok: false, error: "sla_int" };
        const [min, max] = SLA_TARGET_RANGE;
        if (first < min || first > max || resolution < min || resolution > max) return { ok: false, error: "sla_range" };
        if (resolution < first) return { ok: false, error: "sla_order" };
        value[priority] = { first_response: first, resolution };
      }
      return { ok: true, value };
    }

    case "priorities": {
      const draftValue: Record<string, unknown> = isPlainObject(draft) ? draft : {};
      const value: Record<string, string> = {};
      for (const key of COMPLAINT_PRIORITY_KEYS) {
        const priority = draftValue[key];
        if (typeof priority !== "string" || priority === "") return { ok: false, error: "priority_missing" };
        if (!(COMPLAINT_PRIORITIES as readonly string[]).includes(priority)) return { ok: false, error: "option" };
        value[key] = priority;
      }
      return { ok: true, value };
    }

    case "quiet_hours": {
      const window: Record<string, unknown> = isPlainObject(draft) ? draft : {};
      const from = normalizeDigits(String(window.from ?? "")).trim();
      const to = normalizeDigits(String(window.to ?? "")).trim();
      if (!TIME.test(from) || !TIME.test(to)) return { ok: false, error: "quiet_time" };
      // Crossing midnight (22:00 to 08:00) is the normal case; equal times mean no quiet hours.
      return { ok: true, value: { from, to } };
    }

    case "weekdays": {
      const days = (Array.isArray(draft) ? draft : []).map((v) => Number(v));
      if (days.length === 0) return { ok: false, error: "weekdays_empty" };
      if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { ok: false, error: "int_list_item" };
      return { ok: true, value: [...new Set(days)].sort((a, b) => a - b) };
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

function wholeMinutes(text: string): number | null {
  const digits = normalizeDigits(text).trim();
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

function isSlaDraft(draft: SettingDraft): draft is SlaTargetsDraft {
  if (!isPlainObject(draft)) return false;
  const rows = draft as Record<string, unknown>;
  return COMPLAINT_PRIORITIES.every((p) => {
    const row = rows[p];
    return isPlainObject(row) && typeof row.first_response === "string" && typeof row.resolution === "string";
  });
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
  "privacy",
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
