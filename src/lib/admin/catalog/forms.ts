import { z } from "zod";
import { filsToAedInput } from "@/lib/money";
import type {
  AddonPayload,
  CouponPayload,
  LiveOutPlanPayload,
  PackagePayload,
  ServicePayload,
  ServicePricePayload,
} from "../endpoints";
import type {
  Addon,
  CatalogPackage,
  CatalogService,
  Coupon,
  LiveOutPlan,
  ServiceKind,
  ServicePrice,
  SlotTemplate,
  Translatable,
} from "../types";
import {
  catalogCodeInput,
  couponCodeInput,
  dateInput,
  emptyTranslatable,
  idSelect,
  intInput,
  minutesOf,
  moneyInput,
  numText,
  optionalIntInput,
  optionalMoneyInput,
  optionalTranslatableInput,
  parseMoney,
  parseWholeNumber,
  timeInput,
  translatableInput,
  translatableListInput,
  translatableValue,
  type CatalogErrorKey,
} from "./fields";

/*
 * A11 form schemas. Each mirrors the API's FormRequest rules (app/Modules/Catalog/Http/Requests) so the admin sees
 * mistakes before saving, and turns the form values into the request body: `{ payload, reason }`. The API still
 * validates everything (its messages are shown on the same fields).
 */

export type FormMode = "create" | "edit";

export const SERVICE_KINDS = ["standard_visit", "live_out", "future_specialized"] as const;
export const MATERIALS_MODES = ["customer", "company_addon", "company_included"] as const;
export const PRICE_UNITS = ["per_worker_visit", "per_hour", "per_day", "per_month"] as const;
export const DISCOUNT_TYPES = ["percent", "fixed"] as const;
export const ADDON_PERS = ["visit", "worker", "month"] as const;
export const PLAN_KINDS = ["trial_day", "monthly"] as const;
/** Package::VISITS_PER_WEEK_OPTIONS (REQ §4.4, screen 10). */
export const VISITS_PER_WEEK = ["1", "2", "3", "4", "6"] as const;
/** day_of_week: 0 = Sunday … 6 = Saturday. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const addIssue = (ctx: z.RefinementCtx, message: CatalogErrorKey, path: (string | number)[]) =>
  ctx.addIssue({ code: "custom", message, path });

const text = (value: string | null | undefined) => value ?? "";

// ---- Services --------------------------------------------------------------------------------------------------

const serviceShape = {
  name: translatableInput(120),
  description: optionalTranslatableInput(1000),
  includes: translatableListInput(),
  excludes: translatableListInput(),
  // 15-minute steps match the capacity engine's time blocks (spec §8.4).
  duration_minutes: intInput("duration", 15, 1440, 15),
  min_workers: intInput("workers", 1, 20),
  max_workers: intInput("workers", 1, 20),
  team_size_default: optionalIntInput("workers", 1, 20),
  requires_equipment: z.boolean(),
  materials_mode: z.enum(MATERIALS_MODES),
  is_active: z.boolean(),
  is_bookable_online: z.boolean(),
  sort_order: intInput("sortOrder", 0, 65535),
  cancellation_policy_id: idSelect,
  reschedule_policy_id: idSelect,
  refund_policy_id: idSelect,
  reason: z.string(),
};

/** Edits of an existing service (code and kind are fixed after creation). */
export const serviceFormSchema = z.object(serviceShape).transform((v, ctx) => {
  if (v.max_workers < v.min_workers) addIssue(ctx, "maxWorkersBelowMin", ["max_workers"]);
  if (v.team_size_default !== null && (v.team_size_default < v.min_workers || v.team_size_default > v.max_workers)) {
    addIssue(ctx, "teamSizeOutOfRange", ["team_size_default"]);
  }
  const { reason, ...payload } = v;
  return { payload: payload satisfies Omit<ServicePayload, "code" | "kind">, reason };
});

export type ServiceFormValues = z.input<typeof serviceFormSchema>;
export type ServiceFormOutput = z.output<typeof serviceFormSchema>;

const translatableText = (value: Translatable | null | undefined): Translatable => ({
  ar: value?.ar ?? "",
  en: value?.en ?? "",
});

