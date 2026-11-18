import { describe, expect, it } from "vitest";
import {
  CHOICE_LIST_SETTINGS,
  COMPLAINT_PRIORITIES,
  COMPLAINT_PRIORITY_KEYS,
  INT_RANGES,
  editorKind,
  groupSettings,
  parseDraft,
  toDraft,
} from "./settings";

// Phase 5 settings (design section 6.2): the ranges, shapes and editors of the 30 new keys and the three re-ranged ones.
const SLA = {
  urgent: { first_response: 30, resolution: 240 },
  high: { first_response: 120, resolution: 720 },
  medium: { first_response: 240, resolution: 1440 },
  low: { first_response: 720, resolution: 2880 },
};
const PRIORITIES = {
  quality: "medium",
  lateness: "medium",
  conduct: "high",
  damage: "high",
  billing: "medium",
  other: "low",
  support: "low",
  rating_1: "high",
  rating_2: "medium",
  rating_3: "low",
  rating_4: "low",
};

describe("Phase 5 whole-number ranges", () => {
  it("keeps the API's range for every number key of design section 6.2", () => {
    expect(INT_RANGES).toMatchObject({
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
      "incentives.compute_day_of_month": [4, 28],
      "workers.rating_window_days": [30, 730],
      "waitlist.notify_batch": [1, 20],
      "waitlist.renotify_after_minutes": [10, 240],
      "waitlist.max_offers_per_entry": [1, 5],
      "waitlist.max_open_per_customer": [1, 20],
    });
  });

  it("accepts the bounds and refuses a value outside them (and a blank where a null is refused)", () => {
    for (const [key, [min, max]] of Object.entries(INT_RANGES)) {
      const range = [min, max] as const;
      expect(parseDraft("int", String(min), { range }), key).toEqual({ ok: true, value: min });
      expect(parseDraft("int", String(max), { range }), key).toEqual({ ok: true, value: max });
      expect(parseDraft("int", String(max + 1), { range }), key).toEqual({ ok: false, error: "int_range" });
      if (min > 0) expect(parseDraft("int", String(min - 1), { range }), key).toEqual({ ok: false, error: "int_range" });
      expect(parseDraft("int", "", { range }), key).toEqual({ ok: false, error: "required" });
    }
  });

  it("refuses a decimal where a whole number is needed", () => {
    expect(parseDraft("int", "1.5", { range: [1, 4] })).toEqual({ ok: false, error: "int" });
  });
});

describe("Phase 5 editors", () => {
  it("gives every new key its editor", () => {
    expect(editorKind({ key: "reconciliation.auto_fetch", type: "bool", value: true })).toBe("bool");
    expect(editorKind({ key: "wallet.enabled", type: "bool", value: false })).toBe("bool");
    expect(editorKind({ key: "rating.request_live_out_days", type: "bool", value: false })).toBe("bool");
    expect(editorKind({ key: "wallet.credit_validity_days", type: "int", value: 365 })).toBe("int");
    expect(editorKind({ key: "complaint.sla_clock", type: "string", value: "working_hours" })).toBe("enum");
    expect(editorKind({ key: "complaint.sla_targets", type: "json", value: SLA })).toBe("sla_targets");
    expect(editorKind({ key: "complaint.default_priorities", type: "json", value: PRIORITIES })).toBe("priorities");
    expect(editorKind({ key: "compensation.types", type: "list", value: ["refund", "credit"] })).toBe("choices");
    expect(editorKind({ key: "compensation.types", type: "list", value: [] })).toBe("choices");
    expect(editorKind({ key: "documents.expiry_reminder_days", type: "list", value: [7] })).toBe("int_list");
    expect(editorKind({ key: "documents.expiry_reminder_days", type: "list", value: [] })).toBe("int_list");
    expect(editorKind({ key: "waitlist.quiet_hours", type: "time_range", value: { from: "22:00", to: "08:00" } })).toBe("quiet_hours");
  });

  it("keeps a value of an unexpected shape in the JSON editor so nothing is lost", () => {
    expect(editorKind({ key: "complaint.sla_targets", type: "json", value: { urgent: 1 } })).toBe("json");
    expect(editorKind({ key: "complaint.default_priorities", type: "json", value: { quality: "medium" } })).toBe("json");
    expect(editorKind({ key: "compensation.types", type: "list", value: ["voucher"] })).toBe("chips");
    expect(editorKind({ key: "waitlist.quiet_hours", type: "time_range", value: { start: "22:00", end: "08:00" } })).toBe("time_range");
  });

  it("does not depend on the key order the database returns (MySQL sorts JSON keys itself)", () => {
    expect(editorKind({ key: "waitlist.quiet_hours", type: "time_range", value: { to: "08:00", from: "22:00" } })).toBe("quiet_hours");
    expect(toDraft("quiet_hours", { to: "08:00", from: "22:00" })).toEqual({ from: "22:00", to: "08:00" });
  });

  it("lists the privacy group after quality", () => {
    const groups = groupSettings([
      { key: "a", value: 1, type: "int", group: "privacy", description: null, version: 1, updated_at: null },
      { key: "b", value: 1, type: "int", group: "quality", description: null, version: 1, updated_at: null },
      { key: "c", value: 1, type: "int", group: "workforce", description: null, version: 1, updated_at: null },
    ]).map((g) => g.group);
    expect(groups).toEqual(["quality", "privacy", "workforce"]);
  });
});

