import { describe, expect, it } from "vitest";
import { dashboardAlertHref, dashboardHref, linkParams, splitMinutes, trailingId, withQuery } from "./dashboard";
import type { DashboardLink } from "./types";

// Links as GET /admin/dashboard/summary and /alerts send them (Reporting Support\Links).
const bookings = (params: DashboardLink["params"]): DashboardLink => ({ list: "bookings", path: "/api/v1/admin/bookings", params });

describe("A02 links to admin pages", () => {
  it("opens the bookings list with the card's filters (the API's own names)", () => {
    expect(dashboardHref(bookings({ from: "2026-10-23", to: "2026-10-23", zone_id: 1 }))).toBe("/admin/bookings?from=2026-10-23&to=2026-10-23&zone_id=1");
    expect(dashboardHref(bookings({ status: "pending_confirmation" }))).toBe("/admin/bookings?status=pending_confirmation");
    // No filters: an empty object (the API casts it, never []).
    expect(dashboardHref(bookings({}))).toBe("/admin/bookings");
  });

  it("drops filters the list does not know, and keeps its slot, worker and driver filters", () => {
    expect(dashboardHref(bookings({ status: "held", view: "day" }))).toBe("/admin/bookings?status=held");
    expect(dashboardHref(bookings({ status: "held", view: "day", slot_template_id: 2, worker_id: 14, driver_id: 3 }))).toBe(
      "/admin/bookings?driver_id=3&slot_template_id=2&status=held&worker_id=14",
    );
  });

  it("opens one booking from its API path", () => {
    expect(dashboardHref({ list: "booking", path: "/api/v1/admin/bookings/12", params: {} })).toBe("/admin/bookings/12");
    expect(dashboardHref({ list: "booking", path: "/api/v1/admin/bookings/x", params: {} })).toBeNull();
  });

  it("opens the capacity view of a date and zone", () => {
    expect(dashboardHref({ list: "capacity", path: "/api/v1/admin/capacity", params: { date: "2026-10-23", zone_id: 2 } })).toBe(
      "/admin/capacity?date=2026-10-23&zone_id=2",
    );
  });

  it("has no route yet for the A04 board, rounds, driver reports or payments, and none without a link", () => {
    for (const list of ["schedule", "rounds", "driver_reports", "payment"]) {
      expect(dashboardHref({ list, path: "/api/v1/admin/x", params: { date: "2026-10-23" } })).toBeNull();
    }
    expect(dashboardHref(null)).toBeNull();
  });

  it("links an alert to its booking, also when its own target has no page yet", () => {
    expect(dashboardAlertHref({ link: { list: "booking", path: "/api/v1/admin/bookings/4", params: {} }, entity: { type: "booking", id: 4 } })).toBe(
      "/admin/bookings/4",
    );
    // An uncovered visit links to the A04 board (later phase): its booking instead.
    expect(
      dashboardAlertHref({ link: { list: "schedule", path: "/api/v1/admin/schedule", params: {} }, entity: { type: "visit", id: 9, booking_id: 7 } }),
    ).toBe("/admin/bookings/7");
    expect(dashboardAlertHref({ link: null, entity: { type: "payment", id: 3 } })).toBeNull();
  });

  it("builds query strings in a stable order without empty values", () => {
    expect(withQuery("/admin/bookings", { zone_id: null, status: "", to: "2026-10-24", from: "2026-10-23", cancel_review: true })).toBe(
      "/admin/bookings?cancel_review=1&from=2026-10-23&to=2026-10-24",
    );
    expect(linkParams(null)).toEqual({});
    expect(trailingId("/api/v1/admin/bookings/15/")).toBe(15);
  });

  it("splits minutes into hours and minutes", () => {
    expect(splitMinutes(130)).toEqual({ hours: 2, minutes: 10 });
    expect(splitMinutes(-5)).toEqual({ hours: 0, minutes: 0 });
  });
});
