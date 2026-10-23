import type { ScheduleQuery } from "../endpoints";
import { addDaysIso, isIsoDate } from "../format";
import type { BookingStatus, ScheduleGrid, ScheduleRow, ScheduleView, VisitStatus, VisitSummary } from "../types";

/*
 * A04 operations schedule (spec §14.3, §17 A04): the view, the date and the filters live in the page URL (the API's own
 * parameter names), so a link opens the board as it was and a filtered board can be bookmarked. The zone is the shared
 * top-bar zone filter (lib/admin/zone.tsx); a `zone_id` in a link is adopted into it, as on the bookings list.
 */

export const SCHEDULE_VIEWS = ["day", "week", "month"] as const satisfies readonly ScheduleView[];

export const VISIT_STATUSES = [
  "scheduled",
  "worker_assigned",
  "en_route",
  "arrived",
  "in_progress",
  "completed",
  "no_show_customer",
  "missed_by_company",
  "cancelled",
] as const satisfies readonly VisitStatus[];

/** Day markers the API sends (ScheduleBoard::markers). */
export const SCHEDULE_MARKERS = ["rest_day", "leave", "live_out", "not_on_shift", "not_active"] as const;

export type ScheduleFilters = {
  view: ScheduleView;
  /** "YYYY-MM-DD"; empty = today. */
  date: string;
  serviceId: number | null;
  slotTemplateId: number | null;
  workerId: number | null;
  /** Visit statuses (comma-separated in the URL). */
  statuses: VisitStatus[];
};

export const NO_SCHEDULE_FILTERS: ScheduleFilters = { view: "day", date: "", serviceId: null, slotTemplateId: null, workerId: null, statuses: [] };

type ParamsLike = { get(name: string): string | null };

function id(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

/** Filters from the page URL; unknown or malformed values are ignored. */
export function scheduleFiltersFromParams(params: ParamsLike): ScheduleFilters {
  const view = params.get("view");
  const date = params.get("date");
  const statuses = (params.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s, i, all): s is VisitStatus => (VISIT_STATUSES as readonly string[]).includes(s) && all.indexOf(s) === i);
  return {
    view: (SCHEDULE_VIEWS as readonly string[]).includes(view ?? "") ? (view as ScheduleView) : "day",
    date: isIsoDate(date) ? date : "",
    serviceId: id(params.get("service_id")),
    slotTemplateId: id(params.get("slot_template_id")),
    workerId: id(params.get("worker_id")),
    statuses,
  };
}

/** The URL query for these filters (day view and today implied). */
export function scheduleFiltersToParams(filters: ScheduleFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (filters.view !== "day") out.set("view", filters.view);
  if (filters.date) out.set("date", filters.date);
  if (filters.serviceId !== null) out.set("service_id", String(filters.serviceId));
  if (filters.slotTemplateId !== null) out.set("slot_template_id", String(filters.slotTemplateId));
  if (filters.workerId !== null) out.set("worker_id", String(filters.workerId));
  if (filters.statuses.length > 0) out.set("status", filters.statuses.join(","));
  return out;
}

/** True when a filter other than the view and the date is set. */
export function hasScheduleFilters(filters: ScheduleFilters): boolean {
  return filters.serviceId !== null || filters.slotTemplateId !== null || filters.workerId !== null || filters.statuses.length > 0;
}

/** The React Query key of a board request (adminKeys.scheduleBoard): flat, so equal requests share one cache entry. */
export function scheduleKey(query: ScheduleQuery): Record<string, string | number> {
  return {
    view: query.view,
    date: query.date,
    zone: query.zoneId ?? 0,
    service: query.serviceId ?? 0,
    slot: query.slotTemplateId ?? 0,
    worker: query.workerId ?? 0,
    status: (query.statuses ?? []).join(","),
  };
}

