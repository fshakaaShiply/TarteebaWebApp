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
  /** Phase 3: confirmed visits of the date and zone still missing workers (Scheduling UncoveredVisits). */
  uncovered_visits?: UncoveredVisit[];
};

export type UncoveredVisit = {
  visit_id: number;
  booking_id: number;
  reference: string;
  slot_template_id: number;
  start: string;
  end: string;
  workers_count: number;
  assigned: number;
  missing: number;
  status: string;
  /** Named workers who no longer fit the visit (they do not cover it). */
  unfit_workers: { worker_id: number; reason: string }[];
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

// ---- Phase 3: A02 overview (app/Modules/Reporting/Dashboard) ------------------------------------------------------
// The generated schema types these responses as unknown[]; shapes from DashboardSummary, BookingFigures, WorkerFigures,
// FleetFigures, QuickStats, DashboardAlerts and Support\Links.

/** Query filters of a dashboard link (nulls dropped). PHP sends an empty object as [] when there are none. */
export type LinkParams = Record<string, string | number | boolean>;

/**
 * Where a dashboard figure or alert leads: `list` names the admin page, `path` is the API endpoint that serves it and
 * `params` its filters. Null when the viewer could not open the target (the figure stays visible).
 */
export type DashboardLink = {
  list: "bookings" | "booking" | "schedule" | "capacity" | "rounds" | "driver_reports" | "payment" | (string & {});
  path: string;
  params: LinkParams | unknown[];
};

/** A slot as the dashboard panels name it (Support\Text::slot). */
export type DashboardSlot = { slot_template_id: number; code: string; name: Translatable; start: string; end: string };

export type DashboardSummary = {
  date: string;
  timezone: string;
  is_today: boolean;
  generated_at: string;
  zone: ZoneRef | null;
  cards: {
    todays_bookings: {
      label: Translatable;
      value: number;
      workers: number;
      by_slot: (DashboardSlot & { bookings: number })[];
      link: DashboardLink | null;
    };
    pending_confirmation: {
      label: Translatable;
      /** The live queue across every service date. */
      value: number;
      for_date: number;
      /** Deadlines passed that the SLA job has not cancelled yet. */
      overdue: number;
      next_deadline: { booking_id: number; reference: string; deadline_at: string; minutes_left: number; link: DashboardLink | null } | null;
      oldest_request: {
        booking_id: number;
        reference: string;
        pending_since: string;
        waiting_minutes: number;
        link: DashboardLink | null;
      } | null;
      link: DashboardLink | null;
    };
    uncovered_visits: { label: Translatable; value: number; missing_workers: number; link: DashboardLink | null };
    on_time_rate: {
      label: Translatable;
      /** Whole percent; null before the first arrival of the day. */
      value: number | null;
      arrived: number;
      on_time: number;
      late: number;
      overdue: number;
      grace_minutes: number;
      link: DashboardLink | null;
    };
  };
  panels: {
    bookings_by_status: { status: BookingStatus; label: Translatable; bookings: number; link: DashboardLink | null }[];
    bookings_by_slot: (DashboardSlot & { bookings: number; workers: number; uncovered_visits: number; link: DashboardLink | null })[];
    bookings_by_zone: { zone_id: number; code: string; name: Translatable; bookings: number; workers: number; link: DashboardLink | null }[];
    workers: {
      total: number;
      available: number;
      absent: number;
      live_out: number;
      off: number;
      assigned: number;
      late: number;
      link: DashboardLink | null;
    };
    fleet: {
      vehicles: { total: number; active: number; maintenance: number; inactive: number; in_use: number };
      rounds: (DashboardSlot & {
        rounds: number;
        planned: number;
        departed: number;
        completed: number;
        cancelled: number;
        seats_used: number;
        seats_total: number;
        link: DashboardLink | null;
      })[];
    };
  };
  quick_stats: {
    /** Null without payments.view. */
    sales: { currency: string; captured_fils: number; payments: number; refunded_fils: number; refunds: number; net_fils: number } | null;
    occupancy: { percent: number | null; used_units: number; available_units: number };
    cancellations: { total: number; customer: number; company: number; system: number };
    /** Null until ratings exist (Phase 5). */
    rating: null | { average: number; count: number };
  };
};

export type DashboardAlertType =
  | "visit_uncovered"
  | "sla_due"
  | "visit_delayed"
  | "driver_report"
  | "auto_cancelled"
  | "payment_failed"
  | "refund_failed"
  | "payment_review"
  | "refund_review";

/** GET /admin/dashboard/alerts: urgent first, then by type order, then by time. */
export type DashboardAlert = {
  type: DashboardAlertType | (string & {});
  severity: "urgent" | "warning";
  at: string;
  title: Translatable;
  message: Translatable;
  entity: { type: string; id: number; booking_id?: number; reference?: string; ulid?: string; payment_id?: number } | null;
  link: DashboardLink | null;
  details: Record<string, unknown>;
};

export type DashboardAlerts = {
  data: DashboardAlert[];
  meta: {
    generated_at: string;
    date: string;
    timezone: string;
    zone: ZoneRef | null;
    types: string[];
    counts: Record<string, number>;
    total: number;
    urgent: number;
    limit_per_type: number;
  };
};

// ---- Phase 3: the alerts bell (app/Modules/Notification AlertResource; D-11 polling) ------------------------------

/** One in-app alert of the signed-in staff member. `title` and `body` are in the language it was raised in. */
export type AdminAlert = {
  id: string;
  event: string;
  priority: string;
  urgent: boolean;
  title: string;
  body: string;
  /** Admin web path of the entity, e.g. /admin/bookings/12. */
  link: string | null;
  entity: { type?: string; id?: number | string; ulid?: string; reference?: string } | null;
  read: boolean;
  read_at: string | null;
  created_at: string | null;
};

export type AlertsMeta = { unread_count: number; server_time: string; poll_seconds: number };

export type AlertsPage = { data: AdminAlert[]; meta: AlertsMeta & Partial<PageMeta> };

// ---- Phase 3: A03 bookings (app/Modules/Booking/Http/Resources) ----------------------------------------------------

export type BookingStatus =
  | "draft"
  | "held"
  | "pending_confirmation"
  | "confirmed"
  | "alternative_proposed"
  | "rejected"
  | "rescheduled"
  | "completed"
  | "cancelled"
  | "expired";

export type PaymentStatus =
  | "unpaid"
  | "pending"
  | "verifying"
  | "authorized"
  | "captured"
  | "partially_refunded"
  | "refunded"
  | "failed"
  | "voided";

export type BookingSource = "app" | "web" | "phone" | "whatsapp" | "admin";

export type VisitStatus =
  | "scheduled"
  | "worker_assigned"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed"
  | "no_show_customer"
  | "missed_by_company"
  | "cancelled";

export type CleaningArea = "kitchen" | "bathrooms" | "bedrooms" | "living_areas" | "balcony" | "windows";
export type PropertyType = "villa" | "apartment" | "townhouse" | "office";
export type CancelParty = "customer" | "company" | "system";

/** AdminBookingResource: one row of the A03 table. Labels come in both languages. */
export type BookingRow = {
  id: number;
  ulid: string;
  reference: string;
  kind: string;
  customer: { id: string; name: string | null; phone: string };
  service: { id: number; code: string; name: Translatable };
  service_date: string;
  slot: { id: number; code: string; name: Translatable; start: string; end: string };
  zone: { id: number; code: string; name: Translatable };
  workers_count: number;
  status: BookingStatus;
  status_label: Translatable;
  payment_status: PaymentStatus;
  payment_status_label: Translatable;
  source: BookingSource;
  source_label: Translatable;
  total_fils: number;
  currency: string;
  hold_expires_at: string | null;
  confirmation_deadline_at: string | null;
  created_at: string | null;
};

/** The address as it was when the booking was made (Geo address snapshot); `id` is the saved address's ULID. */
export type AddressSnapshot = {
  id?: string | null;
  lat?: number | null;
  lng?: number | null;
  area?: string | null;
  label?: string | null;
  street?: string | null;
  zone_id?: number | null;
  building?: string | null;
  has_pets?: boolean;
  pets_note?: string | null;
  zone_code?: string | null;
  sub_zone_id?: number | null;
  unit_number?: string | null;
  property_type?: PropertyType | (string & {}) | null;
  sub_zone_code?: string | null;
  parking_available?: boolean;
  access_instructions?: string | null;
  entry_permit_required?: boolean;
  cleaning_materials_available?: boolean;
};

/** One price line (PricingService snapshot): VAT on the line (R-07). */
export type PriceLine = {
  code: string;
  type: string;
  unit?: string | null;
  quantity: number;
  description: Translatable;
  net_fils: number;
  vat_fils: number;
  gross_fils: number;
  discount_fils?: number;
  unit_gross_fils?: number;
  gross_before_discount_fils?: number;
};

export type BookingAmounts = {
  subtotal_fils: number;
  addons_fils: number;
  discount_fils: number;
  net_fils: number;
  vat_rate_bp: number;
  vat_fils: number;
  total_fils: number;
  currency: string;
};

export type BookingVisit = {
  id: number;
  ulid: string;
  service_date: string;
  start: string;
  end: string;
  status: VisitStatus;
  status_label: Translatable;
  sub_zone_id: number | null;
  assignments: { worker_id: number; display_name: string; role: string; assigned_at: string }[];
};

export type BookingPayment = {
  id: string;
  status: PaymentStatus;
  status_label: Translatable;
  intent: string;
  gateway: string;
  gateway_payment_ref: string | null;
  method: string | null;
  amount_fils: number;
  captured_fils: number;
  refunded_fils: number;
  currency: string;
  attempts: number;
  needs_review: boolean;
  failure_code: string | null;
  authorized_at: string | null;
  captured_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string | null;
};

export type BookingHold = {
  id: string;
  status: string;
  workers: number;
  vehicle_id: number | null;
  expires_at: string | null;
  converted_at: string | null;
  expired_at: string | null;
  released_at: string | null;
  release_reason: string | null;
  created_by_override: boolean;
};

/** A status change of the booking or one of its visits (BookingStatusHistory). */
export type BookingHistoryRow = {
  id: number;
  scope: "booking" | "visit" | (string & {});
  visit_id: number | null;
  from_status: string | null;
  to_status: string;
  actor_type: "customer" | "staff" | "system" | "driver" | (string & {});
  actor_id: number | null;
  reason: string | null;
  meta: Record<string, unknown> | unknown[] | null;
  created_at: string;
};

export type BookingTimelineStep = { key: string; label: string; reached_at: string | null; current: boolean };

/** PhotoUrls::present: a temporary URL of the private photo. */
export type BookingPhoto = { id?: string; url?: string | null; thumbnail_url?: string | null; [key: string]: unknown };

export type ProposalStatus = "pending" | "accepted" | "declined" | "expired";

export type ProposalSlot = { id: number; name: Translatable | null; start: string | null; end: string | null };

/** AlternativeProposalResource::forStaff. */
export type AlternativeProposal = {
  id: string;
  proposed_by?: number | null;
  status: ProposalStatus;
  status_label: Translatable;
  note: string | null;
  options: {
    index: number;
    service_date: string | null;
    slot: ProposalSlot;
    note: string | null;
    total_fils: number;
    price_diff_fils: number;
  }[];
  expires_at: string;
  is_open: boolean;
  accepted_option: number | null;
  decided_at: string | null;
  created_at: string | null;
};

export type RescheduleRequestStatus = "pending" | "approved" | "rejected" | "auto_approved";

/** RescheduleRequestResource::forStaff (admin routes use the numeric id). */
export type RescheduleRequest = {
  id: number;
  ulid: string;
  status: RescheduleRequestStatus;
  status_label: Translatable;
  from: { service_date: string; slot: ProposalSlot };
  to: { service_date: string; slot: ProposalSlot };
  fee_fils: number;
  price_diff_fils: number;
  new_total_fils: number;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string | null;
  booking_id: number;
  booking_reference: string;
  requested_by_type: string | null;
  requested_by_id: number | null;
  reason: string | null;
  rule_applied: string | null;
  override: boolean | null;
  decided_by: number | null;
};

/** BookingNoteResource: staff only, never shown to customers. */
export type BookingNote = { id: number; body: string; author: { id: number; name: string }; created_at: string };

export type CancelReview = {
  reason_code?: string | null;
  reason_text?: string | null;
  party?: CancelParty | null;
  requested_by_type?: string | null;
  requested_at?: string | null;
  rule_applied?: string | null;
  decision?: "cancelled" | "declined" | "closed" | null;
  resolved_at?: string | null;
  decision_note?: string | null;
};

/** AdminBookingDetailResource: the A03 booking page. */
export type BookingDetail = BookingRow & {
  version: number;
  address: AddressSnapshot | null;
  priorities: CleaningArea[];
  instructions: string | null;
  materials_by: "customer" | "company";
  preferred_worker: { id: number; display_name: string } | null;
  amounts: BookingAmounts;
  lines: PriceLine[] | null;
  applied_rules: unknown[];
  coupon: { id: number; code: string; discount_fils: number } | null;
  policy_snapshot: unknown;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason_code: string | null;
  cancel_reason_text: string | null;
  cancelled_by_type: string | null;
  rejected_reason: string | null;
  expired_at: string | null;
  visits: BookingVisit[];
  hold: BookingHold | null;
  payment: BookingPayment | null;
  history: BookingHistoryRow[];
  timeline: BookingTimelineStep[];
  photos: BookingPhoto[];
  created_by_staff_id: number | null;
  confirmed_by: number | null;
  rejected_reason_code: string | null;
  cancellation: {
    party: CancelParty | null;
    cancelled_by_id: number | null;
    fee_fils: number | null;
    refund_fils: number | null;
    /** Set while a customer's cancellation waits for staff review (spec §10.4). */
    review_requested_at: string | null;
    review: CancelReview | null;
  };
  reschedule_fee_fils: number;
  reschedules_count: number;
  customer_reschedules_count: number;
  /** A capture whose provider answer was lost: confirm again (safe) or reject. */
  capture_unknown_at: string | null;
  alternative_proposals: AlternativeProposal[];
  reschedule_requests: RescheduleRequest[];
  notes: BookingNote[];
};

/** POST /admin/bookings/{id}/cancel/preview: the money plan before cancelling. */
export type CancelPreview = {
  allowed: boolean;
  mode: "release" | "refund" | (string & {});
  fee_fils: number | null;
  kept_fees_fils: number;
  refund_fils: number | null;
  paid_fils: number;
  held_fils: number;
  requires_review: boolean;
  rule_applied: string;
  explanation: Translatable;
};

export type CancelResult = {
  payment: "voided" | "refunded" | "kept" | "none" | (string & {});
  fee_fils: number;
  refund_fils: number;
  booking: BookingDetail;
};

/** POST /admin/bookings (manual booking): 201 with the booking and its payment link (null if the gateway failed). */
export type ManualBookingResult = {
  booking: BookingDetail;
  payment: { id: string; status: string; amount_fils: number; payment_link: string | null; expires_at: string | null };
};

export type PaymentLink = { payment_link: string | null; expires_at: string };

// ---- Phase 3: assignment (app/Modules/Scheduling/Assignment) ------------------------------------------------------

/** Assignment\Support\VisitSummary: a visit with its named team. */
export type VisitSummary = {
  id: number;
  ulid: string;
  version: number;
  booking: {
    id: number;
    ulid: string;
    reference: string;
    status: BookingStatus;
    status_label: Translatable;
    service_id: number;
    preferred_worker_id: number | null;
  };
  service_date: string;
  slot_template_id: number;
  start: string;
  end: string;
  zone_id: number;
  area: string | null;
  status: VisitStatus;
  status_label: Translatable;
  workers_count: number;
  assigned_count: number;
  missing: number;
  vehicle_id: number | null;
  workers: { id: number; display_name: string; full_name: Translatable; assigned_at: string }[];
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  late_minutes: number | null;
};

export type CandidateWorker = {
  id: number;
  ulid: string;
  employee_no: string;
  display_name: string;
  full_name: Translatable;
  home_zone_id: number;
};

export type CandidateReason = { code: string; label: Translatable };

export type Candidate = {
  rank: number;
  worker: CandidateWorker;
  reasons: CandidateReason[];
  preferred: boolean;
  same_zone: boolean;
  served_customer_visits: number;
  skill_match: boolean | null;
  assigned_minutes_this_week: number;
  average_rating: number | null;
};

/** A worker the rules leave out: `overridable` when only soft rules (other zone, travel buffer) apply (§8.6). */
export type ExcludedWorker = { worker: CandidateWorker; reason: CandidateReason; reasons: CandidateReason[]; overridable: boolean; rules: string[] };

/** GET /admin/visits/{id}/candidates: ranked §8.7 (top 5) and the workers left out with their reasons. */
export type VisitCandidates = {
  visit: VisitSummary;
  preferred_worker: CandidateWorker | null;
  candidates: Candidate[];
  excluded: ExcludedWorker[];
};

/** GET /admin/bookings/{id}/notifications (DeliveryLogResource): labels in the request language; never a destination. */
export type DeliveryLogItem = {
  id: string;
  event: string;
  event_label: string;
  channel: string;
  channel_label: string;
  recipient: { type: "customer" | "staff" | (string & {}); id: number; name: string | null };
  locale: string;
  priority: string;
  title: string | null;
  body: string | null;
  status: string;
  status_label: string;
  error: string | null;
  attempts: number;
  created_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
  read_at: string | null;
};

export type RefundStatus = "requested" | "processing" | "succeeded" | "failed";

/** AdminRefundResource (payments.view or refunds.create): the provider's status of one refund. */
export type AdminRefund = {
  id: number;
  ulid: string;
  amount_fils: number;
  currency: string;
  status: RefundStatus;
  status_label: Translatable;
  reason_code: string;
  reason_label: Translatable;
  reason_text: string | null;
  gateway_refund_ref: string | null;
  failure_code: string | null;
  estimated_arrival_text: Partial<Translatable> | null;
  needs_review: boolean;
  created_at: string | null;
  succeeded_at: string | null;
  failed_at: string | null;
  payment?: { id: number; ulid: string; status: PaymentStatus; payable_type: string | null; payable_id: number | null };
};

// ---- Phase 3: A04 operations schedule (app/Modules/Scheduling/Schedule/Support/ScheduleBoard.php) ----------------

export type ScheduleView = "day" | "week" | "month";

/** A worker row's day marker. `leave_type` only for viewers with leave.manage (P2-05). */
export type ScheduleMarkerCode = "rest_day" | "leave" | "live_out" | "not_on_shift" | "not_active";
export type ScheduleMarker = { code: ScheduleMarkerCode | (string & {}); label: Translatable; leave_type?: LeaveType };

/** Candidates::worker() + employment_status. */
export type ScheduleWorker = CandidateWorker & { employment_status: EmploymentStatus };

export type ScheduleSlot = {
  id: number;
  code: string;
  name: Translatable;
  start: string;
  end: string;
  service_kind: ServiceKind;
};

export type ScheduleFiltersEcho = {
  zone_id: number | null;
  service_id: number | null;
  slot_template_id: number | null;
  worker_id: number | null;
  status: VisitStatus[];
};

type ScheduleHead = {
  view: ScheduleView;
  date: string;
  from: string;
  to: string;
  timezone: string;
  filters: ScheduleFiltersEcho;
};

export type ScheduleDayCell = { date: string; markers: ScheduleMarker[]; cards: VisitSummary[] };
export type ScheduleRow = { worker: ScheduleWorker; days: ScheduleDayCell[] };

/** Day and week: one row per worker, one cell per date with her visit cards and markers, plus the unassigned lane. */
export type ScheduleGrid = ScheduleHead & {
  view: "day" | "week";
  dates: string[];
  slots: ScheduleSlot[];
  rows: ScheduleRow[];
  unassigned: VisitSummary[];
};

export type ScheduleMonthCapacity = {
  slot_template_id: number;
  code: string;
  booked_units: number;
  assigned_units: number;
  pool_units: number;
  remaining_units: number;
  /** null when nothing is booked and nothing is free (the slot cannot be sold that day). */
  used_percent: number | null;
};

export type ScheduleMonthDay = { date: string; bookings: number; visits: number; unassigned: number; capacity: ScheduleMonthCapacity[] };

export type ScheduleMonth = ScheduleHead & { view: "month"; days: ScheduleMonthDay[] };

export type ScheduleBoard = ScheduleGrid | ScheduleMonth;

/** POST /admin/schedule/validate-move (a dry run of the move). `details` is [] when the move is fine. */
export type MoveCheckResult = {
  result: "ok" | "override_possible" | "conflicts";
  conflicts: { code: string; message: string }[];
  /** Soft rules an override relaxes (override_possible): other_zone, travel_buffer. */
  rules: string[];
  can_override: boolean;
  details: Record<string, unknown> | unknown[];
};

// ---- Phase 3: A06 trip planner (app/Modules/Fleet/Http/Resources) --------------------------------------------------

export type RoundKind = "dropoff" | "pickup";
export type RoundStatus = "planned" | "departed" | "in_progress" | "completed" | "cancelled";
export type StopStatus = "pending" | "arrived" | "dropped_off" | "picked_up" | "failed";

/** RoundStop::address_snapshot; viewers without trips.manage or bookings.view get {area} only. */
export type StopAddress = AddressSnapshot;

/** RoundPresenter::stop(). Times are UTC instants plus the local "HH:MM". */
export type RoundStop = {
  id: number;
  sequence: number;
  status: StopStatus;
  status_label: Translatable;
  visit_id: number;
  visit_status: VisitStatus;
  booking: { id: number; reference: string; status: BookingStatus; workers_count: number };
  address: StopAddress | null;
  slot_start: string;
  slot_end: string;
  planned_eta: string | null;
  eta_local: string | null;
  /** Drop-off: minutes after the slot start (0 when on time); null on a pickup. */
  late_by_minutes: number | null;
  /** Pickup: minutes the team waits after its slot end; null on a drop-off. */
  wait_minutes: number | null;
  arrived_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  done: boolean;
  workers: { id: number; display_name: string }[];
};

export type RoundPassenger = { seat_no: number; worker_id: number; display_name: string; full_name: Translatable; visit_id: number | null };

export type RoundWarningType =
  | "no_driver"
  | "driver_inactive"
  | "vehicle_unavailable"
  | "seats_exceeded"
  | "late_stop"
  | "visit_not_ready"
  | "visit_closed"
  | "visit_moved"
  | "team_not_aboard"
  | "passenger_not_on_team"
  | "seats_on_other_vehicle"
  | "driver_action_failed"
  | "pickup_late"
  | "ride_clash"
  | "action_backdated";

/** Support\RoundWarnings: a type, its details (stop_id/sequence where it is about one stop) and a message in both languages. */
export type RoundWarning = {
  type: RoundWarningType | (string & {});
  message: Translatable;
  stop_id?: number;
  sequence?: number;
  visit_id?: number;
  late_by_minutes?: number;
  wait_minutes?: number;
  allowed_late_minutes?: number;
  eta_local?: string;
  [key: string]: unknown;
};

export type RoundAction = {
  id: number;
  action: "depart" | "arrive" | "dropoff" | "pickup" | (string & {});
  stop_id: number | null;
  status: string;
  occurred_at: string;
  recorded_at: string;
  undo_until: string | null;
  result: unknown;
};

/** RoundPresenter: a round as the trip planner reads it. `version` goes back as If-Match. */
export type Round = {
  id: number;
  ulid: string;
  date: string;
  kind: RoundKind;
  kind_label: Translatable;
  status: RoundStatus;
  status_label: Translatable;
  slot: { id: number; code: string; name: Translatable; start: string; end: string };
  zone: { id: number; code: string; name: Translatable } | null;
  vehicle: { id: number; plate_no: string; model: string | null; seats: number; status: VehicleStatus };
  driver: { id: number; name: string; phone: string | null; status: DriverStatus } | null;
  planned_depart_at: string;
  depart_local: string;
  planned_end_at: string;
  end_local: string;
  published: boolean;
  published_at: string | null;
  departed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  seats: { total: number; used: number; free: number };
  stops: RoundStop[];
  passengers: RoundPassenger[];
  last_action: RoundAction | null;
  warnings: RoundWarning[];
  version: number;
  created_at: string | null;
  updated_at: string | null;
};

export type UnplannedReason =
  | "booking_not_confirmed"
  | "workers_not_assigned"
  | "no_vehicle"
  | "vehicle_unavailable"
  | "round_underway"
  | "seats_full"
  | "resource_conflict"
  | "visit_already_on_round"
  | "passenger_conflict"
  | "visit_underway"
  | "visit_moved"
  | "visit_closed"
  | "visit_completed";

export type UnplannedVisit = {
  visit_id: number;
  booking_id: number;
  booking_reference: string;
  kind: RoundKind | null;
  reason: UnplannedReason | (string & {});
  details: Record<string, unknown> | unknown[];
  message: Translatable;
};

/** POST /admin/rounds/plan: the rounds it created or extended, the visits it could not place and why. */
export type PlanResult = {
  date: string;
  slot_template_id: number;
  rounds: (Round & { plan: "created" | "extended" | null })[];
  unplanned: UnplannedVisit[];
  already_planned: { visit_id: number; kind: RoundKind; round_id: number }[];
};

export type DriverReportType = "delay" | "cannot_reach" | "vehicle_issue" | "other";
export type DriverReportStatus = "open" | "acknowledged" | "resolved";

/** DriverReportResource (§18 D03): the stop by its area only. */
export type DriverReport = {
  id: number;
  type: DriverReportType;
  type_label: Translatable;
  status: DriverReportStatus;
  status_label: Translatable;
  reason: string | null;
  eta_delay_min: number | null;
  round: {
    id: number;
    date: string;
    kind: RoundKind;
    slot_template_id: number;
    slot_code: string;
    vehicle: { id: number; plate_no: string };
  };
  stop: { id: number; sequence: number; visit_id: number; area: string | null } | null;
  driver: { id: number; name: string };
  handled_by: { id: number; name: string } | null;
  handled_at: string | null;
  handled_note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

// ---- Phase 3: public pages -----------------------------------------------------------------------------------------

/** POST /public/zones/check. */
export type ZoneCheck = { in_service_area: boolean; zone: { code: string; name: string } | null };

/** GET /public/config: support contacts may be unset (null). */
export type PublicConfig = {
  support: { phone: string | null; whatsapp: string | null; email: string | null };
  default_locale?: string;
  currency?: string;
  timezone?: string;
};
