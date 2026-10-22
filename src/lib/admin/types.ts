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

export type SettingType = "int" | "money_fils" | "bool" | "string" | "list" | "time_range" | "json" | "weekly_hours";

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

// ---- Phase 2: A05 workers (app/Modules/Workforce/Http/Resources) -------------------------------------------------

/** A zone as other resources embed it. */
export type ZoneRef = { id: number; code: string; name: Translatable };

// ---- Pick-lists for pages that do not manage the records themselves -----------------------------------------------
// Not in the generated schema yet (added after the last openapi.json); shapes from the API controllers.

/**
 * GET /admin/zones/options (Geo ZoneOptionsController): every zone by sort order, without polygons. Readable with
 * catalog.manage, schedule.view, workers.view, workers.manage, fleet.manage or bookings.view.
 */
export type ZoneOption = { id: number; code: string; name: Translatable; is_active: boolean };

/** GET /admin/services/options (Catalog ServiceOptionsController): every service by sort order, without prices. */
export type ServiceOption = { id: number; code: string; name: Translatable; kind: ServiceKind; is_active: boolean };

/**
 * GET /admin/drivers/candidates (Fleet DriverCandidatesController, fleet.manage): active staff accounts holding the
 * driver role that no driver profile links yet, by name.
 */
export type DriverCandidate = { id: number; name: string; email: string; phone: string | null };

export type EmploymentStatus = "active" | "on_leave" | "suspended" | "terminated";
export type LeaveType = "annual" | "sick" | "unpaid" | "emergency" | "public_holiday";
export type LeaveStatus = "requested" | "approved" | "rejected" | "cancelled";

/** One weekday of a worker's weekly pattern (0 = Sunday … 6 = Saturday). Non-working days carry no times. */
export type ShiftRow = { day_of_week: number; is_working: boolean; start_time: string | null; end_time: string | null };

/** SkillResource. */
export type Skill = { id: number; code: string; name: Translatable; is_active: boolean; version: number };

export type WorkerServiceRef = { id: number; code: string; kind: ServiceKind; name: Translatable };

export type StaffRef = { id: number; name: string };

/** LeaveResource (staff with leave.manage): the whole status history. */
export type WorkerLeave = {
  id: number;
  worker_id: number;
  worker?: { id: number; employee_no: string; full_name: Translatable; display_name: string; home_zone_id: number };
  type: LeaveType;
  date_from: string;
  date_to: string;
  days: number;
  status: LeaveStatus;
  reason: string | null;
  requested_by?: StaffRef | null;
  requested_at: string | null;
  decided_by?: StaffRef | null;
  decided_at: string | null;
  decision_note: string | null;
  cancelled_by?: StaffRef | null;
  cancelled_at: string | null;
  cancellation_note: string | null;
  version: number;
  updated_at: string | null;
};

/** LeaveResource::summary(): the basic view of an upcoming leave (no type, reason, notes or names). */
export type LeaveSummary = Pick<WorkerLeave, "id" | "date_from" | "date_to" | "days" | "status">;

/**
 * WorkerResource. With workers.view alone the API sends the basic profile: `phone` and `notes` are absent and
 * upcoming leave is LeaveSummary only (see WorkerResource::FULL_VIEW_PERMISSIONS).
 */
