import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { ShiftRow, Worker } from "../types";
import {
  applyShiftToWorkingDays,
  hasPrivateFields,
  leaveActions,
  leaveDecisionSchema,
  leaveRequestSchema,
  newWorkerValues,
  serializeShifts,
  shiftErrorDay,
  toShiftDraft,
  validateShifts,
  workerFormSchema,
  workerToFormValues,
} from "./workforce";

function issues(result: z.ZodSafeParseResult<unknown>): Record<string, string[]> {
  if (result.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of result.error.issues) (out[issue.path.join(".")] ??= []).push(issue.message);
  return out;
}

// DemoWorkforceSeeder: works Sunday–Thursday and Saturday 09:00–20:00, rests on Friday (5).
const week: ShiftRow[] = [0, 1, 2, 3, 4, 5, 6].map((d) =>
  d === 5
    ? { day_of_week: d, is_working: false, start_time: null, end_time: null }
    : { day_of_week: d, is_working: true, start_time: "09:00", end_time: "20:00" },
);

const maria: Worker = {
  id: 1,
  ulid: "01m5jm537rh4yrgc2hqg2e0s25",
  employee_no: "DEMO-W01",
  full_name: { ar: "ماريا سانتوس", en: "Maria Santos" },
  display_name: "Maria S.",
  phone: null,
  nationality: "PH",
  languages: ["en", "tl", "ar"],
  employment_status: "active",
  hired_at: "2026-09-01",
  home_zone_id: 1,
  can_live_out: true,
  weekly_rest_day: 5,
  notes: "Demo worker",
  shifts: week,
  version: 1,
  created_at: null,
  updated_at: null,
};

