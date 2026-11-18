import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_PREFIXES, PAGES_NOT_BUILT_YET, alertHref, badgeCount, isBuiltAdminPage, markAllReadInState, markReadInState, mergeAlerts, nextAlertsState } from "./alerts";
import type { AdminAlert } from "./types";

/** A folder of the signed-in admin routes, src/app/admin/(panel)/…. */
const panelPath = (...segments: string[]) => join(process.cwd(), "src", "app", "admin", "(panel)", ...segments);
/** "/admin/fleet/vehicles?search=x" → ["fleet", "vehicles"]. */
const segmentsOf = (path: string) => path.split(/[?#]/, 1)[0].replace(/^\/admin\/?/, "").split("/").filter(Boolean);

/**
 * Whether this app serves `path`: each segment is a route folder, or an id (digits or a ULID) under a [param] folder,
 * as Next.js resolves it. A word is never an id: /admin/workers/incentives is not the worker page.
 */
function routeExists(path: string): boolean {
  let dir = panelPath();
  for (const segment of segmentsOf(path)) {
    if (existsSync(join(dir, segment))) {
      dir = join(dir, segment);
      continue;
    }
    const isId = /^\d+$/.test(segment) || /^[0-9A-HJKMNP-TV-Z]{26}$/.test(segment);
    const param = isId ? readdirSync(dir).find((name) => /^\[[^.\]]+\]$/.test(name)) : undefined;
    if (!param) return false;
    dir = join(dir, param);
  }
  return existsSync(join(dir, "page.tsx"));
}

/** The web paths the Phase 5 API puts in alerts (Notification Support\Intents and Reporting\Dashboard, at 87aee16). */
const PHASE5_LINKS = [
  "/admin/quality/41",
  "/admin/quality/compensations",
  "/admin/finance/reconciliation/9",
  "/admin/customers/01JCQ8X5M2T7V9W3Y6Z4A0B1C2",
  "/admin/waitlist",
  "/admin/workers/14?tab=documents",
  "/admin/workers/incentives?period=2026-10",
  "/admin/incentive-postings/4",
  "/admin/fleet/vehicles?search=A%201234",
  "/admin/fleet/drivers?search=Omar",
];

const alert = (id: string, created: string, over: Partial<AdminAlert> = {}): AdminAlert => ({
  id,
  event: "booking.requested",
  priority: "normal",
  urgent: false,
  title: `Alert ${id}`,
  body: "",
  link: "/admin/bookings/1",
  entity: { type: "booking", id: 1, reference: "TRB-AAAAAA" },
  read: false,
  read_at: null,
  created_at: created,
  ...over,
});

describe("alerts bell state (D-11 polling)", () => {
  it("merges a poll by id, newest first: an alert of the same second comes back once", () => {
    const first = [alert("01B", "2026-10-23T10:00:05Z"), alert("01A", "2026-10-23T10:00:00Z")];
    const poll = [alert("01C", "2026-10-23T10:00:25Z"), alert("01B", "2026-10-23T10:00:05Z", { read: true })];
    const merged = mergeAlerts(first, poll);
    expect(merged.map((a) => a.id)).toEqual(["01C", "01B", "01A"]);
    // The polled copy wins (newer read state).
    expect(merged[1].read).toBe(true);
    expect(mergeAlerts(first, poll, 2)).toHaveLength(2);
  });

  it("keeps the server time for the next poll and the unread count of the last answer", () => {
    const state = nextAlertsState(undefined, { data: [alert("01A", "2026-10-23T10:00:00Z")], meta: { unread_count: 1, server_time: "2026-10-23T10:00:20Z", poll_seconds: 20 } });
    expect(state).toMatchObject({ since: "2026-10-23T10:00:20Z", unreadCount: 1, pollSeconds: 20 });
    const next = nextAlertsState(state, { data: [alert("01B", "2026-10-23T10:00:30Z")], meta: { unread_count: 2, server_time: "2026-10-23T10:00:40Z", poll_seconds: 0 } });
    expect(next.items.map((a) => a.id)).toEqual(["01B", "01A"]);
    expect(next.since).toBe("2026-10-23T10:00:40Z");
    // A missing or tiny poll interval falls back to 20 seconds.
    expect(next.pollSeconds).toBe(20);
  });

  it("counts the unread alerts a poll brings for the screen reader, never the first load or a repeat", () => {
    const meta = { unread_count: 1, server_time: "2026-10-23T10:00:20Z", poll_seconds: 20 };
    const first = nextAlertsState(undefined, { data: [alert("01A", "2026-10-23T10:00:00Z")], meta });
    expect(first.arrived).toEqual({ count: 0, urgent: 0, seq: 0 });
    const poll = nextAlertsState(first, {
      // 01A comes back (same second): not new. 01C was read on another tab: not announced.
      data: [alert("01A", "2026-10-23T10:00:00Z"), alert("01B", "2026-10-23T10:00:30Z", { urgent: true }), alert("01C", "2026-10-23T10:00:31Z", { read: true })],
      meta,
    });
    expect(poll.arrived).toEqual({ count: 1, urgent: 1, seq: 1 });
    const quiet = nextAlertsState(poll, { data: [], meta });
    expect(quiet.arrived).toEqual({ count: 0, urgent: 0, seq: 1 });
    const again = nextAlertsState(quiet, { data: [alert("01D", "2026-10-23T10:01:00Z")], meta });
    expect(again.arrived).toEqual({ count: 1, urgent: 0, seq: 2 });
  });

  it("marks one or all alerts read", () => {
    const state = nextAlertsState(undefined, {
      data: [alert("01A", "2026-10-23T10:00:00Z"), alert("01B", "2026-10-23T10:00:01Z")],
      meta: { unread_count: 2, server_time: "x", poll_seconds: 20 },
    });
    const one = markReadInState(state, { ...state.items[0], read: true, read_at: "2026-10-23T10:01:00Z" }, 1);
    expect(one.items.find((a) => a.id === state.items[0].id)?.read).toBe(true);
    expect(one.unreadCount).toBe(1);
    const all = markAllReadInState(one, "2026-10-23T10:02:00Z");
    expect(all.items.every((a) => a.read)).toBe(true);
    expect(all.unreadCount).toBe(0);
  });

  it("opens only admin pages that exist, never another origin", () => {
    expect(alertHref({ link: "/admin/bookings/12", entity: null })).toBe("/admin/bookings/12");
    // The API names A09 pages by their API path (PaymentIntents): this app serves them under /admin/finance.
    expect(alertHref({ link: "/admin/payments/3", entity: { type: "payment", id: 3 } })).toBe("/admin/finance/payments/3");
    expect(alertHref({ link: "/admin/invoices/3", entity: { type: "invoice", id: 3 } })).toBe("/admin/finance/invoices/3");
    expect(alertHref({ link: "/admin/driver-reports/3", entity: { type: "booking", id: 9 } })).toBe("/admin/bookings/9");
    // Phase 4: A08 pages are built.
    expect(alertHref({ link: "/admin/subscriptions/31", entity: null })).toBe("/admin/subscriptions/31");
    expect(alertHref({ link: "/admin/other", entity: { type: "subscription", id: 12 } })).toBe("/admin/subscriptions/12");
    expect(alertHref({ link: "https://evil.example/admin/bookings/1", entity: null })).toBeNull();
    expect(alertHref({ link: "//evil.example/admin/bookings/1", entity: null })).toBeNull();
  });

  it("opens the Phase 5 pages from the bell once they are built: quality, customers, waitlist and reconciliation runs", () => {
    // Until its slice lands, a Phase 5 page is not linked (it would 404); after, the bell opens it as the API names it.
    const once = (path: string) => (isBuiltAdminPage(path) ? path : null);
    for (const link of ["/admin/quality/41", "/admin/customers/01JC0000000000000000000001", "/admin/waitlist", "/admin/finance/reconciliation/9"]) {
      expect(alertHref({ link, entity: null }), link).toBe(once(link));
    }
    // A prefix is not a page: "/admin/qualityx", "/admin/waitlistx" and a foreign origin stay closed.
    expect(alertHref({ link: "/admin/qualityx/1", entity: null })).toBeNull();
    expect(alertHref({ link: "/admin/waitlistx", entity: null })).toBeNull();
    expect(alertHref({ link: "https://evil.example/admin/quality/41", entity: null })).toBeNull();
    expect(alertHref({ link: "/admin/capacity?date=2026-10-24&zone_id=2", entity: null })).toBe("/admin/capacity?date=2026-10-24&zone_id=2");
  });

  it("opens a Phase 5 link only when this app has its page: never a 404, and the incentives page is not a worker by id", () => {
    // W0 ships with the API alone (P5-X29); the pages come with W1–W4. Every web path the Phase 5 API links to
    // (Notification Support\Intents, Reporting\Dashboard), as the bell would get it:
    for (const link of PHASE5_LINKS) {
      const href = alertHref({ link, entity: null });
      if (href !== null) expect(routeExists(href), `${link} is linked but this app has no page for it`).toBe(true);
      if (isBuiltAdminPage(link) && routeExists(link) && BUILT_PREFIXES.some((prefix) => link.startsWith(prefix))) expect(href, link).toBe(link);
    }
    // /admin/workers/{id} is built and /admin/workers/ is an open prefix: the gate keeps "incentives" from being an id.
    expect(routeExists("/admin/workers/14")).toBe(true);
    expect(routeExists("/admin/workers/incentives")).toBe(existsSync(panelPath("workers", "incentives", "page.tsx")));
    expect(alertHref({ link: "/admin/workers/14?tab=documents", entity: null })).toBe("/admin/workers/14?tab=documents");
    expect(alertHref({ link: "/admin/fleet/vehicles?search=A%201234", entity: null })).toBe("/admin/fleet/vehicles?search=A%201234");
  });

  it("keeps a page closed only while it is not built, and opens prefixes only of pages that exist", () => {
    // The slice that builds one of these pages must take it out of PAGES_NOT_BUILT_YET, or its alerts never open it.
    for (const page of PAGES_NOT_BUILT_YET) {
      expect(existsSync(panelPath(...segmentsOf(page))), `${page} is built now: take it out of PAGES_NOT_BUILT_YET`).toBe(false);
      expect(isBuiltAdminPage(page)).toBe(false);
      expect(isBuiltAdminPage(`${page}/41?x=1`)).toBe(false);
    }
    for (const prefix of BUILT_PREFIXES) {
      if (isBuiltAdminPage(prefix)) expect(existsSync(panelPath(...segmentsOf(prefix))), `${prefix} is linked but has no page`).toBe(true);
    }
  });

  it("opens a subscription period's payment or refund alert on A09 only for staff who read it", () => {
    // refund.subscription_failed (accountants, urgent): the payment page, where the refund is retried.
    const refundFailed = { link: "/admin/payments/55", entity: { type: "refund", id: 7 } };
    const can = (held: string[]) => (wanted: readonly string[]) => wanted.some((p) => held.includes(p));
    expect(alertHref(refundFailed, can(["payments.view"]))).toBe("/admin/finance/payments/55");
    expect(alertHref(refundFailed, can(["bookings.view"]))).toBeNull();
    // invoice.subscription_issued: the invoice page (invoices.manage or payments.view).
    expect(alertHref({ link: "/admin/invoices/8", entity: { type: "invoice", id: 8 } }, can(["invoices.manage"]))).toBe("/admin/finance/invoices/8");
    expect(alertHref({ link: "/admin/invoices/8", entity: { type: "invoice", id: 8 } }, can(["subscriptions.view"]))).toBeNull();
    expect(alertHref({ link: "/admin/payments/55/extra", entity: null }, can(["payments.view"]))).toBeNull();
  });

  it("caps the badge at 99+", () => {
    expect(badgeCount(7)).toBe("7");
    expect(badgeCount(120)).toBe("99+");
  });
});