export function serviceToFormValues(s: CatalogService): ServiceFormValues {
  return {
    name: translatableText(s.name),
    description: translatableText(s.description),
    includes: s.includes.map(translatableText),
    excludes: s.excludes.map(translatableText),
    duration_minutes: String(s.duration_minutes),
    min_workers: String(s.min_workers),
    max_workers: String(s.max_workers),
    team_size_default: numText(s.team_size_default),
    requires_equipment: s.requires_equipment,
    materials_mode: s.materials_mode,
    is_active: s.is_active,
    is_bookable_online: s.is_bookable_online,
    sort_order: String(s.sort_order),
    cancellation_policy_id: numText(s.cancellation_policy_id),
    reschedule_policy_id: numText(s.reschedule_policy_id),
    refund_policy_id: numText(s.refund_policy_id),
    reason: "",
  };
}

/** Create: the identity of the service plus the essentials; the rest is edited on the service page. */
export const serviceCreateSchema = z
  .object({
    code: catalogCodeInput(),
    kind: z.enum(SERVICE_KINDS),
    name: translatableInput(120),
    duration_minutes: intInput("duration", 15, 1440, 15),
    min_workers: intInput("workers", 1, 20),
    max_workers: intInput("workers", 1, 20),
    materials_mode: z.enum(MATERIALS_MODES),
    is_active: z.boolean(),
    is_bookable_online: z.boolean(),
    reason: z.string(),
  })
  .transform((v, ctx) => {
    if (v.max_workers < v.min_workers) addIssue(ctx, "maxWorkersBelowMin", ["max_workers"]);
    const { reason, ...payload } = v;
    return { payload, reason };
  });

export type ServiceCreateValues = z.input<typeof serviceCreateSchema>;

export function newServiceValues(kind: ServiceKind = "standard_visit"): ServiceCreateValues {
  return {
    code: "",
    kind,
    name: emptyTranslatable(),
    duration_minutes: kind === "live_out" ? "540" : "240",
    min_workers: "1",
    max_workers: kind === "live_out" ? "1" : "4",
    materials_mode: "customer",
    // New services start inactive ("draft") so prices can be added before customers see them.
    is_active: false,
    is_bookable_online: true,
    reason: "",
  };
}

// ---- Prices ----------------------------------------------------------------------------------------------------

export const priceFormSchema = z
  .object({
    zone_id: idSelect,
    // One slot template only (e.g. evenings dearer); empty = every slot.
    slot_template_id: idSelect,
    day_of_week: z.string().transform((v): number | null => (v === "" ? null : Number(v))),
    valid_from: dateInput,
    valid_to: dateInput,
    unit: z.enum(PRICE_UNITS),
    amount: moneyInput(),
    vat_inclusive: z.boolean(),
    priority: intInput("priority", 0, 1000),
    reason: z.string(),
  })
  .transform((v, ctx) => {
    if (v.valid_from && v.valid_to && v.valid_from > v.valid_to) addIssue(ctx, "dateRange", ["valid_to"]);
    const payload: ServicePricePayload = {
      zone_id: v.zone_id,
      slot_template_id: v.slot_template_id,
      day_of_week: v.day_of_week,
      valid_from: v.valid_from,
      valid_to: v.valid_to,
      unit: v.unit,
      amount_fils: v.amount,
      vat_inclusive: v.vat_inclusive,
      priority: v.priority,
    };
    return { payload, reason: v.reason };
  });

export type PriceFormValues = z.input<typeof priceFormSchema>;

/**
 * Slot templates a price row can target: those of the service's kind (a standard visit is never booked into a
 * Live-out slot), plus the row's current slot whatever it is now, so opening an editor never drops it.
 */
export function priceSlotChoices(slots: readonly SlotTemplate[], kind: ServiceKind, current: number | null): SlotTemplate[] {
  return slots.filter((s) => s.service_kind === kind || s.id === current);
}

