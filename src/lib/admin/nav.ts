// Admin navigation (spec §17): every module A01–A13 in order. Items the user lacks every permission for are hidden;
// modules not built yet stay visible but disabled ("coming in a later phase"). Hiding is for clarity only: the API
// enforces every permission (spec §5).

export type NavLeaf = {
  id: string;
  /** Message key under admin.nav */
  labelKey: string;
  href: string;
  /** Visible when the user holds any of these; empty = every signed-in staff user. */
  anyOf: readonly string[];
  built: boolean;
};

export type NavModule = NavLeaf & {
  /** Spec module code, e.g. "A11". */
  code: string;
  children?: readonly NavLeaf[];
};

export const TWO_FACTOR_PATH = "/admin/security/two-factor";
export const OVERVIEW_PLACEHOLDER_PATH = "/admin/overview";
export const CAPACITY_PATH = "/admin/capacity";

const CATALOG = ["catalog.manage"] as const;

export const ADMIN_NAV: readonly NavModule[] = [
  // A01 is the sign-in itself; its in-panel page is the account security (two-factor) screen.
  { id: "access", code: "A01", labelKey: "access", href: TWO_FACTOR_PATH, anyOf: [], built: true },
  { id: "overview", code: "A02", labelKey: "overview", href: "/admin/overview", anyOf: [], built: false },
  { id: "bookings", code: "A03", labelKey: "bookings", href: "/admin/bookings", anyOf: ["bookings.view"], built: false },
  {
    // A04 operations: the schedule board comes later; the capacity view (spec §14.3 "Capacity") is built.
    id: "operations",
    code: "A04",
    labelKey: "operations",
    href: CAPACITY_PATH,
    anyOf: ["schedule.view"],
    built: true,
    children: [
      { id: "schedule", labelKey: "schedule", href: "/admin/schedule", anyOf: ["schedule.view"], built: false },
      { id: "capacity", labelKey: "capacity", href: CAPACITY_PATH, anyOf: ["schedule.view"], built: true },
    ],
  },
  { id: "workers", code: "A05", labelKey: "workers", href: "/admin/workers", anyOf: ["workers.view"], built: true },
  {
    id: "fleet",
    code: "A06",
    labelKey: "fleet",
    href: "/admin/fleet/vehicles",
    anyOf: ["fleet.manage", "trips.manage", "schedule.view"],
    built: true,
    children: [
      // Schedule viewers read vehicles (seats per zone); editing and drivers need fleet.manage.
      { id: "vehicles", labelKey: "vehicles", href: "/admin/fleet/vehicles", anyOf: ["fleet.manage", "schedule.view"], built: true },
      { id: "drivers", labelKey: "drivers", href: "/admin/fleet/drivers", anyOf: ["fleet.manage"], built: true },
      { id: "trips", labelKey: "trips", href: "/admin/fleet/trips", anyOf: ["trips.manage"], built: false },
    ],
  },
  {
    id: "customers",
    code: "A07",
    labelKey: "customers",
    href: "/admin/customers",
    anyOf: ["customers.view"],
    built: false,
  },
  {
    id: "subscriptions",
    code: "A08",
    labelKey: "subscriptions",
    href: "/admin/subscriptions",
    anyOf: ["subscriptions.manage"],
    built: false,
  },
  {
    id: "finance",
    code: "A09",
    labelKey: "finance",
    href: "/admin/finance",
    anyOf: ["payments.view", "invoices.manage", "refunds.create", "reconciliation.run"],
    built: false,
  },
  {
    id: "quality",
    code: "A10",
    labelKey: "quality",
    href: "/admin/quality",
    anyOf: ["complaints.manage", "compensation.approve"],
    built: false,
  },
  {
    id: "catalog",
    code: "A11",
    labelKey: "catalog",
    href: "/admin/catalog/services",
    anyOf: ["catalog.manage", "settings.manage"],
    built: true,
    children: [
      { id: "services", labelKey: "services", href: "/admin/catalog/services", anyOf: CATALOG, built: true },
      { id: "packages", labelKey: "packages", href: "/admin/catalog/packages", anyOf: CATALOG, built: true },
      { id: "liveOut", labelKey: "liveOut", href: "/admin/catalog/live-out", anyOf: CATALOG, built: true },
      { id: "addons", labelKey: "addons", href: "/admin/catalog/addons", anyOf: CATALOG, built: true },
      { id: "coupons", labelKey: "coupons", href: "/admin/catalog/coupons", anyOf: CATALOG, built: true },
      { id: "policies", labelKey: "policies", href: "/admin/catalog/policies", anyOf: CATALOG, built: true },
      // Zones use catalog.manage (decision P1-05), and so do the scheduling tables (Scheduling routes/admin.php).
      { id: "zones", labelKey: "zones", href: "/admin/zones", anyOf: CATALOG, built: true },
      { id: "slotTemplates", labelKey: "slotTemplates", href: "/admin/scheduling/slots", anyOf: CATALOG, built: true },
      { id: "slotRules", labelKey: "slotRules", href: "/admin/scheduling/rules", anyOf: CATALOG, built: true },
      { id: "blackoutDates", labelKey: "blackoutDates", href: "/admin/scheduling/blackout-dates", anyOf: CATALOG, built: true },
      { id: "settings", labelKey: "settings", href: "/admin/settings", anyOf: ["settings.manage"], built: true },
    ],
  },
  {
    id: "reports",
    code: "A12",
    labelKey: "reports",
    href: "/admin/reports",
    anyOf: ["reports.view.operations", "reports.view.finance", "reports.view.staff"],
    built: false,
  },
  {
    id: "users",
    code: "A13",
    labelKey: "users",
    href: "/admin/users",
    anyOf: ["users.manage", "audit.view"],
    built: true,
    children: [
      { id: "staffUsers", labelKey: "staffUsers", href: "/admin/users", anyOf: ["users.manage"], built: true },
      { id: "audit", labelKey: "audit", href: "/admin/audit", anyOf: ["audit.view"], built: false },
    ],
  },
];

