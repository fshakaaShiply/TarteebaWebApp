import { adminApi, unwrap } from "./client";
import type {
  Addon,
  AddonPer,
  CatalogPackage,
  CatalogPreview,
  CatalogService,
  Coupon,
  CouponAppliesTo,
  DataEnvelope,
  DiscountType,
  GeoPolygon,
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
  ServicePrice,
  Setting,
  StaffMe,
  StaffUser,
  SubZone,
  Translatable,
  TwoFactorSetup,
  Zone,
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

export async function fetchAllZones(): Promise<Zone[]> {
  return fetchAllPages((page) => fetchZones({ page, perPage: OPTIONS_PAGE }));
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
