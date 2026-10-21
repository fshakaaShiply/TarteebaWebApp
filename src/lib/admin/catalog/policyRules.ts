import { z } from "zod";
import { filsToAedInput } from "@/lib/money";
import type { Compensation, PolicyRules, PolicyType } from "../types";
import { parseMoney, parseWholeNumber, type CatalogErrorKey } from "./fields";

/*
 * Editor model for policies.rules (spec §11.4, validated by the API's PolicyRules):
 *   cancellation          tiers {min_hours_before 0..720 (distinct), fee_type percent|fixed, fee_value}
 *   reschedule            {free_until_hours_before, fee_fils_after, max_per_booking 0..20, requires_approval}
 *   company_cancellation  {refund_percent 0..100, compensation none|credit|coupon}
 *   exceptions            snake_case codes
 * Each policy type must carry its own section (cancellation → cancellation, reschedule → reschedule,
 * refund → company_cancellation). The draft keeps what the admin typed (strings, AED); rulesFromDraft() turns it back
 * into the JSON the API stores, so rules → draft → rules is lossless.
 *
 * The JSON view never changes what the admin typed behind their back: JSON with entries the form cannot hold exactly
 * (unknown keys, wrong types, fractional fils, a missing fee type …) is refused with the list of those entries
 * (parseRulesJson, unsupportedRulesEntries), and the form only opens the JSON view once its draft validates, so no
 * invalid field is replaced by a placeholder number.
 *
 * DECISION: a `fixed` cancellation fee_value is integer fils like every other money field (spec §4.2); the editor
 * shows it in AED.
 */

export const COMPENSATIONS = ["none", "credit", "coupon"] as const satisfies readonly Compensation[];
export const POLICY_TYPES = ["cancellation", "reschedule", "refund"] as const satisfies readonly PolicyType[];
export const MAX_TIERS = 10;
export const MAX_EXCEPTIONS = 20;
const MAX_HOURS = 720;
const MAX_FEE_FILS = 100_000_000;

export type TierDraft = { min_hours_before: string; fee_type: "percent" | "fixed"; fee_value: string };

export type RulesDraft = {
  cancellation: { enabled: boolean; tiers: TierDraft[] };
  reschedule: {
    enabled: boolean;
    free_until_hours_before: string;
    fee_after: string;
    max_per_booking: string;
    requires_approval: boolean;
  };
  company_cancellation: { enabled: boolean; refund_percent: string; compensation: Compensation };
  /** null: the rules have no "exceptions" key (kept absent on save); [] is an explicit empty list. */
  exceptions: string[] | null;
};

