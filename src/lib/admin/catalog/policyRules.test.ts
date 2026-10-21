import { describe, expect, it } from "vitest";
import type { PolicyRules, PolicyType } from "../types";
import {
  defaultRulesDraft,
  parseRulesJson,
  policyFormSchema,
  rulesErrorPath,
  rulesFromDraft,
  rulesToDraft,
  rulesToJson,
} from "./policyRules";

// The §11.4 placeholders the API seeds (app/Modules/Catalog/Support/PolicyDefaults.php).
const SEEDED: Record<"cancellation" | "reschedule" | "refund", PolicyRules> = {
  cancellation: {
    cancellation: [
      { min_hours_before: 24, fee_type: "percent", fee_value: 0 },
      { min_hours_before: 6, fee_type: "percent", fee_value: 50 },
      { min_hours_before: 0, fee_type: "percent", fee_value: 100 },
    ],
    company_cancellation: { refund_percent: 100, compensation: "none" },
    exceptions: ["weather_alert", "medical_with_proof"],
  },
  reschedule: {
    reschedule: { free_until_hours_before: 24, fee_fils_after: 2500, max_per_booking: 2, requires_approval: true },
    exceptions: ["weather_alert", "medical_with_proof"],
  },
  refund: {
    company_cancellation: { refund_percent: 100, compensation: "none" },
    exceptions: ["weather_alert", "medical_with_proof"],
  },
};

describe("policy rules editor round trip", () => {
  it.each(Object.entries(SEEDED))("rules → draft → rules is lossless (%s)", (type, rules) => {
    const result = rulesFromDraft(rulesToDraft(rules), type as keyof typeof SEEDED);
    expect(result.issues).toEqual([]);
    expect(result.rules).toEqual(rules);
  });

  it("round-trips fixed fees in fils through AED in the form", () => {
    const rules: PolicyRules = {
      cancellation: [
        { min_hours_before: 12, fee_type: "fixed", fee_value: 2550 },
        { min_hours_before: 0, fee_type: "percent", fee_value: 100 },
      ],
      exceptions: [],
    };
    const draft = rulesToDraft(rules);
    expect(draft.cancellation.tiers[0]).toEqual({ min_hours_before: "12", fee_type: "fixed", fee_value: "25.50" });
    expect(rulesFromDraft(draft, "cancellation").rules).toEqual(rules);
  });

  it("shows the reschedule fee in AED and stores fils", () => {
    const draft = rulesToDraft(SEEDED.reschedule);
    expect(draft.reschedule.fee_after).toBe("25.00");
    expect(rulesFromDraft({ ...draft, reschedule: { ...draft.reschedule, fee_after: "30" } }, "reschedule").rules.reschedule).toEqual({
      free_until_hours_before: 24,
      fee_fils_after: 3000,
      max_per_booking: 2,
      requires_approval: true,
    });
  });

  it("goes through the JSON view and back", () => {
    const json = rulesToJson(SEEDED.cancellation);
    const parsed = parseRulesJson(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(rulesFromDraft(parsed.draft, "cancellation").rules).toEqual(SEEDED.cancellation);
    expect(parseRulesJson("[1, 2]").ok).toBe(false);
    expect(parseRulesJson("{ not json")).toEqual({ ok: false, problem: { kind: "syntax" } });
  });

  it("keeps JSON the form can hold exactly as typed: draft → rules gives the same object", () => {
    const typed: [PolicyType, PolicyRules][] = [
      // No exceptions key: none is added.
      ["reschedule", { reschedule: { requires_approval: false, max_per_booking: 0, fee_fils_after: 0, free_until_hours_before: 48 } }],
      // An explicit empty list stays.
      ["refund", { company_cancellation: { compensation: "coupon", refund_percent: 50 }, exceptions: [] }],
      // Fixed fees in fils, keys in any order, an optional section on another type.
      [
        "cancellation",
        {
          cancellation: [{ fee_value: 1999, fee_type: "fixed", min_hours_before: 2 }],
          company_cancellation: { refund_percent: 0, compensation: "credit" },
          exceptions: ["weather_alert"],
        },
      ],
    ];
    for (const [type, rules] of typed) {
      const parsed = parseRulesJson(JSON.stringify(rules));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        const back = rulesFromDraft(parsed.draft, type);
        expect(back.issues).toEqual([]);
        expect(back.rules).toEqual(rules);
      }
    }
  });

  it("refuses JSON the form would change, naming each entry", () => {
    const parsed = parseRulesJson(
      JSON.stringify({
        notes: "owner draft",
        cancellation: [
          { min_hours_before: "24", fee_type: "percent", fee_value: 0, label: "early" },
          { min_hours_before: 6, fee_value: 50 },
          { min_hours_before: 0, fee_type: "fixed", fee_value: 2550.5 },
          "none",
        ],
        reschedule: { free_until_hours_before: 24, fee_fils_after: 2500, max_per_booking: 2 },
        company_cancellation: { refund_percent: 100, compensation: "voucher" },
        exceptions: ["weather_alert", 7],
      }),
    );
    expect(parsed).toEqual({
      ok: false,
      problem: {
        kind: "unsupported",
        paths: [
          "notes",
          "cancellation.0.label",
          "cancellation.0.min_hours_before",
          "cancellation.1.fee_type",
          "cancellation.2.fee_value",
          "cancellation.3",
          "reschedule.requires_approval",
          "company_cancellation.compensation",
          "exceptions.1",
        ],
      },
    });
    expect(parseRulesJson('{"reschedule": null, "exceptions": "weather_alert"}')).toEqual({
      ok: false,
      problem: { kind: "unsupported", paths: ["reschedule", "exceptions"] },
    });
    expect(parseRulesJson("[1, 2]")).toEqual({ ok: false, problem: { kind: "syntax" } });
  });

  it("drops sections that are switched off", () => {
    const draft = rulesToDraft(SEEDED.cancellation);
    const off = { ...draft, company_cancellation: { ...draft.company_cancellation, enabled: false } };
    expect(rulesFromDraft(off, "cancellation").rules).not.toHaveProperty("company_cancellation");
  });
});

