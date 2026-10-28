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
  /** GET /admin/drivers/options: every driver's name, state and usual van, for pickers outside fleet.manage. */
  driverPickList: () => ["admin", "fleet", "drivers", "pick-list"] as const,
  /** GET /admin/vehicles/options: every van's plate, seats and state, for pickers outside fleet.manage. */
  vehiclePickList: () => ["admin", "fleet", "vehicles", "pick-list"] as const,
  /** Staff accounts a new driver can be linked to; under "fleet", so creating a driver refreshes it. */
  driverCandidates: () => ["admin", "fleet", "driver-candidates"] as const,
  scheduling: () => ["admin", "scheduling"] as const,
  slotTemplateList: (filters: Record<string, string | number>) => ["admin", "scheduling", "slot-templates", "list", filters] as const,
  slotTemplateOptions: () => ["admin", "scheduling", "slot-templates", "options"] as const,
  /** GET /admin/slot-templates/options: every slot's name, times, kind and state, for pickers outside A11. */
  slotTemplatePickList: () => ["admin", "scheduling", "slot-templates", "pick-list"] as const,
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
  /**
   * GET /admin/customers?phone= in the manual booking wizard (by the normalized number). Outside ["admin", "bookings"]:
   * a booking action marks it stale without asking again at once (rate limited, see bookings/_components/refresh.ts).
   */
  customerLookups: () => ["admin", "customer-lookup"] as const,
  customerLookup: (phone: string) => ["admin", "customer-lookup", phone] as const,
  // Dry runs, outside ["admin", "bookings"] so a booking action's refresh never sends them again.
  /** POST /admin/bookings/preview for one request body (JSON). */
  manualPreview: (body: string) => ["admin", "dry-run", "manual-booking", body] as const,
  /** POST …/reschedule/preview and …/propose-alternative/preview of one booking version. */
  reschedulePreview: (bookingId: number, version: number, date: string, slotId: number) =>
    ["admin", "dry-run", "reschedule", bookingId, version, date, slotId] as const,
  alternativesPreview: (bookingId: number, version: number, body: string) => ["admin", "dry-run", "alternatives", bookingId, version, body] as const,
  /** GET /admin/addons/options (pick-list, also without catalog.manage). */
  addonPickList: () => ["admin", "catalog", "addons", "pick-list"] as const,
  workerOptions: () => ["admin", "workers", "options"] as const,

  // A04 schedule board and A06 trip planner. Team changes and booking actions move cards and stops, so they invalidate
  // ["admin", "schedule"] and ["admin", "rounds"] too (bookings/_components/refresh.ts).
  schedule: () => ["admin", "schedule"] as const,
  scheduleBoard: (query: Record<string, string | number>) => ["admin", "schedule", "board", query] as const,
  rounds: () => ["admin", "rounds"] as const,
  roundList: (query: Record<string, string | number>) => ["admin", "rounds", "list", query] as const,
  driverReports: () => ["admin", "driver-reports"] as const,
  driverReportList: (query: Record<string, string | number>) => ["admin", "driver-reports", "list", query] as const,

  // A09 finance. A refund changes the payment, its refunds, the booking's payment status and later the invoice's
  // credit notes, so it invalidates ["admin", "finance"] and ["admin", "bookings"] together.
  finance: () => ["admin", "finance"] as const,
  paymentList: (query: Record<string, string | number>) => ["admin", "finance", "payments", "list", query] as const,
  payment: (id: number) => ["admin", "finance", "payments", "detail", id] as const,
  refundList: (query: Record<string, string | number>) => ["admin", "finance", "refunds", "list", query] as const,
  invoiceList: (query: Record<string, string | number>) => ["admin", "finance", "invoices", "list", query] as const,
  invoice: (id: number) => ["admin", "finance", "invoices", "detail", id] as const,
  /** GET /admin/refund-reasons (the refund dialog's picker, the refunds list's reason filter). */
  refundReasons: () => ["admin", "finance", "refund-reasons"] as const,
  /** GET /admin/finance/summary (A09 KPI cards); "" = the API's default for that end, null zone = all zones. */
  financeSummary: (from: string, to: string, zoneId: number | null) => ["admin", "finance", "summary", from, to, zoneId] as const,
  creditNoteList: (query: Record<string, string | number>) => ["admin", "finance", "credit-notes", "list", query] as const,
  creditNote: (id: number) => ["admin", "finance", "credit-notes", "detail", id] as const,
  billingRefusalList: (query: Record<string, string | number>) => ["admin", "finance", "billing-refusals", "list", query] as const,

  // A11 notification templates (settings.manage).
  notificationTemplates: () => ["admin", "notification-templates"] as const,
  notificationTemplateList: () => ["admin", "notification-templates", "list"] as const,
  notificationTemplate: (id: number) => ["admin", "notification-templates", "detail", id] as const,
  /** The same event, audience and channel in both languages. */
  notificationTemplateSiblings: (eventKey: string, audience: string, channel: string) =>
    ["admin", "notification-templates", "siblings", eventKey, audience, channel] as const,
};
