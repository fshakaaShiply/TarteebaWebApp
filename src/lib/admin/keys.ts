// React Query keys for the admin panel. Everything starts with "admin" so the whole area can be invalidated
// (e.g. after a language switch, since the API localizes labels) or cleared on sign-out in one call.

export type StaffUserFilters = { search: string; role: string; status: string; page: number; perPage: number };

/** A11 list filters; empty strings mean "no filter". */
export type CatalogListFilters = {
  page: number;
  perPage: number;
  kind?: string;
  type?: string;
  serviceId?: string;
  active?: string;
  search?: string;
};

export const adminKeys = {
  all: ["admin"] as const,
  me: () => ["admin", "me"] as const,
  settings: () => ["admin", "settings"] as const,
  staffUsers: () => ["admin", "staff-users"] as const,
  staffUserList: (filters: StaffUserFilters) => ["admin", "staff-users", "list", filters] as const,
  staffUser: (id: number) => ["admin", "staff-users", "detail", id] as const,
  roles: () => ["admin", "roles"] as const,
  permissions: () => ["admin", "permissions"] as const,

  // A11 catalog. Every catalog key sits under ["admin", "catalog"], so one invalidation refreshes lists, details
  // and the public "price from" figures after a write.
  catalog: () => ["admin", "catalog"] as const,
  services: () => ["admin", "catalog", "services"] as const,
  serviceList: (filters: CatalogListFilters) => ["admin", "catalog", "services", "list", filters] as const,
  service: (id: number) => ["admin", "catalog", "services", "detail", id] as const,
  /** Every service as full records (A11 selects that need more than names), all pages. */
  serviceOptions: () => ["admin", "catalog", "services", "options"] as const,
  /** GET /admin/services/options: every service's name, kind and state, for pickers outside A11. */
  servicePickList: () => ["admin", "catalog", "services", "pick-list"] as const,
  publicServices: () => ["admin", "catalog", "public-services"] as const,
  /** POST /admin/catalog/preview for deleting one price row (what customers would see afterwards). */
  priceDeletePreview: (priceId: number, version: number) => ["admin", "catalog", "price-delete-preview", priceId, version] as const,
  packages: () => ["admin", "catalog", "packages"] as const,
  packageList: (filters: CatalogListFilters) => ["admin", "catalog", "packages", "list", filters] as const,
  /** Every package (for coupon "applies to"). */
  packageOptions: () => ["admin", "catalog", "packages", "options"] as const,
  liveOutPlans: () => ["admin", "catalog", "live-out-plans"] as const,
  liveOutPlanList: (filters: CatalogListFilters) => ["admin", "catalog", "live-out-plans", "list", filters] as const,
  addons: () => ["admin", "catalog", "addons"] as const,
  addonList: (filters: CatalogListFilters) => ["admin", "catalog", "addons", "list", filters] as const,
  coupons: () => ["admin", "catalog", "coupons"] as const,
  couponList: (filters: CatalogListFilters) => ["admin", "catalog", "coupons", "list", filters] as const,
  policies: () => ["admin", "catalog", "policies"] as const,
  policyList: (filters: CatalogListFilters) => ["admin", "catalog", "policies", "list", filters] as const,
  /** Every policy (for the policy selects on services and packages). */
  policyOptions: () => ["admin", "catalog", "policies", "options"] as const,

  // A11 zones (permission catalog.manage, P1-05).
  zones: () => ["admin", "zones"] as const,
  zoneList: (filters: CatalogListFilters) => ["admin", "zones", "list", filters] as const,
  zone: (id: number) => ["admin", "zones", "detail", id] as const,
  /** GET /admin/zones/options: every zone's name and state, for pickers (price rows, operations pages). */
  zonePickList: () => ["admin", "zones", "pick-list"] as const,

  // Phase 2 operations. Workforce, fleet and scheduling changes move capacity, so each write also invalidates
  // ["admin", "capacity"].
  workers: () => ["admin", "workers"] as const,
  workerList: (filters: Record<string, string | number>) => ["admin", "workers", "list", filters] as const,
  worker: (id: number) => ["admin", "workers", "detail", id] as const,
  workerLeaves: (id: number, filters: Record<string, string | number>) => ["admin", "workers", "leaves", id, filters] as const,
  skills: () => ["admin", "skills"] as const,
  fleet: () => ["admin", "fleet"] as const,
  vehicleList: (filters: Record<string, string | number>) => ["admin", "fleet", "vehicles", "list", filters] as const,
  driverList: (filters: Record<string, string | number>) => ["admin", "fleet", "drivers", "list", filters] as const,
  driverOptions: () => ["admin", "fleet", "drivers", "options"] as const,
  /** Staff accounts a new driver can be linked to; under "fleet", so creating a driver refreshes it. */
  driverCandidates: () => ["admin", "fleet", "driver-candidates"] as const,
  scheduling: () => ["admin", "scheduling"] as const,
  slotTemplateList: (filters: Record<string, string | number>) => ["admin", "scheduling", "slot-templates", "list", filters] as const,
  slotTemplateOptions: () => ["admin", "scheduling", "slot-templates", "options"] as const,
  slotRuleList: (filters: Record<string, string | number>) => ["admin", "scheduling", "slot-rules", "list", filters] as const,
  blackoutList: (filters: Record<string, string | number>) => ["admin", "scheduling", "blackout-dates", "list", filters] as const,
  capacity: () => ["admin", "capacity"] as const,
  capacityView: (date: string, zoneId: number) => ["admin", "capacity", date, zoneId] as const,

  // Phase 3. Every booking action changes figures on the overview and capacity, so writes invalidate
  // ["admin", "bookings"], ["admin", "dashboard"] and ["admin", "capacity"] together (see bookings/_components).
  dashboard: () => ["admin", "dashboard"] as const,
  dashboardSummary: (date: string, zoneId: number | null) => ["admin", "dashboard", "summary", date, zoneId] as const,
  dashboardAlerts: (zoneId: number | null) => ["admin", "dashboard", "alerts", zoneId] as const,
  /** The bell's first page (the 20-second poll merges into it). */
  alerts: () => ["admin", "alerts"] as const,
  bookings: () => ["admin", "bookings"] as const,
  bookingList: (filters: Record<string, string | number | boolean>) => ["admin", "bookings", "list", filters] as const,
  booking: (id: number) => ["admin", "bookings", "detail", id] as const,
  visitCandidates: (visitId: number) => ["admin", "bookings", "candidates", visitId] as const,
  bookingRefunds: (bookingId: number) => ["admin", "bookings", "refunds", bookingId] as const,
  bookingNotifications: (bookingId: number, page: number) => ["admin", "bookings", "notifications", bookingId, page] as const,
  /** Customer lookup in the manual booking wizard (past bookings by phone). */
  customerLookup: (phone: string) => ["admin", "bookings", "customer-lookup", phone] as const,
  addonOptions: () => ["admin", "catalog", "addons", "options"] as const,
  workerOptions: () => ["admin", "workers", "options"] as const,

  // A04 schedule board and A06 trip planner. Team changes and booking actions move cards and stops, so they invalidate
  // ["admin", "schedule"] and ["admin", "rounds"] too (bookings/_components/refresh.ts).
  schedule: () => ["admin", "schedule"] as const,
  scheduleBoard: (query: Record<string, string | number>) => ["admin", "schedule", "board", query] as const,
  rounds: () => ["admin", "rounds"] as const,
  roundList: (query: Record<string, string | number>) => ["admin", "rounds", "list", query] as const,
  driverReports: () => ["admin", "driver-reports"] as const,
  driverReportList: (query: Record<string, string | number>) => ["admin", "driver-reports", "list", query] as const,
};
