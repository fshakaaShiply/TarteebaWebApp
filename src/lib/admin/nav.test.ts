import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV,
  CANCEL_REVIEWS_PATH,
  activeChildHref,
  activeNavHref,
  filterNav,
  firstAccessiblePath,
  hasAnyPermission,
  isActivePath,
  safeAdminNext,
} from "./nav";

const ids = (permissions: string[]) =>
  filterNav(ADMIN_NAV, permissions).map((m) => (m.children ? `${m.id}[${m.children.map((c) => c.id).join(",")}]` : m.id));

describe("ADMIN_NAV", () => {
  it("lists every module A01–A13 in order", () => {
    expect(ADMIN_NAV.map((m) => m.code)).toEqual([
      "A01",
      "A02",
      "A03",
      "A04",
      "A05",
      "A06",
      "A07",
      "A08",
      "A09",
      "A10",
      "A11",
      "A12",
      "A13",
    ]);
  });

  it("has route entries for the catalog pages, zones and the scheduling tables", () => {
    const catalog = ADMIN_NAV.find((m) => m.code === "A11")!;
    expect(catalog.children!.map((c) => c.href)).toEqual([
      "/admin/catalog/services",
      "/admin/catalog/packages",
      "/admin/catalog/live-out",
      "/admin/catalog/addons",
      "/admin/catalog/coupons",
      "/admin/catalog/policies",
      "/admin/zones",
      "/admin/scheduling/slots",
      "/admin/scheduling/rules",
      "/admin/scheduling/blackout-dates",
      "/admin/settings/notifications",
      "/admin/settings",
    ]);
  });

  it("builds A02 overview, A03 bookings, A04 schedule and capacity, A05 workers, and A06 vehicles, drivers, trips and driver reports", () => {
    const built = (code: string) =>
      ADMIN_NAV.filter((m) => m.code === code).flatMap((m) => (m.children ?? [m]).map((c) => `${c.id}:${c.built ? "built" : "later"}`));
    expect(built("A02")).toEqual(["overview:built"]);
    expect(built("A03")).toEqual(["bookings:built"]);
    expect(built("A04")).toEqual(["schedule:built", "capacity:built"]);
    expect(built("A05")).toEqual(["workers:built"]);
    expect(built("A06")).toEqual(["vehicles:built", "drivers:built", "trips:built", "driverReports:built"]);
    const fleet = ADMIN_NAV.find((m) => m.code === "A06")!;
    expect(fleet.children!.map((c) => c.href)).toEqual(["/admin/fleet/vehicles", "/admin/fleet/drivers", "/admin/trips", "/admin/trips/reports"]);
    expect(ADMIN_NAV.find((m) => m.code === "A04")!.children!.map((c) => c.href)).toEqual(["/admin/schedule", "/admin/capacity"]);
  });
});

