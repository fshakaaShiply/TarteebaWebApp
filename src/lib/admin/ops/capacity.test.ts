import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { AdminApiError } from "../client";
import type { CapacitySlot, SlotRuleSnapshot } from "../types";
import {
  FORCE_REASON_MIN,
  checkForceReason,
  overrideFormSchema,
  overrideOptions,
  overrideServiceId,
  readResourceConflict,
  readShortfalls,
  shortBy,
  withForce,
} from "./capacity";

function issues(result: z.ZodSafeParseResult<unknown>): Record<string, string[]> {
  if (result.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of result.error.issues) (out[issue.path.join(".")] ??= []).push(issue.message);
  return out;
}

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) =>
  new AdminApiError(status, { code, message: "", details });

// Support\CapacityImpactGuard: details.shortfalls of a 409 CAPACITY_SHORTFALL.
const shortfall = {
  date: "2026-10-25",
  zone_id: 1,
  slot_template_id: 1,
  slot: "MORNING",
  kind: "workers",
  service_id: 1,
  reserved: 5,
  available: 4,
};

const rule = (over: Partial<SlotRuleSnapshot>): SlotRuleSnapshot => ({
  id: 7,
  slot_template_id: 1,
  zone_id: 1,
  service_id: null,
  day_of_week: null,
  date_from: null,
  date_to: null,
  is_open: true,
  max_bookings: null,
  source: "admin",
  reason: "Season",
  version: 1,
  ...over,
});

// GET /admin/capacity for DEMO_BB tomorrow (CapacityBreakdown).
const slot = (over: Partial<CapacitySlot>): CapacitySlot => ({
  slot_template_id: 1,
  code: "MORNING",
  name: { ar: "الفترة الصباحية", en: "Morning" },
  start: "10:00",
  end: "14:00",
  service_kind: "standard_visit",
  is_active: true,
  service: { id: 1, code: "STANDARD_VISIT" },
  status: "available",
  reason: null,
  available_workers: 5,
  reserved_workers: 0,
  reserved_competing: 0,
  remaining_workers: 5,
  vehicles: [{ id: 1, seats: 7, reserved_seats: 0, free: 7 }],
  max_single_vehicle_free: 7,
  total_free_seats: 7,
  bookings_count: 0,
  max_bookings: null,
  rule: null,
  max_workers_fit: 5,
  holds: { active: 0, converted: 0 },
  zone_workers: 6,
  excluded: { rest_day: 1 },
  ...over,
});

describe("save anyway (CapacityForceFields: force + reason ≥ 10)", () => {
  it("adds force and the trimmed reason only when forcing", () => {
    const body = { note: null, version: 3 };
    expect(withForce(body)).toEqual({ note: null, version: 3 });
    expect(withForce(body, null)).toEqual({ note: null, version: 3 });
    expect(withForce(body, { reason: "  Cover found for both visits  " })).toEqual({
      note: null,
      version: 3,
      force: true,
      reason: "Cover found for both visits",
    });
  });

  it("needs a reason of at least 10 characters after trimming", () => {
    expect(FORCE_REASON_MIN).toBe(10);
    expect(checkForceReason("  1234567890 ")).toBe(null);
    expect(checkForceReason("  too short ")).toBe("forceReasonMin");
    expect(checkForceReason("123456789")).toBe("forceReasonMin");
    expect(checkForceReason("          x")).toBe("forceReasonMin");
    expect(checkForceReason("x".repeat(501))).toBe("forceReasonMax");
  });

  it("reads the shortfalls of a 409 CAPACITY_SHORTFALL and nothing else", () => {
    expect(readShortfalls(apiError(409, "CAPACITY_SHORTFALL", { shortfalls: [shortfall, { junk: true }] }))).toEqual([shortfall]);
    expect(readShortfalls(apiError(409, "CAPACITY_SHORTFALL"))).toEqual([]);
    expect(readShortfalls(apiError(409, "STALE_VERSION"))).toBeNull();
    expect(readShortfalls(new Error("x"))).toBeNull();
    expect(shortBy(shortfall)).toBe(1);
  });

  it("reads who holds the time from a 409 RESOURCE_CONFLICT", () => {
    const error = apiError(409, "RESOURCE_CONFLICT", {
      resource_type: "worker",
      resource_id: 3,
      date: "2026-10-26",
      holder_type: "visit",
      holder_id: 41,
      from: "09:30",
    });
    expect(readResourceConflict(error)).toEqual({ resourceType: "worker", date: "2026-10-26", holderType: "visit", holderId: 41, from: "09:30" });
    expect(readResourceConflict(apiError(409, "LEAVE_OVERLAP"))).toBeNull();
  });
});

