/*
 * One readable line per A08 history row (GET …/events, design §7.2): the facts of what the row's type says happened, read
 * from its payload as the API's actions write it (P4-249 keeps the payload untyped, so each type's keys are read here).
 * Every code becomes a label (admin.subscriptions.history.values.*, the statuses and reasons of enums.*), workers and
 * slots are named from the row's own `workers` / `slots` (P4-260), periods by their sequence, and the screen formats
 * dates, instants (Dubai time) and money. Ids and keys this line does not describe are left out; a type it does not
 * know yet shows its headline only (the API's `type_label`).
 */

export type LabelGroup =
  | "status"
  | "cancelReason"
  | "day"
  | "party"
  | "failure"
  | "stage"
  | "paymentOutcome"
  | "expiredCause"
  | "workerReason"
  | "creditCause"
  | "scope"
  | "decision"
  | "outcome"
  | "visitStatus"
  | "autoRenew"
  | "autoRenewReason";

export type HistoryValue =
  | { kind: "date"; date: string }
  | { kind: "dates"; dates: string[] }
  | { kind: "range"; from: string; to: string; days?: number }
  | { kind: "dateChange"; from: string; to: string }
  | { kind: "moves"; moves: { from: string; to: string }[] }
  | { kind: "instant"; at: string }
  | { kind: "money"; fils: number }
  | { kind: "number"; value: number }
  | { kind: "ratio"; value: number; of: number }
  | { kind: "attempt"; no: number; scheduled: boolean | null }
  | { kind: "workers"; ids: number[] }
  | { kind: "workerChange"; from: number | null; to: number | null }
  | { kind: "label"; group: LabelGroup; value: string }
  | { kind: "labelChange"; group: LabelGroup; from: string; to: string }
  | { kind: "weekdaysChange"; from: number[]; to: number[] }
  | { kind: "slot"; id: number }
  | { kind: "slotChange"; from: number; to: number }
  | { kind: "period"; id: number }
  | { kind: "conflict"; code: string; reason: string | null }
  | { kind: "quote"; text: string }
  | { kind: "ltr"; text: string }
  | { kind: "flag" };

/** The fact's label is admin.subscriptions.history.facts.{key}; a `bare` fact shows its value alone. */
export type HistoryFact = { key: HistoryFactKey; value: HistoryValue; bare?: boolean };

/**
 * The codes of our own label groups (admin.subscriptions.history.values.*), the API's lists: renewal failure codes
 * (Payment's decline codes, price_unavailable, verifying_cutoff), renewal stages, the parties, a closed request's
 * payment outcome, expiry causes, worker change and credit reasons, a Live-out change's scope, a request's decision, a
 * settled visit's outcome and status, auto-renew. status, cancelReason and day are the enums.* labels.
 */
export const HISTORY_LABELS = {
  failure: [
    "card_declined", "insufficient_funds", "expired_card", "authentication_failed", "gateway_unavailable", "token_revoked", "no_payment_method", "card_expired",
    "authentication_required", "card_not_consented", "price_unavailable", "verifying_cutoff", "generic",
  ],
  stage: ["attempt", "paid", "refunded_before_paid", "not_renewed"],
  party: ["customer", "company", "system"],
  paymentOutcome: ["voided", "deferred", "kept", "none", "captured", "retry", "refused", "refunded"],
  expiredCause: ["hold_expired", "payment_after_hold_expiry", "hold_not_extended"],
  workerReason: ["live_out_absence", "series_primary", "series_backup", "series_substitute", "series_primary_changed"],
  creditCause: ["missed_by_company", "conflict", "started_at_confirmation", "absence", "holiday"],
  scope: ["this", "following"],
  decision: ["approved", "declined"],
  outcome: ["completed", "cancelled", "none"],
  visitStatus: ["completed", "no_show_customer", "missed_by_company", "cancelled"],
  autoRenew: ["on", "off"],
  autoRenewReason: ["offer_withdrawn"],
} as const satisfies Partial<Record<LabelGroup, readonly string[]>>;