/** The section each policy type must have. */
export const REQUIRED_SECTION: Record<PolicyType, "cancellation" | "reschedule" | "company_cancellation"> = {
  cancellation: "cancellation",
  reschedule: "reschedule",
  refund: "company_cancellation",
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const intText = (value: unknown, fallback = ""): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;

/** Starting rules for a new policy of `type` (the §11.4 placeholders, D-02). */
export function defaultRulesDraft(type: PolicyType): RulesDraft {
  return {
    cancellation: {
      enabled: type === "cancellation",
      tiers: [
        { min_hours_before: "24", fee_type: "percent", fee_value: "0" },
        { min_hours_before: "6", fee_type: "percent", fee_value: "50" },
        { min_hours_before: "0", fee_type: "percent", fee_value: "100" },
      ],
    },
    reschedule: {
      enabled: type === "reschedule",
      free_until_hours_before: "24",
      fee_after: "25.00",
      max_per_booking: "2",
      requires_approval: true,
    },
    company_cancellation: { enabled: type !== "reschedule", refund_percent: "100", compensation: "none" },
    exceptions: ["weather_alert", "medical_with_proof"],
  };
}

/** Stored rules (or anything parsed from the JSON view) → editor draft. Unknown values become empty fields. */
export function rulesToDraft(rules: unknown): RulesDraft {
  const r = asRecord(rules) ?? {};
  const tiers = Array.isArray(r.cancellation) ? r.cancellation : null;
  const reschedule = asRecord(r.reschedule);
  const company = asRecord(r.company_cancellation);
  const compensation = company?.compensation;

  return {
    cancellation: {
      enabled: tiers !== null,
      tiers: (tiers ?? []).map((raw) => {
        const tier = asRecord(raw) ?? {};
        const feeType = tier.fee_type === "fixed" ? "fixed" : "percent";
        const fee = tier.fee_value;
        return {
          min_hours_before: intText(tier.min_hours_before),
          fee_type: feeType,
          fee_value: feeType === "fixed" && typeof fee === "number" ? filsToAedInput(fee) : intText(fee),
        };
      }),
    },
    reschedule: {
      enabled: reschedule !== null,
      free_until_hours_before: intText(reschedule?.free_until_hours_before),
      fee_after: typeof reschedule?.fee_fils_after === "number" ? filsToAedInput(reschedule.fee_fils_after) : "",
      max_per_booking: intText(reschedule?.max_per_booking),
      requires_approval: reschedule?.requires_approval === true,
    },
    company_cancellation: {
      enabled: company !== null,
      refund_percent: intText(company?.refund_percent),
      compensation: (COMPENSATIONS as readonly unknown[]).includes(compensation) ? (compensation as Compensation) : "none",
    },
    exceptions: Array.isArray(r.exceptions) ? r.exceptions.filter((e): e is string => typeof e === "string") : null,
  };
}

const TOP_KEYS = ["cancellation", "reschedule", "company_cancellation", "exceptions"];
const TIER_KEYS = ["min_hours_before", "fee_type", "fee_value"];
const RESCHEDULE_KEYS = ["free_until_hours_before", "fee_fils_after", "max_per_booking", "requires_approval"];
const COMPANY_KEYS = ["refund_percent", "compensation"];

/**
 * Entries of a rules object that the form cannot hold exactly, as dotted paths ("cancellation.1.note"): unknown keys,
 * sections of the wrong shape, numbers given as text, fractional fils, a missing or unknown fee type / compensation,
 * a missing approval flag, non-text exception codes. Values the form can show (an out-of-range hour, an empty field)
 * are not listed here; the form's own checks flag them.
 */
export function unsupportedRulesEntries(rules: Record<string, unknown>): string[] {
  const out: string[] = [];
  const extraKeys = (record: Record<string, unknown>, allowed: string[], prefix: string) => {
    for (const key of Object.keys(record)) if (!allowed.includes(key)) out.push(prefix ? `${prefix}.${key}` : key);
  };
  const number = (record: Record<string, unknown>, key: string, path: string, integer = false) => {
    if (!(key in record)) return;
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value))) out.push(path);
  };

  extraKeys(rules, TOP_KEYS, "");

  if ("cancellation" in rules) {
    const tiers = rules.cancellation;
    if (!Array.isArray(tiers)) out.push("cancellation");
    else {
      tiers.forEach((raw, i) => {
        const path = `cancellation.${i}`;
        const tier = asRecord(raw);
        if (!tier) {
          out.push(path);
          return;
        }
        extraKeys(tier, TIER_KEYS, path);
        number(tier, "min_hours_before", `${path}.min_hours_before`);
        if (tier.fee_type !== "percent" && tier.fee_type !== "fixed") out.push(`${path}.fee_type`);
        // A fixed fee is fils: the form shows AED with 2 decimals, so a fraction of a fil cannot round-trip.
        number(tier, "fee_value", `${path}.fee_value`, tier.fee_type === "fixed");
      });
    }
  }

  if ("reschedule" in rules) {
    const reschedule = asRecord(rules.reschedule);
    if (!reschedule) out.push("reschedule");
    else {
      extraKeys(reschedule, RESCHEDULE_KEYS, "reschedule");
      number(reschedule, "free_until_hours_before", "reschedule.free_until_hours_before");
      number(reschedule, "fee_fils_after", "reschedule.fee_fils_after", true);
      number(reschedule, "max_per_booking", "reschedule.max_per_booking");
      if (typeof reschedule.requires_approval !== "boolean") out.push("reschedule.requires_approval");
    }
  }

  if ("company_cancellation" in rules) {
    const company = asRecord(rules.company_cancellation);
    if (!company) out.push("company_cancellation");
    else {
      extraKeys(company, COMPANY_KEYS, "company_cancellation");
      number(company, "refund_percent", "company_cancellation.refund_percent");
      if (!(COMPENSATIONS as readonly unknown[]).includes(company.compensation)) out.push("company_cancellation.compensation");
    }
  }

  if ("exceptions" in rules) {
    const exceptions = rules.exceptions;
    if (!Array.isArray(exceptions)) out.push("exceptions");
    else {
      exceptions.forEach((code, i) => {
        if (typeof code !== "string") out.push(`exceptions.${i}`);
      });
    }
  }

  return out;
}