export function priceToFormValues(p: ServicePrice | null, kind: ServiceKind): PriceFormValues {
  if (!p) {
    return {
      zone_id: "",
      slot_template_id: "",
      day_of_week: "",
      valid_from: "",
      valid_to: "",
      unit: kind === "live_out" ? "per_month" : "per_worker_visit",
      amount: "",
      vat_inclusive: true,
      priority: "0",
      reason: "",
    };
  }
  return {
    zone_id: numText(p.zone_id),
    slot_template_id: numText(p.slot_template_id),
    day_of_week: numText(p.day_of_week),
    valid_from: text(p.valid_from),
    valid_to: text(p.valid_to),
    unit: p.unit,
    amount: filsToAedInput(p.amount_fils),
    vat_inclusive: p.vat_inclusive,
    priority: String(p.priority),
    reason: "",
  };
}

// ---- Packages --------------------------------------------------------------------------------------------------

export function packageFormSchema(mode: FormMode) {
  return z
    .object({
      service_id: z.string(),
      code: z.string(),
      name: translatableInput(120),
      visits_per_week: z.enum(VISITS_PER_WEEK, { message: "visitsPerWeek" }),
      term_unit: z.enum(["weeks", "months"]),
      term_value: z.string(),
      discount_type: z.enum(DISCOUNT_TYPES),
      discount_value: z.string(),
      min_visits_for_discount: optionalIntInput("minVisits", 1, 1000),
      auto_renew_allowed: z.boolean(),
      max_skips_per_month: optionalIntInput("maxSkips", 0, 31),
      max_freeze_days: optionalIntInput("freezeDays", 0, 365),
      is_active: z.boolean(),
      sort_order: intInput("sortOrder", 0, 65535),
      cancellation_policy_id: idSelect,
      reschedule_policy_id: idSelect,
      refund_policy_id: idSelect,
      reason: z.string(),
    })
    .transform((v, ctx) => {
      const serviceId = v.service_id === "" ? null : Number(v.service_id);
      if (mode === "create" && serviceId === null) addIssue(ctx, "serviceRequired", ["service_id"]);

      const code = mode === "create" ? catalogCodeInput().safeParse(v.code) : null;
      if (code && !code.success) addIssue(ctx, (code.error.issues[0]?.message as CatalogErrorKey) ?? "codeFormat", ["code"]);

      // Exactly one of term_weeks / term_months (PackageRequest::crossCheck).
      const term = parseWholeNumber(v.term_value);
      const termMax = v.term_unit === "weeks" ? 104 : 24;
      if (v.term_value.trim() === "") addIssue(ctx, "required", ["term_value"]);
      else if (term === null || term < 1 || term > termMax) {
        addIssue(ctx, v.term_unit === "weeks" ? "termWeeks" : "termMonths", ["term_value"]);
      }

      // Percent 0..100, or a fixed net amount in fils (R-07).
      let discount: number | null = null;
      if (v.discount_type === "percent") {
        const n = v.discount_value.trim() === "" ? 0 : parseWholeNumber(v.discount_value);
        if (n === null || n > 100) addIssue(ctx, "percent0to100", ["discount_value"]);
        else discount = n;
      } else {
        const money = v.discount_value.trim() === "" ? ({ ok: true, fils: 0 } as const) : parseMoney(v.discount_value);
        if (!money.ok) addIssue(ctx, money.error, ["discount_value"]);
        else discount = money.fils;
      }

      if (discount === null || term === null) return z.NEVER;
      const payload: PackagePayload = {
        ...(mode === "create" && serviceId !== null ? { service_id: serviceId } : {}),
        ...(mode === "create" && code?.success ? { code: code.data } : {}),
        name: v.name,
        visits_per_week: Number(v.visits_per_week),
        term_weeks: v.term_unit === "weeks" ? term : null,
        term_months: v.term_unit === "months" ? term : null,
        discount_type: v.discount_type,
        discount_value: discount,
        min_visits_for_discount: v.min_visits_for_discount,
        auto_renew_allowed: v.auto_renew_allowed,
        max_skips_per_month: v.max_skips_per_month,
        max_freeze_days: v.max_freeze_days,
        is_active: v.is_active,
        sort_order: v.sort_order,
        cancellation_policy_id: v.cancellation_policy_id,
        reschedule_policy_id: v.reschedule_policy_id,
        refund_policy_id: v.refund_policy_id,
      };
      return { payload, reason: v.reason };
    });
}

