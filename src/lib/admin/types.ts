// Admin API shapes as the Laravel resources return them. The generated schema (src/lib/api/schema.d.ts) types
// some of these loosely (e.g. roles as objects, permissions as unknown[]), so admin code reads responses through
// these types; request paths and bodies still go through the typed openapi-fetch client.

export type DataEnvelope<T> = { data: T };

export type PageMeta = {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
};

export type Paginated<T> = { data: T[]; meta: PageMeta };

/** GET /admin/me and the login response (StaffMeResource). */
export type StaffMe = {
  id: number;
  name: string;
  email: string;
  locale: string;
  roles: string[];
  permissions: string[];
  two_factor_enabled: boolean;
  two_factor_setup_required: boolean;
};

export type StaffStatus = "active" | "suspended";

/** A13 staff user (StaffUserResource). */
export type StaffUser = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  locale: string;
  status: StaffStatus | string;
  roles: string[];
  two_factor_enabled: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string | null;
  version: number;
};

/** A13 role (RoleResource). */
export type Role = {
  name: string;
  label: string;
  is_system: boolean;
  permissions: string[];
  users_count?: number;
};

/** GET /admin/permissions. */
export type Permission = { name: string; group: string; label: string };

export type SettingType = "int" | "money_fils" | "bool" | "string" | "list" | "time_range" | "json";

/** A11 global setting (GET /admin/settings). `type` may be a value this app does not know yet. */
export type Setting = {
  key: string;
  value: unknown;
  type: SettingType | (string & {});
  group: string;
  description: string | null;
  version: number;
  updated_at: string | null;
};

/** POST /admin/me/two-factor. */
export type TwoFactorSetup = { secret: string; otpauth_url: string };

// ---- A11 catalog (app/Modules/Catalog/Http/Resources) ---------------------------------------------------------

/** A translatable JSON field as stored: both languages (spec §4.6). */
export type Translatable = { ar: string; en: string };

export type ServiceKind = "standard_visit" | "live_out" | "future_specialized";
export type MaterialsMode = "customer" | "company_addon" | "company_included";
export type PriceUnit = "per_worker_visit" | "per_hour" | "per_day" | "per_month";
export type DiscountType = "percent" | "fixed";
export type AddonPer = "visit" | "worker" | "month";
export type LiveOutPlanKind = "trial_day" | "monthly";
export type PolicyType = "cancellation" | "reschedule" | "refund";

