import { z } from "zod";
import { normalizeDigits } from "@/lib/money";
import { translatableInput } from "../catalog/fields";
import type { EmploymentStatus, LeaveStatus, LeaveType, ShiftRow, Translatable, Worker } from "../types";
import { addIssue, checkWindow, optionalDate, optionalText, requiredDate, requiredIdSelect, type OpsErrorKey } from "./fields";
import { WEEK_ORDER } from "./weeklyHours";

/*
 * A05 workers: form schemas mirroring app/Modules/Workforce/Http/Requests (StoreWorkerRequest, UpdateWorkerRequest,
 * UpdateShiftsRequest + WeeklyPattern, StoreLeaveRequest, LeaveDecisionRequest), and the weekly shift editor model.
 * The API validates everything again; its field messages land on the same fields.
 */

export const EMPLOYMENT_STATUSES = ["active", "on_leave", "suspended", "terminated"] as const satisfies readonly EmploymentStatus[];
export const LEAVE_TYPES = ["annual", "sick", "unpaid", "emergency", "public_holiday"] as const satisfies readonly LeaveType[];
export const LEAVE_STATUSES = ["requested", "approved", "rejected", "cancelled"] as const satisfies readonly LeaveStatus[];

/** StoreWorkerRequest patterns. */
const EMPLOYEE_NO = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TWO_LETTERS = /^[A-Za-z]{2}$/;

// ---- Worker profile ----------------------------------------------------------------------------------------------

export type WorkerFormValues = {
  employee_no: string;
  full_name: Translatable;
  display_name: string;
  phone: string;
  nationality: string;
  languages: string[];
  employment_status: EmploymentStatus;
  hired_at: string;
  home_zone_id: string;
  can_live_out: boolean;
  weekly_rest_day: string;
  notes: string;
};

export type WorkerPayload = {
  employee_no: string;
  full_name: Translatable;
  display_name: string;
  phone?: string | null;
  nationality: string | null;
  languages: string[];
  employment_status: EmploymentStatus;
  hired_at: string | null;
  home_zone_id: number;
  can_live_out: boolean;
  weekly_rest_day: number;
  notes?: string | null;
};

// Each field is checked on its own, so every problem shows at once (a transform on the whole object only runs once
// all fields are valid).

const employeeNoInput = z.string().transform((raw, ctx): string => {
  const v = raw.trim().toUpperCase();
  if (v === "") addIssue(ctx, "required");
  else if (v.length > 30 || !EMPLOYEE_NO.test(v)) addIssue(ctx, "employeeNo");
  return v;
});

const displayNameInput = z.string().transform((raw, ctx): string => {
  const v = raw.trim();
  if (v === "" || v.length > 60) addIssue(ctx, "displayName");
  return v;
});

const nationalityInput = z.string().transform((raw, ctx): string | null => {
  const v = raw.trim().toUpperCase();
  if (v !== "" && !TWO_LETTERS.test(v)) addIssue(ctx, "nationality");
  return v === "" ? null : v;
});

/** 1–10 distinct two-letter codes, lower-cased like WorkerFields::languages(). */
const languagesInput = z.array(z.string()).transform((raw, ctx): string[] => {
  const v = [...new Set(raw.map((l) => l.trim().toLowerCase()).filter((l) => l !== ""))];
  if (v.length === 0) addIssue(ctx, "languagesRequired");
  else if (v.length > 10) addIssue(ctx, "languagesMax");
  else if (v.some((l) => !TWO_LETTERS.test(l))) addIssue(ctx, "language");
  return v;
});

const restDayInput = z.string().transform((raw, ctx): number => {
  const v = Number(normalizeDigits(raw));
  if (raw === "" || !Number.isInteger(v) || v < 0 || v > 6) addIssue(ctx, "restDay");
  return v;
});

/**
 * The worker form. `privateFields` is false when the loaded profile is the basic view (no phone or notes from the
 * API): those fields are then left out of the payload instead of being cleared.
 */
export function workerFormSchema(options: { privateFields: boolean } = { privateFields: true }) {
  return z
    .object({
      employee_no: employeeNoInput,
      full_name: translatableInput(120),
      display_name: displayNameInput,
      phone: optionalText(30, "phoneLength"),
      nationality: nationalityInput,
      languages: languagesInput,
      employment_status: z.enum(EMPLOYMENT_STATUSES),
      hired_at: optionalDate,
      home_zone_id: requiredIdSelect("zoneRequired"),
      can_live_out: z.boolean(),
      weekly_rest_day: restDayInput,
      notes: optionalText(2000, "notesLength"),
    })
    .transform(
      (v): WorkerPayload => ({
        employee_no: v.employee_no,
        full_name: v.full_name,
        display_name: v.display_name,
        ...(options.privateFields ? { phone: v.phone } : {}),
        nationality: v.nationality,
        languages: v.languages,
        employment_status: v.employment_status,
        hired_at: v.hired_at,
        home_zone_id: v.home_zone_id,
        can_live_out: v.can_live_out,
        weekly_rest_day: v.weekly_rest_day,
        ...(options.privateFields ? { notes: v.notes } : {}),
      }),
    );
}

export function newWorkerValues(): WorkerFormValues {
  return {
    employee_no: "",
    full_name: { ar: "", en: "" },
    display_name: "",
    phone: "",
    nationality: "",
    languages: ["ar"],
    employment_status: "active",
    hired_at: "",
    home_zone_id: "",
    can_live_out: false,
    weekly_rest_day: "5",
    notes: "",
  };
}

