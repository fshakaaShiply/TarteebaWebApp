import { describe, expect, it } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { adjustment, proposal, rule } from "@/test/workforceFixtures";
import {
  adjustmentPeriodFromParam,
  approveLines,
  bpText,
  canApprove,
  canApproveAsProposed,
  changedLineKeys,
  closedPeriods,
  currentPeriod,
  decimalToInt,
  emptyRuleForm,
  findWorkerProposal,
  hoursInput,
  hoursText,
  isClosedPeriod,
  isStale,
  lastEndedPeriod,
  periodFromParam,
  postLines,
  previousPeriod,
  proposalFils,
  readAllPages,
  readIds,
  readTermsChanged,
  ruleFieldOf,
  ruleServerErrors,
  ruleToForm,
  starsText,
  totalOf,
  validateAdjustment,
  validateApproval,
  validateRuleForm,
} from "./incentives";

const TODAY = "2026-10-23";
const err = (code: string, details: Record<string, unknown>, status = 409) => new AdminApiError(status, { code, message: "", details });

describe("incentive months", () => {
  it("knows which month has ended: only the months before the current one", () => {
    expect(currentPeriod(TODAY)).toBe("2026-10");
    expect(isClosedPeriod("2026-09", TODAY)).toBe(true);
    expect(isClosedPeriod("2026-10", TODAY)).toBe(false);
    expect(isClosedPeriod("2026-13", TODAY)).toBe(false);
    expect(previousPeriod("2026-01")).toBe("2025-12");
  });

  it("lists the ended months newest first and falls back to the last one for a link that names another", () => {
    expect(closedPeriods(3, TODAY)).toEqual(["2026-09", "2026-08", "2026-07"]);
    expect(closedPeriods(1, "2026-01-05")).toEqual(["2025-12"]);
    expect(periodFromParam("2026-08", TODAY)).toBe("2026-08");
    expect(periodFromParam("2026-10", TODAY)).toBe("2026-09");
    expect(periodFromParam("nonsense", TODAY)).toBe("2026-09");
    expect(periodFromParam(null, TODAY)).toBe("2026-09");
  });

  it("names the last ended month (the one HR decides on now), also across a year", () => {
    expect(lastEndedPeriod(TODAY)).toBe("2026-09");
    expect(lastEndedPeriod("2026-01-02")).toBe("2025-12");
  });

  it("lets the Adjustments tab show the current month too, never a later one", () => {
    expect(adjustmentPeriodFromParam("2026-10", "2026-09", TODAY)).toBe("2026-10");
    expect(adjustmentPeriodFromParam("2026-07", "2026-09", TODAY)).toBe("2026-07");
    expect(adjustmentPeriodFromParam("2026-11", "2026-09", TODAY)).toBe("2026-09");
    expect(adjustmentPeriodFromParam("2026-13", "2026-09", TODAY)).toBe("2026-09");
    expect(adjustmentPeriodFromParam("", "2026-09", TODAY)).toBe("2026-09");
  });
});

describe("reading lists whole", () => {
  const page = (ids: number[], lastPage: number, total: number) => ({ data: ids.map((id) => ({ id })), meta: { last_page: lastPage, total } });

  it("reads every page up to the limit and says how many rows there are in all", async () => {
    const pages: Record<number, ReturnType<typeof page>> = { 1: page([1, 2], 3, 6), 2: page([3, 4], 3, 6), 3: page([5, 6], 3, 6) };
    const asked: number[] = [];
    const all = await readAllPages(async (n) => {
      asked.push(n);
      return pages[n];
    });
    expect(asked).toEqual([1, 2, 3]);
    expect(all).toEqual({ rows: [1, 2, 3, 4, 5, 6].map((id) => ({ id })), total: 6 });
    // Past the limit the rows read are kept and the total says more exist.
    const capped = await readAllPages(async (n) => pages[n], 2);
    expect(capped.rows).toHaveLength(4);
    expect(capped.total).toBe(6);
  });

  it("picks one worker's row from a search that also matched others", () => {
    const rows = [proposal({ id: 1, worker: { ...proposal().worker, id: 30, employee_no: "DEMO-W010" } }), proposal({ id: 2 })];
    expect(findWorkerProposal(rows, 3)?.id).toBe(2);
    expect(findWorkerProposal(rows, 99)).toBeNull();
  });
});