export type Worker = {
  id: number;
  ulid: string;
  employee_no: string;
  full_name: Translatable;
  display_name: string;
  phone?: string | null;
  nationality: string | null;
  languages: string[];
  employment_status: EmploymentStatus;
  hired_at: string | null;
  home_zone_id: number;
  home_zone?: ZoneRef;
  can_live_out: boolean;
  weekly_rest_day: number;
  notes?: string | null;
  skills?: Skill[];
  services?: WorkerServiceRef[];
  shifts?: ShiftRow[];
  on_leave_until?: string | null;
  upcoming_leaves?: (WorkerLeave | LeaveSummary)[];
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

// ---- Phase 2: A06 vehicles and drivers (app/Modules/Fleet/Http/Resources) ----------------------------------------

export type VehicleStatus = "active" | "maintenance" | "inactive";
export type DriverStatus = "active" | "inactive";

export type Vehicle = {
  id: number;
  plate_no: string;
  model: string | null;
  seats: number;
  insurance_expires_at: string | null;
  registration_expires_at: string | null;
  status: VehicleStatus;
  zone_id: number | null;
  zone?: ZoneRef | null;
  default_driver_id: number | null;
  default_driver?: { id: number; name: string; status: DriverStatus } | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

/** DriverResource: the licence number only as its last characters (never the whole number). */
export type Driver = {
  id: number;
  staff_user_id: number;
  staff_user?: { id: number; name: string; email: string; status: string };
  license_no_last4: string;
  license_expires_at: string | null;
  phone: string | null;
  status: DriverStatus;
  vehicle?: { id: number; plate_no: string } | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

// ---- Phase 2: A11 scheduling and capacity (app/Modules/Scheduling) ------------------------------------------------

/** SlotTemplateResource: local "HH:MM" times on the quarter hour ("24:00" may end a slot). */
export type SlotTemplate = {
  id: number;
  code: string;
  name: Translatable;
  start_time: string;
  end_time: string;
  service_kind: ServiceKind;
  is_active: boolean;
  sort_order: number;
  version: number;
  updated_at: string | null;
};

export type RuleSource = "admin" | "override";

/** SlotAvailabilityRule::snapshot(): the rule applied to a capacity cell, or relaxed by an override. */
export type SlotRuleSnapshot = {
  id: number;
  slot_template_id: number;
  zone_id: number | null;
  service_id: number | null;
  day_of_week: number | null;
  date_from: string | null;
  date_to: string | null;
  is_open: boolean;
  max_bookings: number | null;
  source: RuleSource;
  reason: string | null;
  version: number;
};

/** SlotRuleResource. Rules with source "override" come from a capacity override and are read-only. */
export type SlotRule = SlotRuleSnapshot & {
  slot: string | null;
  created_by: StaffRef | null;
  created_at: string | null;
  updated_at: string | null;
};

/** BlackoutDateResource: no zone = every zone; the reason may have one or both languages. */
export type BlackoutDate = {
  id: number;
  date: string;
  zone_id: number | null;
  reason: Partial<Translatable> | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

export type SlotStatus = "available" | "limited" | "full" | "closed";
export type ClosedReason = "lead_time" | "blackout" | "rule_closed" | "horizon" | "past" | "inactive";
export type FullReason = "workers" | "seats" | "max_bookings";
export type ExclusionReason = "not_active" | "not_eligible" | "rest_day" | "not_on_shift" | "leave" | "live_out" | "busy";

export type CapacityVehicle = { id: number; seats: number; reserved_seats: number; free: number };

/** One slot of GET /admin/capacity (CapacityBreakdown): the calculator figures for one worker. */
export type CapacitySlot = {
  slot_template_id: number;
  code: string;
  name: Translatable;
  start: string;
  end: string;
  service_kind: ServiceKind;
  is_active: boolean;
  service: { id: number; code: string } | null;
  status: SlotStatus;
  reason: ClosedReason | FullReason | null;
  available_workers: number;
  reserved_workers: number;
  reserved_competing: number;
  remaining_workers: number;
  vehicles: CapacityVehicle[];
  max_single_vehicle_free: number;
  total_free_seats: number;
  bookings_count: number;
  max_bookings: number | null;
  rule: SlotRuleSnapshot | null;
  max_workers_fit: number;
  holds: { active: number; converted: number };
  zone_workers: number;
  excluded: Partial<Record<ExclusionReason, number>>;
};

export type CapacityView = {
  date: string;
  zone: ZoneRef;
  timezone: string;
  travel_buffer_minutes: number;
  live_out_block_scope: "whole_day" | "window";
  slots: CapacitySlot[];
};

export type OverrideAction = "open" | "raise_cap";

/** What an override relaxed: the rule(s) or blackout(s) named in the response and the audit row. */
export type RelaxedItem =
  | ({ type: "rule" } & SlotRuleSnapshot)
  | { type: "blackout"; id: number; date: string; zone_id: number | null; reason?: Partial<Translatable> | null };

export type CapacityOverrideResult = { rule: SlotRule; relaxed: RelaxedItem[]; capacity: CapacitySlot | null };

/** 409 CAPACITY_SHORTFALL details.shortfalls[] (Support\CapacityImpactGuard). */
export type Shortfall = {
  date: string;
  zone_id: number;
  slot_template_id: number;
  slot: string;
  kind: "workers" | "seats";
  reserved: number;
  available: number;
  service_id?: number | null;
  vehicle_id?: number;
};

/** Settings type "weekly_hours" (booking.working_hours, R-13): "0" (Sunday) … "6" (Saturday); null = closed. */
export type WeeklyHoursDay = { open: string; close: string } | null;
export type WeeklyHoursValue = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", WeeklyHoursDay>;
