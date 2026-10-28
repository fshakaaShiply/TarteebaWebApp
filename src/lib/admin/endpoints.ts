import { adminApi, backgroundPoll, unwrap, type ReadOptions } from "./client";
import { withForce, type ForceInput, type OverridePayload } from "./ops/capacity";
import type { DriverPayload, VehiclePayload } from "./ops/fleet";
import type { BlackoutPayload, SlotRulePayload, SlotTemplatePayload } from "./ops/scheduling";
import type { LeaveRequestPayload, WorkerPayload } from "./ops/workforce";
import type {
  Addon,
  AddonPer,
  AdminAlert,
  AdminCreditNote,
  AdminCreditNoteDetail,
  AdminInvoice,
  AdminInvoiceDetail,
  AdminPayment,
  AdminPaymentDetail,
  AdminRefund,
  AlertsPage,
  BillingDocument,
  BillingRefusal,
  BillingRetryResult,
  CreateRefundPayload,
  DocumentUrl,
  FinanceSummary,
  InvoiceStatus,
  NotificationAudience,
  NotificationChannel,
  NotificationTemplate,
  RefundReason,
  RefundStatus,
  TemplatePreview,
  AlternativeProposal,
  BlackoutDate,
  BookingDetail,
  BookingNote,
  BookingRow,
  BookingSource,
  BookingStatus,
  CancelPreview,
  CancelResult,
  AddonOption,
  AlternativesPreview,
  CustomerLookup,
  DriverOption,
  ManualBookingPreview,
  ReschedulePreview,
  SlotTemplateOption,
  CleaningArea,
  DashboardAlerts,
  DashboardSummary,
  DeliveryLogItem,
  DriverReport,
  DriverReportStatus,
  DriverReportType,
  ManualBookingResult,
  MoveCheckResult,
  PaymentLink,
  PaymentStatus,
  PlanResult,
  PropertyType,
  RescheduleRequest,
  Round,
  RoundKind,
  RoundStatus,
  ScheduleBoard,
  ScheduleView,
  VisitCandidates,
  VisitSummary,
  ZoneCheck,
  CapacityOverrideResult,
  CapacityView,
  CatalogPackage,
  CatalogPreview,
  CatalogService,
  Coupon,
  CouponAppliesTo,
  DataEnvelope,
  DiscountType,
  Driver,
  DriverCandidate,
  DriverStatus,
  EmploymentStatus,
  GeoPolygon,
  LeaveStatus,
  LiveOutPlan,
  LiveOutPlanKind,
  MaterialsMode,
  Paginated,
  Permission,
  Policy,
  PolicyRules,
  PolicyType,
  PriceUnit,
  PublicService,
  Role,
  ServiceKind,
  ServiceOption,
  ServicePrice,
  Setting,
  ShiftRow,
  Skill,
  SlotRule,
  SlotTemplate,
  StaffMe,
  StaffUser,
  SubZone,
  Translatable,
  TwoFactorSetup,
  Vehicle,
  VehicleStatus,
  Worker,
  WorkerLeave,
  Zone,
  ZoneOption,
} from "./types";

/*
 * Admin endpoints used by A01, A11 and A13. Each call goes through the typed openapi-fetch client and
 * returns the unwrapped `data`, or throws AdminApiError. Versioned edits send the loaded version as If-Match
 * (decision P1-04): a mismatch is 409 STALE_VERSION.
 */

const ifMatch = (version: number) => ({ "If-Match": String(version) });

// A01 sign-in and session

export type LoginInput = { email: string; password: string; code?: string };

export async function login(input: LoginInput): Promise<StaffMe> {
  const body = await unwrap<DataEnvelope<StaffMe>>(adminApi.POST("/v1/admin/auth/login", { body: input }));
  return body.data;
}

export async function logout(): Promise<void> {
  await unwrap(adminApi.POST("/v1/admin/auth/logout"));
}

export async function requestPasswordReset(email: string): Promise<void> {
  await unwrap(adminApi.POST("/v1/admin/auth/forgot", { body: { email } }));
}

export type ResetPasswordInput = { email: string; token: string; password: string; password_confirmation: string };

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  await unwrap(adminApi.POST("/v1/admin/auth/reset", { body: input }));
}

export async function fetchMe(): Promise<StaffMe> {
  const body = await unwrap<DataEnvelope<StaffMe>>(adminApi.GET("/v1/admin/me"));
  return body.data;
}

export async function startTwoFactor(password: string): Promise<TwoFactorSetup> {
  const body = await unwrap<DataEnvelope<TwoFactorSetup>>(adminApi.POST("/v1/admin/me/two-factor", { body: { password } }));
  return body.data;
}

export async function confirmTwoFactor(code: string): Promise<StaffMe> {
  const body = await unwrap<DataEnvelope<StaffMe>>(
    adminApi.POST("/v1/admin/me/two-factor/confirm", { body: { code } }),
  );
  return body.data;
}

export async function disableTwoFactor(password: string, code: string): Promise<StaffMe> {
  // The OpenAPI document lists these as query parameters; they go in the JSON body so the password never appears
  // in a URL or an access log (Laravel reads both).
  const body = await unwrap<DataEnvelope<StaffMe>>(
    adminApi.DELETE("/v1/admin/me/two-factor", { body: { password, code } } as never),
  );
  return body.data;
}

// A11 global settings

export async function fetchSettings(): Promise<Setting[]> {
  const body = await unwrap<DataEnvelope<Setting[]>>(adminApi.GET("/v1/admin/settings"));
  return body.data;
}

export type SettingUpdateResult = Pick<Setting, "key" | "value" | "type" | "version">;