describe("filterNav", () => {
  it("shows only modules open to everyone when the user has no permissions", () => {
    expect(ids([])).toEqual(["access"]);
  });

  it("shows the overview to everyone who reads bookings or the schedule", () => {
    expect(ids(["schedule.view"])).toContain("overview");
    expect(ids(["bookings.view"])).toEqual(["access", "overview", "bookings"]);
  });

  it("shows a system admin every module", () => {
    const all = [
      "bookings.view",
      "schedule.view",
      "workers.view",
      "fleet.manage",
      "customers.view",
      "subscriptions.manage",
      "payments.view",
      "complaints.manage",
      "catalog.manage",
      "settings.manage",
      "reports.view.operations",
      "users.manage",
      "audit.view",
    ];
    expect(ids([...all, "trips.manage"])).toEqual([
      "access",
      "overview",
      "bookings",
      "operations[schedule,capacity]",
      "workers",
      "fleet[vehicles,drivers,trips,driverReports]",
      "customers",
      "subscriptions",
      "finance[financeSummary,payments,refunds,invoices,creditNotes,billingRefusals]",
      "quality",
      "catalog[services,packages,liveOut,addons,coupons,policies,zones,slotTemplates,slotRules,blackoutDates,notificationTemplates,settings]",
      "reports",
      "users[staffUsers,audit]",
    ]);
  });

  it("shows each operations role its pages", () => {
    // Booking coordinator: schedule.view and workers.view (basic) → the schedule, capacity, workers, and vehicles, the
    // trip planner and the driver reports to read.
    expect(ids(["bookings.view", "schedule.view", "workers.view"])).toEqual([
      "access",
      "overview",
      "bookings",
      "operations[schedule,capacity]",
      "workers",
      "fleet[vehicles,trips,driverReports]",
    ]);
    // Operations coordinator: also fleet.manage and trips.manage → drivers.
    expect(ids(["schedule.view", "workers.view", "leave.manage", "fleet.manage", "trips.manage"])).toEqual([
      "access",
      "overview",
      "operations[schedule,capacity]",
      "workers",
      "fleet[vehicles,drivers,trips,driverReports]",
    ]);
    // HR: workers and capacity, no fleet editing (schedule.view still reads vehicles, rounds and driver reports).
    expect(ids(["schedule.view", "workers.view", "workers.manage", "leave.manage"])).toEqual([
      "access",
      "overview",
      "operations[schedule,capacity]",
      "workers",
      "fleet[vehicles,trips,driverReports]",
    ]);
    // trips.manage alone: the trip planner and the reports, no vehicles list.
    expect(ids(["trips.manage"])).toEqual(["access", "fleet[trips,driverReports]"]);
  });

  it("hides modules and children the user lacks", () => {
    // Accountant: bookings (read), customers, finance (with the cancellation reviews it resolves), reports; nothing in
    // A11 or A13.
    expect(ids(["bookings.view", "customers.view", "payments.view", "refunds.create", "reports.view.finance"])).toEqual([
      "access",
      "overview",
      "bookings",
      "customers",
      "finance[financeSummary,payments,refunds,cancelReviews,invoices,creditNotes,billingRefusals]",
      "reports",
    ]);
  });

  it("links finance to the bookings waiting for a cancellation review only for those who resolve them and read bookings", () => {
    const reviews = ADMIN_NAV.find((m) => m.code === "A09")!.children!.find((c) => c.id === "cancelReviews")!;
    expect(reviews.href).toBe("/admin/bookings?cancel_review=1");
    expect(ids(["bookings.view", "refunds.create"])).toContain("finance[refunds,cancelReviews]");
    // refunds.create alone can't open the bookings list; bookings.view alone doesn't resolve reviews.
    expect(ids(["refunds.create"])).toEqual(["access", "finance[refunds]"]);
    expect(ids(["bookings.view", "payments.view"])).toContain("finance[financeSummary,payments,refunds,invoices,creditNotes,billingRefusals]");
  });

  it("keeps a module with only the children the user may open", () => {
    expect(ids(["settings.manage"])).toEqual(["access", "catalog[notificationTemplates,settings]"]);
    expect(ids(["catalog.manage"])).toEqual([
      "access",
      "catalog[services,packages,liveOut,addons,coupons,policies,zones,slotTemplates,slotRules,blackoutDates]",
    ]);
    expect(ids(["audit.view"])).toEqual(["access", "users[audit]"]);
  });

  it("does not mutate the shared navigation", () => {
    filterNav(ADMIN_NAV, ["settings.manage"]);
    expect(ADMIN_NAV.find((m) => m.id === "catalog")!.children).toHaveLength(12);
  });
});

describe("hasAnyPermission", () => {
  it("treats an empty requirement as open to everyone", () => {
    expect(hasAnyPermission([], [])).toBe(true);
    expect(hasAnyPermission(["a"], ["b", "a"])).toBe(true);
    expect(hasAnyPermission(["a"], ["b"])).toBe(false);
  });
});

describe("firstAccessiblePath", () => {
  it("prefers the overview, then catalog, settings, users, the operations pages, then the overview's welcome note", () => {
    expect(firstAccessiblePath(["catalog.manage", "bookings.view"])).toBe("/admin/overview");
    expect(firstAccessiblePath(["schedule.view", "workers.view"])).toBe("/admin/overview");
    expect(firstAccessiblePath(["users.manage", "catalog.manage", "settings.manage"])).toBe("/admin/catalog/services");
    expect(firstAccessiblePath(["users.manage", "settings.manage"])).toBe("/admin/settings");
    expect(firstAccessiblePath(["users.manage"])).toBe("/admin/users");
    expect(firstAccessiblePath(["workers.view"])).toBe("/admin/workers");
    expect(firstAccessiblePath(["fleet.manage"])).toBe("/admin/fleet/vehicles");
    expect(firstAccessiblePath(["trips.manage"])).toBe("/admin/trips");
    expect(firstAccessiblePath(["customers.view"])).toBe("/admin/overview");
  });
});

describe("isActivePath", () => {
  it("matches the page and its sub-pages only", () => {
    expect(isActivePath("/admin/users", "/admin/users")).toBe(true);
    expect(isActivePath("/admin/users", "/admin/users/12")).toBe(true);
    expect(isActivePath("/admin/users", "/admin/users-archive")).toBe(false);
  });

  it("marks one child of a group: the longest matching link", () => {
    const fleet = ADMIN_NAV.find((m) => m.code === "A06")!.children!;
    expect(activeChildHref(fleet, "/admin/trips/reports")).toBe("/admin/trips/reports");
    expect(activeChildHref(fleet, "/admin/trips")).toBe("/admin/trips");
    expect(activeChildHref(fleet, "/admin/bookings")).toBeNull();
  });
});