export function scheduleQuery(filters: ScheduleFilters, date: string, zoneId: number | null): ScheduleQuery {
  return {
    view: filters.view,
    date,
    zoneId,
    serviceId: filters.serviceId,
    slotTemplateId: filters.slotTemplateId,
    workerId: filters.workerId,
    statuses: filters.statuses,
  };
}

/** The same view one step earlier or later: a day, a week (Monday–Sunday) or a calendar month. */
export function shiftDate(view: ScheduleView, date: string, step: -1 | 1): string {
  if (view === "day") return addDaysIso(date, step);
  if (view === "week") return addDaysIso(date, 7 * step);
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + step, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** Monday = 0 … Sunday = 6 for a local date. */
export function mondayIndex(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** The month's dates as calendar weeks (Monday first); null pads the first and last week. */
export function calendarWeeks<T extends { date: string }>(days: readonly T[]): (T | null)[][] {
  if (days.length === 0) return [];
  const cells: (T | null)[] = [...Array.from({ length: mondayIndex(days[0].date) }, () => null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ---- cards and moves --------------------------------------------------------------------------------------------

/** A team can still change while the booking is open and the visit has not started (VisitTeam). */
const MOVABLE_BOOKING: readonly BookingStatus[] = ["pending_confirmation", "confirmed"];
const MOVABLE_VISIT: readonly VisitStatus[] = ["scheduled", "worker_assigned"];

export function isMovable(card: VisitSummary): boolean {
  return MOVABLE_BOOKING.includes(card.booking.status) && MOVABLE_VISIT.includes(card.status);
}

/** The cards of one worker row on one date, in one slot (day view) or all slots (week view: slotId null). */
export function cellCards(row: ScheduleRow, date: string, slotId: number | null): VisitSummary[] {
  const day = row.days.find((d) => d.date === date);
  if (!day) return [];
  return slotId === null ? day.cards : day.cards.filter((c) => c.slot_template_id === slotId);
}

export function unassignedCards(board: ScheduleGrid, date: string, slotId: number | null): VisitSummary[] {
  return board.unassigned.filter((c) => c.service_date === date && (slotId === null || c.slot_template_id === slotId));
}

/** A card being moved: the visit and the row it was taken from (null = the unassigned lane). */
export type DragSource = { card: VisitSummary; fromWorkerId: number | null };

/** Where it was dropped: a worker row, and the cell's date and slot (null in the week view: the card's own slot). */
export type DropTarget = { workerId: number; date: string; slotId: number | null };

/**
 * A drop that would change nothing (back on its own row, or on a worker already on the team) is not offered as a
 * target. Another date or slot is sent as it is: the API answers USE_RESCHEDULE and the reschedule dialog takes over.
 */
export function isDropTarget(source: DragSource, target: DropTarget): boolean {
  if (!isMovable(source.card)) return false;
  if (source.fromWorkerId === target.workerId) return false;
  return !source.card.workers.some((w) => w.id === target.workerId);
}

/** The move request for a drop (from_worker_id null = add from the unassigned lane, else replace that worker). */
export function moveInputFor(source: DragSource, target: DropTarget) {
  return {
    visit_id: source.card.id,
    from_worker_id: source.fromWorkerId,
    to_worker_id: target.workerId,
    date: target.date,
    slot_template_id: target.slotId ?? source.card.slot_template_id,
  };
}

/** True when the drop lands on another date or slot than the visit's (a reschedule, not a team change). */
export function isRescheduleDrop(source: DragSource, target: DropTarget): boolean {
  return target.date !== source.card.service_date || (target.slotId !== null && target.slotId !== source.card.slot_template_id);
}

/** Workers a card can be moved to: every row of the board except those already on the team. */
export function moveTargets(board: ScheduleGrid, card: VisitSummary): ScheduleRow["worker"][] {
  const onTeam = new Set(card.workers.map((w) => w.id));
  return board.rows.map((r) => r.worker).filter((w) => !onTeam.has(w.id));
}