export async function updateSetting(
  key: string,
  value: unknown,
  reason: string,
  version: number,
): Promise<SettingUpdateResult> {
  const body = await unwrap<DataEnvelope<SettingUpdateResult>>(
    adminApi.PUT("/v1/admin/settings/{key}", {
      params: { path: { key } },
      // `value` is any JSON value for the setting's type (the generated schema says string).
      body: { value, reason, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// A13 staff users and roles

export type StaffUserQuery = { search?: string; role?: string; status?: "active" | "suspended"; page?: number; perPage?: number };

export async function fetchStaffUsers(q: StaffUserQuery): Promise<Paginated<StaffUser>> {
  return unwrap<Paginated<StaffUser>>(
    adminApi.GET("/v1/admin/staff-users", {
      params: {
        query: {
          search: q.search || undefined,
          role: q.role || undefined,
          status: q.status || undefined,
          page: q.page,
          per_page: q.perPage,
        },
      },
    }),
  );
}

export async function fetchStaffUser(id: number): Promise<StaffUser> {
  const body = await unwrap<DataEnvelope<StaffUser>>(
    adminApi.GET("/v1/admin/staff-users/{staffUser}", { params: { path: { staffUser: id } } }),
  );
  return body.data;
}

export type InviteStaffInput = { name: string; email: string; phone?: string | null; locale: "ar" | "en"; roles: string[] };

export async function inviteStaffUser(input: InviteStaffInput): Promise<StaffUser> {
  const body = await unwrap<DataEnvelope<StaffUser>>(adminApi.POST("/v1/admin/staff-users", { body: input }));
  return body.data;
}

export type UpdateStaffInput = { name?: string; phone?: string | null; locale?: "ar" | "en" };

export async function updateStaffUser(id: number, input: UpdateStaffInput, version: number): Promise<StaffUser> {
  const body = await unwrap<DataEnvelope<StaffUser>>(
    adminApi.PATCH("/v1/admin/staff-users/{staffUser}", {
      params: { path: { staffUser: id } },
      body: { ...input, version },
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function setStaffUserRoles(id: number, roles: string[], version: number): Promise<StaffUser> {
  const body = await unwrap<DataEnvelope<StaffUser>>(
    adminApi.PUT("/v1/admin/staff-users/{staffUser}/roles", {
      params: { path: { staffUser: id } },
      body: { roles, version },
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function suspendStaffUser(id: number, reason: string): Promise<StaffUser> {
  const body = await unwrap<DataEnvelope<StaffUser>>(
    adminApi.POST("/v1/admin/staff-users/{staffUser}/suspend", {
      params: { path: { staffUser: id } },
      body: { reason },
    }),
  );
  return body.data;
}

export async function activateStaffUser(id: number, reason?: string): Promise<StaffUser> {
  const body = await unwrap<DataEnvelope<StaffUser>>(
    adminApi.POST("/v1/admin/staff-users/{staffUser}/activate", {
      params: { path: { staffUser: id } },
      body: { reason: reason || null },
    }),
  );
  return body.data;
}

export async function fetchRoles(): Promise<Role[]> {
  const body = await unwrap<DataEnvelope<Role[]>>(adminApi.GET("/v1/admin/roles"));
  return body.data;
}

export async function fetchPermissions(): Promise<Permission[]> {
  const body = await unwrap<DataEnvelope<Permission[]>>(adminApi.GET("/v1/admin/permissions"));
  return body.data;
}

// A11 catalog (permission catalog.manage). Every write accepts an audit `reason`; edits send the loaded version as
// If-Match and in the body (P1-04). The generated schema types several bodies loosely (translatable fields as
// strings, visits_per_week as string literals), so the bodies below are typed here and passed `as never`.

/** Page-based list query shared by the A11 tables (AdminListRequest). */
export type CatalogListQuery = {
  page?: number;
  perPage?: number;
  kind?: string;
  type?: string;
  serviceId?: number;
  isActive?: boolean;
  search?: string;
};

function listQuery(q: CatalogListQuery) {
  return {
    page: q.page,
    per_page: q.perPage,
    kind: q.kind || undefined,
    type: q.type || undefined,
    service_id: q.serviceId,
    is_active: q.isActive === undefined ? undefined : q.isActive ? ("1" as const) : ("0" as const),
    search: q.search || undefined,
  };
}

/** Admin selects need every row: walks the pages (100 per page, at most 20 pages). */
async function fetchAllPages<T>(load: (page: number) => Promise<Paginated<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const result = await load(page);
    out.push(...result.data);
    if (page >= result.meta.last_page) break;
  }
  return out;
}

const OPTIONS_PAGE = 100;

/** Fields every catalog write may carry besides the record fields. */
export type WriteMeta = { reason?: string | null };

// Services

export type ServicePayload = {
  code?: string;
  kind?: ServiceKind;
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
};

export async function fetchServices(q: CatalogListQuery): Promise<Paginated<CatalogService>> {
  return unwrap<Paginated<CatalogService>>(adminApi.GET("/v1/admin/services", { params: { query: listQuery(q) } }));
}

export async function fetchAllServices(): Promise<CatalogService[]> {
  return fetchAllPages((page) => fetchServices({ page, perPage: OPTIONS_PAGE }));
}

/**
 * GET /admin/services/options: every service's code, name, kind and state, for pickers on pages without catalog.manage
 * (worker eligibility, capacity, scheduling filters). Not paginated.
 */
export async function fetchServiceOptions(): Promise<ServiceOption[]> {
  const body = await unwrap<DataEnvelope<ServiceOption[]>>(adminApi.GET("/v1/admin/services/options"));
  return body.data;
}

export async function fetchService(id: number): Promise<CatalogService> {
  const body = await unwrap<DataEnvelope<CatalogService>>(
    adminApi.GET("/v1/admin/services/{service}", { params: { path: { service: id } } }),
  );
  return body.data;
}

/** Create sends the identity (code, kind are fixed afterwards) and the essentials; the rest has API defaults. */
export type ServiceCreatePayload = Pick<
  ServicePayload,
  "name" | "duration_minutes" | "min_workers" | "max_workers" | "materials_mode" | "is_active" | "is_bookable_online"
> & { code: string; kind: ServiceKind };

export async function createService(input: ServiceCreatePayload & WriteMeta): Promise<CatalogService> {
  const body = await unwrap<DataEnvelope<CatalogService>>(adminApi.POST("/v1/admin/services", { body: input as never }));
  return body.data;
}

export async function updateService(
  id: number,
  input: Partial<ServicePayload> & WriteMeta,
  version: number,
): Promise<CatalogService> {
  const body = await unwrap<DataEnvelope<CatalogService>>(
    adminApi.PATCH("/v1/admin/services/{service}", {
      params: { path: { service: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** GET /public/services: what customers see now (only active, bookable-online services), in the UI language. */
export async function fetchPublicServices(): Promise<PublicService[]> {
  const body = await unwrap<DataEnvelope<PublicService[]>>(adminApi.GET("/v1/public/services"));
  return body.data;
}

// Price matrix rows

export type ServicePricePayload = {
  service_id?: number;
  zone_id: number | null;
  /** One slot template only (e.g. evenings dearer); null = every slot. */
  slot_template_id: number | null;
  day_of_week: number | null;
  valid_from: string | null;
  valid_to: string | null;
  unit: PriceUnit;
  amount_fils: number;
  vat_inclusive: boolean;
  priority: number;
};

export async function createServicePrice(input: ServicePricePayload & WriteMeta): Promise<ServicePrice> {
  const body = await unwrap<DataEnvelope<ServicePrice>>(adminApi.POST("/v1/admin/service-prices", { body: input as never }));
  return body.data;
}

export async function updateServicePrice(
  id: number,
  input: ServicePricePayload & WriteMeta,
  version: number,
): Promise<ServicePrice> {
  const body = await unwrap<DataEnvelope<ServicePrice>>(
    adminApi.PATCH("/v1/admin/service-prices/{price}", {
      params: { path: { price: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** Soft delete (the row stays for audit and booking snapshots). */
export async function deleteServicePrice(id: number, version: number, reason: string): Promise<void> {
  await unwrap(
    adminApi.DELETE("/v1/admin/service-prices/{price}", {
      params: { path: { price: id } },
      // The OpenAPI document has no body for this DELETE; Laravel reads `version` and `reason` from it.
      body: { version, reason },
      headers: ifMatch(version),
    } as never),
  );
}

/** One proposed price change for the preview: an edited or deleted row (`id`), or a new row (no `id`). */
export type PreviewPriceChange = Partial<ServicePricePayload> & { id?: number; delete?: boolean };

export type CatalogPreviewRequest = {
  service_code: string;
  service?: Partial<ServicePayload>;
  prices?: PreviewPriceChange[];
};

/** POST /admin/catalog/preview: validates the proposal like the real endpoints and saves nothing. */
export async function previewCatalog(request: CatalogPreviewRequest): Promise<CatalogPreview> {
  const body = await unwrap<DataEnvelope<CatalogPreview>>(
    adminApi.POST("/v1/admin/catalog/preview", { body: request as never }),
  );
  return body.data;
}

// Packages

export type PackagePayload = {
  service_id?: number;
  code?: string;
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
};

export async function fetchPackages(q: CatalogListQuery): Promise<Paginated<CatalogPackage>> {
  return unwrap<Paginated<CatalogPackage>>(adminApi.GET("/v1/admin/packages", { params: { query: listQuery(q) } }));
}

export async function fetchAllPackages(): Promise<CatalogPackage[]> {
  return fetchAllPages((page) => fetchPackages({ page, perPage: OPTIONS_PAGE }));
}

export async function createPackage(input: PackagePayload & WriteMeta): Promise<CatalogPackage> {
  const body = await unwrap<DataEnvelope<CatalogPackage>>(adminApi.POST("/v1/admin/packages", { body: input as never }));
  return body.data;
}

export async function updatePackage(id: number, input: PackagePayload & WriteMeta, version: number): Promise<CatalogPackage> {
  const body = await unwrap<DataEnvelope<CatalogPackage>>(
    adminApi.PATCH("/v1/admin/packages/{package}", {
      params: { path: { package: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// Live-out plans

export type LiveOutPlanPayload = {
  service_id?: number;
  code?: string;
  name: Translatable;
  kind: LiveOutPlanKind;
  service_days_per_month: number;
  rest_days_per_week: number;
  work_hours: number;
  break_minutes: number;
  window_start: string;
  window_end: string;
  price_fils: number | null;
  vat_inclusive: boolean;
  max_active_contracts: number | null;
  is_active: boolean;
  sort_order: number;
};

export async function fetchLiveOutPlans(q: CatalogListQuery): Promise<Paginated<LiveOutPlan>> {
  return unwrap<Paginated<LiveOutPlan>>(adminApi.GET("/v1/admin/live-out-plans", { params: { query: listQuery(q) } }));
}

export async function createLiveOutPlan(input: LiveOutPlanPayload & WriteMeta): Promise<LiveOutPlan> {
  const body = await unwrap<DataEnvelope<LiveOutPlan>>(adminApi.POST("/v1/admin/live-out-plans", { body: input as never }));
  return body.data;
}

export async function updateLiveOutPlan(
  id: number,
  input: LiveOutPlanPayload & WriteMeta,
  version: number,
): Promise<LiveOutPlan> {
  const body = await unwrap<DataEnvelope<LiveOutPlan>>(
    adminApi.PATCH("/v1/admin/live-out-plans/{plan}", {
      params: { path: { plan: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// Add-ons

export type AddonPayload = {
  code?: string;
  name: Translatable;
  amount_fils: number;
  vat_inclusive: boolean;
  per: AddonPer;
  is_active: boolean;
  sort_order: number;
};

export async function fetchAddons(q: CatalogListQuery): Promise<Paginated<Addon>> {
  return unwrap<Paginated<Addon>>(adminApi.GET("/v1/admin/addons", { params: { query: listQuery(q) } }));
}

export async function createAddon(input: AddonPayload & WriteMeta): Promise<Addon> {
  const body = await unwrap<DataEnvelope<Addon>>(adminApi.POST("/v1/admin/addons", { body: input as never }));
  return body.data;
}

export async function updateAddon(id: number, input: AddonPayload & WriteMeta, version: number): Promise<Addon> {
  const body = await unwrap<DataEnvelope<Addon>>(
    adminApi.PATCH("/v1/admin/addons/{addon}", {
      params: { path: { addon: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// Coupons

export type CouponPayload = {
  code?: string;
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
};

export async function fetchCoupons(q: CatalogListQuery): Promise<Paginated<Coupon>> {
  return unwrap<Paginated<Coupon>>(adminApi.GET("/v1/admin/coupons", { params: { query: listQuery(q) } }));
}

export async function createCoupon(input: CouponPayload & WriteMeta): Promise<Coupon> {
  const body = await unwrap<DataEnvelope<Coupon>>(adminApi.POST("/v1/admin/coupons", { body: input as never }));
  return body.data;
}

export async function updateCoupon(id: number, input: CouponPayload & WriteMeta, version: number): Promise<Coupon> {
  const body = await unwrap<DataEnvelope<Coupon>>(
    adminApi.PATCH("/v1/admin/coupons/{coupon}", {
      params: { path: { coupon: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// Policies

export type PolicyPayload = {
  code?: string;
  type?: PolicyType;
  name: Translatable;
  rules: PolicyRules;
  is_active: boolean;
};

export async function fetchPolicies(q: CatalogListQuery): Promise<Paginated<Policy>> {
  return unwrap<Paginated<Policy>>(adminApi.GET("/v1/admin/policies", { params: { query: listQuery(q) } }));
}

export async function fetchAllPolicies(): Promise<Policy[]> {
  return fetchAllPages((page) => fetchPolicies({ page, perPage: OPTIONS_PAGE }));
}

export async function createPolicy(input: PolicyPayload & WriteMeta): Promise<Policy> {
  const body = await unwrap<DataEnvelope<Policy>>(adminApi.POST("/v1/admin/policies", { body: input as never }));
  return body.data;
}

export async function updatePolicy(id: number, input: PolicyPayload & WriteMeta, version: number): Promise<Policy> {
  const body = await unwrap<DataEnvelope<Policy>>(
    adminApi.PATCH("/v1/admin/policies/{policy}", {
      params: { path: { policy: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// A11 zones and sub-zones (catalog.manage, P1-05). Polygons are GeoJSON geometries; the API checks their shape
// (422 POLYGON_INVALID with details.reason) and that sub-zones lie inside their zone (422 SUB_ZONE_OUTSIDE_ZONE).

export type ZonePayload = {
  code: string;
  name: Translatable;
  polygon: GeoPolygon;
  default_travel_buffer_min: number | null;
  sort_order: number;
  is_active?: boolean;
};

export type SubZonePayload = {
  code: string;
  name: Translatable;
  polygon: GeoPolygon;
  is_active?: boolean;
};

export async function fetchZones(q: { page?: number; perPage?: number; isActive?: boolean }): Promise<Paginated<Zone>> {
  return unwrap<Paginated<Zone>>(
    adminApi.GET("/v1/admin/zones", {
      params: {
        query: {
          page: q.page,
          per_page: q.perPage,
          is_active: q.isActive === undefined ? undefined : q.isActive ? 1 : 0,
        } as never,
      },
    }),
  );
}

/**
 * GET /admin/zones/options: every zone's code, name and state (no polygons), for pickers and names on any page that
 * works with zones. Not paginated.
 */
export async function fetchZoneOptions(): Promise<ZoneOption[]> {
  const body = await unwrap<DataEnvelope<ZoneOption[]>>(adminApi.GET("/v1/admin/zones/options"));
  return body.data;
}

export async function fetchZone(id: number): Promise<Zone> {
  const body = await unwrap<DataEnvelope<Zone>>(adminApi.GET("/v1/admin/zones/{zone}", { params: { path: { zone: id } } }));
  return body.data;
}

export async function createZone(input: ZonePayload & WriteMeta): Promise<Zone> {
  const body = await unwrap<DataEnvelope<Zone>>(adminApi.POST("/v1/admin/zones", { body: input as never }));
  return body.data;
}

export async function updateZone(id: number, input: Partial<ZonePayload> & WriteMeta, version: number): Promise<Zone> {
  const body = await unwrap<DataEnvelope<Zone>>(
    adminApi.PATCH("/v1/admin/zones/{zone}", {
      params: { path: { zone: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** Takes the zone out of service (zones are never deleted). */
export async function deactivateZone(id: number, version: number, reason: string): Promise<Zone> {
  const body = await unwrap<DataEnvelope<Zone>>(
    adminApi.POST("/v1/admin/zones/{zone}/deactivate", {
      params: { path: { zone: id } },
      body: { version, reason },
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function createSubZone(zoneId: number, input: SubZonePayload & WriteMeta): Promise<SubZone> {
  const body = await unwrap<DataEnvelope<SubZone>>(
    adminApi.POST("/v1/admin/zones/{zone}/sub-zones", { params: { path: { zone: zoneId } }, body: input as never }),
  );
  return body.data;
}

export async function updateSubZone(
  id: number,
  input: Partial<SubZonePayload> & WriteMeta,
  version: number,
): Promise<SubZone> {
  const body = await unwrap<DataEnvelope<SubZone>>(
    adminApi.PATCH("/v1/admin/sub-zones/{subZone}", {
      params: { path: { subZone: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// ---- Phase 2 ------------------------------------------------------------------------------------------------------
// Workforce and fleet changes that could leave reserved capacity short answer 409 CAPACITY_SHORTFALL; staff with
// capacity.override may send them again with `force` (a reason of at least 10 characters), see lib/admin/ops/capacity.
// The generated schema types these resources loosely, so bodies are typed here and passed `as never`.

/** Drops empty filters so the query string only carries what is set. */
function compact<T extends Record<string, unknown>>(query: T): T {
  return Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;
}

// A05 workers (workers.view to read, workers.manage to write, leave.manage for leave)

export type WorkerListQuery = {
  page?: number;
  perPage?: number;
  zoneId?: number;
  status?: EmploymentStatus | "";
  serviceId?: number;
  skill?: string;
  search?: string;
};

export async function fetchWorkers(q: WorkerListQuery): Promise<Paginated<Worker>> {
  return unwrap<Paginated<Worker>>(
    adminApi.GET("/v1/admin/workers", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          zone_id: q.zoneId,
          status: q.status,
          service_id: q.serviceId,
          skill: q.skill,
          search: q.search?.trim(),
        }) as never,
      },
    }),
  );
}

export async function fetchAllWorkers(): Promise<Worker[]> {
  return fetchAllPages((page) => fetchWorkers({ page, perPage: OPTIONS_PAGE }));
}

export async function fetchWorker(id: number): Promise<Worker> {
  const body = await unwrap<DataEnvelope<Worker>>(adminApi.GET("/v1/admin/workers/{worker}", { params: { path: { worker: id } } }));
  return body.data;
}

export async function createWorker(input: WorkerPayload): Promise<Worker> {
  const body = await unwrap<DataEnvelope<Worker>>(adminApi.POST("/v1/admin/workers", { body: input as never }));
  return body.data;
}

export async function updateWorker(id: number, input: Partial<WorkerPayload>, version: number, force?: ForceInput | null): Promise<Worker> {
  const body = await unwrap<DataEnvelope<Worker>>(
    adminApi.PATCH("/v1/admin/workers/{worker}", {
      params: { path: { worker: id } },
      body: withForce({ ...input, version }, force) as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** The whole week (seven rows) and, optionally, a new weekly rest day so both change together. */
export async function updateWorkerShifts(
  id: number,
  input: { shifts: ShiftRow[]; weekly_rest_day?: number },
  version: number,
  force?: ForceInput | null,
): Promise<Worker> {
  const body = await unwrap<DataEnvelope<Worker>>(
    adminApi.PUT("/v1/admin/workers/{worker}/shifts", {
      params: { path: { worker: id } },
      body: withForce({ ...input, version }, force) as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** The full list of eligible services; an empty list removes them all. */
export async function setWorkerServices(id: number, serviceIds: number[], version: number, force?: ForceInput | null): Promise<Worker> {
  const body = await unwrap<DataEnvelope<Worker>>(
    adminApi.PUT("/v1/admin/workers/{worker}/services", {
      params: { path: { worker: id } },
      body: withForce({ service_ids: serviceIds, version }, force) as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function setWorkerSkills(id: number, skillIds: number[], version: number): Promise<Worker> {
  const body = await unwrap<DataEnvelope<Worker>>(
    adminApi.PUT("/v1/admin/workers/{worker}/skills", {
      params: { path: { worker: id } },
      body: { skill_ids: skillIds, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** GET /admin/skills (workers.view): the skill catalogue, not paginated. */
export async function fetchSkills(): Promise<Skill[]> {
  const body = await unwrap<DataEnvelope<Skill[]>>(adminApi.GET("/v1/admin/skills"));
  return body.data;
}

export type LeaveListQuery = { page?: number; perPage?: number; status?: LeaveStatus | ""; from?: string; to?: string };

export async function fetchWorkerLeaves(workerId: number, q: LeaveListQuery): Promise<Paginated<WorkerLeave>> {
  return unwrap<Paginated<WorkerLeave>>(
    adminApi.GET("/v1/admin/workers/{worker}/leaves", {
      params: {
        path: { worker: workerId },
        query: compact({ page: q.page, per_page: q.perPage, status: q.status, from: q.from, to: q.to }) as never,
      },
    }),
  );
}

export async function requestLeave(workerId: number, input: LeaveRequestPayload): Promise<WorkerLeave> {
  const body = await unwrap<DataEnvelope<WorkerLeave>>(
    adminApi.POST("/v1/admin/workers/{worker}/leaves", { params: { path: { worker: workerId } }, body: input as never }),
  );
  return body.data;
}

/** Approve (note optional): writes the leave's whole-day blocks; may answer RESOURCE_CONFLICT or CAPACITY_SHORTFALL. */
export async function approveLeave(id: number, note: string | null, version: number, force?: ForceInput | null): Promise<WorkerLeave> {
  const body = await unwrap<DataEnvelope<WorkerLeave>>(
    adminApi.POST("/v1/admin/leaves/{leave}/approve", {
      params: { path: { leave: id } },
      body: withForce({ note, version }, force) as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function rejectLeave(id: number, note: string, version: number): Promise<WorkerLeave> {
  const body = await unwrap<DataEnvelope<WorkerLeave>>(
    adminApi.POST("/v1/admin/leaves/{leave}/reject", {
      params: { path: { leave: id } },
      body: { note, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function cancelLeave(id: number, note: string, version: number): Promise<WorkerLeave> {
  const body = await unwrap<DataEnvelope<WorkerLeave>>(
    adminApi.POST("/v1/admin/leaves/{leave}/cancel", {
      params: { path: { leave: id } },
      body: { note, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// A06 vehicles (fleet.manage, readable with schedule.view) and drivers (fleet.manage)

export type FleetListQuery = { page?: number; perPage?: number; status?: VehicleStatus | DriverStatus | ""; zoneId?: number; search?: string };

export async function fetchVehicles(q: FleetListQuery): Promise<Paginated<Vehicle>> {
  return unwrap<Paginated<Vehicle>>(
    adminApi.GET("/v1/admin/vehicles", {
      params: {
        query: compact({ page: q.page, per_page: q.perPage, status: q.status, zone_id: q.zoneId, search: q.search?.trim() }) as never,
      },
    }),
  );
}

export async function fetchAllVehicles(): Promise<Vehicle[]> {
  return fetchAllPages((page) => fetchVehicles({ page, perPage: OPTIONS_PAGE }));
}

export async function createVehicle(input: VehiclePayload): Promise<Vehicle> {
  const body = await unwrap<DataEnvelope<Vehicle>>(adminApi.POST("/v1/admin/vehicles", { body: input as never }));
  return body.data;
}

export async function updateVehicle(id: number, input: Partial<VehiclePayload>, version: number, force?: ForceInput | null): Promise<Vehicle> {
  const body = await unwrap<DataEnvelope<Vehicle>>(
    adminApi.PATCH("/v1/admin/vehicles/{vehicle}", {
      params: { path: { vehicle: id } },
      body: withForce({ ...input, version }, force) as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function fetchDrivers(q: FleetListQuery): Promise<Paginated<Driver>> {
  return unwrap<Paginated<Driver>>(
    adminApi.GET("/v1/admin/drivers", {
      params: { query: compact({ page: q.page, per_page: q.perPage, status: q.status, search: q.search?.trim() }) as never },
    }),
  );
}

export async function fetchAllDrivers(): Promise<Driver[]> {
  return fetchAllPages((page) => fetchDrivers({ page, perPage: OPTIONS_PAGE }));
}

/** The staff account must hold the driver role (422 NOT_A_DRIVER otherwise). */
export async function createDriver(input: DriverPayload): Promise<Driver> {
  const body = await unwrap<DataEnvelope<Driver>>(adminApi.POST("/v1/admin/drivers", { body: input as never }));
  return body.data;
}

export async function updateDriver(id: number, input: Omit<DriverPayload, "staff_user_id">, version: number): Promise<Driver> {
  const body = await unwrap<DataEnvelope<Driver>>(
    adminApi.PATCH("/v1/admin/drivers/{driver}", {
      params: { path: { driver: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** GET /admin/drivers/candidates (fleet.manage): the staff accounts a new driver can be linked to. */
export async function fetchDriverCandidates(): Promise<DriverCandidate[]> {
  const body = await unwrap<DataEnvelope<DriverCandidate[]>>(adminApi.GET("/v1/admin/drivers/candidates"));
  return body.data;
}

// A11 scheduling (catalog.manage): slot templates, slot rules, blackout dates

export type SchedulingListQuery = {
  page?: number;
  perPage?: number;
  serviceKind?: string;
  isActive?: boolean;
  slotTemplateId?: number;
  zoneId?: number;
  serviceId?: number;
  source?: "admin" | "override" | "";
  from?: string;
  to?: string;
};

function schedulingQuery(q: SchedulingListQuery) {
  return compact({
    page: q.page,
    per_page: q.perPage,
    service_kind: q.serviceKind,
    is_active: q.isActive === undefined ? undefined : q.isActive ? "1" : "0",
    slot_template_id: q.slotTemplateId,
    zone_id: q.zoneId,
    service_id: q.serviceId,
    source: q.source,
    from: q.from,
    to: q.to,
  }) as never;
}

export async function fetchSlotTemplates(q: SchedulingListQuery): Promise<Paginated<SlotTemplate>> {
  return unwrap<Paginated<SlotTemplate>>(adminApi.GET("/v1/admin/slot-templates", { params: { query: schedulingQuery(q) } }));
}

export async function fetchAllSlotTemplates(): Promise<SlotTemplate[]> {
  return fetchAllPages((page) => fetchSlotTemplates({ page, perPage: OPTIONS_PAGE }));
}

export async function createSlotTemplate(input: SlotTemplatePayload): Promise<SlotTemplate> {
  const body = await unwrap<DataEnvelope<SlotTemplate>>(adminApi.POST("/v1/admin/slot-templates", { body: input as never }));
  return body.data;
}

/** Times and service kind cannot change while upcoming requests hold the slot (409 SLOT_IN_USE, details.holds). */
export async function updateSlotTemplate(id: number, input: Omit<SlotTemplatePayload, "code">, version: number): Promise<SlotTemplate> {
  const body = await unwrap<DataEnvelope<SlotTemplate>>(
    adminApi.PATCH("/v1/admin/slot-templates/{slotTemplate}", {
      params: { path: { slotTemplate: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function fetchSlotRules(q: SchedulingListQuery): Promise<Paginated<SlotRule>> {
  return unwrap<Paginated<SlotRule>>(adminApi.GET("/v1/admin/slot-rules", { params: { query: schedulingQuery(q) } }));
}

export async function createSlotRule(input: SlotRulePayload): Promise<SlotRule> {
  const body = await unwrap<DataEnvelope<SlotRule>>(adminApi.POST("/v1/admin/slot-rules", { body: input as never }));
  return body.data;
}

/** Override rules (source "override") are read-only: 409 OVERRIDE_RULE_READ_ONLY. */
export async function updateSlotRule(id: number, input: SlotRulePayload, version: number): Promise<SlotRule> {
  const body = await unwrap<DataEnvelope<SlotRule>>(
    adminApi.PATCH("/v1/admin/slot-rules/{slotRule}", {
      params: { path: { slotRule: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** Deleting an override rule also needs capacity.override (403). */
export async function deleteSlotRule(id: number, version: number, reason: string): Promise<void> {
  await unwrap(
    adminApi.DELETE("/v1/admin/slot-rules/{slotRule}", {
      params: { path: { slotRule: id } },
      // The OpenAPI document lists these as query parameters; the reason goes in the body (Laravel reads both).
      body: { version, reason },
      headers: ifMatch(version),
    } as never),
  );
}

export async function fetchBlackoutDates(q: SchedulingListQuery): Promise<Paginated<BlackoutDate>> {
  return unwrap<Paginated<BlackoutDate>>(adminApi.GET("/v1/admin/blackout-dates", { params: { query: schedulingQuery(q) } }));
}

export async function createBlackoutDate(input: BlackoutPayload): Promise<BlackoutDate> {
  const body = await unwrap<DataEnvelope<BlackoutDate>>(adminApi.POST("/v1/admin/blackout-dates", { body: input as never }));
  return body.data;
}

export async function updateBlackoutDate(id: number, input: BlackoutPayload, version: number): Promise<BlackoutDate> {
  const body = await unwrap<DataEnvelope<BlackoutDate>>(
    adminApi.PATCH("/v1/admin/blackout-dates/{blackoutDate}", {
      params: { path: { blackoutDate: id } },
      body: { ...input, version } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function deleteBlackoutDate(id: number, version: number, reason: string): Promise<void> {
  await unwrap(
    adminApi.DELETE("/v1/admin/blackout-dates/{blackoutDate}", {
      params: { path: { blackoutDate: id } },
      body: { version, reason },
      headers: ifMatch(version),
    } as never),
  );
}

// Capacity (schedule.view) and manual override (capacity.override)

export async function fetchCapacity(q: { date: string; zoneId: number; serviceId?: number }): Promise<CapacityView> {
  const body = await unwrap<DataEnvelope<CapacityView>>(
    adminApi.GET("/v1/admin/capacity", {
      params: { query: compact({ date: q.date, zone_id: q.zoneId, service_id: q.serviceId }) as never },
    }),
  );
  return body.data;
}

export async function overrideCapacity(input: OverridePayload): Promise<CapacityOverrideResult> {
  const body = await unwrap<DataEnvelope<CapacityOverrideResult>>(adminApi.POST("/v1/admin/capacity/override", { body: input as never }));
  return body.data;
}

// ---- Phase 3 ------------------------------------------------------------------------------------------------------
// The generated schema types most Phase 3 responses as unknown[]; they are typed in types.ts from the Laravel
// resources. Every route that may move money or capacity needs an Idempotency-Key (a UUID per intent, sent again
// unchanged on a retry: see lib/admin/idempotency.ts); edits send the loaded version as If-Match when it is known.

const idempotency = (key: string) => ({ "Idempotency-Key": key });
const optionalIfMatch = (version: number | null | undefined) => (version === null || version === undefined ? {} : ifMatch(version));

// A02 overview (bookings.view or schedule.view)

export type DashboardQuery = { date?: string; zoneId?: number | null };

/** `background`: the overview's timed refresh (X-Background-Poll, not staff activity). */
export async function fetchDashboardSummary(q: DashboardQuery, opts: ReadOptions = {}): Promise<DashboardSummary> {
  const body = await unwrap<DataEnvelope<DashboardSummary>>(
    adminApi.GET("/v1/admin/dashboard/summary", {
      params: { query: compact({ date: q.date, zone_id: q.zoneId ?? undefined }) as never },
      headers: backgroundPoll(opts.background),
    }),
  );
  return body.data;
}

export async function fetchDashboardAlerts(q: { zoneId?: number | null }, opts: ReadOptions = {}): Promise<DashboardAlerts> {
  return unwrap<DashboardAlerts>(
    adminApi.GET("/v1/admin/dashboard/alerts", {
      params: { query: compact({ zone_id: q.zoneId ?? undefined }) as never },
      headers: backgroundPoll(opts.background),
    }),
  );
}

// Alerts bell (any staff member; D-11 polling every 20 s)

export type AlertsQuery = { since?: string; page?: number; perPage?: number; unread?: boolean };

/**
 * With `since` (the previous answer's meta.server_time) only alerts created at or after it; otherwise a page. The bell
 * passes `background` (the API treats GET /admin/alerts as a background poll anyway).
 */
export async function fetchAlerts(q: AlertsQuery, opts: ReadOptions = {}): Promise<AlertsPage> {
  return unwrap<AlertsPage>(
    adminApi.GET("/v1/admin/alerts", {
      params: {
        query: compact({ since: q.since, page: q.page, per_page: q.perPage, unread: q.unread === undefined ? undefined : q.unread ? 1 : 0 }) as never,
      },
      headers: backgroundPoll(opts.background),
    }),
  );
}

export async function markAlertRead(id: string): Promise<{ alert: AdminAlert; unreadCount: number }> {
  const body = await unwrap<{ data: AdminAlert; meta: { unread_count: number } }>(
    adminApi.POST("/v1/admin/alerts/{alert}/read", { params: { path: { alert: id } } }),
  );
  return { alert: body.data, unreadCount: body.meta.unread_count };
}

export async function markAllAlertsRead(): Promise<{ updated: number; unreadCount: number }> {
  const body = await unwrap<{ data: { updated: number }; meta: { unread_count: number } }>(adminApi.POST("/v1/admin/alerts/read-all"));
  return { updated: body.data.updated, unreadCount: body.meta.unread_count };
}

// Pick-lists (Phase 3 polish): light fields, readable without the permission that manages the records, no paging.

/** GET /admin/slot-templates/options: every slot template (inactive ones marked) with its service kind. */
export async function fetchSlotTemplateOptions(): Promise<SlotTemplateOption[]> {
  const body = await unwrap<DataEnvelope<SlotTemplateOption[]>>(adminApi.GET("/v1/admin/slot-templates/options"));
  return body.data;
}

/** GET /admin/drivers/options: every driver by name (never contact data), `is_active` when a round may be given. */
export async function fetchDriverOptions(): Promise<DriverOption[]> {
  const body = await unwrap<DataEnvelope<DriverOption[]>>(adminApi.GET("/v1/admin/drivers/options"));
  return body.data;
}

/** GET /admin/addons/options: every add-on (inactive ones marked) with the service codes it can be priced with. */
export async function fetchAddonOptions(): Promise<AddonOption[]> {
  const body = await unwrap<DataEnvelope<AddonOption[]>>(adminApi.GET("/v1/admin/addons/options"));
  return body.data;
}

// A03 bookings (bookings.view to read; each action its own permission)

export type BookingListQuery = {
  page?: number;
  perPage?: number;
  status?: BookingStatus | "";
  paymentStatus?: PaymentStatus | "";
  from?: string;
  to?: string;
  zoneId?: number | null;
  /** Service code or numeric id. */
  service?: string;
  source?: BookingSource | "";
  /** Reference, phone, or (2+ characters) part of the customer's name or the booked address. */
  search?: string;
  /** Cancellations waiting for staff review. */
  cancelReview?: boolean;
  slotTemplateId?: number | null;
  /** A worker named on one of the booking's visits now. */
  workerId?: number | null;
  /** The driver (drivers.id) of a live drop-off or pickup stop of one of the booking's visits. */
  driverId?: number | null;
};

export async function fetchBookings(q: BookingListQuery): Promise<Paginated<BookingRow>> {
  return unwrap<Paginated<BookingRow>>(
    adminApi.GET("/v1/admin/bookings", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          status: q.status,
          payment_status: q.paymentStatus,
          from: q.from,
          to: q.to,
          zone_id: q.zoneId ?? undefined,
          service: q.service,
          source: q.source,
          search: q.search?.trim(),
          cancel_review: q.cancelReview ? 1 : undefined,
          slot_template_id: q.slotTemplateId ?? undefined,
          worker_id: q.workerId ?? undefined,
          driver_id: q.driverId ?? undefined,
        }) as never,
      },
    }),
  );
}

/** `background`: the booking page's timed refresh (X-Background-Poll, not staff activity). */
export async function fetchBooking(id: number, opts: ReadOptions = {}): Promise<BookingDetail> {
  const body = await unwrap<DataEnvelope<BookingDetail>>(
    adminApi.GET("/v1/admin/bookings/{booking}", { params: { path: { booking: id } }, headers: backgroundPoll(opts.background) }),
  );
  return body.data;
}

/** Internal note (never shown to the customer): any of bookings.create_manual|confirm|reschedule|cancel. */
export async function addBookingNote(id: number, text: string): Promise<BookingNote> {
  const body = await unwrap<DataEnvelope<BookingNote>>(
    adminApi.POST("/v1/admin/bookings/{booking}/notes", { params: { path: { booking: id } }, body: { body: text } }),
  );
  return body.data;
}

/** Capture and confirm (bookings.confirm). 502 PAYMENT_RESULT_UNKNOWN: the bank did not answer; confirming again is safe. */
export async function confirmBooking(id: number, version: number | null, key: string): Promise<BookingDetail> {
  const body = await unwrap<DataEnvelope<BookingDetail>>(
    adminApi.POST("/v1/admin/bookings/{booking}/confirm", {
      params: { path: { booking: id } },
      headers: { ...idempotency(key), ...optionalIfMatch(version) },
    }),
  );
  return body.data;
}

export type RejectInput = { reason_code: string; reason_text: string | null };

/** Void and reject (bookings.reject). */
export async function rejectBooking(id: number, input: RejectInput, version: number | null, key: string): Promise<BookingDetail> {
  const body = await unwrap<DataEnvelope<BookingDetail>>(
    adminApi.POST("/v1/admin/bookings/{booking}/reject", {
      params: { path: { booking: id } },
      body: input as never,
      headers: { ...idempotency(key), ...optionalIfMatch(version) },
    }),
  );
  return body.data;
}

export type AlternativeOptionInput = { service_date: string; slot_template_id: number; note?: string | null };
export type ProposeInput = { options: AlternativeOptionInput[]; note: string | null };

/** 1–3 other times (bookings.propose_alternative); 201 with the proposal (prices per option) and the booking. */
export async function proposeAlternatives(
  id: number,
  input: ProposeInput,
  version: number | null,
): Promise<{ proposal: AlternativeProposal; booking: BookingDetail }> {
  const body = await unwrap<DataEnvelope<{ proposal: AlternativeProposal; booking: BookingDetail }>>(
    adminApi.POST("/v1/admin/bookings/{booking}/propose-alternative", {
      params: { path: { booking: id } },
      body: input as never,
      headers: optionalIfMatch(version),
    }),
  );
  return body.data;
}

/**
 * The options as the proposal would check them, every option reported (bookings.propose_alternative; writes nothing):
 * price, difference and problem per option, `can_send`, and the customer's deadline if sent now.
 */
export async function previewAlternatives(id: number, input: ProposeInput): Promise<AlternativesPreview> {
  const body = await unwrap<DataEnvelope<AlternativesPreview>>(
    adminApi.POST("/v1/admin/bookings/{booking}/propose-alternative/preview", { params: { path: { booking: id } }, body: input as never }),
  );
  return body.data;
}

/**
 * `expected_*`: the terms the dialog showed (POST …/reschedule/preview); 409 TERMS_CHANGED (details = the new preview
 * and `changed`) when they no longer hold. Staff moves have no fee (0).
 */
export type RescheduleInput = {
  service_date: string;
  slot_template_id: number;
  reason: string;
  override?: boolean;
  expected_fee_fils?: number;
  expected_new_total_fils?: number;
};

/** The staff move's terms for a date and slot (bookings.reschedule; 409 RESCHEDULE_PENDING while a customer request waits). */
export async function previewReschedule(id: number, input: { service_date: string; slot_template_id: number }): Promise<ReschedulePreview> {
  const body = await unwrap<DataEnvelope<ReschedulePreview>>(
    adminApi.POST("/v1/admin/bookings/{booking}/reschedule/preview", { params: { path: { booking: id } }, body: input }),
  );
  return body.data;
}

/** Staff move a confirmed booking (bookings.reschedule; override needs capacity.override and a 10-character reason). */
export async function rescheduleBooking(
  id: number,
  input: RescheduleInput,
  version: number | null,
  key: string,
): Promise<{ reschedule_request: RescheduleRequest; booking: BookingDetail }> {
  const body = await unwrap<DataEnvelope<{ reschedule_request: RescheduleRequest; booking: BookingDetail }>>(
    adminApi.POST("/v1/admin/bookings/{booking}/reschedule", {
      params: { path: { booking: id } },
      body: input as never,
      headers: { ...idempotency(key), ...optionalIfMatch(version) },
    }),
  );
  return body.data;
}

/** The fee and refund the policy gives before anything is cancelled (bookings.cancel). */
export async function previewCancellation(id: number, party: "customer" | "company"): Promise<CancelPreview> {
  const body = await unwrap<DataEnvelope<CancelPreview>>(
    adminApi.POST("/v1/admin/bookings/{booking}/cancel/preview", { params: { path: { booking: id } }, body: { party } as never }),
  );
  return body.data;
}

/**
 * `expected_*`: the preview's fee and refund as the dialog showed them (null for a review), also with an explicit
 * refund_fils; 409 TERMS_CHANGED (details = the new preview and `changed`) when the policy terms moved meanwhile.
 */
export type CancelInput = {
  reason_code: string;
  reason_text: string | null;
  party: "customer" | "company";
  refund_fils?: number;
  expected_fee_fils?: number | null;
  expected_refund_fils?: number | null;
};

/** bookings.cancel; an explicit refund_fils needs refunds.create (403 REFUND_PERMISSION_REQUIRED otherwise). */
export async function cancelBooking(id: number, input: CancelInput, version: number | null, key: string): Promise<CancelResult> {
  const body = await unwrap<DataEnvelope<CancelResult>>(
    adminApi.POST("/v1/admin/bookings/{booking}/cancel", {
      params: { path: { booking: id } },
      body: input as never,
      headers: { ...idempotency(key), ...optionalIfMatch(version) },
    }),
  );
  return body.data;
}

/**
 * Finish a customer's cancellation that waits for review with a refund (refunds.create, Idempotency-Key; the
 * accountant's way): refund_fils of what is refundable goes back, the rest is kept as the fee; `note` is the refund's
 * note and the audit reason.
 */
export async function resolveCancelReview(
  id: number,
  input: { refund_fils: number; note: string },
  version: number | null,
  key: string,
): Promise<CancelResult> {
  const body = await unwrap<DataEnvelope<CancelResult>>(
    adminApi.POST("/v1/admin/bookings/{booking}/cancel-review/resolve", {
      params: { path: { booking: id } },
      body: input,
      headers: { ...idempotency(key), ...optionalIfMatch(version) },
    }),
  );
  return body.data;
}

/** Keep the booking and close the customer's cancellation review (bookings.cancel; no money moves). */
export async function declineCancelReview(id: number, note: string, version: number | null): Promise<BookingDetail> {
  const body = await unwrap<DataEnvelope<BookingDetail>>(
    adminApi.POST("/v1/admin/bookings/{booking}/cancel-review/decline", {
      params: { path: { booking: id } },
      body: { note },
      headers: optionalIfMatch(version),
    }),
  );
  return body.data;
}

export type ApproveRescheduleInput = { note?: string | null; override?: boolean; reason?: string | null };

/** A customer's reschedule request (bookings.reschedule, Idempotency-Key). */
export async function approveRescheduleRequest(id: number, input: ApproveRescheduleInput, key: string): Promise<RescheduleRequest> {
  const body = await unwrap<DataEnvelope<RescheduleRequest>>(
    adminApi.POST("/v1/admin/reschedule-requests/{rescheduleRequest}/approve", {
      params: { path: { rescheduleRequest: id } },
      body: input,
      headers: idempotency(key),
    }),
  );
  return body.data;
}

export async function rejectRescheduleRequest(id: number, note: string): Promise<RescheduleRequest> {
  const body = await unwrap<DataEnvelope<RescheduleRequest>>(
    adminApi.POST("/v1/admin/reschedule-requests/{rescheduleRequest}/reject", {
      params: { path: { rescheduleRequest: id } },
      body: { note },
    }),
  );
  return body.data;
}

export type ManualBookingPayload = {
  source: "phone" | "whatsapp" | "admin";
  customer: { phone: string; name: string | null; locale: "ar" | "en" | null };
  address:
    | { id: string }
    | {
        label: string;
        property_type: PropertyType;
        building: string | null;
        unit_number: string | null;
        street: string | null;
        area_text: string | null;
        lat: number;
        lng: number;
        access_instructions: string | null;
        has_pets: boolean;
        pets_note: string | null;
        parking_available: boolean;
        entry_permit_required: boolean;
        cleaning_materials_available: boolean;
      };
  service: string;
  service_date: string;
  slot_template_id: number;
  workers_count: number;
  addons: string[];
  priorities: CleaningArea[];
  instructions: string | null;
  materials_by: "customer" | "company" | null;
  preferred_worker_id: number | null;
  internal_note: string | null;
  override?: boolean;
  reason?: string | null;
};

/**
 * GET /admin/customers?phone= (bookings.create_manual): the customer with exactly this number (any notation, normalized
 * like the manual booking's) and their saved addresses; `data` [] when nobody has it. A partial number is 422
 * PHONE_INVALID; 429 RATE_LIMITED after 30 lookups a minute.
 */
export async function lookupCustomer(phone: string): Promise<CustomerLookup> {
  return unwrap<CustomerLookup>(adminApi.GET("/v1/admin/customers", { params: { query: { phone } } }));
}

/**
 * The manual booking as a dry run (bookings.create_manual; nothing is created): amounts and lines, the slot's
 * availability, how long the link holds the slot, the cancellation terms. Same errors as the creation; 429 RATE_LIMITED
 * after 60 previews a minute.
 */
export async function previewManualBooking(input: ManualBookingPayload): Promise<ManualBookingPreview> {
  const body = await unwrap<DataEnvelope<ManualBookingPreview>>(adminApi.POST("/v1/admin/bookings/preview", { body: input as never }));
  return body.data;
}

/** Manual booking (bookings.create_manual, Idempotency-Key): held until the customer pays the link. */
export async function createManualBooking(input: ManualBookingPayload, key: string): Promise<ManualBookingResult> {
  const body = await unwrap<DataEnvelope<ManualBookingResult>>(
    adminApi.POST("/v1/admin/bookings", { body: input as never, headers: idempotency(key) }),
  );
  return body.data;
}

/** A new checkout link for a manual booking still held (409 INVALID_STATE not_manual_booking for app bookings). */
export async function createPaymentLink(id: number): Promise<PaymentLink> {
  const body = await unwrap<DataEnvelope<PaymentLink>>(adminApi.POST("/v1/admin/bookings/{booking}/payment-link", { params: { path: { booking: id } } }));
  return body.data;
}

// Assignment (assignments.manage; candidates also with schedule.view). `override` needs capacity.override.

/** `background`: a read a background poll set off on the booking page (lib/admin/backgroundRefresh.ts isPollDriven). */
export async function fetchVisitCandidates(visitId: number, opts: ReadOptions = {}): Promise<VisitCandidates> {
  const body = await unwrap<DataEnvelope<VisitCandidates>>(
    adminApi.GET("/v1/admin/visits/{visit}/candidates", { params: { path: { visit: visitId } }, headers: backgroundPoll(opts.background) }),
  );
  return body.data;
}

export type OverrideFieldsInput = { override?: boolean; reason?: string | null };

/** Names exactly the missing number of workers (422 WORKERS_COUNT_MISMATCH otherwise). */
export async function assignWorkers(visitId: number, workerIds: number[], version: number | null, extra: OverrideFieldsInput = {}): Promise<VisitSummary> {
  const body = await unwrap<DataEnvelope<VisitSummary>>(
    adminApi.POST("/v1/admin/visits/{visit}/assign", {
      params: { path: { visit: visitId } },
      body: { worker_ids: workerIds, ...extra },
      headers: optionalIfMatch(version),
    }),
  );
  return body.data;
}

export async function unassignWorker(visitId: number, workerId: number, reason: string, version: number | null, override = false): Promise<VisitSummary> {
  const body = await unwrap<DataEnvelope<VisitSummary>>(
    adminApi.POST("/v1/admin/visits/{visit}/unassign", {
      params: { path: { visit: visitId } },
      body: { worker_id: workerId, reason, ...(override ? { override: true } : {}) } as never,
      headers: optionalIfMatch(version),
    }),
  );
  return body.data;
}

export async function replaceWorker(
  visitId: number,
  input: { worker_id: number; new_worker_id: number; reason: string; override?: boolean },
  version: number | null,
): Promise<VisitSummary> {
  const body = await unwrap<DataEnvelope<VisitSummary>>(
    adminApi.POST("/v1/admin/visits/{visit}/replace", { params: { path: { visit: visitId } }, body: input as never, headers: optionalIfMatch(version) }),
  );
  return body.data;
}

export type VisitStatusTarget = "arrived" | "in_progress" | "completed" | "no_show_customer" | "missed_by_company";

/** Operations override of a visit's status (D-01); `at` is an instant with its offset. */
export async function setVisitStatus(
  visitId: number,
  input: { status: VisitStatusTarget; reason: string; at?: string | null },
  version: number | null,
): Promise<VisitSummary> {
  const body = await unwrap<DataEnvelope<VisitSummary>>(
    adminApi.POST("/v1/admin/visits/{visit}/status", { params: { path: { visit: visitId } }, body: input as never, headers: optionalIfMatch(version) }),
  );
  return body.data;
}

/** The booking's notifications sent log (bookings.view), newest first. */
export async function fetchBookingNotifications(id: number, page: number): Promise<Paginated<DeliveryLogItem>> {
  return unwrap<Paginated<DeliveryLogItem>>(
    adminApi.GET("/v1/admin/bookings/{booking}/notifications", {
      params: { path: { booking: id }, query: { page, per_page: 10 } as never },
    }),
  );
}

/**
 * GET /admin/refunds (payments.view or refunds.create) for one customer phone: the booking page keeps the refunds of
 * its own payments (matched by the payment's ULID or payable id) to show each one's provider status. `background`: a read
 * a background poll set off (lib/admin/backgroundRefresh.ts isPollDriven).
 */
export async function fetchRefundsByPhone(phone: string, opts: ReadOptions = {}): Promise<AdminRefund[]> {
  const body = await unwrap<Paginated<AdminRefund>>(
    adminApi.GET("/v1/admin/refunds", { params: { query: compact({ phone, per_page: 50 }) as never }, headers: backgroundPoll(opts.background) }),
  );
  return body.data;
}

// A04 operations schedule (schedule.view to read; the drop dry run and the move need assignments.manage, an override
// also capacity.override)

export type ScheduleQuery = {
  view: ScheduleView;
  date: string;
  zoneId?: number | null;
  serviceId?: number | null;
  slotTemplateId?: number | null;
  workerId?: number | null;
  /** Visit statuses, sent comma-separated. */
  statuses?: readonly string[];
};

export async function fetchSchedule(q: ScheduleQuery): Promise<ScheduleBoard> {
  const body = await unwrap<DataEnvelope<ScheduleBoard>>(
    adminApi.GET("/v1/admin/schedule", {
      params: {
        query: compact({
          view: q.view,
          date: q.date,
          zone_id: q.zoneId ?? undefined,
          service_id: q.serviceId ?? undefined,
          slot_template_id: q.slotTemplateId ?? undefined,
          worker_id: q.workerId ?? undefined,
          status: q.statuses && q.statuses.length > 0 ? q.statuses.join(",") : undefined,
        }) as never,
      },
    }),
  );
  return body.data;
}

/**
 * Where a card was dropped: the worker row, and the date and slot of the cell. A different date or slot is a reschedule
 * (422 USE_RESCHEDULE). No from_worker_id = from the unassigned lane (adds the worker); otherwise that worker is replaced.
 */
export type MoveInput = {
  visit_id: number;
  from_worker_id: number | null;
  to_worker_id: number;
  date?: string | null;
  slot_template_id?: number | null;
};

function moveBody(input: MoveInput) {
  return compact({
    visit_id: input.visit_id,
    from_worker_id: input.from_worker_id ?? undefined,
    to_worker_id: input.to_worker_id,
    date: input.date ?? undefined,
    slot_template_id: input.slot_template_id ?? undefined,
  });
}

/** The move as a dry run: nothing is saved (MoveCheck rolls the real move back). */
export async function validateMove(input: MoveInput): Promise<MoveCheckResult> {
  const body = await unwrap<DataEnvelope<MoveCheckResult>>(adminApi.POST("/v1/admin/schedule/validate-move", { body: moveBody(input) as never }));
  return body.data;
}

/** Saves the move (the visit's version as If-Match). `override` needs capacity.override and a 10-character reason. */
export async function moveVisit(input: MoveInput, version: number | null, extra: OverrideFieldsInput = {}): Promise<VisitSummary> {
  const body = await unwrap<DataEnvelope<VisitSummary>>(
    adminApi.POST("/v1/admin/schedule/move", { body: { ...moveBody(input), ...extra } as never, headers: optionalIfMatch(version) }),
  );
  return body.data;
}

// A06 trip planner (trips.manage; rounds and driver reports are readable with schedule.view). Every round answer is
// the round as the planner reads it, with its warnings and the version for If-Match.

export type RoundsQuery = { date: string; slotTemplateId?: number | null; zoneId?: number | null; kind?: RoundKind | ""; status?: RoundStatus | "" };

export async function fetchRounds(q: RoundsQuery): Promise<Round[]> {
  const body = await unwrap<DataEnvelope<Round[]>>(
    adminApi.GET("/v1/admin/rounds", {
      params: {
        query: compact({
          date: q.date,
          slot_template_id: q.slotTemplateId ?? undefined,
          zone_id: q.zoneId ?? undefined,
          kind: q.kind,
          status: q.status,
        }) as never,
      },
    }),
  );
  return body.data;
}

/** Auto-draft (spec §8.3): rounds for every confirmed, fully assigned visit of the slot; the rest come back unplanned. */
export async function planRounds(input: { date: string; slot_template_id: number; zone_id?: number | null }): Promise<PlanResult> {
  const body = await unwrap<DataEnvelope<PlanResult>>(adminApi.POST("/v1/admin/rounds/plan", { body: compact(input) as never }));
  return body.data;
}

/** Only the changed fields: vehicle (its seat reservations move with it), driver (null clears it), departure instant. */
export type RoundChanges = { vehicle_id?: number; driver_id?: number | null; planned_depart_at?: string };

export async function updateRound(id: number, changes: RoundChanges, version: number): Promise<Round> {
  const body = await unwrap<DataEnvelope<Round>>(
    adminApi.PATCH("/v1/admin/rounds/{round}", { params: { path: { round: id } }, body: changes as never, headers: ifMatch(version) }),
  );
  return body.data;
}

/** Every stop of the round once, in the new order (422 STOPS_MISMATCH otherwise). */
export async function reorderStops(id: number, stopIds: number[], version: number): Promise<Round> {
  const body = await unwrap<DataEnvelope<Round>>(
    adminApi.POST("/v1/admin/rounds/{round}/stops/reorder", {
      params: { path: { round: id } },
      body: { stop_ids: stopIds } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** Puts a visit on the round (its seats move to this van; 409 SEATS_EXCEEDED when they do not fit, never overridable). */
export async function addStop(id: number, visitId: number, version: number): Promise<Round> {
  const body = await unwrap<DataEnvelope<Round>>(
    adminApi.POST("/v1/admin/rounds/{round}/stops", { params: { path: { round: id } }, body: { visit_id: visitId } as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export async function removeStop(id: number, stopId: number, version: number): Promise<Round> {
  const body = await unwrap<DataEnvelope<Round>>(
    adminApi.DELETE("/v1/admin/rounds/{round}/stops/{stop}", { params: { path: { round: id, stop: stopId } }, headers: ifMatch(version) }),
  );
  return body.data;
}

export type PassengerSeat = { worker_id: number; seat_no: number };

/**
 * The riders by seat. A seat the van does not have is 422 SEAT_OUT_OF_RANGE (never overridable); a rider who is not on
 * a stop's team, or a team split between vans, is 409 OVERRIDE_REQUIRED (capacity.override and a 10-character reason).
 */
export async function setPassengers(id: number, workers: PassengerSeat[], version: number, extra: OverrideFieldsInput = {}): Promise<Round> {
  const body = await unwrap<DataEnvelope<Round>>(
    adminApi.PUT("/v1/admin/rounds/{round}/passengers", {
      params: { path: { round: id } },
      body: { workers, ...extra } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** Sends the round to the driver's app (409 DRIVER_REQUIRED, DRIVER_UNAVAILABLE, ROUND_NEEDS_STOP). */
export async function publishRound(id: number, version: number): Promise<Round> {
  const body = await unwrap<DataEnvelope<Round>>(
    adminApi.POST("/v1/admin/rounds/{round}/publish", { params: { path: { round: id } }, headers: ifMatch(version) }),
  );
  return body.data;
}

export async function cancelRound(id: number, reason: string, version: number): Promise<Round> {
  const body = await unwrap<DataEnvelope<Round>>(
    adminApi.POST("/v1/admin/rounds/{round}/cancel", { params: { path: { round: id } }, body: { reason } as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export type DriverReportQuery = { page?: number; perPage?: number; status?: DriverReportStatus | ""; type?: DriverReportType | ""; date?: string; roundId?: number };

/** Newest first (trips.manage or schedule.view). */
export async function fetchDriverReports(q: DriverReportQuery): Promise<Paginated<DriverReport>> {
  return unwrap<Paginated<DriverReport>>(
    adminApi.GET("/v1/admin/driver-reports", {
      params: {
        query: compact({ page: q.page, per_page: q.perPage, status: q.status, type: q.type, date: q.date, round_id: q.roundId }) as never,
      },
    }),
  );
}

/** Marks a report seen or handled (trips.manage): open → acknowledged → resolved, or open → resolved. */
export async function updateDriverReport(id: number, input: { status: "acknowledged" | "resolved"; note?: string | null }): Promise<DriverReport> {
  const body = await unwrap<DataEnvelope<DriverReport>>(
    adminApi.PATCH("/v1/admin/driver-reports/{driverReport}", { params: { path: { driverReport: id } }, body: input as never }),
  );
  return body.data;
}

// A09 finance: payments and refunds (payments.view to read; a refund needs refunds.create and an Idempotency-Key),
// invoices and credit notes (invoices.manage or payments.view to read; e-mailing and retrying need invoices.manage).

export type PaymentListQuery = {
  page?: number;
  perPage?: number;
  status?: PaymentStatus | "";
  /** Created from/to, local dates (Asia/Dubai). */
  from?: string;
  to?: string;
  /** At least 4 digits, matched anywhere in the customer's number. */
  phone?: string;
  payableType?: string;
  needsReview?: boolean;
  /** Our payment ULID or the provider's payment reference. */
  reference?: string;
};

export async function fetchPayments(q: PaymentListQuery): Promise<Paginated<AdminPayment>> {
  return unwrap<Paginated<AdminPayment>>(
    adminApi.GET("/v1/admin/payments", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          status: q.status,
          from: q.from,
          to: q.to,
          phone: q.phone?.trim(),
          payable_type: q.payableType,
          // Laravel's boolean rule takes 1/0, not "true".
          needs_review: q.needsReview ? 1 : undefined,
          reference: q.reference?.trim(),
        }) as never,
      },
    }),
  );
}

export async function fetchPayment(id: number): Promise<AdminPaymentDetail> {
  const body = await unwrap<DataEnvelope<AdminPaymentDetail>>(adminApi.GET("/v1/admin/payments/{payment}", { params: { path: { payment: id } } }));
  return body.data;
}

/**
 * Refunds (part of) a captured payment (refunds.create). `key` is the intent's Idempotency-Key: the same key with the
 * same body answers with the refund already recorded, with another body 422 IDEMPOTENCY_KEY_REUSED. 201 with the
 * refund and the provider's status (often still processing).
 */
export async function createRefund(paymentId: number, input: CreateRefundPayload, key: string): Promise<AdminRefund> {
  const body = await unwrap<DataEnvelope<AdminRefund>>(
    adminApi.POST("/v1/admin/payments/{payment}/refunds", {
      params: { path: { payment: paymentId } },
      // reason_code is a code GET /admin/refund-reasons offered at run time, not the generated enum.
      body: input as never,
      headers: idempotency(key),
    }),
  );
  return body.data;
}

/** The refund reasons with their labels (refunds.create or payments.view): pick from `selectable`, filter by any. */
export async function fetchRefundReasons(): Promise<RefundReason[]> {
  const body = await unwrap<DataEnvelope<RefundReason[]>>(adminApi.GET("/v1/admin/refund-reasons"));
  return body.data;
}

/**
 * The A09 KPI cards (payments.view or invoices.manage). `from`/`to` are local dates; left out, the API takes month to
 * date. At most 366 days (422 VALIDATION_FAILED on `to`, or on `from` when `to` was left out).
 */
export async function fetchFinanceSummary(q: { from?: string; to?: string; zoneId?: number | null }): Promise<FinanceSummary> {
  const body = await unwrap<DataEnvelope<FinanceSummary>>(
    adminApi.GET("/v1/admin/finance/summary", {
      params: { query: compact({ from: q.from, to: q.to, zone_id: q.zoneId ?? undefined }) as never },
    }),
  );
  return body.data;
}

export type RefundListQuery = {
  page?: number;
  perPage?: number;
  status?: RefundStatus | "";
  from?: string;
  to?: string;
  paymentId?: number;
  reasonCode?: string;
  needsReview?: boolean;
  phone?: string;
};

/** Newest first (refunds.create or payments.view). */
export async function fetchRefunds(q: RefundListQuery): Promise<Paginated<AdminRefund>> {
  return unwrap<Paginated<AdminRefund>>(
    adminApi.GET("/v1/admin/refunds", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          status: q.status,
          from: q.from,
          to: q.to,
          payment_id: q.paymentId,
          reason_code: q.reasonCode,
          needs_review: q.needsReview ? 1 : undefined,
          phone: q.phone?.trim(),
        }) as never,
      },
    }),
  );
}

export type InvoiceListQuery = {
  page?: number;
  perPage?: number;
  status?: InvoiceStatus | "";
  /** Issue date from/to. */
  from?: string;
  to?: string;
  customerId?: number;
  /** Only this payment's invoice(s); an unknown id answers an empty page. */
  paymentId?: number;
  /** Invoice number, booking reference or customer phone (4 digits or more). */
  search?: string;
};

export async function fetchInvoices(q: InvoiceListQuery): Promise<Paginated<AdminInvoice>> {
  return unwrap<Paginated<AdminInvoice>>(
    adminApi.GET("/v1/admin/invoices", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          status: q.status,
          from: q.from,
          to: q.to,
          customer_id: q.customerId,
          payment_id: q.paymentId,
          search: q.search?.trim(),
        }) as never,
      },
    }),
  );
}

export async function fetchInvoice(id: number): Promise<AdminInvoiceDetail> {
  const body = await unwrap<DataEnvelope<AdminInvoiceDetail>>(adminApi.GET("/v1/admin/invoices/{invoice}", { params: { path: { invoice: id } } }));
  return body.data;
}

/** A 15-minute signed URL of the PDF (rendered on demand; 503 INVOICE_PDF_UNAVAILABLE when it cannot be). */
export async function fetchInvoicePdf(id: number): Promise<DocumentUrl> {
  const body = await unwrap<DataEnvelope<DocumentUrl>>(adminApi.GET("/v1/admin/invoices/{invoice}/pdf", { params: { path: { invoice: id } } }));
  return body.data;
}

export type InvoiceEmailResult = { status: "queued"; email: string; message: string };

/** Queues the invoice e-mail to the customer's own address (202); 422 EMAIL_MISSING without one; 429 per invoice. */
export async function emailInvoice(id: number): Promise<InvoiceEmailResult> {
  const body = await unwrap<DataEnvelope<InvoiceEmailResult>>(adminApi.POST("/v1/admin/invoices/{invoice}/email", { params: { path: { invoice: id } } }));
  return body.data;
}

export type CreditNoteListQuery = { page?: number; perPage?: number; from?: string; to?: string; invoiceId?: number; customerId?: number; search?: string };

export async function fetchCreditNotes(q: CreditNoteListQuery): Promise<Paginated<AdminCreditNote>> {
  return unwrap<Paginated<AdminCreditNote>>(
    adminApi.GET("/v1/admin/credit-notes", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          from: q.from,
          to: q.to,
          invoice_id: q.invoiceId,
          customer_id: q.customerId,
          search: q.search?.trim(),
        }) as never,
      },
    }),
  );
}

export async function fetchCreditNote(id: number): Promise<AdminCreditNoteDetail> {
  const body = await unwrap<DataEnvelope<AdminCreditNoteDetail>>(
    adminApi.GET("/v1/admin/credit-notes/{creditNote}", { params: { path: { creditNote: id } } }),
  );
  return body.data;
}

export async function fetchCreditNotePdf(id: number): Promise<DocumentUrl> {
  const body = await unwrap<DataEnvelope<DocumentUrl>>(
    adminApi.GET("/v1/admin/credit-notes/{creditNote}/pdf", { params: { path: { creditNote: id } } }),
  );
  return body.data;
}

export type BillingRefusalQuery = { page?: number; perPage?: number; document?: BillingDocument | ""; paymentId?: number };

/** Documents Billing refused to issue, most recently refused first (invoices.manage or payments.view). */
export async function fetchBillingRefusals(q: BillingRefusalQuery): Promise<Paginated<BillingRefusal>> {
  return unwrap<Paginated<BillingRefusal>>(
    adminApi.GET("/v1/admin/billing-refusals", {
      params: { query: compact({ page: q.page, per_page: q.perPage, document: q.document, payment_id: q.paymentId }) as never },
    }),
  );
}

/** Issues the refused document now (invoices.manage); 422 BILLING_DOCUMENT_REFUSED while the records still disagree. */
export async function retryBillingRefusal(id: number): Promise<BillingRetryResult> {
  const body = await unwrap<DataEnvelope<BillingRetryResult>>(
    adminApi.POST("/v1/admin/billing-refusals/{refusal}/retry", { params: { path: { refusal: id } } }),
  );
  return body.data;
}

// A11 notification templates (settings.manage). The seeder fixes the set (one per event, audience, channel and
// language); edits change subject, body and is_active with the loaded version as If-Match (409 STALE_VERSION).

export type TemplateListQuery = { eventKey?: string; audience?: NotificationAudience; channel?: NotificationChannel };

/** Every template matching the filters, all pages (174 rows at most today, 100 per page). */
export async function fetchNotificationTemplates(q: TemplateListQuery = {}): Promise<NotificationTemplate[]> {
  return fetchAllPages((page) =>
    unwrap<Paginated<NotificationTemplate>>(
      adminApi.GET("/v1/admin/notification-templates", {
        params: {
          query: compact({ event_key: q.eventKey, audience: q.audience, channel: q.channel, page, per_page: OPTIONS_PAGE }) as never,
        },
      }),
    ),
  );
}

export async function fetchNotificationTemplate(id: number): Promise<NotificationTemplate> {
  const body = await unwrap<DataEnvelope<NotificationTemplate>>(
    adminApi.GET("/v1/admin/notification-templates/{template}", { params: { path: { template: String(id) } } }),
  );
  return body.data;
}

export type TemplateUpdateInput = { subject?: string | null; body?: string; is_active?: boolean; reason?: string | null };

/** 422 for unknown placeholders, a missing subject (push, in-app, e-mail) or a body over the channel's limit. */
export async function updateNotificationTemplate(id: number, input: TemplateUpdateInput, version: number): Promise<NotificationTemplate> {
  const body = await unwrap<DataEnvelope<NotificationTemplate>>(
    adminApi.PATCH("/v1/admin/notification-templates/{template}", {
      params: { path: { template: String(id) } },
      body: { ...input, version },
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

/** A sample value: one text for both languages, or each language its own (a missing one keeps the API's sample). */
export type SampleValue = string | { ar?: string; en?: string };

/** The editor's preview request (the API also takes numbers and nulls as sample values; the editor sends texts). */
export type TemplatePreviewInput = { payload?: Record<string, SampleValue>; subject?: string | null; body?: string | null };

/** Renders the template (an unsaved draft of its own language when given) and its twin in the other language. */
export async function previewNotificationTemplate(id: number, input: TemplatePreviewInput): Promise<TemplatePreview> {
  const body = await unwrap<DataEnvelope<TemplatePreview>>(
    adminApi.POST("/v1/admin/notification-templates/{template}/preview", {
      params: { path: { template: String(id) } },
      body: input,
    }),
  );
  return body.data;
}

// Public endpoints the wizard uses through the same proxy

/** POST /public/zones/check: which zone covers a point (the API checks it again on save). */
export async function checkZone(lat: number, lng: number): Promise<ZoneCheck> {
  const body = await unwrap<DataEnvelope<ZoneCheck>>(adminApi.POST("/v1/public/zones/check", { body: { lat, lng } as never }));
  return body.data;
}