export type PackageFormValues = z.input<ReturnType<typeof packageFormSchema>>;

export function packageToFormValues(p: CatalogPackage | null, serviceId?: number): PackageFormValues {
  if (!p) {
    return {
      service_id: serviceId ? String(serviceId) : "",
      code: "",
      name: emptyTranslatable(),
      visits_per_week: "1",
      term_unit: "weeks",
      term_value: "4",
      discount_type: "percent",
      discount_value: "0",
      min_visits_for_discount: "",
      auto_renew_allowed: true,
      max_skips_per_month: "",
      max_freeze_days: "",
      is_active: false,
      sort_order: "0",
      cancellation_policy_id: "",
      reschedule_policy_id: "",
      refund_policy_id: "",
      reason: "",
    };
  }
  const visits = String(p.visits_per_week);
  return {
    service_id: String(p.service_id),
    code: p.code,
    name: translatableText(p.name),
    visits_per_week: (VISITS_PER_WEEK as readonly string[]).includes(visits) ? (visits as PackageFormValues["visits_per_week"]) : "1",
    term_unit: p.term_months !== null ? "months" : "weeks",
    term_value: numText(p.term_months ?? p.term_weeks),
    discount_type: p.discount_type,
    discount_value: p.discount_type === "fixed" ? filsToAedInput(p.discount_value) : String(p.discount_value),
    min_visits_for_discount: numText(p.min_visits_for_discount),
    auto_renew_allowed: p.auto_renew_allowed,
    max_skips_per_month: numText(p.max_skips_per_month),
    max_freeze_days: numText(p.max_freeze_days),
    is_active: p.is_active,
    sort_order: String(p.sort_order),
    cancellation_policy_id: numText(p.cancellation_policy_id),
    reschedule_policy_id: numText(p.reschedule_policy_id),
    refund_policy_id: numText(p.refund_policy_id),
    reason: "",
  };
}

// ---- Live-out plans --------------------------------------------------------------------------------------------

export function liveOutPlanFormSchema(mode: FormMode) {
  return z
    .object({
      service_id: z.string(),
      code: z.string(),
      name: translatableInput(120),
      kind: z.enum(PLAN_KINDS),
      service_days_per_month: intInput("serviceDays", 1, 31),
      rest_days_per_week: intInput("restDays", 0, 6),
      work_hours: intInput("workHours", 1, 16),
      break_minutes: intInput("breakMinutes", 0, 240),
      window_start: timeInput,
      window_end: timeInput,
      // Empty = no approved price: the plan stays hidden from customers (D-03).
      price: optionalMoneyInput(),
      vat_inclusive: z.boolean(),
      max_active_contracts: optionalIntInput("maxContracts", 0, 100000),
      is_active: z.boolean(),
      sort_order: intInput("sortOrder", 0, 65535),
      reason: z.string(),
    })
    .transform((v, ctx) => {
      const serviceId = v.service_id === "" ? null : Number(v.service_id);
      if (mode === "create" && serviceId === null) addIssue(ctx, "serviceRequired", ["service_id"]);
      const code = mode === "create" ? catalogCodeInput().safeParse(v.code) : null;
      if (code && !code.success) addIssue(ctx, (code.error.issues[0]?.message as CatalogErrorKey) ?? "codeFormat", ["code"]);

      // LiveOutPlanRequest::crossCheck: the window must fit the work hours plus the break.
      const start = minutesOf(v.window_start);
      const end = minutesOf(v.window_end);
      if (end <= start) addIssue(ctx, "windowOrder", ["window_end"]);
      else if (end - start < v.work_hours * 60 + v.break_minutes) addIssue(ctx, "windowTooShort", ["window_end"]);

      const payload: LiveOutPlanPayload = {
        ...(mode === "create" && serviceId !== null ? { service_id: serviceId } : {}),
        ...(mode === "create" && code?.success ? { code: code.data } : {}),
        name: v.name,
        kind: v.kind,
        service_days_per_month: v.service_days_per_month,
        rest_days_per_week: v.rest_days_per_week,
        work_hours: v.work_hours,
        break_minutes: v.break_minutes,
        window_start: v.window_start,
        window_end: v.window_end,
        price_fils: v.price,
        vat_inclusive: v.vat_inclusive,
        max_active_contracts: v.max_active_contracts,
        is_active: v.is_active,
        sort_order: v.sort_order,
      };
      return { payload, reason: v.reason };
    });
}