describe("figures", () => {
  it("writes hours, percents and stars with integer math", () => {
    expect(hoursText(7440)).toBe("124");
    expect(hoursText(450)).toBe("7.5");
    expect(hoursInput(450)).toBe("7.5");
    expect(hoursInput(9600)).toBe("160");
    expect(hoursInput(15)).toBe("0.25");
    expect(bpText(8292)).toBe("82.92");
    expect(bpText(9500)).toBe("95");
    expect(bpText(4190)).toBe("41.9");
    expect(starsText(490)).toBe("4.90");
    expect(starsText(300)).toBe("3.00");
  });

  it("values a proposal at its approved amount, else the proposed one", () => {
    expect(proposalFils(proposal({ approved_fils: null, proposed_fils: 35000 }))).toBe(35000);
    expect(proposalFils(proposal({ approved_fils: 40000, proposed_fils: 35000 }))).toBe(40000);
  });
});

describe("the lines HR confirms (workforce §4.4)", () => {
  const a = proposal({ id: 1, proposed_fils: 35000 });
  const b = proposal({ id: 2, proposed_fils: 50000, approved_fils: 40000, status: "approved" });

  it("builds the approve lines at the proposed amounts and the post lines at the approved amounts with their kind", () => {
    expect(approveLines([a, b])).toEqual([{ id: 1, amount_fils: 35000 }, { id: 2, amount_fils: 50000 }]);
    expect(postLines([b], [adjustment({ id: 4, amount_fils: -5000 })])).toEqual([
      { kind: "incentive", id: 2, amount_fils: 40000 },
      { kind: "adjustment", id: 4, amount_fils: -5000 },
    ]);
    expect(totalOf(postLines([b], [adjustment({ id: 4, amount_fils: -5000 })]))).toBe(35000);
  });

  it("can approve a proposed incentive whose figures did not change, never a stale one", () => {
    expect(canApprove(proposal())).toBe(true);
    expect(canApprove(proposal({ metrics_stale_at: "2026-10-10T00:00:00+00:00" }))).toBe(false);
    expect(canApprove(proposal({ status: "approved" }))).toBe(false);
    expect(isStale(proposal({ metrics_stale_at: "2026-10-10T00:00:00+00:00" }))).toBe(true);
    expect(isStale(proposal({ status: "rejected", metrics_stale_at: "2026-10-10T00:00:00+00:00" }))).toBe(true);
    expect(isStale(proposal({ status: "posted", metrics_stale_at: "2026-10-10T00:00:00+00:00" }))).toBe(false);
  });

  it("approves as proposed only an amount of 1 fils or more: a zero proposal needs Edit or Reject (the bulk route refuses the batch)", () => {
    expect(canApproveAsProposed(proposal({ proposed_fils: 35000 }))).toBe(true);
    expect(canApproveAsProposed(proposal({ proposed_fils: 1 }))).toBe(true);
    expect(canApproveAsProposed(proposal({ proposed_fils: 0 }))).toBe(false);
    expect(canApprove(proposal({ proposed_fils: 0 }))).toBe(true);
    expect(canApproveAsProposed(proposal({ proposed_fils: 35000, metrics_stale_at: "2026-10-10T00:00:00+00:00" }))).toBe(false);
  });

  it("reads the new terms of a 409 TERMS_CHANGED, with the kind of each line when the API names it", () => {
    const terms = readTermsChanged(err("TERMS_CHANGED", { expected_total_fils: 85000, total_fils: 90000, lines: [{ kind: "incentive", id: 1, amount_fils: 40000 }, { id: 2, amount_fils: 50000 }] }));
    expect(terms).toEqual({ expectedTotal: 85000, total: 90000, lines: [{ kind: "incentive", id: 1, amount_fils: 40000 }, { id: 2, amount_fils: 50000 }] });
    expect(readTermsChanged(err("TERMS_CHANGED", { total_fils: "x", lines: [] }))).toBeNull();
    expect(readTermsChanged(err("TERMS_CHANGED", { total_fils: 1, lines: [{ id: "a" }] }))).toBeNull();
    expect(readTermsChanged(err("STALE_VERSION", {}))).toBeNull();
    expect(readTermsChanged(new Error("x"))).toBeNull();
  });

  it("marks the lines whose amount changed, appeared or vanished, with an incentive and an adjustment of the same id apart", () => {
    const shown = [{ kind: "incentive" as const, id: 5, amount_fils: 1000 }, { kind: "adjustment" as const, id: 5, amount_fils: -500 }, { kind: "incentive" as const, id: 6, amount_fils: 200 }];
    const now = [{ kind: "incentive" as const, id: 5, amount_fils: 1000 }, { kind: "adjustment" as const, id: 5, amount_fils: -900 }, { kind: "incentive" as const, id: 7, amount_fils: 10 }];
    expect([...changedLineKeys(shown, now)].sort()).toEqual(["adjustment:5", "incentive:6", "incentive:7"]);
  });

  it("reads the proposals a 409 names", () => {
    expect(readIds(err("METRICS_STALE", { ids: [3, 4] }))).toEqual([3, 4]);
    expect(readIds(err("METRICS_STALE", { ids: "no" }))).toEqual([]);
    expect(readIds(new Error("x"))).toEqual([]);
  });
});

