import { describe, expect, it } from "vitest";
import { editorKind, parseDraft, toDraft, INT_RANGES } from "./settings";

// Phase 4 settings (design section 8.3).
describe("Phase 4 settings editors", () => {
  it("gives each subscription key its editor", () => {
    expect(editorKind({ key: "subscription.horizon_weeks", type: "int", value: 8 })).toBe("int");
    expect(editorKind({ key: "subscription.renewal_time", type: "string", value: "10:00" })).toBe("time");
    expect(editorKind({ key: "subscription.renewal_retry_hours", type: "list", value: [24, 72] })).toBe("int_list");
    expect(editorKind({ key: "subscription.renewal_retry_hours", type: "list", value: [] })).toBe("int_list");
    expect(editorKind({ key: "subscription.allowed_weekdays", type: "list", value: [0, 1, 2, 3, 4, 6] })).toBe("weekdays");
    for (const key of [
      "subscription.skip_freeze_effect",
      "subscription.company_miss_effect",
      "live_out.absence_without_substitute",
      "subscription.hold_next_period",
      "subscription.public_holiday_effect",
      "live_out.day_notifications",
    ]) {
      expect(editorKind({ key, type: "string", value: "x" }), key).toBe("enum");
    }
    expect(editorKind({ key: "subscription.cancel_fee_counts_skipped", type: "bool", value: true })).toBe("bool");
    // An unexpected shape stays a JSON editor so nothing is lost.
    expect(editorKind({ key: "subscription.renewal_retry_hours", type: "list", value: ["a"] })).toBe("chips");
  });

  it("keeps the API's whole-number ranges", () => {
    const range = INT_RANGES["subscription.horizon_weeks"];
    expect(parseDraft("int", "3", { range })).toEqual({ ok: false, error: "int_range" });
    expect(parseDraft("int", "4", { range })).toEqual({ ok: true, value: 4 });
    expect(parseDraft("int", "26", { range })).toEqual({ ok: true, value: 26 });
    expect(parseDraft("int", "27", { range })).toEqual({ ok: false, error: "int_range" });
    expect(parseDraft("int", "0", { range: INT_RANGES["subscription.renewal_notice_days"] })).toEqual({ ok: true, value: 0 });
    expect(parseDraft("int", "0", { range: INT_RANGES["subscription.renew_days_before"] })).toEqual({ ok: false, error: "int_range" });
  });

  it("saves the renewal time on the quarter hour only", () => {
    const opts = { key: "subscription.renewal_time" };
    expect(parseDraft("time", "10:15", opts)).toEqual({ ok: true, value: "10:15" });
    expect(parseDraft("time", "10:10", opts)).toEqual({ ok: false, error: "time_quarter" });
    // Other time settings are not limited to the quarter hour.
    expect(parseDraft("time", "10:10", { key: "reminder.day_before_time" })).toEqual({ ok: true, value: "10:10" });
  });

  it("saves the retry hours as a strictly ascending list of 0 to 5 numbers", () => {
    const opts = { key: "subscription.renewal_retry_hours" };
    expect(toDraft("int_list", [24, 72])).toEqual(["24", "72"]);
    expect(parseDraft("int_list", ["24", "72"], opts)).toEqual({ ok: true, value: [24, 72] });
    expect(parseDraft("int_list", ["٢٤", "٧٢"], opts)).toEqual({ ok: true, value: [24, 72] });
    expect(parseDraft("int_list", [], opts)).toEqual({ ok: true, value: [] });
    expect(parseDraft("int_list", ["72", "24"], opts)).toEqual({ ok: false, error: "int_list_order" });
    expect(parseDraft("int_list", ["24", "24"], opts)).toEqual({ ok: false, error: "int_list_order" });
    expect(parseDraft("int_list", ["0"], opts)).toEqual({ ok: false, error: "int_list_item" });
    expect(parseDraft("int_list", ["337"], opts)).toEqual({ ok: false, error: "int_list_item" });
    expect(parseDraft("int_list", ["1.5"], opts)).toEqual({ ok: false, error: "int_list_item" });
    expect(parseDraft("int_list", ["1", "2", "3", "4", "5", "6"], opts)).toEqual({ ok: false, error: "int_list_count" });
    expect(parseDraft("int_list", ["1", "2", "3", "4", "5"], opts)).toEqual({ ok: true, value: [1, 2, 3, 4, 5] });
  });

  it("saves the allowed weekdays as sorted numbers, at least one", () => {
    expect(toDraft("weekdays", [6, 0, 1])).toEqual(["0", "1", "6"]);
    expect(parseDraft("weekdays", ["6", "0", "1"])).toEqual({ ok: true, value: [0, 1, 6] });
    expect(parseDraft("weekdays", [])).toEqual({ ok: false, error: "weekdays_empty" });
    expect(parseDraft("weekdays", ["7"])).toEqual({ ok: false, error: "int_list_item" });
  });
});
