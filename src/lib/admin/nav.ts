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
  /** And, when set, every one of these (a page of another module the entry opens). */
  allOf?: readonly string[];
  built: boolean;
};

export type NavModule = NavLeaf & {
  /** Spec module code, e.g. "A11". */
  code: string;
  children?: readonly NavLeaf[];
};

export const TWO_FACTOR_PATH = "/admin/security/two-factor";
export const OVERVIEW_PATH = "/admin/overview";
/** Users without the overview's permissions see a welcome note there instead of the figures. */
export const OVERVIEW_PLACEHOLDER_PATH = OVERVIEW_PATH;
export const CAPACITY_PATH = "/admin/capacity";
export const SCHEDULE_PATH = "/admin/schedule";
export const TRIPS_PATH = "/admin/trips";
export const DRIVER_REPORTS_PATH = "/admin/trips/reports";
export const OVERVIEW_PERMISSIONS = ["bookings.view", "schedule.view"] as const;
/** Rounds and driver reports are readable with either; changes need trips.manage (Fleet routes/admin.php). */
export const TRIPS_READ = ["trips.manage", "schedule.view"] as const;

/** The A09 landing page: the period's KPI cards (GET /admin/finance/summary, DOCUMENTS_READ). */
export const FINANCE_SUMMARY_PATH = "/admin/finance";
export const PAYMENTS_PATH = "/admin/finance/payments";
export const REFUNDS_PATH = "/admin/finance/refunds";
export const INVOICES_PATH = "/admin/finance/invoices";
export const CREDIT_NOTES_PATH = "/admin/finance/credit-notes";
export const BILLING_REFUSALS_PATH = "/admin/finance/billing-refusals";
export const NOTIFICATION_TEMPLATES_PATH = "/admin/settings/notifications";
/** GET /admin/refunds (Payment routes/admin.php). */
export const REFUNDS_READ = ["refunds.create", "payments.view"] as const;
/** Invoices, credit notes and refused documents are readable with either (Billing routes/admin.php). */
export const DOCUMENTS_READ = ["invoices.manage", "payments.view"] as const;
/**
 * The A03 list of customer cancellations waiting for review (bookings.view): finance resolves them with a refund
 * (POST /admin/bookings/{id}/cancel-review/resolve, refunds.create), so A09 links to it.
 */
export const CANCEL_REVIEWS_PATH = "/admin/bookings?cancel_review=1";

const CATALOG = ["catalog.manage"] as const;