describe("adjustment form", () => {
  const ok = { worker_id: "3", period: "2026-09", amount: "-50", reason: "Overpaid in August", corrects_posting_id: "" };

  it("converts a signed AED amount to fils and keeps a correction link only when chosen", () => {
    expect(validateAdjustment(ok, TODAY)).toEqual({ ok: true, input: { worker_id: 3, period: "2026-09", amount_fils: -5000, reason: "Overpaid in August" } });
    expect(validateAdjustment({ ...ok, amount: "120.5", corrects_posting_id: "2" }, TODAY)).toMatchObject({ ok: true, input: { amount_fils: 12050, corrects_posting_id: 2 } });
  });

  it("refuses a missing cleaner, a month after the current one, no amount, zero and a short reason", () => {
    expect(validateAdjustment({ worker_id: "", period: "2026-11", amount: "", reason: "ab", corrects_posting_id: "" }, TODAY)).toEqual({
      ok: false,
      errors: { worker_id: "workerRequired", period: "periodFuture", amount: "amountRequired", reason: "reasonLength" },
    });
    expect(validateAdjustment({ ...ok, amount: "0" }, TODAY)).toMatchObject({ errors: { amount: "amountZero" } });
    expect(validateAdjustment({ ...ok, amount: "1.234" }, TODAY)).toMatchObject({ errors: { amount: "amountInvalid" } });
    expect(validateAdjustment({ ...ok, period: "x" }, TODAY)).toMatchObject({ errors: { period: "periodInvalid" } });
    expect(validateAdjustment({ ...ok, period: "2026-10" }, TODAY).ok).toBe(true);
  });
});

describe("approving one proposal", () => {
  const p = proposal({ proposed_fils: 35000 });

  it("approves the proposed amount without a reason", () => {
    expect(validateApproval(p, "350.00", "")).toEqual({ ok: true, input: { approved_fils: 35000 } });
    expect(validateApproval(p, "350", "")).toEqual({ ok: true, input: { approved_fils: 35000 } });
  });

  it("needs a reason of at least 3 characters for another amount, and sends it", () => {
    expect(validateApproval(p, "400", "")).toEqual({ ok: false, errors: { reason: "reasonRequired" } });
    expect(validateApproval(p, "400", " ab ")).toEqual({ ok: false, errors: { reason: "reasonRequired" } });
    expect(validateApproval(p, "400", "Covered two extra Fridays")).toEqual({ ok: true, input: { approved_fils: 40000, adjust_reason: "Covered two extra Fridays" } });
  });

  it("refuses an unreadable amount and zero", () => {
    expect(validateApproval(p, "abc", "x")).toEqual({ ok: false, errors: { amount: "amountInvalid" } });
    expect(validateApproval(p, "1.005", "x")).toEqual({ ok: false, errors: { amount: "amountInvalid" } });
    expect(validateApproval(p, "0", "x")).toEqual({ ok: false, errors: { amount: "amountZero" } });
  });
});