/** ServicePriceResource: one row of the price matrix, with the VAT split of one unit at the current rate. */
export type ServicePrice = {
  id: number;
  service_id: number;
  zone_id: number | null;
  slot_template_id: number | null;
  /** 0 = Sunday … 6 = Saturday; null = any day. */
  day_of_week: number | null;
  valid_from: string | null;
  valid_to: string | null;
  unit: PriceUnit;
  amount_fils: number;
  vat_inclusive: boolean;
  priority: number;
  unit_breakdown: { net_fils: number; vat_fils: number; gross_fils: number; vat_rate_percent: number };
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

/** PackageResource (recurring bundle of standard visits). `discount_value` is a percent or net fils (R-07). */
export type CatalogPackage = {
  id: number;
  service_id: number;
  code: string;
  name: Translatable;
  visits_per_week: number;
  term_weeks: number | null;
  term_months: number | null;
  discount_type: DiscountType;
  discount_value: number;
  min_visits_for_discount: number | null;
  auto_renew_allowed: boolean;
  max_skips_per_month: number | null;
  max_freeze_days: number | null;
  is_active: boolean;
  sort_order: number;
  cancellation_policy_id: number | null;
  reschedule_policy_id: number | null;
  refund_policy_id: number | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

/** LiveOutPlanResource. A plan without a price is hidden from customers (D-03). */
export type LiveOutPlan = {
  id: number;
  service_id: number;
  code: string;
  name: Translatable;
  kind: LiveOutPlanKind;
  service_days_per_month: number;
  rest_days_per_week: number;
  work_hours: number;
  break_minutes: number;
  /** "09:00" (Asia/Dubai wall clock). */
  window_start: string;
  window_end: string;
  price_fils: number | null;
  vat_inclusive: boolean;
  max_active_contracts: number | null;
  is_active: boolean;
  sort_order: number;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

/** ServiceResource; the detail endpoint also loads prices, packages and Live-out plans. */
export type CatalogService = {
  id: number;
  code: string;
  kind: ServiceKind;
  name: Translatable;
  description: Translatable | null;
  includes: Translatable[];
  excludes: Translatable[];
  duration_minutes: number;
  min_workers: number;
  max_workers: number;
  team_size_default: number | null;
  requires_equipment: boolean;
  materials_mode: MaterialsMode;
  is_active: boolean;
  is_bookable_online: boolean;
  sort_order: number;
  cancellation_policy_id: number | null;
  reschedule_policy_id: number | null;
  refund_policy_id: number | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
  prices?: ServicePrice[];
  packages?: CatalogPackage[];
  live_out_plans?: LiveOutPlan[];
};

export type Addon = {
  id: number;
  code: string;
  name: Translatable;
  amount_fils: number;
  vat_inclusive: boolean;
  per: AddonPer;
  is_active: boolean;
  sort_order: number;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

export type CouponAppliesTo = { service_ids?: number[]; package_ids?: number[]; first_booking_only?: boolean };

/** CouponResource. `value` is a percent (1..100) or a net (pre-VAT) amount in fils (R-07). */
export type Coupon = {
  id: number;
  code: string;
  type: DiscountType;
  value: number;
  max_discount_fils: number | null;
  min_order_fils: number | null;
  valid_from: string | null;
  valid_to: string | null;
  usage_limit_total: number | null;
  usage_limit_per_customer: number | null;
  applies_to: CouponAppliesTo | null;
  is_active: boolean;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

/** policies.rules (spec §11.4); each policy type carries its own section. */
export type CancellationTier = { min_hours_before: number; fee_type: "percent" | "fixed"; fee_value: number };
export type RescheduleRules = {
  free_until_hours_before: number;
  fee_fils_after: number;
  max_per_booking: number;
  requires_approval: boolean;
};
export type Compensation = "none" | "credit" | "coupon";
export type CompanyCancellationRules = { refund_percent: number; compensation: Compensation };
export type PolicyRules = {
  cancellation?: CancellationTier[];
  reschedule?: RescheduleRules;
  company_cancellation?: CompanyCancellationRules;
  exceptions?: string[];
};

export type Policy = {
  id: number;
  code: string;
  type: PolicyType;
  name: Translatable;
  rules: PolicyRules;
  is_active: boolean;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

/** One service as the public API shows it (BuildPublicServicePayload), localized to one language. */
export type PublicServicePackage = {
  code: string;
  name: string | null;
  visits_per_week: number;
  term_weeks: number | null;
  term_months: number | null;
  discount_type: DiscountType;
  discount_value: number;
  min_visits_for_discount: number | null;
  auto_renew_allowed: boolean;
  max_skips_per_month: number | null;
  max_freeze_days: number | null;
};

export type PublicServicePlan = {
  code: string;
  kind: LiveOutPlanKind;
  name: string | null;
  /** Gross (VAT included); absent while the plan has no price. */
  price_fils?: number;
  service_days_per_month: number;
  rest_days_per_week: number;
  work_hours: number;
  break_minutes: number;
  window_start: string;
  window_end: string;
  available: boolean;
};

export type PublicService = {
  code: string;
  kind: ServiceKind;
  name: string | null;
  description: string | null;
  includes: string[];
  excludes: string[];
  duration_minutes: number;
  min_workers: number;
  max_workers: number;
  materials_mode: MaterialsMode;
  currency: string;
  /** Gross "from" price (P1-03); null while nothing is priced. */
  price_from_fils: number | null;
  price_unit: PriceUnit | null;
  vat_inclusive_display: boolean;
  packages: PublicServicePackage[];
  live_out_plans: PublicServicePlan[];
};

/** POST /admin/catalog/preview: the public payload in both languages after the proposed changes (nothing saved). */
export type CatalogPreview = {
  payload: { ar: PublicService; en: PublicService };
  /** Standard visits: the line total per team size (R-07: VAT on the line). */
  price_examples: { workers: number; gross_fils: number; net_fils: number; vat_fils: number }[];
};

// ---- A11 zones (app/Modules/Geo/Http/Resources) -----------------------------------------------------------

/** GeoJSON geometry as the API stores it: [lng, lat] positions, closed rings. */
export type GeoPolygon =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export type BoundingBox = { min_lat: number; max_lat: number; min_lng: number; max_lng: number };

export type SubZone = {
  id: number;
  zone_id: number;
  code: string;
  name: Translatable;
  is_active: boolean;
  polygon: GeoPolygon;
  bbox: BoundingBox;
  version: number;
  active_addresses_count?: number;
  created_at: string | null;
  updated_at: string | null;
};

export type Zone = {
  id: number;
  code: string;
  name: Translatable;
  is_active: boolean;
  polygon: GeoPolygon;
  bbox: BoundingBox;
  default_travel_buffer_min: number | null;
  sort_order: number;
  version: number;
  active_addresses_count?: number;
  sub_zones?: SubZone[];
  created_at: string | null;
  updated_at: string | null;
};
