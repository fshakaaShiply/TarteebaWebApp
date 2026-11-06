import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import { subscriptionErrorText } from "./errors";
import { HISTORY_FACT_KEYS, HISTORY_LABELS, historyFacts } from "./history";
import { healthToneOf, statusToneOf } from "./status";
import { businessDateOf, daysInMonth, monthOf, shiftMonth, weekdayName, weekdayOf } from "./text";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";

describe("A08 calendar and weekday helpers", () => {
  it("numbers weekdays from Sunday as the API does, in both languages", () => {
    expect(weekdayName(0, "en")).toBe("Sunday");
    expect(weekdayName(6, "en", "short")).toBe("Sat");
    expect(weekdayName(0, "ar")).toBe("الأحد");
    expect(weekdayOf("2026-11-01")).toBe(0);
    expect(weekdayOf("2026-11-06")).toBe(5);
  });

  it("moves between months and counts their days", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-11")).toBe(30);
    expect(monthOf("2026-11-09")).toBe("2026-11");
  });

  it("reads the Dubai date of an API instant, not the first 10 characters of its UTC form", () => {
    // A renewal at 02:00 local on 29 Nov is 22:00 UTC on 28 Nov.
    expect(businessDateOf("2026-11-28T22:00:00+00:00")).toBe("2026-11-29");
    expect(businessDateOf("2026-11-28T19:59:00+00:00")).toBe("2026-11-28");
    expect(businessDateOf("2026-11-29T02:00:00+04:00")).toBe("2026-11-29");
    expect(businessDateOf(null)).toBe("");
    expect(businessDateOf("not a date")).toBe("");
  });
});

describe("A08 chip colours", () => {
  it("colours the design's chips", () => {
    expect(statusToneOf("active")).toBe("success");
    expect(statusToneOf("pending_confirmation")).toBe("pending");
    expect(statusToneOf("paused")).toBe("neutral");
    expect(statusToneOf("renewal_failed")).toBe("danger");
    expect(statusToneOf("suspended")).toBe("danger");
    expect(healthToneOf("verifying")).toBe("neutral");
    expect(healthToneOf("paid")).toBe("success");
    expect(statusToneOf("something_new")).toBe("neutral");
  });
});