export const ADMIN_NAV: readonly NavModule[] = [
  // A01 is the sign-in itself; its in-panel page is the account security (two-factor) screen.
  { id: "access", code: "A01", labelKey: "access", href: TWO_FACTOR_PATH, anyOf: [], built: true },
  // A02 reads bookings or the schedule (Reporting dashboard routes); A03 needs bookings.view.
  { id: "overview", code: "A02", labelKey: "overview", href: OVERVIEW_PATH, anyOf: OVERVIEW_PERMISSIONS, built: true },
  { id: "bookings", code: "A03", labelKey: "bookings", href: "/admin/bookings", anyOf: ["bookings.view"], built: true },
  {
    // A04 operations: the schedule board (moves need assignments.manage) and the capacity view (spec §14.3 "Capacity").
    id: "operations",
    code: "A04",
    labelKey: "operations",
    href: SCHEDULE_PATH,
    anyOf: ["schedule.view"],
    built: true,
    children: [
      { id: "schedule", labelKey: "schedule", href: SCHEDULE_PATH, anyOf: ["schedule.view"], built: true },
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
      // The trip planner and the driver reports inbox: trips.manage plans and handles; schedule.view reads (Fleet routes).
      { id: "trips", labelKey: "trips", href: TRIPS_PATH, anyOf: TRIPS_READ, built: true },
      { id: "driverReports", labelKey: "driverReports", href: DRIVER_REPORTS_PATH, anyOf: TRIPS_READ, built: true },
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
    // A09: the period's summary cards (read like the documents), transactions and their refunds (payments.view; a refund
    // needs refunds.create), tax invoices and credit notes, and the documents Billing refused to issue. Reconciliation is
    // a later phase.
    id: "finance",
    code: "A09",
    labelKey: "finance",
    href: FINANCE_SUMMARY_PATH,
    anyOf: ["payments.view", "invoices.manage", "refunds.create"],
    built: true,
    children: [
      // A prefix of every other finance page: activeChildHref marks the longest match, so they keep their own entry.
      { id: "financeSummary", labelKey: "financeSummary", href: FINANCE_SUMMARY_PATH, anyOf: DOCUMENTS_READ, built: true },
      { id: "payments", labelKey: "payments", href: PAYMENTS_PATH, anyOf: ["payments.view"], built: true },
      { id: "refunds", labelKey: "refunds", href: REFUNDS_PATH, anyOf: REFUNDS_READ, built: true },
      { id: "cancelReviews", labelKey: "cancelReviews", href: CANCEL_REVIEWS_PATH, anyOf: ["refunds.create"], allOf: ["bookings.view"], built: true },
      { id: "invoices", labelKey: "invoices", href: INVOICES_PATH, anyOf: DOCUMENTS_READ, built: true },
      { id: "creditNotes", labelKey: "creditNotes", href: CREDIT_NOTES_PATH, anyOf: DOCUMENTS_READ, built: true },
      { id: "billingRefusals", labelKey: "billingRefusals", href: BILLING_REFUSALS_PATH, anyOf: DOCUMENTS_READ, built: true },
      { id: "reconciliation", labelKey: "reconciliation", href: "/admin/finance/reconciliation", anyOf: ["reconciliation.run"], built: false },
    ],
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
      // Notification templates are edited with settings.manage (Notification routes/admin.php).
      { id: "notificationTemplates", labelKey: "notificationTemplates", href: NOTIFICATION_TEMPLATES_PATH, anyOf: ["settings.manage"], built: true },
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

/** `anyOf` (any one, or open to all when empty) and every one of `allOf`. */
function mayOpen(permissions: readonly string[], item: Pick<NavLeaf, "anyOf" | "allOf">): boolean {
  return hasAnyPermission(permissions, item.anyOf) && (item.allOf ?? []).every((p) => permissions.includes(p));
}

/** The navigation this user may see: children filtered first, then modules without a visible child dropped. */
export function filterNav(nav: readonly NavModule[], permissions: readonly string[]): NavModule[] {
  const out: NavModule[] = [];
  for (const item of nav) {
    if (item.children) {
      const children = item.children.filter((c) => mayOpen(permissions, c));
      if (children.length > 0) out.push({ ...item, children });
    } else if (mayOpen(permissions, item)) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Where /admin sends a user: the A02 overview for everyone who reads bookings or the schedule, then catalog for
 * catalog.manage, settings, users, the workers and vehicles pages, the trip planner, the A09 summary (or the refunds
 * list for refunds.create alone), else the overview's welcome note.
 */
export function firstAccessiblePath(permissions: readonly string[]): string {
  if (hasAnyPermission(permissions, OVERVIEW_PERMISSIONS)) return OVERVIEW_PATH;
  if (permissions.includes("catalog.manage")) return "/admin/catalog/services";
  if (permissions.includes("settings.manage")) return "/admin/settings";
  if (permissions.includes("users.manage")) return "/admin/users";
  if (permissions.includes("workers.view")) return "/admin/workers";
  if (permissions.includes("fleet.manage")) return "/admin/fleet/vehicles";
  if (permissions.includes("trips.manage")) return TRIPS_PATH;
  if (hasAnyPermission(permissions, DOCUMENTS_READ)) return FINANCE_SUMMARY_PATH;
  if (permissions.includes("refunds.create")) return REFUNDS_PATH;
  return OVERVIEW_PLACEHOLDER_PATH;
}

/**
 * How closely an entry's href matches the page (`search`: its query string, with or without "?"), or null when it
 * does not: the page is the href's path or below it, and carries every query parameter the href names with the same
 * value. A longer path scores higher, and so does each query parameter on the same path, so
 * "/admin/bookings?cancel_review=1" beats "/admin/bookings" on that list.
 */
function matchScore(href: string, pathname: string, search: string): number | null {
  const q = href.indexOf("?");
  const path = q < 0 ? href : href.slice(0, q);
  if (pathname !== path && !pathname.startsWith(`${path}/`)) return null;
  const wanted = new URLSearchParams(q < 0 ? "" : href.slice(q + 1));
  const params = new URLSearchParams(search);
  let named = 0;
  for (const [key, value] of wanted) {
    if (params.get(key) !== value) return null;
    named += 1;
  }
  return path.length * 100 + named;
}

export function isActivePath(href: string, pathname: string, search = ""): boolean {
  return matchScore(href, pathname, search) !== null;
}

/**
 * The entry the page belongs to among `children`: the closest match (matchScore), so /admin/trips/reports marks
 * "Driver reports" and not also "Trip planner" (/admin/trips), and the cancellation review list
 * (/admin/bookings?cancel_review=1) its own entry.
 */
export function activeChildHref(children: readonly Pick<NavLeaf, "href">[], pathname: string, search = ""): string | null {
  let best: { href: string; score: number } | null = null;
  for (const child of children) {
    const score = matchScore(child.href, pathname, search);
    if (score !== null && (best === null || score > best.score)) best = { href: child.href, score };
  }
  return best?.href ?? null;
}

/**
 * The one entry of the user's navigation (filterNav) the page belongs to, across every module, so only one carries
 * aria-current: the cancellation review list marks A09's "Cancellation reviews" and not also A03 "Bookings", which
 * stays the page's entry for users without the review entry.
 */
export function activeNavHref(modules: readonly NavModule[], pathname: string, search = ""): string | null {
  return activeChildHref(
    modules.flatMap((m) => m.children ?? [m]),
    pathname,
    search,
  );
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