export type RulesIssue = { path: (string | number)[]; message: CatalogErrorKey };

/**
 * Draft → rules JSON, with every API rule checked. Paths match the draft (e.g. ["cancellation", "tiers", 1,
 * "fee_value"]) so the editor can show each message on its field. `rules` is always filled (invalid numbers become
 * 0) so the JSON view can show a draft that does not validate yet.
 */
export function rulesFromDraft(draft: RulesDraft, type: PolicyType): { rules: PolicyRules; issues: RulesIssue[] } {
  const issues: RulesIssue[] = [];
  const issue = (message: CatalogErrorKey, ...path: (string | number)[]) => issues.push({ path, message });
  const rules: PolicyRules = {};
  const required = REQUIRED_SECTION[type];

  const int = (raw: string, min: number, max: number, message: CatalogErrorKey, ...path: (string | number)[]) => {
    if (raw.trim() === "") {
      issue("required", ...path);
      return 0;
    }
    const n = parseWholeNumber(raw);
    if (n === null || n < min || n > max) {
      issue(message, ...path);
      return 0;
    }
    return n;
  };

  if (draft.cancellation.enabled || required === "cancellation") {
    const tiers = draft.cancellation.tiers;
    if (tiers.length === 0) issue("tiersRequired", "cancellation", "tiers");
    if (tiers.length > MAX_TIERS) issue("tiersMax", "cancellation", "tiers");
    const seen = new Set<number>();
    rules.cancellation = tiers.map((tier, i) => {
      const before = issues.length;
      const hours = int(tier.min_hours_before, 0, MAX_HOURS, "hoursBefore", "cancellation", "tiers", i, "min_hours_before");
      // Only valid hours take part in the distinct check (an invalid entry stands in as 0 and must not clash).
      if (issues.length === before) {
        if (seen.has(hours)) issue("tierHoursDistinct", "cancellation", "tiers", i, "min_hours_before");
        seen.add(hours);
      }
      let fee = 0;
      if (tier.fee_type === "percent") {
        fee = int(tier.fee_value, 0, 100, "percent0to100", "cancellation", "tiers", i, "fee_value");
      } else {
        const money = parseMoney(tier.fee_value);
        if (!money.ok) issue(money.error, "cancellation", "tiers", i, "fee_value");
        else if (money.fils > MAX_FEE_FILS) issue("moneyTooLarge", "cancellation", "tiers", i, "fee_value");
        else fee = money.fils;
      }
      return { min_hours_before: hours, fee_type: tier.fee_type, fee_value: fee };
    });
  }

  if (draft.reschedule.enabled || required === "reschedule") {
    const r = draft.reschedule;
    const fee = parseMoney(r.fee_after);
    if (!fee.ok) issue(fee.error, "reschedule", "fee_after");
    else if (fee.fils > MAX_FEE_FILS) issue("moneyTooLarge", "reschedule", "fee_after");
    rules.reschedule = {
      free_until_hours_before: int(r.free_until_hours_before, 0, MAX_HOURS, "hoursBefore", "reschedule", "free_until_hours_before"),
      fee_fils_after: fee.ok ? fee.fils : 0,
      max_per_booking: int(r.max_per_booking, 0, 20, "maxPerBooking", "reschedule", "max_per_booking"),
      requires_approval: r.requires_approval,
    };
  }

  if (draft.company_cancellation.enabled || required === "company_cancellation") {
    const c = draft.company_cancellation;
    rules.company_cancellation = {
      refund_percent: int(c.refund_percent, 0, 100, "percent0to100", "company_cancellation", "refund_percent"),
      compensation: c.compensation,
    };
  }

  if (draft.exceptions !== null) {
    if (draft.exceptions.length > MAX_EXCEPTIONS) issue("exceptionsMax", "exceptions");
    const seenExceptions = new Set<string>();
    draft.exceptions.forEach((code, i) => {
      if (code.length > 50 || !/^[a-z][a-z0-9_]*$/.test(code)) issue("exceptionFormat", "exceptions", i);
      else if (seenExceptions.has(code)) issue("exceptionDuplicate", "exceptions", i);
      seenExceptions.add(code);
    });
    rules.exceptions = [...draft.exceptions];
  }

  return { rules, issues };
}

