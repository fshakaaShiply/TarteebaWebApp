import { PAYMENTS_PATH, SUBSCRIPTIONS_PATH } from "./nav";
import type { DashboardAlert, DashboardLink, LinkParams } from "./types";

/*
 * A02 links (spec §17: every KPI opens a filtered list, every alert links to its entity). The API names the target
 * page and its filters ({list, path, params}); this turns that into an admin web route. A link the API gives only to
 * staff who may open it (a payment needs payments.view, Reporting Support\Links) is null otherwise. The A04 board,
 * rounds and driver reports have no route from here yet: those links are null unless a fallback is given.
 */

export const BOOKINGS_PATH = "/admin/bookings";
export const CAPACITY_PATH = "/admin/capacity";
/** Phase 5 pages the new alert types open (A10 quality, A09 reconciliation, A05 workers, A06 fleet). */
export const QUALITY_PATH = "/admin/quality";
export const COMPENSATIONS_PATH = "/admin/quality/compensations";
export const RECONCILIATION_PATH = "/admin/finance/reconciliation";
export const WORKERS_PATH = "/admin/workers";
export const INCENTIVES_PATH = "/admin/workers/incentives";
export const VEHICLES_PATH = "/admin/fleet/vehicles";
export const DRIVERS_PATH = "/admin/fleet/drivers";

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

/** Filters the A08 list understands (the API's own names for GET /admin/subscriptions; `q` is its search). */
const SUBSCRIPTION_LINK_FILTERS = [
  "status",
  "type",
  "payment_health",
  "renewal_from",
  "renewal_to",
  "zone_id",
  "worker_id",
  "conflicts",
  "cancel_review",
  "q",
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
    case "subscriptions": {
      const filters: Record<string, string | number | boolean> = {};
      for (const key of SUBSCRIPTION_LINK_FILTERS) if (params[key] !== undefined) filters[key] = params[key];
      return withQuery(SUBSCRIPTIONS_PATH, filters);
    }
    case "subscription": {
      const id = trailingId(link.path);
      return id === null ? null : `${SUBSCRIPTIONS_PATH}/${id}`;
    }
    case "capacity":
      return withQuery(CAPACITY_PATH, { date: params.date, zone_id: params.zone_id });
    case "payment": {
      // A09's payment page (/api/v1/admin/payments/{id} → /admin/finance/payments/{id}), where a refund is retried.
      const id = trailingId(link.path);
      return id === null ? null : `${PAYMENTS_PATH}/${id}`;
    }
    case "complaint": {
      // A10's case page (/api/v1/admin/complaints/{id} → /admin/quality/{id}); null for the viewer without it.
      const id = trailingId(link.path);
      return id === null ? null : `${QUALITY_PATH}/${id}`;
    }
    case "compensations":
      return COMPENSATIONS_PATH;
    case "reconciliation_run": {
      const id = trailingId(link.path);
      return id === null ? null : `${RECONCILIATION_PATH}/${id}`;
    }
    case "worker": {
      // A worker's page, on the Documents tab for a document alert (any other tab name is ignored).
      const id = trailingId(link.path);
      return id === null ? null : withQuery(`${WORKERS_PATH}/${id}`, { tab: params.tab === "documents" ? "documents" : undefined });
    }
    case "vehicles":
      return withQuery(VEHICLES_PATH, { search: params.search });
    case "drivers":
      return withQuery(DRIVERS_PATH, { search: params.search });
    case "incentives":
      return withQuery(INCENTIVES_PATH, { period: typeof params.period === "string" && /^\d{4}-\d{2}$/.test(params.period) ? params.period : undefined });
    default:
      return null;
  }
}

/**
 * The subscription a payment_failed or refund_failed alert of a subscription period names (design §8.2 P4-68:
 * `details.subscription {id, reference, link}`), with its A08 page when the viewer may open it (the API's link is null
 * otherwise); null for a booking's payment.
 */
export function alertSubscription(alert: Partial<Pick<DashboardAlert, "details">>): { id: number; reference: string; href: string | null } | null {
  const block = alert.details?.subscription;
  if (!block || typeof block !== "object") return null;
  const { id, reference, link } = block as { id?: unknown; reference?: unknown; link?: unknown };
  if (typeof id !== "number" || typeof reference !== "string") return null;
  const href = link && typeof link === "object" ? dashboardHref(link as DashboardLink) : null;
  return { id, reference, href };
}

/**
 * Where an alert of the overview leads: its own link when that page exists (a failed payment or refund opens the
 * payment), else the subscription a period payment's alert names, else the booking it is about (a visit alert names
 * its booking), else nothing.
 */
export function dashboardAlertHref(alert: Pick<DashboardAlert, "link" | "entity"> & Partial<Pick<DashboardAlert, "details">>): string | null {
  const direct = dashboardHref(alert.link);
  if (direct) return direct;
  const series = alertSubscription(alert)?.href;
  if (series) return series;
  const entity = alert.entity;
  if (!entity) return null;
  if (entity.type === "booking" && typeof entity.id === "number") return `${BOOKINGS_PATH}/${entity.id}`;
  if (entity.type === "subscription" && typeof entity.id === "number") return `${SUBSCRIPTIONS_PATH}/${entity.id}`;
  // Phase 5: the API gives these alerts a link only to staff who may open the page; a case still opens from its entity.
  if (entity.type === "complaint" && typeof entity.id === "number") return `${QUALITY_PATH}/${entity.id}`;
  if (entity.type === "reconciliation_run" && typeof entity.id === "number") return `${RECONCILIATION_PATH}/${entity.id}`;
  if (typeof entity.booking_id === "number") return `${BOOKINGS_PATH}/${entity.booking_id}`;
  return null;
}

/**
 * A08's queue of subscriptions whose cancellation waits for review (design §9.1 A02: `cancel_review=1`; GET
 * /admin/subscriptions takes cancel_review and zone_id), in the zone the overview's alerts were counted for. Each
 * subscription_cancel_review alert opens one subscription; this opens them all.
 */
export function subscriptionCancelReviewsHref(zoneId: number | null): string {
  return withQuery(SUBSCRIPTIONS_PATH, { cancel_review: true, zone_id: zoneId });
}

/** Hours and minutes for a duration in whole minutes ("2 h 10 min"); negative values are treated as zero. */
export function splitMinutes(minutes: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor(minutes));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}