describe("safeAdminNext", () => {
  it("accepts admin paths with query strings", () => {
    expect(safeAdminNext("/admin/settings")).toBe("/admin/settings");
    expect(safeAdminNext("/admin/users?page=2")).toBe("/admin/users?page=2");
    expect(safeAdminNext("/admin")).toBe("/admin");
  });

  it("rejects other origins, other areas and the auth pages", () => {
    for (const bad of [
      null,
      "",
      "https://evil.test/admin",
      "//evil.test/admin",
      "/admin\\@evil.test",
      "/adminx",
      "/driver",
      "/admin/login",
      "/admin/login?next=/admin",
      "/admin/reset-password?token=x",
    ]) {
      expect(safeAdminNext(bad)).toBeNull();
    }
  });
});

describe("A09 finance and A11 notification templates", () => {
  it("builds A09 summary, payments, refunds, invoices, credit notes and refused documents (reconciliation later)", () => {
    const finance = ADMIN_NAV.find((m) => m.code === "A09")!;
    expect(finance.built).toBe(true);
    expect(finance.href).toBe("/admin/finance");
    expect(finance.children!.map((c) => `${c.href}:${c.built ? "built" : "later"}`)).toEqual([
      "/admin/finance:built",
      "/admin/finance/payments:built",
      "/admin/finance/refunds:built",
      "/admin/bookings?cancel_review=1:built",
      "/admin/finance/invoices:built",
      "/admin/finance/credit-notes:built",
      "/admin/finance/billing-refusals:built",
      "/admin/finance/reconciliation:later",
    ]);
  });

  it("shows each finance page to the permissions its API routes accept", () => {
    // payments.view reads everything in A09; invoices.manage the summary and the documents; refunds.create the refunds
    // list.
    expect(ids(["payments.view"])).toEqual(["access", "finance[financeSummary,payments,refunds,invoices,creditNotes,billingRefusals]"]);
    expect(ids(["invoices.manage"])).toEqual(["access", "finance[financeSummary,invoices,creditNotes,billingRefusals]"]);
    expect(ids(["refunds.create"])).toEqual(["access", "finance[refunds]"]);
    expect(ids(["reconciliation.run"])).toEqual(["access", "finance[reconciliation]"]);
  });

  it("marks the summary on its own page and each finance page under its own entry", () => {
    const finance = ADMIN_NAV.find((m) => m.code === "A09")!.children!;
    expect(activeChildHref(finance, "/admin/finance")).toBe("/admin/finance");
    expect(activeChildHref(finance, "/admin/finance/payments/9")).toBe("/admin/finance/payments");
    expect(activeChildHref(finance, "/admin/finance/credit-notes")).toBe("/admin/finance/credit-notes");
  });

  it("marks the cancellation reviews on the bookings list filtered to them (path and query), and Bookings on the plain list", () => {
    const finance = ADMIN_NAV.find((m) => m.code === "A09")!.children!;
    expect(activeChildHref(finance, "/admin/bookings", "cancel_review=1")).toBe(CANCEL_REVIEWS_PATH);
    expect(activeChildHref(finance, "/admin/bookings", "?status=held&cancel_review=1")).toBe(CANCEL_REVIEWS_PATH);
    expect(activeChildHref(finance, "/admin/bookings", "")).toBeNull();
    expect(activeChildHref(finance, "/admin/bookings", "cancel_review=0")).toBeNull();
    expect(isActivePath(CANCEL_REVIEWS_PATH, "/admin/bookings", "cancel_review=1")).toBe(true);
    expect(isActivePath(CANCEL_REVIEWS_PATH, "/admin/bookings")).toBe(false);

    // Across the accountant's whole navigation one entry is the page: the review list's own, else Bookings.
    const accountant = filterNav(ADMIN_NAV, ["bookings.view", "payments.view", "refunds.create"]);
    expect(activeNavHref(accountant, "/admin/bookings", "cancel_review=1")).toBe(CANCEL_REVIEWS_PATH);
    expect(activeNavHref(accountant, "/admin/bookings", "")).toBe("/admin/bookings");
    expect(activeNavHref(accountant, "/admin/bookings/12", "")).toBe("/admin/bookings");
    expect(activeNavHref(accountant, "/admin/finance/payments/9", "")).toBe("/admin/finance/payments");
    // A coordinator has no review entry: the filtered list stays under Bookings.
    expect(activeNavHref(filterNav(ADMIN_NAV, ["bookings.view"]), "/admin/bookings", "cancel_review=1")).toBe("/admin/bookings");
  });

  it("opens the finance pages for finance-only roles and marks the template editor under its own entry", () => {
    expect(firstAccessiblePath(["payments.view", "invoices.manage"])).toBe("/admin/finance");
    expect(firstAccessiblePath(["invoices.manage"])).toBe("/admin/finance");
    expect(firstAccessiblePath(["refunds.create"])).toBe("/admin/finance/refunds");
    const catalog = ADMIN_NAV.find((m) => m.code === "A11")!.children!;
    expect(activeChildHref(catalog, "/admin/settings/notifications/12")).toBe("/admin/settings/notifications");
    expect(activeChildHref(catalog, "/admin/settings")).toBe("/admin/settings");
  });
});
