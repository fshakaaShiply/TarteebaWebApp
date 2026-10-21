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

  it("has route entries for the catalog pages and zones", () => {
    const catalog = ADMIN_NAV.find((m) => m.code === "A11")!;
    expect(catalog.children!.map((c) => c.href)).toEqual([
      "/admin/catalog/services",
      "/admin/catalog/packages",
      "/admin/catalog/live-out",
      "/admin/catalog/addons",
      "/admin/catalog/coupons",
      "/admin/catalog/policies",
      "/admin/zones",
      "/admin/settings",
    ]);
  });
});

describe("filterNav", () => {
  it("shows only modules open to everyone when the user has no permissions", () => {
    expect(ids([])).toEqual(["access", "overview"]);
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
    expect(ids(all)).toEqual([
      "access",
      "overview",
      "bookings",
      "schedule",
      "workers",
      "fleet",
      "customers",
      "subscriptions",
      "finance",
      "quality",
      "catalog[services,packages,liveOut,addons,coupons,policies,zones,settings]",
      "reports",
      "users[staffUsers,audit]",
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
    expect(ids(["settings.manage"])).toEqual(["access", "overview", "catalog[settings]"]);
    expect(ids(["catalog.manage"])).toEqual([
      "access",
      "overview",
      "catalog[services,packages,liveOut,addons,coupons,policies,zones]",
    ]);
    expect(ids(["audit.view"])).toEqual(["access", "overview", "users[audit]"]);
  });

  it("does not mutate the shared navigation", () => {
    filterNav(ADMIN_NAV, ["settings.manage"]);
    expect(ADMIN_NAV.find((m) => m.id === "catalog")!.children).toHaveLength(8);
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
  it("prefers catalog, then settings, then users, then the overview placeholder", () => {
    expect(firstAccessiblePath(["users.manage", "catalog.manage", "settings.manage"])).toBe("/admin/catalog/services");
    expect(firstAccessiblePath(["users.manage", "settings.manage"])).toBe("/admin/settings");
    expect(firstAccessiblePath(["users.manage"])).toBe("/admin/users");
    expect(firstAccessiblePath(["bookings.view"])).toBe("/admin/overview");
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
