import { isIsoDate } from "../format";
import type {
  DriverReportStatus,
  DriverReportType,
  Round,
  RoundKind,
  RoundStatus,
  RoundWarning,
  RoundWarningType,
  StopStatus,
  UnplannedReason,
} from "../types";

/*
 * A06 trip planner (spec §6.8, §8.3, §14.3, §17 A06; D-04 a team rides together). The API plans, checks and keeps
 * every rule (seats, rides, lateness); these helpers only shape what is sent and shown.
 */

export const ROUND_KINDS = ["dropoff", "pickup"] as const satisfies readonly RoundKind[];
export const ROUND_STATUSES = ["planned", "departed", "in_progress", "completed", "cancelled"] as const satisfies readonly RoundStatus[];
export const STOP_STATUSES = ["pending", "arrived", "dropped_off", "picked_up", "failed"] as const satisfies readonly StopStatus[];
export const DRIVER_REPORT_TYPES = ["delay", "cannot_reach", "vehicle_issue", "other"] as const satisfies readonly DriverReportType[];
export const DRIVER_REPORT_STATUSES = ["open", "acknowledged", "resolved"] as const satisfies readonly DriverReportStatus[];

export const ROUND_WARNING_TYPES = [
  "no_driver",
  "driver_inactive",
  "vehicle_unavailable",
  "seats_exceeded",
  "late_stop",
  "visit_not_ready",
  "visit_closed",
  "visit_moved",
  "team_not_aboard",
  "passenger_not_on_team",
  "seats_on_other_vehicle",
  "driver_action_failed",
  "pickup_late",
  "ride_clash",
  "action_backdated",
] as const satisfies readonly RoundWarningType[];

export const UNPLANNED_REASONS = [
  "booking_not_confirmed",
  "workers_not_assigned",
  "no_vehicle",
  "vehicle_unavailable",
  "round_underway",
  "seats_full",
  "resource_conflict",
  "visit_already_on_round",
  "passenger_conflict",
  "visit_underway",
  "visit_moved",
  "visit_closed",
  "visit_completed",
] as const satisfies readonly UnplannedReason[];

/** The cancellation reason: 3 to 500 characters (CancelRoundRequest). */
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 500;
export const REPORT_NOTE_MAX = 1000;

/** Only a planned round can be edited, reordered, seated, published or cancelled (RoundEditor::assertPlanned). */
export function isEditable(round: Pick<Round, "status">): boolean {
  return round.status === "planned";
}

/** A copy of `list` with the item at `from` moved to `to` (indices clamped). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
}

/** Warnings about one stop (they carry its stop_id) and the rest, about the round as a whole. */
export function splitWarnings(round: Pick<Round, "warnings">): { round: RoundWarning[]; byStop: Map<number, RoundWarning[]> } {
  const byStop = new Map<number, RoundWarning[]>();
  const rest: RoundWarning[] = [];
  for (const w of round.warnings) {
    if (typeof w.stop_id === "number") byStop.set(w.stop_id, [...(byStop.get(w.stop_id) ?? []), w]);
    else rest.push(w);
  }
  return { round: rest, byStop };
}