/** Every fact key a line can carry (admin.subscriptions.history.facts.*). */
export const HISTORY_FACT_KEYS = [
  "status", "stage", "party", "period", "periodDates", "visits", "amount", "holdUntil", "moved", "dropped", "captured", "primary", "backup", "reason", "payment", "refund",
  "fee", "clawback", "waived", "unpaid", "deadline", "failure", "attempt", "attempts", "endDate", "renewalAt", "termEnd", "continuesFrom", "refunded", "visitsUsed",
  "visit", "added", "removed", "from", "days", "restDays", "slot", "replaced", "new", "autoRenew", "card", "consent", "conflict", "cause", "addedOn", "change",
  "scope", "substitute", "credited", "notCovered", "unusedValue", "note", "decision", "move", "frozen", "frozenVisits", "endedOn", "restored", "stillFrozen",
  "removedFromEnd", "overLimit", "notMadeUp", "override", "outcome", "visitStatus",
] as const;
export type HistoryFactKey = (typeof HISTORY_FACT_KEYS)[number];

type Payload = Record<string, unknown>;
type Fact = HistoryFact | null;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v);
const str = (p: Payload, key: string): string | null => (typeof p[key] === "string" && p[key] !== "" ? (p[key] as string) : null);
const num = (p: Payload, key: string): number | null => (typeof p[key] === "number" && Number.isFinite(p[key]) ? (p[key] as number) : null);
const obj = (p: Payload, key: string): Payload | null => {
  const v = p[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : null;
};
const list = (p: Payload, key: string): unknown[] => (Array.isArray(p[key]) ? (p[key] as unknown[]) : []);
/** Dates given as "YYYY-MM-DD" or as objects with a `date`. */
const dateList = (p: Payload, key: string): string[] =>
  list(p, key)
    .map((x) => (isDate(x) ? x : x && typeof x === "object" && isDate((x as Payload).date) ? ((x as Payload).date as string) : null))
    .filter((x): x is string => x !== null);
const positiveIds = (values: unknown[]): number[] => values.filter((v): v is number => typeof v === "number" && v > 0);
const weekdays = (v: unknown): number[] | null => (Array.isArray(v) && v.every((d) => typeof d === "number") ? [...(v as number[])].sort((a, b) => a - b) : null);

const fact = (key: HistoryFactKey, value: HistoryValue | null, bare = false): Fact => (value ? { key, value, ...(bare ? { bare } : {}) } : null);
const date = (p: Payload, key: string): HistoryValue | null => (isDate(p[key]) ? { kind: "date", date: p[key] as string } : null);
const dates = (values: string[]): HistoryValue | null => (values.length > 0 ? { kind: "dates", dates: values } : null);
const count = (value: number | null): HistoryValue | null => (value === null ? null : { kind: "number", value });
const money = (fils: number | null, positiveOnly = false): HistoryValue | null => (fils === null || (positiveOnly && fils <= 0) ? null : { kind: "money", fils });
const instant = (p: Payload, key: string): HistoryValue | null => {
  const at = str(p, key);
  return at && !Number.isNaN(Date.parse(at)) ? { kind: "instant", at } : null;
};
const label = (group: LabelGroup, value: string | null): HistoryValue | null => (value ? { kind: "label", group, value } : null);
const ltr = (value: string | null): HistoryValue | null => (value ? { kind: "ltr", text: value } : null);
const period = (p: Payload): HistoryValue | null => {
  const id = num(p, "period_id");
  return id === null ? null : { kind: "period", id };
};
const span = (p: Payload): HistoryValue | null => {
  const s = obj(p, "period");
  return s && isDate(s.start) && isDate(s.end) ? { kind: "range", from: s.start, to: s.end } : null;
};
const workers = (values: unknown[]): HistoryValue | null => {
  const ids = positiveIds(values);
  return ids.length > 0 ? { kind: "workers", ids } : null;
};
const quote = (p: Payload, key: string): HistoryValue | null => {
  const text = str(p, key)?.trim();
  return text ? { kind: "quote", text } : null;
};
/** A code of a known label group, else free text a person wrote. */
const codeOrText = (group: "workerReason" | "autoRenewReason", value: string | null): HistoryValue | null => {
  if (!value) return null;
  return (HISTORY_LABELS[group] as readonly string[]).includes(value) ? label(group, value) : { kind: "quote", text: value };
};
/** The status before and after, when the row changed it. */
const statusChange = (p: Payload): Fact => {
  const from = str(p, "from");
  const to = str(p, "to");
  return from && to && from !== to && !isDate(from) && !isDate(to) ? fact("status", { kind: "labelChange", group: "status", from, to }) : null;
};
/** The end of the term: a {from, to} change (only when it moved), or the date. */
const termEnd = (p: Payload): Fact => {
  const change = obj(p, "term_end_date");
  if (change) {
    const { from, to } = change;
    return isDate(from) && isDate(to) && from !== to ? fact("termEnd", { kind: "dateChange", from, to }) : null;
  }
  return fact("termEnd", date(p, "term_end_date"));
};
const range = (p: Payload, days?: number | null): HistoryValue | null => {
  const { from, to } = p;
  if (!isDate(from) || !isDate(to)) return null;
  return { kind: "range", from, to, ...(days ? { days } : {}) };
};
const move = (p: Payload): HistoryValue | null => {
  const { from, to } = p;
  if (isDate(from) && isDate(to) && from !== to) return { kind: "moves", moves: [{ from, to }] };
  return isDate(to) ? { kind: "date", date: to } : null;
};
const attempt = (p: Payload): HistoryValue | null => {
  const no = num(p, "attempt_no");
  if (no === null || no < 1) return null;
  return { kind: "attempt", no, scheduled: typeof p.scheduled === "boolean" ? p.scheduled : null };
};
const slot = (p: Payload): HistoryValue | null => {
  const id = num(p, "slot_template_id");
  return id === null ? null : { kind: "slot", id };
};
const flag = (on: boolean, key: HistoryFactKey): Fact => (on ? fact(key, { kind: "flag" }) : null);

function lineOf(type: string, p: Payload): Fact[] {
  switch (type) {
    case "created": {
      const moves = list(p, "moved")
        .map((m) => (m && typeof m === "object" ? (m as Payload) : null))
        .filter((m): m is Payload => m !== null && isDate(m.date) && isDate(m.new_date))
        .map((m) => ({ from: m.date as string, to: m.new_date as string }));
      return [
        fact("periodDates", span(p)),
        fact("visits", count(num(p, "visits_planned"))),
        fact("amount", money(num(p, "amount_fils"))),
        fact("holdUntil", instant(p, "hold_expires_at")),
        fact("moved", moves.length > 0 ? { kind: "moves", moves } : null),
        fact("dropped", dates(dateList(p, "dropped"))),
      ];
    }
    case "confirmed":
      return [fact("captured", money(num(p, "captured_fils"))), fact("primary", workers([p.primary_worker_id])), fact("backup", workers([p.backup_worker_id]))];
    case "rejected":
      return [fact("reason", quote(p, "reason")), fact("payment", label("paymentOutcome", str(p, "payment"))), fact("refund", money(num(p, "refund_fils"), true))];
    case "expired":
      return [fact("cause", label("expiredCause", str(p, "cause")))];
    case "cancel":
      return [
        statusChange(p),
        fact("party", label("party", str(p, "party"))),
        fact("reason", label("cancelReason", str(p, "reason_code"))),
        fact("refund", money(num(p, "refund_fils"))),
        fact("fee", money(num(p, "fee_fils"), true)),
        fact("clawback", money(num(p, "clawback_fils"), true)),
        fact("unpaid", money(num(p, "unpaid_amount_fils"), true)),
        fact("deadline", instant(p, "confirmation_deadline_at")),
        fact("payment", label("paymentOutcome", str(p, "payment"))),
      ];
    case "renewal_failed":
      return [statusChange(p), fact("failure", label("failure", str(p, "code") ?? str(p, "cause"))), fact("period", period(p)), fact("attempt", attempt(p))];
    case "suspended":
      return [statusChange(p), fact("attempts", count(num(p, "attempts"))), fact("failure", label("failure", str(p, "code")))];
    case "ended":
      return [statusChange(p), fact("endDate", date(p, "end_date"))];
    case "renew": {
      const stage = str(p, "stage");
      const head = fact("stage", label("stage", stage), true);
      switch (stage) {
        case "attempt":
          return [head, fact("period", period(p)), fact("amount", money(num(p, "amount_fils"))), fact("attempt", attempt(p))];
        case "paid":
          return [head, fact("period", period(p)), fact("periodDates", span(p)), fact("amount", money(num(p, "amount_fils"))), fact("continuesFrom", date(p, "continues_from"))];
        case "refunded_before_paid":
          return [head, fact("period", period(p)), fact("refunded", money(num(p, "refunded_fils")))];
        case "not_renewed":
          return [head, statusChange(p), fact("renewalAt", instant(p, "renewal_at")), fact("termEnd", date(p, "term_end_date"))];
        default:
          return [head, fact("period", period(p)), fact("amount", money(num(p, "amount_fils")))];
      }
    }
    case "renewal_priced":
      return [fact("period", period(p)), fact("amount", money(num(p, "amount_fils"))), fact("renewalAt", instant(p, "renewal_at"))];
    case "discount_revoked": {
      const used = num(p, "consumed_visits");
      const needed = num(p, "min_visits_for_discount");
      return [
        fact("visitsUsed", used !== null && needed !== null ? { kind: "ratio", value: used, of: needed } : null),
        fact("clawback", money(num(p, "clawback_fils"))),
        fact("waived", money(num(p, "clawback_waived_fils"), true)),
      ];
    }
    case "worker_changed": {
      const role = str(p, "role");
      if (role) {
        // AssignSeriesWorker: the series' worker of a role, from a date on.
        return [fact(role === "backup" ? "backup" : "primary", { kind: "workerChange", from: num(p, "from"), to: num(p, "to") }), fact("from", date(p, "apply_from"))];
      }
      // One visit's team (RecordSeriesVisitWorkers).
      return [
        fact("visit", date(p, "date")),
        fact("added", workers(list(p, "added"))),
        fact("removed", workers(list(p, "removed"))),
        fact("reason", codeOrText("workerReason", str(p, "reason"))),
      ];
    }
    case "series_edited": {
      const before = obj(p, "before") ?? {};
      const after = obj(p, "after") ?? {};
      const daysBefore = weekdays(before.days_of_week);
      const daysAfter = weekdays(after.days_of_week);
      const restBefore = weekdays(before.rest_weekdays);
      const restAfter = weekdays(after.rest_weekdays);
      const slotBefore = typeof before.slot_template_id === "number" ? before.slot_template_id : null;
      const slotAfter = typeof after.slot_template_id === "number" ? after.slot_template_id : null;
      return [
        fact("from", date(p, "from")),
        fact("days", daysBefore && daysAfter && daysBefore.join() !== daysAfter.join() ? { kind: "weekdaysChange", from: daysBefore, to: daysAfter } : null),
        fact("restDays", restBefore && restAfter && restBefore.join() !== restAfter.join() ? { kind: "weekdaysChange", from: restBefore, to: restAfter } : null),
        fact("slot", slotBefore !== null && slotAfter !== null && slotBefore !== slotAfter ? { kind: "slotChange", from: slotBefore, to: slotAfter } : null),
        fact("replaced", dates(dateList(p, "replaced"))),
        fact("new", dates(dateList(p, "new"))),
        termEnd(p),
      ];
    }
    case "auto_renew_changed":
      return [
        fact("autoRenew", typeof p.auto_renew === "boolean" ? label("autoRenew", p.auto_renew ? "on" : "off") : null),
        fact("reason", codeOrText("autoRenewReason", str(p, "reason"))),
      ];
    case "payment_method_changed":
      return [fact("card", ltr(str(p, "card"))), fact("consent", ltr(str(p, "consent_version")))];
    case "conflict": {
      const code = str(p, "code");
      return [fact("visit", date(p, "date")), fact("slot", slot(p)), fact("conflict", code ? { kind: "conflict", code, reason: str(p, "reason") } : null)];
    }
    case "credited":
      return [
        fact("visit", date(p, "date")),
        fact("cause", label("creditCause", str(p, "cause"))),
        isDate(p.new_date) ? fact("addedOn", date(p, "new_date")) : flag(true, "notMadeUp"),
      ];
    case "live_out_day_changed":
      return [
        fact("change", label("day", str(p, "change"))),
        fact("scope", label("scope", str(p, "scope"))),
        fact("days", dates(dateList(p, "dates"))),
        fact("substitute", workers([p.substitute_worker_id])),
        fact("credited", dates(dateList(p, "credited"))),
        fact("addedOn", dates(dateList(p, "appended"))),
        // A credited day or a holiday served again: the day appended for it is taken off the end (P4-267).
        fact("removedFromEnd", dates(dateList(p, "replaced"))),
        fact("notCovered", dates(dateList(p, "unfit"))),
        termEnd(p),
      ];
    case "cancel_review_requested":
      return [fact("reason", label("cancelReason", str(p, "reason_code"))), fact("unusedValue", money(num(p, "unused_value_fils")))];
    case "cancel_review_declined":
      return [fact("note", quote(p, "note"))];
    case "cancel_review_resolved":
      return [fact("refund", money(num(p, "refund_fils"))), fact("note", quote(p, "note"))];
    case "skip":
      return [fact("visit", date(p, "date")), isDate(p.appended_date) ? fact("addedOn", date(p, "appended_date")) : flag(true, "notMadeUp"), termEnd(p)];
    case "unskip":
      return [fact("visit", date(p, "date")), fact("removedFromEnd", dates(dateList(p, "replaced"))), termEnd(p)];
    case "freeze":
      return [
        fact("frozen", range(p, num(p, "days"))),
        fact("frozenVisits", dates(dateList(p, "frozen"))),
        fact("addedOn", dates(dateList(p, "appended"))),
        termEnd(p),
        fact("reason", quote(p, "reason")),
        flag(p.over_limit === true, "overLimit"),
      ];
    case "unfreeze":
      return [
        fact("frozen", range(p)),
        fact("endedOn", date(p, "ended_to")),
        fact("restored", dates(dateList(p, "restored"))),
        fact("stillFrozen", dates(dateList(p, "still_frozen"))),
        fact("removedFromEnd", dates(dateList(p, "replaced"))),
        termEnd(p),
      ];
    case "late_capture":
      return [fact("period", period(p)), fact("replaced", dates(dateList(p, "replaced")))];
    case "reschedule_visit":
      return [fact("move", move(p)), fact("slot", slot(p)), fact("reason", quote(p, "reason")), flag(p.override === true, "override")];
    case "reschedule_requested":
      return [fact("move", move(p)), fact("slot", slot(p))];
    case "reschedule_decided":
      return [fact("decision", label("decision", str(p, "decision"))), fact("move", move(p)), fact("slot", slot(p)), fact("reason", quote(p, "reason"))];
    case "settled":
      return [fact("visit", date(p, "date")), fact("outcome", label("outcome", str(p, "outcome"))), fact("visitStatus", label("visitStatus", str(p, "visit_status")))];
    default:
      // reactivated, and any type added later: the status change it made, if any.
      return [statusChange(p)];
  }
}

/** The facts of one history row, in the order its line reads. */
export function historyFacts(type: string, payload: Record<string, unknown> | null | undefined): HistoryFact[] {
  return lineOf(type, payload ?? {}).filter((f): f is HistoryFact => f !== null);
}