export type LiveOutPlanFormValues = z.input<ReturnType<typeof liveOutPlanFormSchema>>;

export function planToFormValues(p: LiveOutPlan | null, serviceId?: number): LiveOutPlanFormValues {
  if (!p) {
    // Spec §21 defaults: 26 service days, 1 rest day a week, 09:00–18:00 = 8 h work + 1 h break.
    return {
      service_id: serviceId ? String(serviceId) : "",
      code: "",
      name: emptyTranslatable(),
      kind: "monthly",
      service_days_per_month: "26",
      rest_days_per_week: "1",
      work_hours: "8",
      break_minutes: "60",
      window_start: "09:00",
      window_end: "18:00",
      price: "",
      vat_inclusive: true,
      max_active_contracts: "",
      is_active: false,
      sort_order: "0",
      reason: "",
    };
  }
  return {
    service_id: String(p.service_id),
    code: p.code,
    name: translatableText(p.name),
    kind: p.kind,
    service_days_per_month: String(p.service_days_per_month),
    rest_days_per_week: String(p.rest_days_per_week),
    work_hours: String(p.work_hours),
    break_minutes: String(p.break_minutes),
    window_start: p.window_start,
    window_end: p.window_end,
    price: p.price_fils === null ? "" : filsToAedInput(p.price_fils),
    vat_inclusive: p.vat_inclusive,
    max_active_contracts: numText(p.max_active_contracts),
    is_active: p.is_active,
    sort_order: String(p.sort_order),
    reason: "",
  };
}

// ---- Add-ons ---------------------------------------------------------------------------------------------------

export function addonFormSchema(mode: FormMode) {
  return z
    .object({
      code: z.string(),
      name: translatableInput(120),
      amount: moneyInput(),
      vat_inclusive: z.boolean(),
      per: z.enum(ADDON_PERS),
      is_active: z.boolean(),
      sort_order: intInput("sortOrder", 0, 65535),
      reason: z.string(),
    })
    .transform((v, ctx) => {
      const code = mode === "create" ? catalogCodeInput().safeParse(v.code) : null;
      if (code && !code.success) addIssue(ctx, (code.error.issues[0]?.message as CatalogErrorKey) ?? "codeFormat", ["code"]);
      const payload: AddonPayload = {
        ...(mode === "create" && code?.success ? { code: code.data } : {}),
        name: v.name,
        amount_fils: v.amount,
        vat_inclusive: v.vat_inclusive,
        per: v.per,
        is_active: v.is_active,
        sort_order: v.sort_order,
      };
      return { payload, reason: v.reason };
    });
}

export type AddonFormValues = z.input<ReturnType<typeof addonFormSchema>>;

export function addonToFormValues(a: Addon | null): AddonFormValues {
  if (!a) {
    return {
      code: "",
      name: emptyTranslatable(),
      amount: "",
      vat_inclusive: true,
      per: "visit",
      is_active: false,
      sort_order: "0",
      reason: "",
    };
  }
  return {
    code: a.code,
    name: translatableText(a.name),
    amount: filsToAedInput(a.amount_fils),
    vat_inclusive: a.vat_inclusive,
    per: a.per,
    is_active: a.is_active,
    sort_order: String(a.sort_order),
    reason: "",
  };
}

// ---- Coupons ---------------------------------------------------------------------------------------------------

/** usage limits are unsigned INT columns (CouponRequest::MAX_USAGE_LIMIT). */
const MAX_USAGE_LIMIT = 4_294_967_295;