describe("complaint.sla_targets", () => {
  it("starts from the stored minutes, one row per priority", () => {
    const draft = toDraft("sla_targets", SLA);
    expect(draft).toEqual({
      urgent: { first_response: "30", resolution: "240" },
      high: { first_response: "120", resolution: "720" },
      medium: { first_response: "240", resolution: "1440" },
      low: { first_response: "720", resolution: "2880" },
    });
  });

  it("saves exactly the four priorities with whole minutes (Arabic-Indic digits too)", () => {
    const draft = toDraft("sla_targets", SLA) as Record<string, { first_response: string; resolution: string }>;
    expect(parseDraft("sla_targets", draft as never)).toEqual({ ok: true, value: SLA });
    const arabic = { ...draft, urgent: { first_response: "٣٠", resolution: "٢٤٠" } };
    expect(parseDraft("sla_targets", arabic as never)).toEqual({ ok: true, value: SLA });
  });

  it("refuses minutes outside 5 to 20160, a resolution shorter than the first reply and a blank", () => {
    const base = toDraft("sla_targets", SLA) as Record<string, { first_response: string; resolution: string }>;
    const withUrgent = (first_response: string, resolution: string) => ({ ...base, urgent: { first_response, resolution } }) as never;
    expect(parseDraft("sla_targets", withUrgent("4", "240"))).toEqual({ ok: false, error: "sla_range" });
    expect(parseDraft("sla_targets", withUrgent("30", "20161"))).toEqual({ ok: false, error: "sla_range" });
    expect(parseDraft("sla_targets", withUrgent("5", "20160"))).toEqual({ ok: true, value: { ...SLA, urgent: { first_response: 5, resolution: 20160 } } });
    expect(parseDraft("sla_targets", withUrgent("240", "30"))).toEqual({ ok: false, error: "sla_order" });
    expect(parseDraft("sla_targets", withUrgent("30", "30"))).toEqual({ ok: true, value: { ...SLA, urgent: { first_response: 30, resolution: 30 } } });
    expect(parseDraft("sla_targets", withUrgent("", "240"))).toEqual({ ok: false, error: "sla_int" });
    expect(parseDraft("sla_targets", withUrgent("1.5", "240"))).toEqual({ ok: false, error: "sla_int" });
    expect(parseDraft("sla_targets", "nope")).toEqual({ ok: false, error: "sla_int" });
  });
});

