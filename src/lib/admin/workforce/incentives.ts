import { filsToAedInput, normalizeDigits, parseAedToFils } from "@/lib/money";
import { AdminApiError } from "../client";
import { addDaysIso, businessToday } from "../format";
import type { RuleBody } from "./endpoints";
import type { ExpectedLine, IncentiveAdjustment, IncentiveProposal, IncentiveRule, IncentiveStatus, ScoreKey } from "./types";

/*
 * A05 incentives (workforce §3.3, §3.4, §4.2, §4.4, §5.6): months, the lines HR confirms (every line the screen showed,
 * adjustments included, sent back with the total so the money posted is the money confirmed), the answers of 409
 * TERMS_CHANGED and METRICS_STALE, and the incentive rule form mirroring IncentiveRuleRequest and RuleShape. Money is
 * integer fils from the server; the only client conversions are the rule's AED amounts, hours and percents through
 * integer parsing, never float math on money.
 */

export const INCENTIVE_STATUSES = ["proposed", "approved", "rejected", "posted"] as const satisfies readonly IncentiveStatus[];
export const SCORE_KEYS = ["hours", "rating", "punctuality", "repeat_requests"] as const satisfies readonly ScoreKey[];
/** config workforce.incentives.max_tiers. */
export const MAX_TIERS = 5;

// ---- months ---------------------------------------------------------------------------------------------------------

