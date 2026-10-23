import { describe, expect, it } from "vitest";
import { alertHref, badgeCount, markAllReadInState, markReadInState, mergeAlerts, nextAlertsState } from "./alerts";
import type { AdminAlert } from "./types";

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
    expect(alertHref({ link: "/admin/payments/3", entity: { type: "payment", id: 3 } })).toBeNull();
    expect(alertHref({ link: "/admin/invoices/3", entity: { type: "booking", id: 9 } })).toBe("/admin/bookings/9");
    expect(alertHref({ link: "https://evil.example/admin/bookings/1", entity: null })).toBeNull();
    expect(alertHref({ link: "//evil.example/admin/bookings/1", entity: null })).toBeNull();
  });

  it("caps the badge at 99+", () => {
    expect(badgeCount(7)).toBe("7");
    expect(badgeCount(120)).toBe("99+");
  });
});
