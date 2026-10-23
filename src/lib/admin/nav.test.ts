import { describe, expect, it } from "vitest";
import { ADMIN_NAV, filterNav, firstAccessiblePath, hasAnyPermission, isActivePath, safeAdminNext } from "./nav";

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
      "/admin/settings",
    ]);
  });

  it("builds A02 overview, A03 bookings, A05 workers, A06 vehicles and drivers, and the capacity view; the schedule board and trips come later", () => {
    const built = (code: string) =>
      ADMIN_NAV.filter((m) => m.code === code).flatMap((m) => (m.children ?? [m]).map((c) => `${c.id}:${c.built ? "built" : "later"}`));
    expect(built("A02")).toEqual(["overview:built"]);
    expect(built("A03")).toEqual(["bookings:built"]);
    expect(built("A04")).toEqual(["schedule:later", "capacity:built"]);
    expect(built("A05")).toEqual(["workers:built"]);
    expect(built("A06")).toEqual(["vehicles:built", "drivers:built", "trips:later"]);
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
      "fleet[vehicles,drivers,trips]",
      "customers",
      "subscriptions",
      "finance",
      "quality",
      "catalog[services,packages,liveOut,addons,coupons,policies,zones,slotTemplates,slotRules,blackoutDates,settings]",
      "reports",
      "users[staffUsers,audit]",
    ]);
  });

  it("shows each operations role its Phase 2 pages", () => {
    // Booking coordinator: schedule.view and workers.view (basic) → capacity, workers, vehicles (read).
    expect(ids(["bookings.view", "schedule.view", "workers.view"])).toEqual([
      "access",
      "overview",
      "bookings",
      "operations[schedule,capacity]",
      "workers",
      "fleet[vehicles]",
    ]);
    // Operations coordinator: also fleet.manage and trips.manage → drivers, and the trip planner (later).
    expect(ids(["schedule.view", "workers.view", "leave.manage", "fleet.manage", "trips.manage"])).toEqual([
      "access",
      "overview",
      "operations[schedule,capacity]",
      "workers",
      "fleet[vehicles,drivers,trips]",
    ]);
    // HR: workers and capacity, no fleet editing (schedule.view still reads vehicles).
    expect(ids(["schedule.view", "workers.view", "workers.manage", "leave.manage"])).toEqual([
      "access",
      "overview",
      "operations[schedule,capacity]",
      "workers",
      "fleet[vehicles]",
    ]);
  });

  it("hides modules and children the user lacks", () => {
    // Accountant: bookings (read), customers, finance, reports; nothing in A11 or A13.
    expect(ids(["bookings.view", "customers.view", "payments.view", "refunds.create", "reports.view.finance"])).toEqual([
      "access",
      "overview",
      "bookings",
      "customers",
      "finance",
      "reports",
    ]);
  });

  it("keeps a module with only the children the user may open", () => {
    expect(ids(["settings.manage"])).toEqual(["access", "catalog[settings]"]);
    expect(ids(["catalog.manage"])).toEqual([
      "access",
      "catalog[services,packages,liveOut,addons,coupons,policies,zones,slotTemplates,slotRules,blackoutDates]",
    ]);
    expect(ids(["audit.view"])).toEqual(["access", "users[audit]"]);
  });

  it("does not mutate the shared navigation", () => {
    filterNav(ADMIN_NAV, ["settings.manage"]);
    expect(ADMIN_NAV.find((m) => m.id === "catalog")!.children).toHaveLength(11);
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
    expect(firstAccessiblePath(["customers.view"])).toBe("/admin/overview");
  });
});

describe("isActivePath", () => {
  it("matches the page and its sub-pages only", () => {
    expect(isActivePath("/admin/users", "/admin/users")).toBe(true);
    expect(isActivePath("/admin/users", "/admin/users/12")).toBe(true);
    expect(isActivePath("/admin/users", "/admin/users-archive")).toBe(false);
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
