import { describe, expect, it } from "vitest";
import { CHOICE_LIST_SETTINGS, COMPLAINT_PRIORITIES, COMPLAINT_PRIORITY_KEYS, INT_RANGES, SETTING_OPTIONS } from "@/lib/admin/settings";
import ar from "./ar.json";
import en from "./en.json";

/** Every key of design section 6.2: 30 new ones and the three that got a new range or label. */
const PHASE5_KEYS = [
  "reconciliation.auto_fetch",
  "reconciliation.settlement_lag_days",
  "reconciliation.amount_tolerance_fils",
  "wallet.enabled",
  "wallet.credit_validity_days",
  "wallet.expiry_notice_days",
  "rating.low_threshold",
  "rating.request_delay_minutes",
  "rating.window_days",
  "rating.series_request_interval_days",
  "rating.request_live_out_days",
  "complaint.window_days",
  "complaint.sla_clock",
  "complaint.sla_targets",
  "complaint.default_priorities",
  "complaint.auto_close_days",
  "complaint.sla_alert_minutes",
  "compensation.types",
  "privacy.deletion_grace_days",
  "privacy.export_available_days",
  "privacy.deletion_stuck_alert_days",
  "otp.retention_days",
  "documents.default_alert_days",
  "documents.expiry_reminder_days",
  "fleet.document_alert_days",
  "attendance.backdate_days",
  "incentives.compute_day_of_month",
  "workers.rating_window_days",
  "waitlist.notify_batch",
  "waitlist.renotify_after_minutes",
  "waitlist.max_offers_per_entry",
  "waitlist.max_open_per_customer",
  "waitlist.quiet_hours",
];

type Tree = { [key: string]: Tree | string };
const settingsOf = (messages: unknown) => (messages as { admin: { settings: Tree } }).admin.settings;
const pick = (tree: Tree, ...path: string[]): unknown => path.reduce<unknown>((node, step) => (node && typeof node === "object" ? (node as Tree)[step] : undefined), tree);

describe.each([
  ["ar", ar],
  ["en", en],
])("Phase 5 settings messages (%s)", (_locale, messages) => {
  const settings = settingsOf(messages);

  it("has a label and a help text for each of the 33 keys", () => {
    for (const key of PHASE5_KEYS) {
      const [group, ...rest] = key.split(".");
      const entry = pick(settings, "keys", group!, rest.join(".")) as { label?: string; description?: string } | undefined;
      expect(entry?.label, `${key} label`).toBeTruthy();
      expect(entry?.description, `${key} description`).toBeTruthy();
    }
  });

  it("labels every key that has a range", () => {
    for (const key of Object.keys(INT_RANGES)) {
      const [group, ...rest] = key.split(".");
      expect(pick(settings, "keys", group!, rest.join("."), "label"), key).toBeTruthy();
    }
  });

  it("names every choice, priority and category the editors show", () => {
    for (const value of ["working_hours", "calendar"]) expect(pick(settings, "options", "slaClock", value), value).toBeTruthy();
    for (const value of CHOICE_LIST_SETTINGS["compensation.types"]!) expect(pick(settings, "options", "compensationType", value), value).toBeTruthy();
    for (const priority of COMPLAINT_PRIORITIES) expect(pick(settings, "priorities", priority), priority).toBeTruthy();
    for (const key of COMPLAINT_PRIORITY_KEYS) expect(pick(settings, "categories", key), key).toBeTruthy();
    expect(SETTING_OPTIONS["complaint.sla_clock"]?.messageKey).toBe("slaClock");
    expect(SETTING_OPTIONS["compensation.types"]?.messageKey).toBe("compensationType");
  });

  it("has the new error and hint texts and the privacy group", () => {
    for (const code of ["int_list_order_desc", "sla_int", "sla_range", "sla_order", "priority_missing", "quiet_time"]) {
      expect(pick(settings, "errors", code), code).toBeTruthy();
    }
    for (const hint of ["intListDesc", "slaTargets", "priorities", "choices", "quietHours"]) expect(pick(settings, "hints", hint), hint).toBeTruthy();
    expect(pick(settings, "groups", "privacy")).toBeTruthy();
  });
});

describe("Phase 5 labels as the design writes them", () => {
  it("keeps the API's own wording for the waitlist offer window and the three re-ranged keys (P5-L25)", () => {
    expect(pick(settingsOf(en), "keys", "waitlist", "renotify_after_minutes", "label")).toBe("How long a waitlist offer stays open (minutes)");
    expect(pick(settingsOf(en), "keys", "waitlist", "notify_batch", "label")).toBe("Customers told at once when a place opens");
    expect(pick(settingsOf(en), "keys", "rating", "low_threshold", "label")).toBe("Overall rating at or below this opens a low-rating follow-up");
    expect(pick(settingsOf(ar), "keys", "waitlist", "renotify_after_minutes", "label")).toBe("مدة صلاحية عرض قائمة الانتظار بالدقائق");
  });
});
