import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { CatalogService, ServiceKind, ServicePrice, SlotTemplate } from "../types";
import {
  addonFormSchema,
  addonToFormValues,
  couponFormSchema,
  couponToFormValues,
  liveOutPlanFormSchema,
  packageFormSchema,
  packageToFormValues,
  planToFormValues,
  priceFormSchema,
  priceSlotChoices,
  priceToFormValues,
  serviceCreateSchema,
  serviceFormSchema,
  serviceToFormValues,
  newServiceValues,
} from "./forms";

/** The issue messages (error keys) by path, e.g. { "max_workers": ["maxWorkersBelowMin"] }. */
function issues(result: z.ZodSafeParseResult<unknown>): Record<string, string[]> {
  if (result.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const service: CatalogService = {
  id: 1,
  code: "STANDARD_VISIT",
  kind: "standard_visit",
  name: { ar: "زيارة تنظيف", en: "Cleaning visit" },
  description: null,
  includes: [{ ar: "المطبخ", en: "Kitchen" }],
  excludes: [],
  duration_minutes: 240,
  min_workers: 1,
  max_workers: 4,
  team_size_default: null,
  requires_equipment: false,
  materials_mode: "customer",
  is_active: true,
  is_bookable_online: true,
  sort_order: 10,
  cancellation_policy_id: 3,
  reschedule_policy_id: null,
  refund_policy_id: null,
  version: 5,
  created_at: null,
  updated_at: null,
};

describe("service form (ServiceRequest rules)", () => {
  it("turns the loaded service back into the same payload", () => {
    const result = serviceFormSchema.safeParse(serviceToFormValues(service));
    expect(result.success).toBe(true);
    expect(result.data?.payload).toEqual({
      name: service.name,
      description: null,
      includes: service.includes,
      excludes: [],
      duration_minutes: 240,
      min_workers: 1,
      max_workers: 4,
      team_size_default: null,
      requires_equipment: false,
      materials_mode: "customer",
      is_active: true,
      is_bookable_online: true,
      sort_order: 10,
      cancellation_policy_id: 3,
      reschedule_policy_id: null,
      refund_policy_id: null,
    });
  });

  it("needs 15-minute steps between 15 and 1440 minutes", () => {
    const values = serviceToFormValues(service);
    expect(issues(serviceFormSchema.safeParse({ ...values, duration_minutes: "250" }))).toEqual({ duration_minutes: ["duration"] });
    expect(issues(serviceFormSchema.safeParse({ ...values, duration_minutes: "1455" }))).toEqual({ duration_minutes: ["duration"] });
    expect(serviceFormSchema.safeParse({ ...values, duration_minutes: "٢٢٥" }).data?.payload.duration_minutes).toBe(225);
  });

  it("keeps max workers ≥ min and the team size between them", () => {
    const values = serviceToFormValues(service);
    expect(issues(serviceFormSchema.safeParse({ ...values, min_workers: "3", max_workers: "2" }))).toEqual({
      max_workers: ["maxWorkersBelowMin"],
    });
    expect(issues(serviceFormSchema.safeParse({ ...values, team_size_default: "5" }))).toEqual({
      team_size_default: ["teamSizeOutOfRange"],
    });
    expect(issues(serviceFormSchema.safeParse({ ...values, max_workers: "21" }))).toEqual({ max_workers: ["workers"] });
  });

  it("needs both languages for names, descriptions and list items", () => {
    const values = serviceToFormValues(service);
    expect(issues(serviceFormSchema.safeParse({ ...values, name: { ar: "زيارة", en: " " } }))).toEqual({ "name.en": ["nameRequired"] });
    expect(issues(serviceFormSchema.safeParse({ ...values, description: { ar: "", en: "Only English" } }))).toEqual({
      "description.ar": ["bilingualPair"],
    });
    expect(
      issues(
        serviceFormSchema.safeParse({
          ...values,
          includes: [
            { ar: "", en: "" },
            { ar: "غسيل", en: "" },
          ],
        }),
      ),
    ).toEqual({ "includes.1.en": ["itemIncomplete"] });
  });

  it("drops empty list rows and trims text", () => {
    const values = serviceToFormValues(service);
    const result = serviceFormSchema.safeParse({
      ...values,
      description: { ar: "  وصف  ", en: " Text " },
      excludes: [{ ar: "", en: "" }, { ar: " الكي ", en: "Ironing " }],
    });
    expect(result.data?.payload.description).toEqual({ ar: "وصف", en: "Text" });
    expect(result.data?.payload.excludes).toEqual([{ ar: "الكي", en: "Ironing" }]);
  });

  it("upper-cases new codes and refuses codes the API would refuse", () => {
    const values = { ...newServiceValues(), name: { ar: "خدمة", en: "Service" } };
    expect(serviceCreateSchema.safeParse({ ...values, code: " deep_clean " }).data?.payload.code).toBe("DEEP_CLEAN");
    expect(issues(serviceCreateSchema.safeParse({ ...values, code: "1DEEP" }))).toEqual({ code: ["codeFormat"] });
    expect(issues(serviceCreateSchema.safeParse({ ...values, code: "" }))).toEqual({ code: ["required"] });
  });
});

describe("price form: AED in the form, integer fils in the API", () => {
  const row: ServicePrice = {
    id: 9,
    service_id: 1,
    zone_id: 2,
    slot_template_id: null,
    day_of_week: 5,
    valid_from: "2026-11-01",
    valid_to: null,
    unit: "per_worker_visit",
    amount_fils: 12050,
    vat_inclusive: true,
    priority: 10,
    unit_breakdown: { net_fils: 11476, vat_fils: 574, gross_fils: 12050, vat_rate_percent: 5 },
    version: 2,
    created_at: null,
    updated_at: null,
  };

  it("shows fils as AED and sends the same fils back", () => {
    const values = priceToFormValues(row, "standard_visit");
    expect(values.amount).toBe("120.50");
    expect(priceFormSchema.parse(values).payload).toEqual({
      zone_id: 2,
      slot_template_id: null,
      day_of_week: 5,
      valid_from: "2026-11-01",
      valid_to: null,
      unit: "per_worker_visit",
      amount_fils: 12050,
      vat_inclusive: true,
      priority: 10,
    });
  });

  it.each([
    ["120", 12000],
    ["120.5", 12050],
    ["0.07", 7],
    ["1,200.75", 120075],
    ["٤٥٠٠", 450000],
    ["0", 0],
  ])("parses %s AED as %d fils", (amount, fils) => {
    const values = { ...priceToFormValues(null, "standard_visit"), amount };
    expect(priceFormSchema.parse(values).payload.amount_fils).toBe(fils);
  });

  it.each([
    ["", "moneyRequired"],
    ["12.345", "moneyPrecision"],
    ["-5", "moneyNegative"],
    ["abc", "money"],
    ["2000000000", "moneyTooLarge"],
  ])("refuses %j (%s)", (amount, key) => {
    const values = { ...priceToFormValues(null, "standard_visit"), amount };
    expect(issues(priceFormSchema.safeParse(values))).toEqual({ amount: [key] });
  });

  it("targets one slot template, or every slot when left empty", () => {
    const evening = { ...row, slot_template_id: 2 };
    expect(priceToFormValues(evening, "standard_visit").slot_template_id).toBe("2");
    expect(priceFormSchema.parse(priceToFormValues(evening, "standard_visit")).payload.slot_template_id).toBe(2);
    expect(priceFormSchema.parse({ ...priceToFormValues(evening, "standard_visit"), slot_template_id: "" }).payload.slot_template_id).toBeNull();
  });

  it("offers the slots of the service's kind, and keeps the row's own slot whatever its kind", () => {
    const slot = (id: number, service_kind: ServiceKind): SlotTemplate => ({
      id,
      code: `S${id}`,
      name: { ar: `فترة ${id}`, en: `Slot ${id}` },
      start_time: "10:00",
      end_time: "14:00",
      service_kind,
      is_active: true,
      sort_order: id,
      version: 1,
      updated_at: null,
    });
    const slots = [slot(1, "standard_visit"), slot(2, "live_out"), slot(3, "standard_visit")];
    expect(priceSlotChoices(slots, "standard_visit", null).map((s) => s.id)).toEqual([1, 3]);
    expect(priceSlotChoices(slots, "standard_visit", 2).map((s) => s.id)).toEqual([1, 2, 3]);
    expect(priceSlotChoices(slots, "live_out", null).map((s) => s.id)).toEqual([2]);
  });

  it("defaults new rows to all zones, every slot, any day, VAT inclusive and the kind's unit", () => {
    const values = { ...priceToFormValues(null, "live_out"), amount: "4500" };
    expect(priceFormSchema.parse(values).payload).toMatchObject({
      zone_id: null,
      slot_template_id: null,
      day_of_week: null,
      unit: "per_month",
      amount_fils: 450000,
      vat_inclusive: true,
      priority: 0,
    });
  });

  it("checks the validity dates and the priority range", () => {
    const base = { ...priceToFormValues(null, "standard_visit"), amount: "120" };
    expect(issues(priceFormSchema.safeParse({ ...base, valid_from: "2026-12-01", valid_to: "2026-11-30" }))).toEqual({
      valid_to: ["dateRange"],
    });
    expect(issues(priceFormSchema.safeParse({ ...base, priority: "1001" }))).toEqual({ priority: ["priority"] });
  });
});

describe("package form (PackageRequest rules)", () => {
  const base = () => ({ ...packageToFormValues(null, 1), code: "weekly_2", name: { ar: "مرتان", en: "Twice" } });

  it("builds the create payload with exactly one term", () => {
    const payload = packageFormSchema("create").parse({ ...base(), visits_per_week: "2", term_unit: "months", term_value: "3" }).payload;
    expect(payload).toMatchObject({ service_id: 1, code: "WEEKLY_2", visits_per_week: 2, term_weeks: null, term_months: 3 });
  });

  it("only offers 1, 2, 3, 4 or 6 visits a week", () => {
    expect(issues(packageFormSchema("create").safeParse({ ...base(), visits_per_week: "5" }))).toEqual({
      visits_per_week: ["visitsPerWeek"],
    });
  });

  it("limits terms to 104 weeks or 24 months", () => {
    expect(issues(packageFormSchema("create").safeParse({ ...base(), term_unit: "weeks", term_value: "105" }))).toEqual({
      term_value: ["termWeeks"],
    });
    expect(issues(packageFormSchema("create").safeParse({ ...base(), term_unit: "months", term_value: "25" }))).toEqual({
      term_value: ["termMonths"],
    });
  });

  it("takes percent discounts up to 100 and fixed discounts as net fils (R-07)", () => {
    expect(issues(packageFormSchema("create").safeParse({ ...base(), discount_type: "percent", discount_value: "101" }))).toEqual({
      discount_value: ["percent0to100"],
    });
    const fixed = packageFormSchema("create").parse({ ...base(), discount_type: "fixed", discount_value: "50.25" }).payload;
    expect(fixed).toMatchObject({ discount_type: "fixed", discount_value: 5025 });
  });

  it("does not send the fixed service or code when editing", () => {
    const values = { ...base(), code: "WEEKLY_2" };
    const payload = packageFormSchema("edit").parse(values).payload;
    expect(payload).not.toHaveProperty("service_id");
    expect(payload).not.toHaveProperty("code");
  });

  it("requires a service on create", () => {
    expect(issues(packageFormSchema("create").safeParse({ ...base(), service_id: "" }))).toEqual({ service_id: ["serviceRequired"] });
  });
});

describe("Live-out plan form (LiveOutPlanRequest rules)", () => {
  const base = () => ({ ...planToFormValues(null, 7), code: "monthly_2", name: { ar: "شهري", en: "Monthly" } });

  it("keeps an empty price as null: the plan stays hidden until priced (D-03)", () => {
    const payload = liveOutPlanFormSchema("create").parse({ ...base(), kind: "trial_day", price: "" }).payload;
    expect(payload.price_fils).toBeNull();
    expect(payload.kind).toBe("trial_day");
  });

  it("sends the monthly price in fils", () => {
    expect(liveOutPlanFormSchema("create").parse({ ...base(), price: "4,500" }).payload.price_fils).toBe(450000);
  });

  it("needs the window to fit the work hours plus the break", () => {
    expect(issues(liveOutPlanFormSchema("create").safeParse({ ...base(), window_end: "17:00" }))).toEqual({
      window_end: ["windowTooShort"],
    });
    expect(issues(liveOutPlanFormSchema("create").safeParse({ ...base(), window_start: "18:00", window_end: "09:00" }))).toEqual({
      window_end: ["windowOrder"],
    });
    expect(issues(liveOutPlanFormSchema("create").safeParse({ ...base(), window_start: "9:00" }))).toEqual({ window_start: ["time"] });
  });

  it("checks the day limits", () => {
    expect(issues(liveOutPlanFormSchema("create").safeParse({ ...base(), service_days_per_month: "32" }))).toEqual({
      service_days_per_month: ["serviceDays"],
    });
    expect(issues(liveOutPlanFormSchema("create").safeParse({ ...base(), rest_days_per_week: "7" }))).toEqual({
      rest_days_per_week: ["restDays"],
    });
  });
});

describe("add-on form (AddonRequest rules)", () => {
  it("requires an amount and sends fils", () => {
    const values = { ...addonToFormValues(null), code: "materials", name: { ar: "مواد", en: "Materials" } };
    expect(issues(addonFormSchema("create").safeParse(values))).toEqual({ amount: ["moneyRequired"] });
    expect(addonFormSchema("create").parse({ ...values, amount: "15" }).payload).toMatchObject({ code: "MATERIALS", amount_fils: 1500 });
  });
});

describe("coupon form (CouponRequest rules)", () => {
  const base = () => ({ ...couponToFormValues(null), code: "summer-10", value: "10" });

  it("upper-cases the code", () => {
    expect(couponFormSchema("create").parse(base()).payload.code).toBe("SUMMER-10");
    expect(issues(couponFormSchema("create").safeParse({ ...base(), code: "ab" }))).toEqual({ code: ["couponCodeFormat"] });
    expect(issues(couponFormSchema("create").safeParse({ ...base(), code: "-ABC" }))).toEqual({ code: ["couponCodeFormat"] });
  });

  it("takes percentages from 1 to 100", () => {
    expect(issues(couponFormSchema("create").safeParse({ ...base(), value: "0" }))).toEqual({ value: ["percent1to100"] });
    expect(issues(couponFormSchema("create").safeParse({ ...base(), value: "101" }))).toEqual({ value: ["percent1to100"] });
    expect(couponFormSchema("create").parse({ ...base(), value: "100" }).payload.value).toBe(100);
  });

  it("sends a fixed coupon as a net amount in fils (R-07)", () => {
    const payload = couponFormSchema("create").parse({ ...base(), type: "fixed", value: "50", max_discount: "", min_order: "200" }).payload;
    expect(payload).toMatchObject({ type: "fixed", value: 5000, max_discount_fils: null, min_order_fils: 20000 });
    expect(issues(couponFormSchema("create").safeParse({ ...base(), type: "fixed", value: "0" }))).toEqual({ value: ["moneyPositive"] });
  });

  it("keeps the per-customer limit within the total", () => {
    expect(
      issues(couponFormSchema("create").safeParse({ ...base(), usage_limit_total: "10", usage_limit_per_customer: "11" })),
    ).toEqual({ usage_limit_per_customer: ["perCustomerLimit"] });
  });

  it("builds applies_to only from what is set", () => {
    expect(couponFormSchema("create").parse(base()).payload.applies_to).toBeNull();
    expect(
      couponFormSchema("create").parse({ ...base(), service_ids: ["3", "4"], first_booking_only: true }).payload.applies_to,
    ).toEqual({ service_ids: [3, 4], first_booking_only: true });
  });

  it("does not resend the fixed code when editing", () => {
    expect(couponFormSchema("edit").parse(base()).payload).not.toHaveProperty("code");
  });
});
