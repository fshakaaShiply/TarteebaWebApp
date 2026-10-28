import type { DashboardAlert, DashboardLink, LinkParams } from "./types";

/*
 * A02 links (spec §17: every KPI opens a filtered list, every alert links to its entity). The API names the target
 * page and its filters ({list, path, params}); this turns that into an admin web route. Pages of later phases (the
 * A04 board, rounds, driver reports, payments) have no route yet: those links are null unless a fallback is given.
 */

export const BOOKINGS_PATH = "/admin/bookings";
export const CAPACITY_PATH = "/admin/capacity";

/** The link's filters ({} for an entity link such as a booking, or without a link). */
export function linkParams(link: DashboardLink | null | undefined): LinkParams {
  return link?.params ?? {};
}

/** "/admin/bookings?status=pending_confirmation&zone_id=2": empty values are left out, keys in a stable order. */
export function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    query.set(key, value === true ? "1" : String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Filters the A03 list understands (lib/admin/bookings/filters.ts): the link's own names. */
const BOOKING_LINK_FILTERS = [
  "status",
  "payment_status",
  "from",
  "to",
  "zone_id",
  "service",
  "source",
  "search",
  "cancel_review",
  "slot_template_id",
  "worker_id",
  "driver_id",
] as const;

/** The numeric id at the end of an API path such as /api/v1/admin/bookings/12. */
export function trailingId(path: string | null | undefined): number | null {
  const match = /\/(\d+)\/?$/.exec(path ?? "");
  return match ? Number(match[1]) : null;
}

/** The admin web page of a dashboard link, or null when that page is not built yet. */
export function dashboardHref(link: DashboardLink | null | undefined): string | null {
  if (!link) return null;
  const params = linkParams(link);
  switch (link.list) {
    case "bookings": {
      const filters: Record<string, string | number | boolean> = {};
      for (const key of BOOKING_LINK_FILTERS) if (params[key] !== undefined) filters[key] = params[key];
      return withQuery(BOOKINGS_PATH, filters);
    }
    case "booking": {
      const id = trailingId(link.path);
      return id === null ? null : `${BOOKINGS_PATH}/${id}`;
    }
    case "capacity":
      return withQuery(CAPACITY_PATH, { date: params.date, zone_id: params.zone_id });
    default:
      return null;
  }
}

/**
 * Where an alert of the overview leads: its own link when that page exists, else the booking it is about (a visit
 * alert names its booking), else nothing.
 */
export function dashboardAlertHref(alert: Pick<DashboardAlert, "link" | "entity">): string | null {
  const direct = dashboardHref(alert.link);
  if (direct) return direct;
  const entity = alert.entity;
  if (!entity) return null;
  if (entity.type === "booking" && typeof entity.id === "number") return `${BOOKINGS_PATH}/${entity.id}`;
  if (typeof entity.booking_id === "number") return `${BOOKINGS_PATH}/${entity.booking_id}`;
  return null;
}

/** Hours and minutes for a duration in whole minutes ("2 h 10 min"); negative values are treated as zero. */
export function splitMinutes(minutes: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor(minutes));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