export function isPeriod(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function currentPeriod(today: string = businessToday()): string {
  return today.slice(0, 7);
}

/** A month can be computed and posted once it has ended (422 PERIOD_NOT_CLOSED otherwise). */
export function isClosedPeriod(period: string, today: string = businessToday()): boolean {
  return isPeriod(period) && period < currentPeriod(today);
}

export function previousPeriod(period: string): string {
  return addDaysIso(`${period}-01`, -1).slice(0, 7);
}

/** The last month that has ended: the one whose proposals HR decides on now (computed from the 4th or so, P5-W74). */
export function lastEndedPeriod(today: string = businessToday()): string {
  return previousPeriod(currentPeriod(today));
}

/** The ended months, newest first (the month picker of the proposals page). */
export function closedPeriods(count = 12, today: string = businessToday()): string[] {
  const out: string[] = [];
  let period = lastEndedPeriod(today);
  for (let i = 0; i < count; i++) {
    out.push(period);
    period = previousPeriod(period);
  }
  return out;
}

/** "2026-10" from a link; anything else (or an unended month) falls back to the last ended month. */
export function periodFromParam(value: string | null | undefined, today: string = businessToday()): string {
  return value && isClosedPeriod(value, today) ? value : lastEndedPeriod(today);
}

/**
 * The month of the Adjustments tab: an adjustment may be made for the current month too (P5-W89), so that tab also
 * shows it (proposals and postings exist only for ended months). Anything later or malformed falls back to `fallback`.
 */
export function adjustmentPeriodFromParam(value: string | null | undefined, fallback: string, today: string = businessToday()): string {
  return value && isPeriod(value) && value <= currentPeriod(today) ? value : fallback;
}

/** The first day of a period as a local date, for the date helpers. */
export function periodFirstDay(period: string): string {
  return `${period}-01`;
}

// ---- amounts and figures ----------------------------------------------------------------------------------------------

/** What a proposal is worth right now: the approved amount, else the proposed one (the API's `fils` of the totals). */
export function proposalFils(p: Pick<IncentiveProposal, "approved_fils" | "proposed_fils">): number {
  return p.approved_fils ?? p.proposed_fils;
}

/** Hours with one decimal from minutes: 7440 gives "124", 450 gives "7.5". Integer math. */
export function hoursText(minutes: number): string {
  const tenths = Math.round((minutes * 10) / 60);
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** Minutes as the hours an input shows, exact when the minutes make up whole hundredths of an hour (450 gives "7.5"). */
export function hoursInput(minutes: number): string {
  const hundredths = Math.round((minutes * 100) / 60);
  const whole = Math.floor(hundredths / 100);
  const rest = hundredths % 100;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

/** A score in basis points as a percent: 8292 gives "82.92", 9500 gives "95", 4190 gives "41.9". */
export function bpText(bp: number): string {
  const hundredths = Math.round(bp);
  const whole = Math.floor(hundredths / 100);
  const rest = hundredths % 100;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

/** Stars with two decimals from an average times 100: 490 gives "4.90". */
export function starsText(x100: number): string {
  return `${Math.floor(x100 / 100)}.${String(x100 % 100).padStart(2, "0")}`;
}

// ---- the lines the screen showed -----------------------------------------------------------------------------------------

export function totalOf(lines: readonly { amount_fils: number }[]): number {
  return lines.reduce((sum, l) => sum + l.amount_fils, 0);
}

/** A proposal HR can approve: proposed, and its figures not changed since compute (409 METRICS_STALE otherwise). */
export function canApprove(p: Pick<IncentiveProposal, "status" | "metrics_stale_at">): boolean {
  return p.status === "proposed" && p.metrics_stale_at === null;
}

/**
 * A proposal that can be approved at the amount it was proposed: the API approves only 1 fils or more
 * (ApproveProposal::assertAmount), and a bulk approval is all or nothing (one AED 0.00 line refuses the whole batch with
 * 422 AMOUNT_OUT_OF_RANGE, naming no proposal). A zero proposal (a recompute that dropped it to zero, P5-W59, or a
 * system-rejected zero reopened) needs "Edit amount" or "Reject".
 */
export function canApproveAsProposed(p: Pick<IncentiveProposal, "status" | "metrics_stale_at" | "proposed_fils">): boolean {
  return canApprove(p) && p.proposed_fils >= 1;
}

/** The row of one worker in a proposals page searched by her employee number (the search also matches names and longer numbers). */
export function findWorkerProposal<T extends Pick<IncentiveProposal, "worker">>(rows: readonly T[], workerId: number): T | null {
  return rows.find((p) => p.worker.id === workerId) ?? null;
}

/** Every page of a list, up to `maxPages` (the post takes at most `max_bulk` 500 adjustments: 5 pages of 100). */
export async function readAllPages<T>(
  fetchPage: (page: number) => Promise<{ data: T[]; meta: { last_page: number; total: number } }>,
  maxPages = 5,
): Promise<{ rows: T[]; total: number }> {
  const first = await fetchPage(1);
  const rows = [...first.data];
  const last = Math.min(first.meta.last_page, maxPages);
  for (let page = 2; page <= last; page++) rows.push(...(await fetchPage(page)).data);
  return { rows, total: Math.max(first.meta.total, rows.length) };
}

/** The figures behind an open proposal changed since it was computed: it must be recomputed before it is approved. */
export function isStale(p: Pick<IncentiveProposal, "status" | "metrics_stale_at">): boolean {
  return (p.status === "proposed" || p.status === "rejected") && p.metrics_stale_at !== null;
}

/** Bulk approve: every selected proposal at the amount it was proposed (the lines the dialog lists). */
export function approveLines(proposals: readonly IncentiveProposal[]): ExpectedLine[] {
  return proposals.map((p) => ({ id: p.id, amount_fils: p.proposed_fils }));
}

/** A post: approved proposals at their approved amount and the open adjustments, each with its kind. */
export function postLines(proposals: readonly IncentiveProposal[], adjustments: readonly IncentiveAdjustment[]): ExpectedLine[] {
  return [
    ...proposals.map((p): ExpectedLine => ({ kind: "incentive", id: p.id, amount_fils: p.approved_fils ?? p.proposed_fils })),
    ...adjustments.map((a): ExpectedLine => ({ kind: "adjustment", id: a.id, amount_fils: a.amount_fils })),
  ];
}

export function lineKey(line: Pick<ExpectedLine, "id" | "kind">): string {
  return `${line.kind ?? "incentive"}:${line.id}`;
}

export type TermsChanged = { expectedTotal: number | null; total: number; lines: ExpectedLine[] };

/** The new terms of a 409 TERMS_CHANGED (`details.total_fils` and the lines as they stand now), or null when malformed. */
export function readTermsChanged(error: unknown): TermsChanged | null {
  if (!(error instanceof AdminApiError) || error.code !== "TERMS_CHANGED") return null;
  const d = error.details;
  if (typeof d.total_fils !== "number" || !Array.isArray(d.lines)) return null;
  const lines: ExpectedLine[] = [];
  for (const raw of d.lines) {
    if (!raw || typeof raw !== "object") return null;
    const l = raw as Record<string, unknown>;
    if (typeof l.id !== "number" || typeof l.amount_fils !== "number") return null;
    lines.push({ id: l.id, amount_fils: l.amount_fils, ...(l.kind === "incentive" || l.kind === "adjustment" ? { kind: l.kind } : {}) });
  }
  return { expectedTotal: typeof d.expected_total_fils === "number" ? d.expected_total_fils : null, total: d.total_fils, lines };
}

/** The keys of the lines whose amount is not what was shown, or that appeared or vanished. */
export function changedLineKeys(shown: readonly ExpectedLine[], now: readonly ExpectedLine[]): Set<string> {
  const before = new Map(shown.map((l) => [lineKey(l), l.amount_fils]));
  const after = new Map(now.map((l) => [lineKey(l), l.amount_fils]));
  const changed = new Set<string>();
  for (const [key, amount] of after) if (before.get(key) !== amount) changed.add(key);
  for (const key of before.keys()) if (!after.has(key)) changed.add(key);
  return changed;
}

/** The proposal ids of a 409 (METRICS_STALE, bulk INVALID_STATE, PERIOD_MISMATCH): `details.ids`. */
export function readIds(error: unknown): number[] {
  if (!(error instanceof AdminApiError)) return [];
  const ids = error.details.ids;
  return Array.isArray(ids) ? ids.filter((i): i is number => typeof i === "number") : [];
}

// ---- adjustments ------------------------------------------------------------------------------------------------------------

export type AdjustmentForm = { worker_id: string; period: string; amount: string; reason: string; corrects_posting_id: string };
export type AdjustmentErrorKey = "workerRequired" | "periodInvalid" | "periodFuture" | "amountRequired" | "amountInvalid" | "amountZero" | "reasonLength";
export type AdjustmentErrors = Partial<Record<keyof AdjustmentForm, AdjustmentErrorKey>>;

type AdjustmentBody = { worker_id: number; period: string; amount_fils: number; reason: string; corrects_posting_id?: number };

/** A signed amount in AED ("-50", "120.50") as fils; the API holds the range (422 AMOUNT_OUT_OF_RANGE). */
export function validateAdjustment(form: AdjustmentForm, today: string = businessToday()): { ok: true; input: AdjustmentBody } | { ok: false; errors: AdjustmentErrors } {
  const errors: AdjustmentErrors = {};
  if (!/^[1-9]\d{0,9}$/.test(form.worker_id)) errors.worker_id = "workerRequired";
  if (!isPeriod(form.period)) errors.period = "periodInvalid";
  else if (form.period > currentPeriod(today)) errors.period = "periodFuture";
  let fils = 0;
  if (form.amount.trim() === "") errors.amount = "amountRequired";
  else {
    const parsed = parseAedToFils(form.amount, { allowNegative: true });
    if (!parsed.ok) errors.amount = "amountInvalid";
    else if (parsed.fils === 0) errors.amount = "amountZero";
    else fils = parsed.fils;
  }
  const reason = form.reason.trim();
  if (reason.length < 3 || reason.length > 500) errors.reason = "reasonLength";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      worker_id: Number(form.worker_id),
      period: form.period,
      amount_fils: fils,
      reason,
      ...(form.corrects_posting_id !== "" ? { corrects_posting_id: Number(form.corrects_posting_id) } : {}),
    },
  };
}

// ---- approving one proposal ----------------------------------------------------------------------------------------------------

export type ApproveErrorKey = "amountInvalid" | "amountZero" | "reasonRequired";

/** Approve at the proposed amount, or at an edited one with a reason of at least 3 characters (422 REASON_REQUIRED otherwise). */
export function validateApproval(
  proposal: Pick<IncentiveProposal, "proposed_fils">,
  amount: string,
  reason: string,
): { ok: true; input: { approved_fils: number; adjust_reason?: string } } | { ok: false; errors: { amount?: ApproveErrorKey; reason?: ApproveErrorKey } } {
  const parsed = parseAedToFils(amount);
  if (!parsed.ok) return { ok: false, errors: { amount: "amountInvalid" } };
  if (parsed.fils < 1) return { ok: false, errors: { amount: "amountZero" } };
  if (parsed.fils !== proposal.proposed_fils) {
    const why = reason.trim();
    if (why.length < 3) return { ok: false, errors: { reason: "reasonRequired" } };
    return { ok: true, input: { approved_fils: parsed.fils, adjust_reason: why } };
  }
  return { ok: true, input: { approved_fils: parsed.fils } };
}

// ---- the rule form -------------------------------------------------------------------------------------------------------------------

export type RuleForm = {
  name_ar: string;
  name_en: string;
  weights: Record<ScoreKey, string>;
  hours_target: string;
  min_hours: string;
  rating_floor: string;
  min_ratings: string;
  max_absent: string;
  tiers: { min_score: string; amount: string }[];
};

export type RuleFieldKey =
  | "name_ar"
  | "name_en"
  | `weights.${ScoreKey}`
  | "weights"
  | "hours_target"
  | "min_hours"
  | "rating_floor"
  | "min_ratings"
  | "max_absent"
  | "tiers"
  | `tiers.${number}.min_score`
  | `tiers.${number}.amount`;
export type RuleErrorKey =
  | "nameRequired"
  | "weightRange"
  | "weightsEmpty"
  | "hoursInvalid"
  | "hoursPrecision"
  | "hoursRange"
  | "minAboveTarget"
  | "ratingFloor"
  | "minRatings"
  | "maxAbsent"
  | "tierCount"
  | "tierScore"
  | "tierAmount"
  | "tierAscending";
export type RuleErrors = Partial<Record<RuleFieldKey, RuleErrorKey>>;

/** The placeholder scheme of the design (workforce §4.2): the form of a new rule starts from it, the owner has not approved one. */
export function emptyRuleForm(): RuleForm {
  return {
    name_ar: "",
    name_en: "",
    weights: { hours: "40", rating: "30", punctuality: "20", repeat_requests: "10" },
    hours_target: "160",
    min_hours: "80",
    rating_floor: "3.00",
    min_ratings: "5",
    max_absent: "2",
    tiers: [
      { min_score: "60", amount: "200.00" },
      { min_score: "75", amount: "350.00" },
      { min_score: "90", amount: "500.00" },
    ],
  };
}

export function ruleToForm(rule: IncentiveRule): RuleForm {
  return {
    name_ar: rule.name.ar,
    name_en: rule.name.en,
    weights: Object.fromEntries(SCORE_KEYS.map((k) => [k, String(rule.weights[k])])) as Record<ScoreKey, string>,
    hours_target: hoursInput(rule.thresholds.hours_target_minutes),
    min_hours: hoursInput(rule.thresholds.min_hours_minutes),
    rating_floor: starsText(rule.thresholds.rating_floor_x100),
    min_ratings: String(rule.thresholds.min_ratings),
    max_absent: rule.thresholds.max_absent_days === null ? "" : String(rule.thresholds.max_absent_days),
    tiers: rule.amounts.map((t) => ({ min_score: bpText(t.min_score_bp), amount: filsToAedInput(t.amount_fils) })),
  };
}

/** A decimal typed with at most `scale` decimals as an integer times 10^scale ("75.5", 2 gives 7550); null when it is not one. */
export function decimalToInt(input: string, scale: number): number | null {
  const raw = normalizeDigits(input).trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > scale) return null;
  const value = Number(match[1] + fraction.padEnd(scale, "0"));
  return Number.isSafeInteger(value) ? value : null;
}

/** Hours typed as hours ("160", "7.5") as whole minutes; a value that is not a whole number of minutes is refused. */
function hoursToMinutes(input: string): { minutes: number } | { error: RuleErrorKey } {
  const hundredths = decimalToInt(input, 2);
  if (hundredths === null) return { error: "hoursInvalid" };
  if ((hundredths * 60) % 100 !== 0) return { error: "hoursPrecision" };
  return { minutes: (hundredths * 60) / 100 };
}

/** IncentiveRuleRequest and RuleShape on the whole form; the API checks again (422 RULE_INVALID {fields}). */
export function validateRuleForm(form: RuleForm): { ok: true; body: RuleBody } | { ok: false; errors: RuleErrors } {
  const errors: RuleErrors = {};
  const nameAr = form.name_ar.trim();
  const nameEn = form.name_en.trim();
  if (nameAr === "" || nameAr.length > 100) errors.name_ar = "nameRequired";
  if (nameEn === "" || nameEn.length > 100) errors.name_en = "nameRequired";

  const weights = {} as Record<ScoreKey, number>;
  for (const key of SCORE_KEYS) {
    const raw = form.weights[key].trim();
    if (!/^\d{1,3}$/.test(raw) || Number(raw) > 100) errors[`weights.${key}`] = "weightRange";
    else weights[key] = Number(raw);
  }
  if (SCORE_KEYS.every((k) => weights[k] !== undefined) && SCORE_KEYS.every((k) => weights[k] === 0)) errors.weights = "weightsEmpty";

  let target = 0;
  let min = 0;
  const targetRead = hoursToMinutes(form.hours_target);
  if ("error" in targetRead) errors.hours_target = targetRead.error;
  else if (targetRead.minutes < 1 || targetRead.minutes > 44640) errors.hours_target = "hoursRange";
  else target = targetRead.minutes;
  const minRead = hoursToMinutes(form.min_hours);
  if ("error" in minRead) errors.min_hours = minRead.error;
  else if (minRead.minutes > 44640) errors.min_hours = "hoursRange";
  else min = minRead.minutes;
  if (!errors.hours_target && !errors.min_hours && min > target) errors.min_hours = "minAboveTarget";

  const floor = decimalToInt(form.rating_floor, 2);
  if (floor === null || floor > 499) errors.rating_floor = "ratingFloor";
  const minRatings = form.min_ratings.trim();
  if (!/^\d{1,4}$/.test(minRatings) || Number(minRatings) > 1000) errors.min_ratings = "minRatings";
  const absent = form.max_absent.trim();
  if (absent !== "" && !(/^\d{1,2}$/.test(absent) && Number(absent) <= 31)) errors.max_absent = "maxAbsent";

  if (form.tiers.length < 1 || form.tiers.length > MAX_TIERS) errors.tiers = "tierCount";
  const amounts: { min_score_bp: number; amount_fils: number }[] = [];
  let previous: { score: number; fils: number } | null = null;
  form.tiers.forEach((tier, i) => {
    const score = decimalToInt(tier.min_score, 2);
    const parsed = parseAedToFils(tier.amount);
    let ok = true;
    if (score === null || score > 10000) {
      errors[`tiers.${i}.min_score`] = "tierScore";
      ok = false;
    }
    if (!parsed.ok || parsed.fils < 1) {
      errors[`tiers.${i}.amount`] = "tierAmount";
      ok = false;
    }
    if (ok && score !== null && parsed.ok) {
      if (previous && (score <= previous.score || parsed.fils <= previous.fils)) errors[`tiers.${i}.amount`] = "tierAscending";
      previous = { score, fils: parsed.fils };
      amounts.push({ min_score_bp: score, amount_fils: parsed.fils });
    }
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      name: { ar: nameAr, en: nameEn },
      weights,
      thresholds: {
        hours_target_minutes: target,
        min_hours_minutes: min,
        rating_floor_x100: floor as number,
        min_ratings: Number(minRatings),
        max_absent_days: absent === "" ? null : Number(absent),
      },
      amounts,
    },
  };
}

/** The API's own RULE_INVALID field names (`thresholds.min_hours_minutes`, `amounts.1.amount_fils`) as form fields. */
export function ruleFieldOf(apiField: string): RuleFieldKey | null {
  const map: Record<string, RuleFieldKey> = {
    "name.ar": "name_ar",
    "name.en": "name_en",
    name: "name_ar",
    weights: "weights",
    "thresholds.hours_target_minutes": "hours_target",
    "thresholds.min_hours_minutes": "min_hours",
    "thresholds.rating_floor_x100": "rating_floor",
    "thresholds.min_ratings": "min_ratings",
    "thresholds.max_absent_days": "max_absent",
    amounts: "tiers",
  };
  if (map[apiField]) return map[apiField];
  const weight = /^weights\.(hours|rating|punctuality|repeat_requests)$/.exec(apiField);
  if (weight) return `weights.${weight[1] as ScoreKey}`;
  const tier = /^amounts\.(\d+)(?:\.(min_score_bp|amount_fils))?$/.exec(apiField);
  if (tier) return tier[2] === "min_score_bp" ? `tiers.${Number(tier[1])}.min_score` : `tiers.${Number(tier[1])}.amount`;
  return null;
}

/** RULE_INVALID `details.fields` as {form field: first message}, plus the messages that match no field. */
export function ruleServerErrors(error: unknown): { byField: Partial<Record<RuleFieldKey, string>>; other: string[] } | null {
  if (!(error instanceof AdminApiError) || error.code !== "RULE_INVALID") return null;
  const byField: Partial<Record<RuleFieldKey, string>> = {};
  const other: string[] = [];
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const target = ruleFieldOf(field);
    if (target && messages[0]) byField[target] = messages[0];
    else if (messages[0]) other.push(messages[0]);
  }
  return { byField, other };
}