describe("complaint.default_priorities", () => {
  it("covers the 11 keys of the design, the four priorities", () => {
    expect([...COMPLAINT_PRIORITY_KEYS]).toEqual([
      "quality", "lateness", "conduct", "damage", "billing", "other", "support", "rating_1", "rating_2", "rating_3", "rating_4",
    ]);
    expect([...COMPLAINT_PRIORITIES]).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("saves one valid priority for every key and refuses a blank or an unknown one", () => {
    const draft = toDraft("priorities", PRIORITIES) as Record<string, string>;
    expect(draft).toEqual(PRIORITIES);
    expect(parseDraft("priorities", draft)).toEqual({ ok: true, value: PRIORITIES });
    expect(parseDraft("priorities", { ...draft, billing: "" })).toEqual({ ok: false, error: "priority_missing" });
    expect(parseDraft("priorities", { ...draft, billing: "critical" })).toEqual({ ok: false, error: "option" });
  });
});

describe("compensation.types", () => {
  const options = [...CHOICE_LIST_SETTINGS["compensation.types"]!];

  it("saves any unique subset in the list's own order, an empty one too", () => {
    expect(parseDraft("choices", ["free_visit", "refund"], { options })).toEqual({ ok: true, value: ["refund", "free_visit"] });
    expect(parseDraft("choices", [], { options })).toEqual({ ok: true, value: [] });
    expect(parseDraft("choices", ["refund", "refund"], { options })).toEqual({ ok: false, error: "list_duplicate" });
    expect(parseDraft("choices", ["voucher"], { options })).toEqual({ ok: false, error: "option" });
  });
});

describe("documents.expiry_reminder_days", () => {
  const opts = { key: "documents.expiry_reminder_days" };

  it("saves up to three whole numbers from 1 to 90, strictly descending, or none", () => {
    expect(parseDraft("int_list", ["30", "14", "7"], opts)).toEqual({ ok: true, value: [30, 14, 7] });
    expect(parseDraft("int_list", ["7"], opts)).toEqual({ ok: true, value: [7] });
    expect(parseDraft("int_list", [], opts)).toEqual({ ok: true, value: [] });
    expect(parseDraft("int_list", ["7", "14"], opts)).toEqual({ ok: false, error: "int_list_order_desc" });
    expect(parseDraft("int_list", ["7", "7"], opts)).toEqual({ ok: false, error: "int_list_order_desc" });
    expect(parseDraft("int_list", ["0"], opts)).toEqual({ ok: false, error: "int_list_item" });
    expect(parseDraft("int_list", ["91"], opts)).toEqual({ ok: false, error: "int_list_item" });
    expect(parseDraft("int_list", ["30", "14", "7", "3"], opts)).toEqual({ ok: false, error: "int_list_count" });
  });

  it("still saves the retry hours ascending (the other list setting is unchanged)", () => {
    expect(parseDraft("int_list", ["24", "72"], { key: "subscription.renewal_retry_hours" })).toEqual({ ok: true, value: [24, 72] });
    expect(parseDraft("int_list", ["72", "24"], { key: "subscription.renewal_retry_hours" })).toEqual({ ok: false, error: "int_list_order" });
  });
});

describe("waitlist.quiet_hours", () => {
  it("saves {from, to}, a window across midnight and equal times (none) included", () => {
    expect(parseDraft("quiet_hours", { from: "22:00", to: "08:00" })).toEqual({ ok: true, value: { from: "22:00", to: "08:00" } });
    expect(parseDraft("quiet_hours", { from: "09:00", to: "09:00" })).toEqual({ ok: true, value: { from: "09:00", to: "09:00" } });
    expect(parseDraft("quiet_hours", { from: "٢٢:٠٠", to: "08:00" })).toEqual({ ok: true, value: { from: "22:00", to: "08:00" } });
  });

  it("refuses a missing or malformed time", () => {
    expect(parseDraft("quiet_hours", { from: "", to: "08:00" })).toEqual({ ok: false, error: "quiet_time" });
    expect(parseDraft("quiet_hours", { from: "24:00", to: "08:00" })).toEqual({ ok: false, error: "quiet_time" });
    expect(parseDraft("quiet_hours", { from: "22:60", to: "08:00" })).toEqual({ ok: false, error: "quiet_time" });
  });
});
