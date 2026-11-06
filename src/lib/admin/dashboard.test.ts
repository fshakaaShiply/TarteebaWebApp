import { describe, expect, it } from "vitest";
import { alertSubscription, dashboardAlertHref, dashboardHref, linkParams, splitMinutes, subscriptionCancelReviewsHref, trailingId, withQuery } from "./dashboard";
import type { DashboardLink } from "./types";

// Links as GET /admin/dashboard/summary and /alerts send them (Reporting Support\Links).
const bookings = (params: DashboardLink["params"]): DashboardLink => ({ list: "bookings", path: "/api/v1/admin/bookings", params });

describe("A02 links to admin pages", () => {
  it("opens the A08 list with the card's filters and one subscription by its API path", () => {
    expect(
      dashboardHref({ list: "subscriptions", path: "/api/v1/admin/subscriptions", params: { status: "pending_confirmation", zone_id: 2 } }),
    ).toBe("/admin/subscriptions?status=pending_confirmation&zone_id=2");
    expect(dashboardHref({ list: "subscriptions", path: "/api/v1/admin/subscriptions", params: { cancel_review: 1, view: "x" } })).toBe(
      "/admin/subscriptions?cancel_review=1",
    );
    expect(dashboardHref({ list: "subscriptions", path: "/api/v1/admin/subscriptions", params: {} })).toBe("/admin/subscriptions");
    expect(dashboardHref({ list: "subscription", path: "/api/v1/admin/subscriptions/31", params: {} })).toBe("/admin/subscriptions/31");
    expect(dashboardHref({ list: "subscription", path: "/api/v1/admin/subscriptions/x", params: {} })).toBeNull();
    // A subscription alert without a usable link still opens its subscription through the entity.
    expect(dashboardAlertHref({ link: null, entity: { type: "subscription", id: 29, reference: "TRS-A1B2C3" } })).toBe("/admin/subscriptions/29");
  });

  it("opens A08's cancellation review queue (design §9.1 A02: cancel_review=1), in the overview's zone", () => {
    expect(subscriptionCancelReviewsHref(null)).toBe("/admin/subscriptions?cancel_review=1");
    expect(subscriptionCancelReviewsHref(2)).toBe("/admin/subscriptions?cancel_review=1&zone_id=2");
  });

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

  it("has no route from here for the A04 board, rounds or driver reports, and none without a link", () => {
    for (const list of ["schedule", "rounds", "driver_reports"]) {
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

  it("opens A09's payment page from a payment link (payments.view: the API sends it only then)", () => {
    expect(dashboardHref({ list: "payment", path: "/api/v1/admin/payments/55", params: {} })).toBe("/admin/finance/payments/55");
    expect(dashboardHref({ list: "payment", path: "/api/v1/admin/payments/x", params: {} })).toBeNull();
  });

  it("links a failed payment or refund of a subscription period to the payment, else to the subscription it names (P4-68)", () => {
    const subscription = { id: 31, reference: "TRS-7K2M9Q", link: { list: "subscription", path: "/api/v1/admin/subscriptions/31", params: {} } };
    const payment = { list: "payment", path: "/api/v1/admin/payments/55", params: {} };
    // An accountant (payments.view): the payment page, where a refund is retried; the subscription beside it.
    const failed = { link: payment, entity: { type: "payment", id: 55 }, details: { failure_code: "card_declined", subscription } };
    expect(dashboardAlertHref(failed)).toBe("/admin/finance/payments/55");
    expect(alertSubscription(failed)).toEqual({ id: 31, reference: "TRS-7K2M9Q", href: "/admin/subscriptions/31" });
    // A coordinator without payments.view (the API leaves the payment link out): the subscription.
    const refund = { link: null, entity: { type: "refund", id: 7, payment_id: 55 }, details: { subscription } };
    expect(dashboardAlertHref(refund)).toBe("/admin/subscriptions/31");
    // Without an A08 permission the API sends no subscription link: the reference only.
    expect(alertSubscription({ details: { subscription: { ...subscription, link: null } } })).toEqual({ id: 31, reference: "TRS-7K2M9Q", href: null });
    expect(dashboardAlertHref({ link: null, entity: { type: "refund", id: 7 }, details: { subscription: { ...subscription, link: null } } })).toBeNull();
    // A booking's payment names no subscription.
    expect(alertSubscription({ details: { subscription: null } })).toBeNull();
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