export function hasAnyPermission(permissions: readonly string[], anyOf: readonly string[]): boolean {
  return anyOf.length === 0 || anyOf.some((p) => permissions.includes(p));
}

/** The navigation this user may see: children filtered first, then modules without a visible child dropped. */
export function filterNav(nav: readonly NavModule[], permissions: readonly string[]): NavModule[] {
  const out: NavModule[] = [];
  for (const item of nav) {
    if (item.children) {
      const children = item.children.filter((c) => hasAnyPermission(permissions, c.anyOf));
      if (children.length > 0) out.push({ ...item, children });
    } else if (hasAnyPermission(permissions, item.anyOf)) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Where /admin sends a user: catalog for catalog.manage, settings, users, then the operations pages a role works in
 * (capacity, workers, vehicles), else the overview placeholder.
 */
export function firstAccessiblePath(permissions: readonly string[]): string {
  if (permissions.includes("catalog.manage")) return "/admin/catalog/services";
  if (permissions.includes("settings.manage")) return "/admin/settings";
  if (permissions.includes("users.manage")) return "/admin/users";
  if (permissions.includes("schedule.view")) return CAPACITY_PATH;
  if (permissions.includes("workers.view")) return "/admin/workers";
  if (permissions.includes("fleet.manage")) return "/admin/fleet/vehicles";
  return OVERVIEW_PLACEHOLDER_PATH;
}

export function isActivePath(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The `next` value after sign-in: only paths inside the admin panel on this origin (no protocol-relative
 * "//host" or backslash tricks), never the auth pages themselves.
 */
export function safeAdminNext(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/admin") || next.startsWith("//") || next.includes("\\")) return null;
  if (!/^\/admin(?:[/?#]|$)/.test(next)) return null;
  if (/^\/admin\/(?:login|forgot-password|reset-password)(?:[/?#]|$)/.test(next)) return null;
  return next;
}