export function workerToFormValues(w: Worker): WorkerFormValues {
  return {
    employee_no: w.employee_no,
    full_name: { ar: w.full_name?.ar ?? "", en: w.full_name?.en ?? "" },
    display_name: w.display_name,
    phone: w.phone ?? "",
    nationality: w.nationality ?? "",
    languages: [...(w.languages ?? [])],
    employment_status: w.employment_status,
    hired_at: w.hired_at ?? "",
    home_zone_id: String(w.home_zone_id),
    can_live_out: w.can_live_out,
    weekly_rest_day: String(w.weekly_rest_day),
    notes: w.notes ?? "",
  };
}

/** Whether the API sent the full profile (phone and notes present), i.e. the viewer holds workers.manage or leave.manage. */
export const hasPrivateFields = (w: Worker) => "phone" in w || "notes" in w;

// ---- Weekly shift pattern (PUT /admin/workers/{id}/shifts) -----------------------------------------------------

export type ShiftDraftRow = { working: boolean; start: string; end: string };
/** Keyed by weekday 0..6 (0 = Sunday). */
export type ShiftDraft = Record<number, ShiftDraftRow>;

export type ShiftError = Extract<OpsErrorKey, "timeStep" | "timeOrder" | "startMidnight" | "restDayWorking">;

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";

/** The editor state from the API's seven rows; days without a row are days off. */
export function toShiftDraft(rows: readonly ShiftRow[] | undefined): ShiftDraft {
  const draft: ShiftDraft = {};
  for (let d = 0; d < 7; d++) {
    const row = rows?.find((r) => r.day_of_week === d);
    draft[d] =
      row && row.is_working
        ? { working: true, start: row.start_time ?? DEFAULT_START, end: row.end_time ?? DEFAULT_END }
        : { working: false, start: DEFAULT_START, end: DEFAULT_END };
  }
  return draft;
}

/** WeeklyPattern rules: quarter-hour times, start < end on the same day (24:00 as an end), no shift on the rest day. */
export function validateShifts(draft: ShiftDraft, restDay: number | null): Partial<Record<number, ShiftError>> {
  const errors: Partial<Record<number, ShiftError>> = {};
  for (let d = 0; d < 7; d++) {
    const row = draft[d];
    if (!row?.working) continue;
    if (restDay === d) {
      errors[d] = "restDayWorking";
      continue;
    }
    const problem = checkWindow(row.start, row.end);
    if (problem) errors[d] = problem.error as ShiftError;
  }
  return errors;
}

/** The seven rows the API expects (0 = Sunday first); days off carry no times. */
export function serializeShifts(draft: ShiftDraft): ShiftRow[] {
  return Array.from({ length: 7 }, (_, d) => {
    const row = draft[d];
    return row?.working
      ? { day_of_week: d, is_working: true, start_time: row.start, end_time: row.end }
      : { day_of_week: d, is_working: false, start_time: null, end_time: null };
  });
}

/** Copies one day's hours to every working day (rest day excluded). */
export function applyShiftToWorkingDays(draft: ShiftDraft, sourceDay: number): ShiftDraft {
  const source = draft[sourceDay];
  if (!source) return draft;
  const next: ShiftDraft = {};
  for (let d = 0; d < 7; d++) next[d] = draft[d]?.working ? { ...draft[d], start: source.start, end: source.end } : { ...draft[d] };
  return next;
}

/** API field errors "shifts.<index>.start_time" → the weekday of that row (rows are sent Sunday first). */
export function shiftErrorDay(field: string): number | null {
  const m = /^shifts\.(\d)\./.exec(field);
  return m ? Number(m[1]) : null;
}

export { WEEK_ORDER };

// ---- Leave -----------------------------------------------------------------------------------------------------

export type LeaveRequestValues = { type: LeaveType; date_from: string; date_to: string; reason: string };
export type LeaveRequestPayload = { type: LeaveType; date_from: string; date_to: string; reason: string | null };

/** StoreLeaveRequest: type, both dates (to on or after from), optional reason (500). */
export const leaveRequestSchema = z
  .object({
    type: z.enum(LEAVE_TYPES),
    date_from: requiredDate,
    date_to: requiredDate,
    reason: optionalText(500, "noteLength"),
  })
  .transform((v, ctx): LeaveRequestPayload => {
    if (v.date_to < v.date_from) addIssue(ctx, "dateRange", ["date_to"]);
    return v;
  });

export type LeaveDecision = "approve" | "reject" | "cancel";

/** Decisions a leave in this status can take (LeaveStatus::canBecome). */
export function leaveActions(status: LeaveStatus): LeaveDecision[] {
  if (status === "requested") return ["approve", "reject", "cancel"];
  if (status === "approved") return ["cancel"];
  return [];
}

/** LeaveDecisionRequest: a note is optional when approving and required when rejecting or cancelling (500 max). */
export function leaveDecisionSchema(decision: LeaveDecision) {
  return z.object({ note: z.string() }).transform((v, ctx): { note: string | null } => {
    const note = v.note.trim();
    if (note === "" && decision !== "approve") addIssue(ctx, "noteRequired", ["note"]);
    if (note.length > 500) addIssue(ctx, "noteLength", ["note"]);
    return { note: note === "" ? null : note };
  });
}
