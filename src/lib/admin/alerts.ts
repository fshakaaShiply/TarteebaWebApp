import { DOCUMENTS_READ, INVOICES_PATH, PAYMENTS_PATH, safeAdminNext } from "./nav";
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

/** Admin pages that an alert may open as the API names them (driver reports have no page by id yet). */
export const BUILT_PREFIXES: readonly string[] = [
  "/admin/bookings/",
  "/admin/workers/",
  "/admin/capacity",
  "/admin/fleet/",
  "/admin/subscriptions/",
  // Phase 5: A10 quality, A07 customers, A04 waitlist and A09 reconciliation runs (each opens once its page is built,
  // PAGES_NOT_BUILT_YET).
  "/admin/quality/",
  "/admin/customers/",
  "/admin/waitlist",
  "/admin/finance/reconciliation/",
];

/**
 * Phase 5 pages the API already links to (the bell and the A02 alerts) whose screens come with a later web slice. W0
 * ships with the Phase 5 API on its own and W1–W4 follow as they finish (P5-X29), so until a page exists no alert opens
 * it: the link would 404, or land on a page by id (/admin/workers/incentives is the worker page of "incentives", which
 * the API answers 404). The slice that builds a page takes its entry out: W1 reconciliation, W2 quality, W3 customers,
 * W4 incentives and the waitlist. alerts.test.ts fails while an entry names a page that exists.
 */
export const PAGES_NOT_BUILT_YET: readonly string[] = [
  // W1 built /admin/finance/reconciliation (runs and /{id}); W2 built /admin/quality (inbox, /{id}, ratings, compensations);
  // W3 built /admin/customers (list, /{ulid}, privacy-requests).
  "/admin/workers/incentives",
  "/admin/waitlist",
];

/** The path without its query or fragment and trailing slashes ("/admin/quality/41?x=1" → "/admin/quality/41"). */
function barePath(path: string): string {
  return path.split(/[?#]/, 1)[0].replace(/(.)\/+$/, "$1");
}

/** Whether `path` is the page `page` or one below it ("/admin/waitlist" holds "/admin/waitlist/3", not "/admin/waitlistx"). */
function isUnder(path: string, page: string): boolean {
  const bare = barePath(path);
  const root = barePath(page);
  return bare === root || bare.startsWith(`${root}/`);
}

/** False for a path in a Phase 5 page that is not built yet (PAGES_NOT_BUILT_YET); every alert link goes through it. */
export function isBuiltAdminPage(path: string): boolean {
  return !PAGES_NOT_BUILT_YET.some((page) => isUnder(path, page));
}

/**
 * Pages the API names by their API path (PaymentIntents: a payment or refund alert, booking or subscription period,
 * links /admin/payments/{id}; an issued invoice /admin/invoices/{id}) that this app serves under A09's finance section.
 */
const FINANCE_PAGES: readonly { pattern: RegExp; base: string; anyOf: readonly string[] }[] = [
  { pattern: /^\/admin\/payments\/(\d+)$/, base: PAYMENTS_PATH, anyOf: ["payments.view"] },
  { pattern: /^\/admin\/invoices\/(\d+)$/, base: INVOICES_PATH, anyOf: DOCUMENTS_READ },
];

/**
 * The page an alert opens in this app, or null when its page is not built yet or the user may not open it (the alert is
 * still listed). `canAny` is the session's check: a finance page needs its read permission.
 */
export function alertHref(alert: Pick<AdminAlert, "link" | "entity">, canAny: (permissions: readonly string[]) => boolean = () => true): string | null {
  const path = safeAdminNext(alert.link);
  if (path && isBuiltAdminPage(path) && BUILT_PREFIXES.some((prefix) => (prefix.endsWith("/") ? path.startsWith(prefix) : isUnder(path, prefix)))) return path;
  for (const page of FINANCE_PAGES) {
    const match = path ? page.pattern.exec(path) : null;
    if (match && canAny(page.anyOf)) return `${page.base}/${match[1]}`;
  }
  const entity = alert.entity;
  if (entity?.type === "booking" && typeof entity.id === "number") return `/admin/bookings/${entity.id}`;
  if (entity?.type === "subscription" && typeof entity.id === "number") return `/admin/subscriptions/${entity.id}`;
  return null;
}

/** The badge text: "99+" above 99. */
export function badgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