describe("A08 history rows", () => {
  // Payloads as the walk-through's stack wrote them (TRS-C7H810, TRL-S2FB7Q).
  it("reads a cancellation, a failed renewal and a renewal notice as labelled facts, ids and zero amounts left out", () => {
    expect(
      historyFacts("cancel", {
        to: "cancelled", from: "active", party: "customer", periods: [{ ulid: "01m6", refund_fils: 91201 }], fee_fils: 0, reason_code: "plans_changed", refund_fils: 182402, clawback_fils: 0,
      }),
    ).toEqual([
      { key: "status", value: { kind: "labelChange", group: "status", from: "active", to: "cancelled" } },
      { key: "party", value: { kind: "label", group: "party", value: "customer" } },
      { key: "reason", value: { kind: "label", group: "cancelReason", value: "plans_changed" } },
      { key: "refund", value: { kind: "money", fils: 182402 } },
    ]);
    expect(historyFacts("renewal_failed", { to: "renewal_failed", code: "card_declined", from: "active", period_id: 2, scheduled: true, attempt_no: 1, payment_id: 2 })).toEqual([
      { key: "status", value: { kind: "labelChange", group: "status", from: "active", to: "renewal_failed" } },
      { key: "failure", value: { kind: "label", group: "failure", value: "card_declined" } },
      { key: "period", value: { kind: "period", id: 2 } },
      { key: "attempt", value: { kind: "attempt", no: 1, scheduled: true } },
    ]);
    expect(historyFacts("renewal_priced", { period_id: 2, renewal_at: "2026-12-07T06:00:00+00:00", amount_fils: 91201 })).toEqual([
      { key: "period", value: { kind: "period", id: 2 } },
      { key: "amount", value: { kind: "money", fils: 91201 } },
      { key: "renewalAt", value: { kind: "instant", at: "2026-12-07T06:00:00+00:00" } },
    ]);
    expect(historyFacts("renew", { stage: "attempt", period_id: 2, scheduled: false, attempt_no: 1, payment_id: 2, amount_fils: 91201, payment_attempt: 2 })[0]).toEqual({
      key: "stage",
      value: { kind: "label", group: "stage", value: "attempt" },
      bare: true,
    });
  });

  it("names workers by id for the screen, and leaves an unchanged term end out", () => {
    expect(historyFacts("worker_changed", { date: "2026-11-17", added: [2], reason: "live_out_absence", removed: [1], workers: [2], visit_id: 33, booking_id: 33 })).toEqual([
      { key: "visit", value: { kind: "date", date: "2026-11-17" } },
      { key: "added", value: { kind: "workers", ids: [2] } },
      { key: "removed", value: { kind: "workers", ids: [1] } },
      { key: "reason", value: { kind: "label", group: "workerReason", value: "live_out_absence" } },
    ]);
    expect(historyFacts("worker_changed", { role: "backup", from: null, to: 5, apply_from: "2026-11-15" })).toEqual([
      { key: "backup", value: { kind: "workerChange", from: null, to: 5 } },
      { key: "from", value: { kind: "date", date: "2026-11-15" } },
    ]);
    expect(
      historyFacts("live_out_day_changed", {
        to: "2026-11-17", from: "2026-11-17", dates: ["2026-11-17"], scope: "this", unfit: [], change: "absence", appended: [], credited: [],
        term_end_date: { to: "2026-12-07", from: "2026-12-07" }, substitute_worker_id: 2,
      }),
    ).toEqual([
      { key: "change", value: { kind: "label", group: "day", value: "absence" } },
      { key: "scope", value: { kind: "label", group: "scope", value: "this" } },
      { key: "days", value: { kind: "dates", dates: ["2026-11-17"] } },
      { key: "substitute", value: { kind: "workers", ids: [2] } },
    ]);
    // A forfeited skip: nothing added, the term end did not move.
    expect(historyFacts("skip", { date: "2026-11-18", occurrence_date: "2026-11-18", appended_date: null, term_end_date: { from: "2026-12-05", to: "2026-12-05" } })).toEqual([
      { key: "visit", value: { kind: "date", date: "2026-11-18" } },
      { key: "notMadeUp", value: { kind: "flag" } },
    ]);
    // A staff reason written in words is quoted; a type this screen does not know shows its headline only.
    expect(historyFacts("worker_changed", { date: "2026-11-17", added: [3], removed: [], reason: "Customer asked for Siti" }).at(-1)).toEqual({
      key: "reason",
      value: { kind: "quote", text: "Customer asked for Siti" },
    });
    expect(historyFacts("something_new", { code: "x", a_b: 1 })).toEqual([]);
    expect(historyFacts("created", undefined)).toEqual([]);
  });

  it("has a label for every fact and every code it shows, in both languages", () => {
    for (const messages of [en, ar]) {
      const history = messages.admin.subscriptions.history as unknown as { facts: Record<string, string>; values: Record<string, Record<string, string>> };
      for (const key of HISTORY_FACT_KEYS) expect(history.facts[key], key).toBeTypeOf("string");
      for (const [group, codes] of Object.entries(HISTORY_LABELS)) for (const code of codes) expect(history.values[group]?.[code], `${group}.${code}`).toBeTypeOf("string");
    }
  });
});

describe("A08 error copy", () => {
  const t = (messages: typeof en) => {
    const lookup = (key: string, values: Record<string, string | number> = {}) => {
      const raw = key.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], (messages.admin.subscriptions as { errors: unknown }).errors) as string;
      return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k]));
    };
    const has = (key: string) => key.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], (messages.admin.subscriptions as { errors: unknown }).errors) !== undefined;
    return { lookup, has };
  };
  const error = (code: string, details: Record<string, unknown> = {}) => new AdminApiError(409, { code, message: "", details });

  it("says what happened to the subscription, with the numbers the error carries", () => {
    const { lookup, has } = t(en);
    expect(subscriptionErrorText(error("VISIT_LOCKED", { lead_time_hours: 12 }), lookup, has)).toBe("This visit starts in less than 12 hours, so it can no longer be changed.");
    expect(subscriptionErrorText(error("FREEZE_TOO_LONG", { max_days: 14, requested: 20, used: 3 }), lookup, has)).toContain("allowed 14");
    expect(subscriptionErrorText(error("PAYMENT_RESULT_UNKNOWN"), lookup, has)).toContain("capture result is unknown");
  });

  it("names the reason of a day that cannot change and of a freeze that is not allowed", () => {
    const { lookup, has } = t(en);
    expect(subscriptionErrorText(error("DAY_NOT_EDITABLE", { reason: "rest" }), lookup, has)).toBe("This is a weekly rest day.");
    expect(subscriptionErrorText(error("DAY_NOT_EDITABLE", { reason: "something_new" }), lookup, has)).toBe("This day cannot be changed.");
    expect(subscriptionErrorText(error("FREEZE_NOT_ALLOWED", { reason: "live_out" }), lookup, has)).toContain("Live-out");
  });

  it("leaves a code it does not know to the shared messages, and speaks Arabic", () => {
    const { lookup, has } = t(en);
    expect(subscriptionErrorText(error("RATE_LIMITED"), lookup, has)).toBeNull();
    const arabic = t(ar as unknown as typeof en);
    expect(subscriptionErrorText(error("SERIES_PRICE_HIGHER"), arabic.lookup, arabic.has)).toContain("السعر المتفق عليه");
  });
});
