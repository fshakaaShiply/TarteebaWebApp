import { safeAdminNext } from "./nav";
import type { AdminAlert, AlertsPage } from "./types";

/*
 * The alerts bell (spec §12 admin alerts, §17 top bar; D-11): GET /admin/alerts every 20 seconds. The first call loads
 * the newest page; each poll then asks only for alerts created at or after the previous answer's server_time and
 * merges them by id (an alert raised in that same second comes back again). The poll is passive: the bell sends
 * X-Background-Poll: 1, and the API treats GET /admin/alerts as a background poll whatever the client sends, so it never
 * keeps an idle session alive.
 */

export const ALERTS_PAGE_SIZE = 20;
export const DEFAULT_POLL_SECONDS = 20;
/** The bell keeps at most this many alerts in memory. */
export const ALERTS_KEEP = 50;

export type AlertsState = {
  items: AdminAlert[];
  unreadCount: number;
  /** meta.server_time of the last answer: the next poll's `since`. */
  since: string;
  pollSeconds: number;
  /**
   * Unread alerts the last poll brought that the bell did not hold yet (never on the first load), for the screen
   * reader announcement; `seq` grows with each poll that brought some, so the same text is announced again.
   */
  arrived: { count: number; urgent: number; seq: number };
};

function newestFirst(a: AdminAlert, b: AdminAlert): number {
  const at = Date.parse(a.created_at ?? "") || 0;
  const bt = Date.parse(b.created_at ?? "") || 0;
  if (at !== bt) return bt - at;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Alerts by id (the incoming copy wins: its read state is newer), newest first, at most `limit`. */
export function mergeAlerts(current: readonly AdminAlert[], incoming: readonly AdminAlert[], limit = ALERTS_KEEP): AdminAlert[] {
  const byId = new Map<string, AdminAlert>();
  for (const alert of current) byId.set(alert.id, alert);
  for (const alert of incoming) byId.set(alert.id, alert);
  return [...byId.values()].sort(newestFirst).slice(0, limit);
}

function pollSecondsOf(page: AlertsPage): number {
  const seconds = page.meta.poll_seconds;
  return typeof seconds === "number" && seconds >= 5 ? seconds : DEFAULT_POLL_SECONDS;
}

/** The state after an answer: the first page, or a poll merged into what the bell already shows. */
export function nextAlertsState(previous: AlertsState | undefined, page: AlertsPage): AlertsState {
  const known = new Set(previous?.items.map((a) => a.id) ?? []);
  const fresh = previous ? page.data.filter((a) => !a.read && !known.has(a.id)) : [];
  const seq = previous?.arrived.seq ?? 0;
  return {
    items: mergeAlerts(previous?.items ?? [], page.data),
    unreadCount: Math.max(0, page.meta.unread_count ?? 0),
    since: page.meta.server_time,
    pollSeconds: pollSecondsOf(page),
    arrived: { count: fresh.length, urgent: fresh.filter((a) => a.urgent).length, seq: fresh.length > 0 ? seq + 1 : seq },
  };
}

/** One alert marked read (the API answers with the new unread count). */
export function markReadInState(state: AlertsState, alert: AdminAlert, unreadCount: number): AlertsState {
  return { ...state, items: state.items.map((a) => (a.id === alert.id ? alert : a)), unreadCount: Math.max(0, unreadCount) };
}

export function markAllReadInState(state: AlertsState, at: string): AlertsState {
  return { ...state, items: state.items.map((a) => (a.read ? a : { ...a, read: true, read_at: at })), unreadCount: 0 };
}

/** Admin pages built so far that an alert may open (payments, invoices and driver reports come in later phases). */
const BUILT_PREFIXES = ["/admin/bookings/", "/admin/workers/", "/admin/capacity", "/admin/fleet/"];

/** The page an alert opens in this app, or null when its page is not built yet (the alert is still listed). */
export function alertHref(alert: Pick<AdminAlert, "link" | "entity">): string | null {
  const path = safeAdminNext(alert.link);
  if (path && BUILT_PREFIXES.some((prefix) => path.startsWith(prefix))) return path;
  const entity = alert.entity;
  if (entity?.type === "booking" && typeof entity.id === "number") return `/admin/bookings/${entity.id}`;
  return null;
}

/** The badge text: "99+" above 99. */
export function badgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