/** The business clock is Asia/Dubai, UTC+4 all year (no daylight saving): "HH:MM" on a date → an instant with its offset. */
export function departInstant(date: string, time: string): string | null {
  if (!isIsoDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return `${date}T${time}:00+04:00`;
}

export type RoundEditValues = { vehicleId: string; driverId: string; departTime: string };

export function roundEditDefaults(round: Pick<Round, "vehicle" | "driver" | "depart_local">): RoundEditValues {
  return { vehicleId: String(round.vehicle.id), driverId: round.driver ? String(round.driver.id) : "", departTime: round.depart_local };
}

/** PATCH /admin/rounds/{id}: only what changed (an empty driver clears it). */
export function roundChanges(round: Pick<Round, "date" | "vehicle" | "driver" | "depart_local">, values: RoundEditValues) {
  const changes: { vehicle_id?: number; driver_id?: number | null; planned_depart_at?: string } = {};
  if (values.vehicleId && Number(values.vehicleId) !== round.vehicle.id) changes.vehicle_id = Number(values.vehicleId);
  const driver = values.driverId ? Number(values.driverId) : null;
  if (driver !== (round.driver?.id ?? null)) changes.driver_id = driver;
  if (values.departTime && values.departTime !== round.depart_local) {
    const instant = departInstant(round.date, values.departTime);
    if (instant) changes.planned_depart_at = instant;
  }
  return changes;
}

// ---- seats (round_passengers) -----------------------------------------------------------------------------------

export type SeatRow = { workerId: number; name: string; /** The stop whose team she is on, if any. */ sequence: number | null; seat: string };

/**
 * One row per rider: the team of each stop in driving order, then anyone else already seated (an extra rider after an
 * override). Each starts on her current seat, if any.
 */
export function seatRows(round: Pick<Round, "stops" | "passengers">): SeatRow[] {
  const seatOf = new Map(round.passengers.map((p) => [p.worker_id, p.seat_no]));
  const rows: SeatRow[] = [];
  const seen = new Set<number>();
  for (const stop of [...round.stops].sort((a, b) => a.sequence - b.sequence)) {
    if (stop.status === "failed") continue;
    for (const w of stop.workers) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      rows.push({ workerId: w.id, name: w.display_name, sequence: stop.sequence, seat: seatOf.has(w.id) ? String(seatOf.get(w.id)) : "" });
    }
  }
  for (const p of round.passengers) {
    if (seen.has(p.worker_id)) continue;
    seen.add(p.worker_id);
    rows.push({ workerId: p.worker_id, name: p.display_name, sequence: null, seat: String(p.seat_no) });
  }
  return rows;
}

/** Fills the empty seats in row order with the lowest free seat numbers (teams in stop order sit together). */
export function fillSeats(rows: readonly SeatRow[], seats: number): SeatRow[] {
  const taken = new Set(rows.map((r) => Number(r.seat)).filter((n) => n > 0));
  let next = 1;
  return rows.map((row) => {
    if (row.seat) return row;
    while (taken.has(next)) next++;
    if (next > seats) return row;
    taken.add(next);
    return { ...row, seat: String(next) };
  });
}

/** Seat numbers chosen twice (one worker per seat: UNIQUE(round_id, seat_no)). */
export function duplicateSeats(rows: readonly SeatRow[]): Set<string> {
  const count = new Map<string, number>();
  for (const r of rows) if (r.seat) count.set(r.seat, (count.get(r.seat) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([seat]) => seat));
}

/** PUT /admin/rounds/{id}/passengers: the riders who have a seat. */
export function passengersPayload(rows: readonly SeatRow[]) {
  return rows.filter((r) => r.seat).map((r) => ({ worker_id: r.workerId, seat_no: Number(r.seat) }));
}

/** 409 OVERRIDE_REQUIRED of SetPassengers: riders not on a stop's team, and visits whose team is split. */
export function passengerViolations(details: Record<string, unknown>): { notOnRound: number[]; teamSplit: number[] } {
  const v = details.violations && typeof details.violations === "object" ? (details.violations as Record<string, unknown>) : {};
  const ids = (value: unknown) => (Array.isArray(value) ? value.filter((n): n is number => typeof n === "number") : []);
  return { notOnRound: ids(v.not_on_round), teamSplit: ids(v.team_split) };
}

// ---- driver reports ---------------------------------------------------------------------------------------------

/** open → acknowledged | resolved; acknowledged → resolved; resolved is closed (DriverReportStatus::canBecome). */
export function reportTargets(status: DriverReportStatus): ("acknowledged" | "resolved")[] {
  if (status === "open") return ["acknowledged", "resolved"];
  if (status === "acknowledged") return ["resolved"];
  return [];
}
