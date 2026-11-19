import type { StatusTone } from "@/components/admin";
import { BUSINESS_TIME_ZONE, zonedDateTimeIso } from "../format";
import type { AttendanceInput } from "./endpoints";
import type { AttendanceDay, AttendanceStatus } from "./types";

/*
 * A05 attendance (workforce §3.2, §5.4): the form model mirroring RecordAttendanceRequest, the day's evidence and the
 * chips. Check-in and check-out are typed as Dubai wall-clock times and sent as instants WITH their offset
 * (zonedDateTimeIso, P5-W88: an offset-less value is read as UTC, four hours late). A note is required for absent, late
 * and half day; "late" takes 1 to 600 minutes and nothing else may carry minutes.
 */

export const ATTENDANCE_STATUSES = ["present", "absent", "late", "half_day"] as const satisfies readonly AttendanceStatus[];
/** The day sheet's status filter (ListAttendanceRequest): the four recordable ones and the three derived groups. */
export const SHEET_STATUSES = ["present", "absent", "late", "half_day", "unrecorded", "leave", "not_expected"] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];

export const attendanceTone: Record<AttendanceStatus, StatusTone> = { present: "success", absent: "danger", late: "pending", half_day: "pending" };

export function noteRequired(status: string): boolean {
  return status === "absent" || status === "late" || status === "half_day";
}

export type AttendanceForm = { status: string; late_minutes: string; check_in: string; check_out: string; note: string };
export type AttendanceErrorKey = "statusRequired" | "lateMinutes" | "noteRequired" | "noteLength" | "timeInvalid" | "checkOrder";
export type AttendanceErrors = Partial<Record<keyof AttendanceForm, AttendanceErrorKey>>;

/** "HH:MM" on the Dubai clock of an instant, "" without one. */
export function dubaiTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: BUSINESS_TIME_ZONE }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export function attendanceFormFrom(day: AttendanceDay): AttendanceForm {
  return {
    status: day.status ?? "",
    late_minutes: day.late_minutes === null ? "" : String(day.late_minutes),
    check_in: dubaiTime(day.check_in_at),
    check_out: dubaiTime(day.check_out_at),
    note: day.note ?? "",
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateAttendanceForm(form: AttendanceForm, date: string): { ok: true; input: AttendanceInput } | { ok: false; errors: AttendanceErrors } {
  const errors: AttendanceErrors = {};
  if (!(ATTENDANCE_STATUSES as readonly string[]).includes(form.status)) errors.status = "statusRequired";
  const minutes = form.late_minutes.trim();
  if (form.status === "late" && !(/^\d{1,3}$/.test(minutes) && Number(minutes) >= 1 && Number(minutes) <= 600)) errors.late_minutes = "lateMinutes";
  const note = form.note.trim();
  if (noteRequired(form.status) && note === "") errors.note = "noteRequired";
  else if (note.length > 500) errors.note = "noteLength";
  if (form.check_in !== "" && !TIME.test(form.check_in)) errors.check_in = "timeInvalid";
  if (form.check_out !== "" && !TIME.test(form.check_out)) errors.check_out = "timeInvalid";
  if (!errors.check_in && !errors.check_out && form.check_in !== "" && form.check_out !== "" && form.check_out < form.check_in) errors.check_out = "checkOrder";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const checkIn = form.check_in === "" ? null : zonedDateTimeIso(date, form.check_in);
  const checkOut = form.check_out === "" ? null : zonedDateTimeIso(date, form.check_out);
  return {
    ok: true,
    input: {
      status: form.status as AttendanceStatus,
      ...(form.status === "late" ? { late_minutes: Number(minutes) } : {}),
      ...(checkIn ? { check_in_at: checkIn } : {}),
      ...(checkOut ? { check_out_at: checkOut } : {}),
      ...(note !== "" ? { note } : {}),
    },
  };
}

/** If-Match of a day: its stored row's version; a day with no stored row (a computed draft) sends 0. */
export function dayVersion(day: Pick<AttendanceDay, "stored" | "version">): number {
  return day.stored ? day.version : 0;
}

/** What the day offers: approved leave decides the day, a locked month is read-only, a manual row can go back to derived. */
export function dayActions(day: AttendanceDay, today: string): { canRecord: boolean; canRevert: boolean; statuses: readonly AttendanceStatus[] } {
  const editable = !day.locked && day.leave === null && day.date <= today;
  // absent, late and half day need a working day (422 NOT_A_WORKING_DAY); a day worked on a rest day can still be present.
  const statuses: readonly AttendanceStatus[] = day.expected ? ATTENDANCE_STATUSES : ["present"];
  return { canRecord: editable, canRevert: editable && day.source === "manual", statuses };
}

export type Evidence = {
  visits: { id: number; reference: string; status: string }[];
  rounds: { id: number; kind: string; departedAt: string | null }[];
  pickups: number;
  liveOut: boolean;
  released: { visitId: number; reason: string }[];
};

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : [];
}

/** The deriver's evidence of a day, read defensively (the API sends an open object and omits empty keys). */
export function readEvidence(evidence: AttendanceDay["evidence"] | null | undefined): Evidence {
  const e = evidence ?? {};
  return {
    visits: list(e.visits).map((v) => ({ id: Number(v.id), reference: String(v.booking_reference ?? ""), status: String(v.status ?? "") })),
    rounds: list(e.rounds).map((r) => ({ id: Number(r.id), kind: String(r.kind ?? ""), departedAt: typeof r.departed_at === "string" ? r.departed_at : null })),
    pickups: list(e.pickups).length,
    liveOut: !!e.live_out && typeof e.live_out === "object",
    released: list(e.released).map((r) => ({ visitId: Number(r.visit_id), reason: String(r.reason_code ?? "") })),
  };
}

export function hasEvidence(e: Evidence): boolean {
  return e.visits.length + e.rounds.length + e.pickups + e.released.length > 0 || e.liveOut;
}

/** The first day of the month "YYYY-MM" as "YYYY-MM-01", and the number of its days (for the month table's range). */
export function monthStart(month: string): string {
  return `${month}-01`;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