export function couponFormSchema(mode: FormMode) {
  return z
    .object({
      code: z.string(),
      type: z.enum(DISCOUNT_TYPES),
      value: z.string(),
      max_discount: optionalMoneyInput(),
      min_order: optionalMoneyInput(),
      valid_from: dateInput,
      valid_to: dateInput,
      usage_limit_total: optionalIntInput("usageLimit", 1, MAX_USAGE_LIMIT),
      usage_limit_per_customer: optionalIntInput("usageLimit", 1, MAX_USAGE_LIMIT),
      service_ids: z.array(z.string()),
      package_ids: z.array(z.string()),
      first_booking_only: z.boolean(),
      is_active: z.boolean(),
      reason: z.string(),
    })
    .transform((v, ctx) => {
      const code = mode === "create" ? couponCodeInput().safeParse(v.code) : null;
      if (code && !code.success) {
        addIssue(ctx, (code.error.issues[0]?.message as CatalogErrorKey) ?? "couponCodeFormat", ["code"]);
      }

      // Percent coupons take 1..100; a fixed coupon is a net (pre-VAT) amount in fils (R-07), at least 0.01.
      let value: number | null = null;
      if (v.type === "percent") {
        const n = parseWholeNumber(v.value);
        if (v.value.trim() === "") addIssue(ctx, "required", ["value"]);
        else if (n === null || n < 1 || n > 100) addIssue(ctx, "percent1to100", ["value"]);
        else value = n;
      } else {
        const money = parseMoney(v.value, 1);
        if (!money.ok) addIssue(ctx, money.error, ["value"]);
        else value = money.fils;
      }

      if (v.valid_from && v.valid_to && v.valid_from > v.valid_to) addIssue(ctx, "dateRange", ["valid_to"]);
      if (
        v.usage_limit_total !== null &&
        v.usage_limit_per_customer !== null &&
        v.usage_limit_per_customer > v.usage_limit_total
      ) {
        addIssue(ctx, "perCustomerLimit", ["usage_limit_per_customer"]);
      }

      if (value === null) return z.NEVER;
      const serviceIds = v.service_ids.map(Number);
      const packageIds = v.package_ids.map(Number);
      const appliesTo =
        serviceIds.length || packageIds.length || v.first_booking_only
          ? {
              ...(serviceIds.length ? { service_ids: serviceIds } : {}),
              ...(packageIds.length ? { package_ids: packageIds } : {}),
              ...(v.first_booking_only ? { first_booking_only: true } : {}),
            }
          : null;

      const payload: CouponPayload = {
        ...(mode === "create" && code?.success ? { code: code.data } : {}),
        type: v.type,
        value,
        max_discount_fils: v.max_discount,
        min_order_fils: v.min_order,
        valid_from: v.valid_from,
        valid_to: v.valid_to,
        usage_limit_total: v.usage_limit_total,
        usage_limit_per_customer: v.usage_limit_per_customer,
        applies_to: appliesTo,
        is_active: v.is_active,
      };
      return { payload, reason: v.reason };
    });
}

export type CouponFormValues = z.input<ReturnType<typeof couponFormSchema>>;

export function couponToFormValues(c: Coupon | null): CouponFormValues {
  if (!c) {
    return {
      code: "",
      type: "percent",
      value: "",
      max_discount: "",
      min_order: "",
      valid_from: "",
      valid_to: "",
      usage_limit_total: "",
      usage_limit_per_customer: "",
      service_ids: [],
      package_ids: [],
      first_booking_only: false,
      is_active: false,
      reason: "",
    };
  }
  return {
    code: c.code,
    type: c.type,
    value: c.type === "fixed" ? filsToAedInput(c.value) : String(c.value),
    max_discount: c.max_discount_fils === null ? "" : filsToAedInput(c.max_discount_fils),
    min_order: c.min_order_fils === null ? "" : filsToAedInput(c.min_order_fils),
    valid_from: text(c.valid_from),
    valid_to: text(c.valid_to),
    usage_limit_total: numText(c.usage_limit_total),
    usage_limit_per_customer: numText(c.usage_limit_per_customer),
    service_ids: (c.applies_to?.service_ids ?? []).map(String),
    package_ids: (c.applies_to?.package_ids ?? []).map(String),
    first_booking_only: c.applies_to?.first_booking_only === true,
    is_active: c.is_active,
    reason: "",
  };
}

/** Re-exported for forms that build a translatable row. */
export { translatableValue };
