import { filsToAedInput, parseAedToFils } from "@/lib/money";
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
  | "json";

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

export type SettingDraft = string | boolean | string[];

export type SettingDraftError =
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
  | "time_order";

export type DraftResult = { ok: true; value: unknown } | { ok: false; error: SettingDraftError };

export function editorKind(setting: Pick<Setting, "key" | "type" | "value">): EditorKind {
  switch (setting.type) {
    case "int":
      return "int";
    case "money_fils":
      return "money";
    case "bool":
      return "bool";
    case "string":
      return SETTING_OPTIONS[setting.key] ? "enum" : "string";
    case "list":
      return isStringList(setting.value) ? "chips" : "json-list";
    case "time_range":
      return "time_range";
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
    case "enum":
    case "string":
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

    case "chips": {
      const items = (Array.isArray(draft) ? draft : []).map((v) => v.trim());
      if (items.some((v) => v === "")) return { ok: false, error: "list_empty_item" };
      if (new Set(items).size !== items.length) return { ok: false, error: "list_duplicate" };
      return { ok: true, value: items };
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
