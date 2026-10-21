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
  /** Every service (for selects and names), all pages. */
  serviceOptions: () => ["admin", "catalog", "services", "options"] as const,
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
  /** Every zone (for the price-row zone select). */
  zoneOptions: () => ["admin", "zones", "options"] as const,
};