/**
 * An API validation key for the rules ("rules.cancellation.1.fee_value") → the matching draft path
 * ("rules.cancellation.tiers.1.fee_value"), or null when the draft has no such field.
 */
export function rulesErrorPath(apiField: string): string | null {
  const parts = apiField.split(".");
  if (parts[0] !== "rules" || parts.length < 2) return null;
  const [, section, ...rest] = parts;
  if (section === "cancellation") return ["rules", "cancellation", "tiers", ...rest].join(".");
  if (section === "reschedule") {
    if (rest.length === 0) return null;
    return ["rules", "reschedule", rest[0] === "fee_fils_after" ? "fee_after" : rest[0]].join(".");
  }
  if (section === "company_cancellation") return rest.length ? ["rules", "company_cancellation", rest[0]].join(".") : null;
  if (section === "exceptions") return ["rules", "exceptions", ...rest.slice(0, 1)].join(".");
  return null;
}

/** The JSON view: the rules as stored, pretty-printed. */
export function rulesToJson(rules: PolicyRules): string {
  return JSON.stringify(rules, null, 2);
}

/** Why the JSON view's text cannot become the form's draft. */
export type RulesJsonProblem = { kind: "syntax" } | { kind: "unsupported"; paths: string[] };

/**
 * JSON view → draft. The text must be a JSON object that the form can hold exactly (unsupportedRulesEntries); the
 * values are checked by the form's own rules when saving.
 */
export function parseRulesJson(text: string): { ok: true; draft: RulesDraft } | { ok: false; problem: RulesJsonProblem } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problem: { kind: "syntax" } };
  }
  const record = asRecord(value);
  if (!record) return { ok: false, problem: { kind: "syntax" } };
  const paths = unsupportedRulesEntries(record);
  if (paths.length > 0) return { ok: false, problem: { kind: "unsupported", paths } };
  return { ok: true, draft: rulesToDraft(record) };
}

/** zod wrapper used by the policy form: the rules editor draft → PolicyRules for the given type. */
export function rulesDraftSchema(type: PolicyType) {
  return z.custom<RulesDraft>().transform((draft, ctx): PolicyRules => {
    const result = rulesFromDraft(draft, type);
    if (result.issues.length === 0) return result.rules;
    for (const i of result.issues) ctx.addIssue({ code: "custom", message: i.message, path: i.path });
    return z.NEVER;
  });
}

/**
 * Policy form: identity (create only), bilingual name, rules, active flag, audit reason. `type` decides which rules
 * section is required; on edit it is the stored type (fixed after creation).
 */
export function policyFormSchema(mode: "create" | "edit", type: PolicyType) {
  return z.object({
    code: z.string(),
    type: z.enum(POLICY_TYPES),
    name: z.object({ ar: z.string(), en: z.string() }),
    rules: rulesDraftSchema(type),
    is_active: z.boolean(),
    reason: z.string(),
  }).transform((v, ctx) => {
    const name = { ar: v.name.ar.trim(), en: v.name.en.trim() };
    for (const lang of ["ar", "en"] as const) {
      if (name[lang] === "") ctx.addIssue({ code: "custom", message: "nameRequired", path: ["name", lang] });
      else if (name[lang].length > 120) ctx.addIssue({ code: "custom", message: "textTooLong", path: ["name", lang] });
    }
    let code: string | undefined;
    if (mode === "create") {
      code = v.code.trim().toUpperCase();
      if (code === "") ctx.addIssue({ code: "custom", message: "required", path: ["code"] });
      else if (code.length > 40 || !/^[A-Z][A-Z0-9_]*$/.test(code)) {
        ctx.addIssue({ code: "custom", message: "codeFormat", path: ["code"] });
      }
    }
    return {
      payload: {
        ...(mode === "create" ? { code, type } : {}),
        name,
        rules: v.rules,
        is_active: v.is_active,
      },
      reason: v.reason,
    };
  });
}