describe("weekly shift editor (UpdateShiftsRequest + WeeklyPattern)", () => {
  it("round-trips the API's seven rows, Sunday first, days off without times", () => {
    const rows = serializeShifts(toShiftDraft(week));
    expect(rows).toEqual(week);
    expect(rows.map((r) => r.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("keeps default hours ready on days off but never sends them", () => {
    const draft = toShiftDraft(week);
    expect(draft[5]).toEqual({ working: false, start: "09:00", end: "18:00" });
    expect(serializeShifts(draft)[5]).toEqual({ day_of_week: 5, is_working: false, start_time: null, end_time: null });
    // A worker without shifts: seven days off.
    expect(serializeShifts(toShiftDraft(undefined)).every((r) => !r.is_working)).toBe(true);
  });

  it("checks quarter hours, start before end (24:00 allowed as an end) and no shift on the rest day", () => {
    const draft = toShiftDraft(week);
    draft[0] = { working: true, start: "09:10", end: "17:00" };
    draft[1] = { working: true, start: "18:00", end: "09:00" };
    draft[2] = { working: true, start: "16:00", end: "24:00" };
    draft[5] = { working: true, start: "09:00", end: "17:00" }; // the rest day
    expect(validateShifts(draft, 5)).toEqual({ 0: "timeStep", 1: "timeOrder", 5: "restDayWorking" });
    // Moving the rest day to a day off clears the rest-day problem (shifts and rest day change together).
    draft[6] = { working: false, start: "09:00", end: "18:00" };
    expect(validateShifts(draft, 6)).toEqual({ 0: "timeStep", 1: "timeOrder" });
  });

  it("copies one day's hours to the working days only", () => {
    const draft = toShiftDraft(week);
    draft[1] = { working: true, start: "08:00", end: "16:30" };
    const next = applyShiftToWorkingDays(draft, 1);
    expect(next[0]).toEqual({ working: true, start: "08:00", end: "16:30" });
    expect(next[5]).toEqual(draft[5]);
  });

  it("maps API field errors shifts.N.* back to the weekday of that row", () => {
    expect(shiftErrorDay("shifts.3.end_time")).toBe(3);
    expect(shiftErrorDay("shifts")).toBeNull();
  });
});

describe("worker form (StoreWorkerRequest / UpdateWorkerRequest)", () => {
  it("turns the loaded worker back into the same fields", () => {
    const result = workerFormSchema().safeParse(workerToFormValues(maria));
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({
      employee_no: "DEMO-W01",
      full_name: maria.full_name,
      display_name: "Maria S.",
      phone: null,
      nationality: "PH",
      languages: ["en", "tl", "ar"],
      employment_status: "active",
      hired_at: "2026-09-01",
      home_zone_id: 1,
      can_live_out: true,
      weekly_rest_day: 5,
      notes: "Demo worker",
    });
  });

  it("leaves phone and notes out when the API sent the basic profile", () => {
    const basic = { ...maria } as Partial<Worker>;
    delete basic.phone;
    delete basic.notes;
    expect(hasPrivateFields(basic as Worker)).toBe(false);
    expect(hasPrivateFields(maria)).toBe(true);
    const result = workerFormSchema({ privateFields: false }).safeParse(workerToFormValues(basic as Worker));
    expect(result.success && "phone" in result.data).toBe(false);
    expect(result.success && "notes" in result.data).toBe(false);
  });

  it("applies the API rules: employee number, display name, nationality, languages, zone and rest day", () => {
    const values = {
      ...newWorkerValues(),
      employee_no: "w 01",
      full_name: { ar: "", en: "Maria" },
      display_name: "x".repeat(61),
      nationality: "PHL",
      languages: ["english"],
      home_zone_id: "",
      weekly_rest_day: "",
      phone: "1".repeat(31),
    };
    expect(issues(workerFormSchema().safeParse(values))).toEqual({
      "full_name.ar": ["nameRequired"],
      home_zone_id: ["zoneRequired"],
      phone: ["phoneLength"],
      employee_no: ["employeeNo"],
      display_name: ["displayName"],
      nationality: ["nationality"],
      languages: ["language"],
      weekly_rest_day: ["restDay"],
    });
    expect(issues(workerFormSchema().safeParse({ ...values, languages: [] })).languages).toEqual(["languagesRequired"]);
  });

  it("normalizes like the API: upper-case employee number and nationality, lower-case unique languages", () => {
    const result = workerFormSchema().safeParse({
      ...newWorkerValues(),
      employee_no: " w-014 ",
      full_name: { ar: "نور", en: "Noor" },
      display_name: " Noor ",
      nationality: "in",
      languages: ["AR", "ar", " En "],
      home_zone_id: "2",
      weekly_rest_day: "4",
    });
    expect(result.success && result.data).toMatchObject({
      employee_no: "W-014",
      display_name: "Noor",
      nationality: "IN",
      languages: ["ar", "en"],
      home_zone_id: 2,
      weekly_rest_day: 4,
      hired_at: null,
      notes: null,
    });
  });
});

describe("leave (StoreLeaveRequest, LeaveDecisionRequest, LeaveStatus)", () => {
  it("needs a type and both dates, the last on or after the first", () => {
    expect(issues(leaveRequestSchema.safeParse({ type: "annual", date_from: "", date_to: "2026-10-01", reason: "" }))).toEqual({
      date_from: ["dateRequired"],
    });
    expect(
      issues(leaveRequestSchema.safeParse({ type: "sick", date_from: "2026-11-05", date_to: "2026-11-04", reason: "" })),
    ).toEqual({ date_to: ["dateRange"] });
    expect(leaveRequestSchema.parse({ type: "sick", date_from: "2026-11-05", date_to: "2026-11-05", reason: "  " })).toEqual({
      type: "sick",
      date_from: "2026-11-05",
      date_to: "2026-11-05",
      reason: null,
    });
  });

  it("offers approve / reject / cancel on a request and only cancel once approved", () => {
    expect(leaveActions("requested")).toEqual(["approve", "reject", "cancel"]);
    expect(leaveActions("approved")).toEqual(["cancel"]);
    expect(leaveActions("rejected")).toEqual([]);
    expect(leaveActions("cancelled")).toEqual([]);
  });

  it("needs a note to reject or cancel, not to approve", () => {
    expect(leaveDecisionSchema("approve").parse({ note: " " })).toEqual({ note: null });
    expect(issues(leaveDecisionSchema("reject").safeParse({ note: "" }))).toEqual({ note: ["noteRequired"] });
    expect(issues(leaveDecisionSchema("cancel").safeParse({ note: "x".repeat(501) }))).toEqual({ note: ["noteLength"] });
    expect(leaveDecisionSchema("cancel").parse({ note: " Family emergency over " })).toEqual({ note: "Family emergency over" });
  });
});
