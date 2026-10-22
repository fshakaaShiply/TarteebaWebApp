import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { SlotTemplate } from "../types";
import {
  blackoutFormSchema,
  blackoutToFormValues,
  slotRuleFormSchema,
  slotRuleToFormValues,
  slotTemplateFormSchema,
  slotTemplateToFormValues,
} from "./scheduling";

function issues(result: z.ZodSafeParseResult<unknown>): Record<string, string[]> {
  if (result.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of result.error.issues) (out[issue.path.join(".")] ??= []).push(issue.message);
  return out;
}

// SchedulingSeeder: MORNING 10:00–14:00 for standard visits.
const morning: SlotTemplate = {
  id: 1,
  code: "MORNING",
  name: { ar: "الفترة الصباحية", en: "Morning" },
  start_time: "10:00",
  end_time: "14:00",
  service_kind: "standard_visit",
  is_active: true,
  sort_order: 1,
  version: 1,
  updated_at: null,
};

describe("slot template form (SlotTemplateRequest + SlotTimes)", () => {
  it("edits without the code (fixed after creation)", () => {
    expect(slotTemplateFormSchema("edit").parse(slotTemplateToFormValues(morning))).toEqual({
      name: morning.name,
      start_time: "10:00",
      end_time: "14:00",
      service_kind: "standard_visit",
      is_active: true,
      sort_order: 1,
    });
  });

  it("creates with an upper-cased code and allows 24:00 as an end", () => {
    const values = { ...slotTemplateToFormValues(null), code: "late_evening", name: { ar: "مسائية متأخرة", en: "Late evening" }, start_time: "20:00", end_time: "24:00" };
    expect(slotTemplateFormSchema("create").parse(values)).toMatchObject({ code: "LATE_EVENING", start_time: "20:00", end_time: "24:00" });
  });

  it("refuses an end before the start, off-grid times, a 24:00 start and a bad code or order", () => {
    const base = { ...slotTemplateToFormValues(morning) };
    expect(issues(slotTemplateFormSchema("edit").safeParse({ ...base, start_time: "14:00", end_time: "10:00" }))).toEqual({ end_time: ["timeOrder"] });
    expect(issues(slotTemplateFormSchema("edit").safeParse({ ...base, start_time: "10:10" }))).toEqual({ start_time: ["timeStep"] });
    expect(issues(slotTemplateFormSchema("edit").safeParse({ ...base, start_time: "24:00", end_time: "24:00" }))).toEqual({
      start_time: ["startMidnight"],
    });
    expect(issues(slotTemplateFormSchema("create").safeParse({ ...base, code: "1AM", sort_order: "1001", name: { ar: "", en: "x" } }))).toEqual({
      code: ["codeFormat"],
      sort_order: ["sortOrder"],
      "name.ar": ["nameRequired"],
    });
  });
});

describe("slot rule form (SlotRuleRequest + RuleFields)", () => {
  it("empty scope fields mean all zones, all services, every day and all dates", () => {
    const values = { ...slotRuleToFormValues(null), slot_template_id: "1", is_open: true, max_bookings: "6", reason: "Weekend demand" };
    expect(slotRuleFormSchema.parse(values)).toEqual({
      slot_template_id: 1,
      zone_id: null,
      service_id: null,
      day_of_week: null,
      date_from: null,
      date_to: null,
      is_open: true,
      max_bookings: 6,
      reason: "Weekend demand",
    });
  });

  it("drops the booking cap of a closed rule", () => {
    const values = { ...slotRuleToFormValues(null), slot_template_id: "2", day_of_week: "5", is_open: false, max_bookings: "3", reason: "Friday off" };
    expect(slotRuleFormSchema.parse(values)).toMatchObject({ day_of_week: 5, is_open: false, max_bookings: null });
  });

  it("needs a slot and a reason, a cap of 0–1000 and a last date on or after the first", () => {
    const values = { ...slotRuleToFormValues(null), max_bookings: "1001", date_from: "2026-12-10", date_to: "2026-12-01" };
    expect(issues(slotRuleFormSchema.safeParse(values))).toEqual({
      slot_template_id: ["slotRequired"],
      // SlotRuleRequest only asks for 0–1000; "higher than the current limit" belongs to the override form.
      max_bookings: ["maxBookingsRange"],
      reason: ["reasonRequired"],
    });
    expect(issues(slotRuleFormSchema.safeParse({ ...values, max_bookings: "2.5" })).max_bookings).toEqual(["maxBookingsRange"]);
    expect(
      slotRuleFormSchema.parse({ ...values, slot_template_id: "1", is_open: true, max_bookings: "0", date_to: "", reason: "Paused" }),
    ).toMatchObject({ max_bookings: 0 });
    const fixed = { ...values, slot_template_id: "1", max_bookings: "", reason: "Holiday season" };
    expect(issues(slotRuleFormSchema.safeParse(fixed))).toEqual({ date_to: ["dateRange"] });
  });
});

describe("blackout form (BlackoutDateRequest + BlackoutFields)", () => {
  it("no zone means every zone, and an empty reason is null", () => {
    expect(blackoutFormSchema.parse(blackoutToFormValues(null, "2026-12-02"))).toEqual({ date: "2026-12-02", zone_id: null, reason: null });
  });

  it("keeps the languages that were filled in (200 characters each)", () => {
    const values = { date: "2026-12-02", zone_id: "2", reason: { ar: " اليوم الوطني ", en: "" } };
    expect(blackoutFormSchema.parse(values)).toEqual({ date: "2026-12-02", zone_id: 2, reason: { ar: "اليوم الوطني" } });
    expect(issues(blackoutFormSchema.safeParse({ ...values, date: "", reason: { ar: "", en: "x".repeat(201) } }))).toEqual({
      date: ["dateRequired"],
      "reason.en": ["blackoutReasonLength"],
    });
  });
});