describe("incentive rule form (workforce §5.6, RuleShape)", () => {
  it("round-trips the stored rule through the form without losing a minute, a percent or a fil", () => {
    const stored = rule();
    const form = ruleToForm(stored);
    expect(form).toMatchObject({ hours_target: "160", min_hours: "80", rating_floor: "3.00", min_ratings: "5", max_absent: "2" });
    expect(form.tiers).toEqual([
      { min_score: "60", amount: "200.00" },
      { min_score: "75", amount: "350.00" },
      { min_score: "90", amount: "500.00" },
    ]);
    const checked = validateRuleForm({ ...form, name_ar: stored.name.ar, name_en: stored.name.en });
    expect(checked).toEqual({ ok: true, body: { name: stored.name, weights: stored.weights, thresholds: stored.thresholds, amounts: stored.amounts } });
    // Minutes that are not whole hundredths of an hour still show as typed numbers the person can keep.
    expect(ruleToForm(rule({ thresholds: { ...stored.thresholds, hours_target_minutes: 450 } })).hours_target).toBe("7.5");
  });

  it("starts a new rule from the design's placeholder scheme", () => {
    const form = emptyRuleForm();
    expect(form.weights).toEqual({ hours: "40", rating: "30", punctuality: "20", repeat_requests: "10" });
    expect(form.tiers).toHaveLength(3);
    expect(validateRuleForm({ ...form, name_ar: "أ", name_en: "A" }).ok).toBe(true);
  });

  it("converts hours, stars, percent and AED by integer parsing", () => {
    const form = { ...emptyRuleForm(), name_ar: "أ", name_en: "A", hours_target: "7.5", min_hours: "0", rating_floor: "4.99", max_absent: "", tiers: [{ min_score: "82.5", amount: "1,200.75" }] };
    const checked = validateRuleForm(form);
    expect(checked).toMatchObject({ ok: true, body: { thresholds: { hours_target_minutes: 450, min_hours_minutes: 0, rating_floor_x100: 499, max_absent_days: null }, amounts: [{ min_score_bp: 8250, amount_fils: 120075 }] } });
    expect(decimalToInt("75.5", 2)).toBe(7550);
    expect(decimalToInt("75.555", 2)).toBeNull();
    expect(decimalToInt("٧٥", 2)).toBe(7500);
  });

  it("refuses what the request refuses, field by field", () => {
    const base = { ...emptyRuleForm(), name_ar: "أ", name_en: "A" };
    const bad = validateRuleForm({
      ...base,
      name_ar: "",
      weights: { hours: "101", rating: "-1", punctuality: "x", repeat_requests: "0" },
      hours_target: "7.13",
      min_hours: "abc",
      rating_floor: "5",
      min_ratings: "1001",
      max_absent: "32",
    });
    expect(bad).toEqual({
      ok: false,
      errors: {
        name_ar: "nameRequired",
        "weights.hours": "weightRange",
        "weights.rating": "weightRange",
        "weights.punctuality": "weightRange",
        hours_target: "hoursPrecision",
        min_hours: "hoursInvalid",
        rating_floor: "ratingFloor",
        min_ratings: "minRatings",
        max_absent: "maxAbsent",
      },
    });
  });

  it("needs a weight above zero, a minimum within the target, and 1 to 5 tiers whose scores and amounts both rise", () => {
    const base = { ...emptyRuleForm(), name_ar: "أ", name_en: "A" };
    expect(validateRuleForm({ ...base, weights: { hours: "0", rating: "0", punctuality: "0", repeat_requests: "0" } })).toMatchObject({ errors: { weights: "weightsEmpty" } });
    expect(validateRuleForm({ ...base, hours_target: "10", min_hours: "11" })).toMatchObject({ errors: { min_hours: "minAboveTarget" } });
    expect(validateRuleForm({ ...base, hours_target: "0" })).toMatchObject({ errors: { hours_target: "hoursRange" } });
    expect(validateRuleForm({ ...base, tiers: [] })).toMatchObject({ errors: { tiers: "tierCount" } });
    expect(validateRuleForm({ ...base, tiers: Array.from({ length: 6 }, (_, i) => ({ min_score: String(10 * (i + 1)), amount: String(10 * (i + 1)) })) })).toMatchObject({ errors: { tiers: "tierCount" } });
    expect(validateRuleForm({ ...base, tiers: [{ min_score: "60", amount: "200" }, { min_score: "60", amount: "300" }] })).toMatchObject({ errors: { "tiers.1.amount": "tierAscending" } });
    expect(validateRuleForm({ ...base, tiers: [{ min_score: "60", amount: "200" }, { min_score: "70", amount: "200" }] })).toMatchObject({ errors: { "tiers.1.amount": "tierAscending" } });
    expect(validateRuleForm({ ...base, tiers: [{ min_score: "101", amount: "0" }] })).toMatchObject({ errors: { "tiers.0.min_score": "tierScore", "tiers.0.amount": "tierAmount" } });
  });

  it("puts the API's RULE_INVALID messages on the form's fields", () => {
    expect(ruleFieldOf("thresholds.min_hours_minutes")).toBe("min_hours");
    expect(ruleFieldOf("amounts.1.amount_fils")).toBe("tiers.1.amount");
    expect(ruleFieldOf("amounts.2.min_score_bp")).toBe("tiers.2.min_score");
    expect(ruleFieldOf("amounts.1")).toBe("tiers.1.amount");
    expect(ruleFieldOf("weights.rating")).toBe("weights.rating");
    expect(ruleFieldOf("weights")).toBe("weights");
    expect(ruleFieldOf("unknown")).toBeNull();
    const server = ruleServerErrors(err("RULE_INVALID", { fields: { "thresholds.min_hours_minutes": ["Too high"], "amounts.1": ["Tiers must rise"], other: ["Odd"] } }, 422));
    expect(server).toEqual({ byField: { min_hours: "Too high", "tiers.1.amount": "Tiers must rise" }, other: ["Odd"] });
    expect(ruleServerErrors(err("STALE_VERSION", {}))).toBeNull();
  });
});