describe("policy rules validation (PolicyRules::rules)", () => {
  it("requires the section of the policy type", () => {
    const draft = defaultRulesDraft("cancellation");
    const empty = { ...draft, cancellation: { enabled: true, tiers: [] } };
    expect(rulesFromDraft(empty, "cancellation").issues).toEqual([{ path: ["cancellation", "tiers"], message: "tiersRequired" }]);
    // The refund type always carries company_cancellation, even if switched off in the draft.
    const refund = defaultRulesDraft("refund");
    expect(rulesFromDraft({ ...refund, company_cancellation: { ...refund.company_cancellation, enabled: false } }, "refund").rules).toHaveProperty(
      "company_cancellation",
    );
  });

  it("checks hours, distinct tiers and percentages", () => {
    const draft = defaultRulesDraft("cancellation");
    draft.cancellation.tiers = [
      { min_hours_before: "24", fee_type: "percent", fee_value: "0" },
      { min_hours_before: "24", fee_type: "percent", fee_value: "101" },
      { min_hours_before: "721", fee_type: "fixed", fee_value: "1.234" },
    ];
    expect(rulesFromDraft(draft, "cancellation").issues).toEqual([
      { path: ["cancellation", "tiers", 1, "min_hours_before"], message: "tierHoursDistinct" },
      { path: ["cancellation", "tiers", 1, "fee_value"], message: "percent0to100" },
      { path: ["cancellation", "tiers", 2, "min_hours_before"], message: "hoursBefore" },
      { path: ["cancellation", "tiers", 2, "fee_value"], message: "moneyPrecision" },
    ]);
  });

  it("does not report an invalid hour as a duplicate of the 0-hour tier", () => {
    const draft = defaultRulesDraft("cancellation");
    draft.cancellation.tiers[0].min_hours_before = "abc";
    expect(rulesFromDraft(draft, "cancellation").issues).toEqual([{ path: ["cancellation", "tiers", 0, "min_hours_before"], message: "hoursBefore" }]);
  });

  it("checks reschedule and company cancellation numbers", () => {
    const draft = defaultRulesDraft("reschedule");
    draft.reschedule.max_per_booking = "21";
    draft.reschedule.free_until_hours_before = "";
    draft.company_cancellation = { enabled: true, refund_percent: "120", compensation: "credit" };
    expect(rulesFromDraft(draft, "reschedule").issues).toEqual([
      { path: ["reschedule", "free_until_hours_before"], message: "required" },
      { path: ["reschedule", "max_per_booking"], message: "maxPerBooking" },
      { path: ["company_cancellation", "refund_percent"], message: "percent0to100" },
    ]);
  });

  it("accepts snake_case exception codes only, once each", () => {
    const draft = defaultRulesDraft("refund");
    draft.exceptions = ["weather_alert", "Medical", "weather_alert"];
    expect(rulesFromDraft(draft, "refund").issues).toEqual([
      { path: ["exceptions", 1], message: "exceptionFormat" },
      { path: ["exceptions", 2], message: "exceptionDuplicate" },
    ]);
  });

  it("puts rule issues under rules.* in the policy form", () => {
    const draft = defaultRulesDraft("cancellation");
    draft.cancellation.tiers[0].fee_value = "150";
    const result = policyFormSchema("create", "cancellation").safeParse({
      code: "std",
      type: "cancellation",
      name: { ar: "قياسية", en: "Standard" },
      rules: draft,
      is_active: true,
      reason: "",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([["rules.cancellation.tiers.0.fee_value", "percent0to100"]]);
  });

  it("builds the create payload with an upper-case code and the type", () => {
    const result = policyFormSchema("create", "refund").parse({
      code: "refund_std",
      type: "refund",
      name: { ar: "استرداد", en: "Refund" },
      rules: defaultRulesDraft("refund"),
      is_active: false,
      reason: "New policy",
    });
    expect(result.payload).toEqual({
      code: "REFUND_STD",
      type: "refund",
      name: { ar: "استرداد", en: "Refund" },
      rules: SEEDED.refund,
      is_active: false,
    });
    expect(result.reason).toBe("New policy");
  });

  it("maps API rule errors onto the draft fields", () => {
    expect(rulesErrorPath("rules.cancellation.1.fee_value")).toBe("rules.cancellation.tiers.1.fee_value");
    expect(rulesErrorPath("rules.cancellation")).toBe("rules.cancellation.tiers");
    expect(rulesErrorPath("rules.reschedule.fee_fils_after")).toBe("rules.reschedule.fee_after");
    expect(rulesErrorPath("rules.exceptions.2")).toBe("rules.exceptions.2");
    expect(rulesErrorPath("name.ar")).toBeNull();
  });
});
