import { describe, expect, it } from "vitest";
import { attendanceDay } from "@/test/workforceFixtures";
import {
  ATTENDANCE_STATUSES,
  SHEET_STATUSES,
  attendanceFormFrom,
  dayActions,
  dayVersion,
  dubaiTime,
  hasEvidence,
  noteRequired,
  readEvidence,
  shiftMonth,
  validateAttendanceForm,
} from "./attendance";

const form = (over: Partial<ReturnType<typeof attendanceFormFrom>> = {}) => ({ status: "present", late_minutes: "", check_in: "", check_out: "", note: "", ...over });

describe("attendance form (workforce §5.4)", () => {
  it("lists the four recordable statuses and the three derived groups of the sheet", () => {
    expect(ATTENDANCE_STATUSES).toEqual(["present", "absent", "late", "half_day"]);
    expect(SHEET_STATUSES).toEqual(["present", "absent", "late", "half_day", "unrecorded", "leave", "not_expected"]);
  });

  it("needs a note for absent, late and half day only", () => {
    expect(noteRequired("absent")).toBe(true);
    expect(noteRequired("late")).toBe(true);
    expect(noteRequired("half_day")).toBe(true);
    expect(noteRequired("present")).toBe(false);
    expect(validateAttendanceForm(form({ status: "absent" }), "2026-10-22")).toEqual({ ok: false, errors: { note: "noteRequired" } });
    expect(validateAttendanceForm(form({ status: "present" }), "2026-10-22")).toEqual({ ok: true, input: { status: "present" } });
  });

  it("takes minutes late from 1 to 600 and only for late", () => {
    for (const bad of ["", "0", "601", "1.5", "abc"]) {
      expect(validateAttendanceForm(form({ status: "late", note: "traffic", late_minutes: bad }), "2026-10-22")).toMatchObject({ ok: false, errors: { late_minutes: "lateMinutes" } });
    }
    expect(validateAttendanceForm(form({ status: "late", note: "traffic", late_minutes: "600" }), "2026-10-22")).toMatchObject({ ok: true, input: { status: "late", late_minutes: 600 } });
    // Minutes typed for another status are never sent (the API prohibits them).
    const result = validateAttendanceForm(form({ status: "half_day", note: "left at noon", late_minutes: "20" }), "2026-10-22");
    expect(result).toEqual({ ok: true, input: { status: "half_day", note: "left at noon" } });
  });

  it("sends check-in and check-out as instants with the Dubai offset, never offset-less (P5-W88)", () => {
    const result = validateAttendanceForm(form({ check_in: "10:25", check_out: "16:40", note: "ok" }), "2026-10-22");
    expect(result).toEqual({ ok: true, input: { status: "present", check_in_at: "2026-10-22T10:25:00+04:00", check_out_at: "2026-10-22T16:40:00+04:00", note: "ok" } });
    // An evening check-in stays on its own Dubai date, not the UTC one.
    expect(validateAttendanceForm(form({ check_in: "23:30" }), "2026-10-22")).toMatchObject({ input: { check_in_at: "2026-10-22T23:30:00+04:00" } });
  });

  it("refuses an out-of-order or malformed time", () => {
    expect(validateAttendanceForm(form({ check_in: "10:00", check_out: "09:59" }), "2026-10-22")).toMatchObject({ ok: false, errors: { check_out: "checkOrder" } });
    expect(validateAttendanceForm(form({ check_in: "25:00" }), "2026-10-22")).toMatchObject({ ok: false, errors: { check_in: "timeInvalid" } });
    expect(validateAttendanceForm(form({ status: "" }), "2026-10-22")).toMatchObject({ ok: false, errors: { status: "statusRequired" } });
    expect(validateAttendanceForm(form({ status: "absent", note: "n".repeat(501) }), "2026-10-22")).toMatchObject({ ok: false, errors: { note: "noteLength" } });
  });

  it("reads a stored day back as Dubai times", () => {
    expect(dubaiTime("2026-10-22T06:25:00+00:00")).toBe("10:25");
    expect(dubaiTime("2026-10-22T21:30:00+00:00")).toBe("01:30");
    expect(dubaiTime(null)).toBe("");
    expect(dubaiTime("not a date")).toBe("");
    expect(attendanceFormFrom(attendanceDay({ status: "late", late_minutes: 15, check_in_at: "2026-10-22T06:25:00+00:00", note: "van" }))).toEqual({
      status: "late",
      late_minutes: "15",
      check_in: "10:25",
      check_out: "",
      note: "van",
    });
  });

  it("sends 0 as If-Match for a day with no stored row and the row's version otherwise", () => {
    expect(dayVersion(attendanceDay({ stored: false, version: 0 }))).toBe(0);
    expect(dayVersion(attendanceDay({ stored: true, version: 4 }))).toBe(4);
  });
});

describe("what a day offers", () => {
  const today = "2026-10-23";

  it("offers every status on an expected day and present only on a rest day", () => {
    expect(dayActions(attendanceDay(), today)).toEqual({ canRecord: true, canRevert: false, statuses: ATTENDANCE_STATUSES });
    expect(dayActions(attendanceDay({ expected: false, rest_day: true }), today).statuses).toEqual(["present"]);
  });

  it("lets a manual row go back to the computed day", () => {
    expect(dayActions(attendanceDay({ source: "manual", stored: true, version: 2 }), today).canRevert).toBe(true);
    expect(dayActions(attendanceDay({ source: "derived", stored: true }), today).canRevert).toBe(false);
  });

  it("offers nothing on a locked day, on leave, or after today", () => {
    expect(dayActions(attendanceDay({ locked: true, source: "manual" }), today)).toMatchObject({ canRecord: false, canRevert: false });
    expect(dayActions(attendanceDay({ leave: { id: 5 } }), today).canRecord).toBe(false);
    expect(dayActions(attendanceDay({ date: "2026-10-24" }), today).canRecord).toBe(false);
  });
});

describe("evidence and months", () => {
  it("reads the deriver's open object defensively", () => {
    const e = readEvidence({
      visits: [{ id: 5, booking_reference: "TRB-AAAAAA", status: "completed", slot_template_id: 1 }],
      rounds: [{ id: 9, kind: "drop_off", departed_at: "2026-10-22T05:50:00+00:00" }],
      pickups: [{ stop_id: 1, visit_id: 5, completed_at: "x" }],
      live_out: { subscription_id: 3, calendar_id: 4, day_type: "service" },
      released: [{ assignment_id: 1, visit_id: 5, reason_code: "worker_unavailable" }],
    });
    expect(e).toEqual({
      visits: [{ id: 5, reference: "TRB-AAAAAA", status: "completed" }],
      rounds: [{ id: 9, kind: "drop_off", departedAt: "2026-10-22T05:50:00+00:00" }],
      pickups: 1,
      liveOut: true,
      released: [{ visitId: 5, reason: "worker_unavailable" }],
    });
    expect(hasEvidence(e)).toBe(true);
    expect(hasEvidence(readEvidence({}))).toBe(false);
    expect(hasEvidence(readEvidence(null))).toBe(false);
    expect(readEvidence({ visits: "nope", rounds: [1, null] } as never)).toMatchObject({ visits: [], rounds: [] });
  });

  it("moves between months across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });
});
