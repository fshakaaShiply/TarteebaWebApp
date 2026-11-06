import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import { subscriptionErrorText } from "./errors";
import { payloadFacts } from "./history";
import { healthToneOf, statusToneOf } from "./status";
import { daysInMonth, monthOf, shiftMonth, weekdayName, weekdayOf } from "./text";
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
  it("summarises a payload without a JSON dump: money, dates, short lists; ids and objects left out", () => {
    const facts = payloadFacts({ from: "2026-11-15", captured_fils: 96000, payment_id: 5, dates: ["2026-11-01", "2026-11-04"], before: { a: 1 }, reason: "Travel", empty: "", gone: null });
    expect(facts).toEqual([
      { key: "from", kind: "date", value: "2026-11-15" },
      { key: "captured_fils", kind: "money", value: 96000 },
      { key: "dates", kind: "list", value: ["2026-11-01", "2026-11-04"] },
      { key: "reason", kind: "text", value: "Travel" },
    ]);
    expect(payloadFacts(undefined)).toEqual([]);
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