describe("manual override (spec §8.6)", () => {
  it("opens a slot closed by a blackout or a closed rule, and raises an open rule's cap", () => {
    expect(overrideOptions(slot({ status: "closed", reason: "blackout" }))).toEqual([{ action: "open", relaxes: [{ kind: "blackout" }] }]);
    const closed = rule({ is_open: false });
    expect(overrideOptions(slot({ status: "closed", reason: "rule_closed", rule: closed }))).toEqual([
      { action: "open", relaxes: [{ kind: "closed_rule", rule: closed }] },
    ]);
    const capped = rule({ max_bookings: 4 });
    expect(overrideOptions(slot({ status: "full", reason: "max_bookings", rule: capped }))).toEqual([
      { action: "raise_cap", relaxes: [{ kind: "cap", rule: capped }] },
    ]);
  });

  it("only opens a slot a blackout closes, even when the rule that applies has a cap (raise_cap is NOTHING_TO_OVERRIDE there)", () => {
    const capped = rule({ max_bookings: 4 });
    expect(overrideOptions(slot({ status: "closed", reason: "blackout", rule: capped }))).toEqual([
      { action: "open", relaxes: [{ kind: "blackout" }] },
    ]);
    // Once open (an override rule outranks the blackout), the cap can be raised.
    const overrideCap = rule({ id: 9, source: "override", max_bookings: 4 });
    expect(overrideOptions(slot({ status: "full", reason: "max_bookings", rule: overrideCap }))).toEqual([
      { action: "raise_cap", relaxes: [{ kind: "cap", rule: overrideCap }] },
    ]);
  });

  it("limits an override to a service only when it relaxes that service's own rule", () => {
    const serviceCap = rule({ service_id: 2, max_bookings: 4 });
    const serviceClosed = rule({ service_id: 2, is_open: false });
    // Blackout only: every service, although the card shows a cap rule for one service.
    expect(overrideServiceId(overrideOptions(slot({ status: "closed", reason: "blackout", rule: serviceCap }))[0])).toBeNull();
    expect(overrideServiceId(overrideOptions(slot({ status: "closed", reason: "rule_closed", rule: serviceClosed }))[0])).toBe(2);
    expect(overrideServiceId(overrideOptions(slot({ status: "full", reason: "max_bookings", rule: serviceCap }))[0])).toBe(2);
    expect(overrideServiceId(overrideOptions(slot({ status: "full", reason: "max_bookings", rule: rule({ max_bookings: 4 }) }))[0])).toBeNull();
    expect(overrideServiceId(undefined)).toBeNull();
  });

  it("never offers to override hard limits", () => {
    expect(overrideOptions(slot({ status: "full", reason: "workers" }))).toEqual([]);
    expect(overrideOptions(slot({ status: "full", reason: "seats" }))).toEqual([]);
    expect(overrideOptions(slot({ status: "closed", reason: "past", rule: rule({ is_open: false }) }))).toEqual([]);
    expect(overrideOptions(slot({ status: "closed", reason: "horizon" }))).toEqual([]);
    expect(overrideOptions(slot({ is_active: false, status: "closed", reason: "inactive" }))).toEqual([]);
    expect(overrideOptions(slot({}))).toEqual([]);
  });

  it("requires a reason of at least 10 characters and an explicit confirmation", () => {
    const schema = overrideFormSchema(null);
    expect(issues(schema.safeParse({ action: "open", max_bookings: "", reason: "short", confirmed: false }))).toEqual({
      reason: ["forceReasonMin"],
      confirmed: ["required"],
    });
    expect(schema.parse({ action: "open", max_bookings: "", reason: "  Phone booking for VIP  ", confirmed: true })).toEqual({
      action: "open",
      max_bookings: null,
      reason: "Phone booking for VIP",
    });
  });

  it("needs a higher whole-number cap to raise one (0–1000)", () => {
    const schema = overrideFormSchema(4);
    const base = { action: "raise_cap" as const, reason: "Extra van available today", confirmed: true };
    expect(issues(schema.safeParse({ ...base, max_bookings: "" }))).toEqual({ max_bookings: ["maxBookingsRequired"] });
    expect(issues(schema.safeParse({ ...base, max_bookings: "4" }))).toEqual({ max_bookings: ["maxBookings"] });
    expect(issues(schema.safeParse({ ...base, max_bookings: "1001" }))).toEqual({ max_bookings: ["maxBookings"] });
    expect(issues(schema.safeParse({ ...base, max_bookings: "2.5" }))).toEqual({ max_bookings: ["maxBookings"] });
    expect(schema.parse({ ...base, max_bookings: "6" })).toEqual({ action: "raise_cap", max_bookings: 6, reason: "Extra van available today" });
  });

  it("only needs 0–1000 for the optional cap when opening", () => {
    const schema = overrideFormSchema(4);
    const base = { action: "open" as const, reason: "Extra van available today", confirmed: true };
    expect(issues(schema.safeParse({ ...base, max_bookings: "1001" }))).toEqual({ max_bookings: ["maxBookingsRange"] });
    expect(schema.parse({ ...base, max_bookings: "2" })).toMatchObject({ max_bookings: 2 });
  });
});
