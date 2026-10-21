import type {
  CatalogPackage,
  CatalogPreview,
  CatalogService,
  LiveOutPlan,
  Policy,
  PublicService,
  ServicePrice,
  SubZone,
  Zone,
} from "@/lib/admin/types";

/*
 * A11 records shaped like the API resources return them (CatalogSeeder / DemoZonesSeeder data), for component tests.
 */

export const standardPrice: ServicePrice = {
  id: 1,
  service_id: 1,
  zone_id: null,
  slot_template_id: null,
  day_of_week: null,
  valid_from: null,
  valid_to: null,
  unit: "per_worker_visit",
  amount_fils: 12000,
  vat_inclusive: true,
  priority: 0,
  unit_breakdown: { net_fils: 11429, vat_fils: 571, gross_fils: 12000, vat_rate_percent: 5 },
  version: 1,
  created_at: "2026-10-20T23:37:05+00:00",
  updated_at: "2026-10-20T23:37:05+00:00",
};

export const weeklyPackage: CatalogPackage = {
  id: 1,
  service_id: 1,
  code: "WEEKLY_1",
  name: { ar: "مرة أسبوعيًا", en: "Once a week" },
  visits_per_week: 1,
  term_weeks: 4,
  term_months: null,
  discount_type: "percent",
  discount_value: 0,
  min_visits_for_discount: null,
  auto_renew_allowed: true,
  max_skips_per_month: 1,
  max_freeze_days: 30,
  is_active: true,
  sort_order: 1,
  cancellation_policy_id: 1,
  reschedule_policy_id: 2,
  refund_policy_id: 3,
  version: 1,
  created_at: null,
  updated_at: null,
};

export const standardService: CatalogService = {
  id: 1,
  code: "STANDARD_VISIT",
  kind: "standard_visit",
  name: { ar: "زيارة تنظيف", en: "Cleaning visit" },
  description: { ar: "تنظيف عام وترتيب للغرف.", en: "General cleaning and tidying of rooms." },
  includes: [
    { ar: "تنظيف المطبخ", en: "Kitchen cleaning" },
    { ar: "تنظيف الحمامات", en: "Bathroom cleaning" },
  ],
  excludes: [{ ar: "التنظيف العميق", en: "Deep cleaning" }],
  duration_minutes: 240,
  min_workers: 1,
  max_workers: 4,
  team_size_default: null,
  requires_equipment: false,
  materials_mode: "customer",
  is_active: true,
  is_bookable_online: true,
  sort_order: 1,
  cancellation_policy_id: 1,
  reschedule_policy_id: 2,
  refund_policy_id: 3,
  version: 1,
  created_at: null,
  updated_at: null,
  prices: [standardPrice],
  packages: [weeklyPackage],
  live_out_plans: [],
};

export const trialPlan: LiveOutPlan = {
  id: 1,
  service_id: 2,
  code: "TRIAL_DAY",
  name: { ar: "يوم تجريبي", en: "Trial day" },
  kind: "trial_day",
  service_days_per_month: 1,
  rest_days_per_week: 0,
  work_hours: 8,
  break_minutes: 60,
  window_start: "09:00",
  window_end: "18:00",
  price_fils: null,
  vat_inclusive: true,
  max_active_contracts: null,
  is_active: true,
  sort_order: 1,
  version: 1,
  created_at: null,
  updated_at: null,
};

export const policies: Policy[] = [
  {
    id: 1,
    code: "CANCELLATION_DEFAULT",
    type: "cancellation",
    name: { ar: "سياسة الإلغاء", en: "Cancellation policy" },
    rules: {
      // Key order as MySQL returns the JSON column.
      exceptions: ["weather_alert", "medical_with_proof"],
      cancellation: [
        { min_hours_before: 24, fee_type: "percent", fee_value: 0 },
        { min_hours_before: 6, fee_type: "percent", fee_value: 50 },
        { min_hours_before: 0, fee_type: "percent", fee_value: 100 },
      ],
      company_cancellation: { refund_percent: 100, compensation: "none" },
    },
    is_active: true,
    version: 1,
    created_at: null,
    updated_at: null,
  },
  {
    id: 2,
    code: "RESCHEDULE_DEFAULT",
    type: "reschedule",
    name: { ar: "سياسة إعادة الجدولة", en: "Reschedule policy" },
    rules: {
      reschedule: { free_until_hours_before: 24, fee_fils_after: 2500, max_per_booking: 2, requires_approval: true },
      exceptions: ["weather_alert", "medical_with_proof"],
    },
    is_active: true,
    version: 1,
    created_at: null,
    updated_at: null,
  },
  {
    id: 3,
    code: "REFUND_DEFAULT",
    type: "refund",
    name: { ar: "سياسة الاسترداد", en: "Refund policy" },
    rules: { company_cancellation: { refund_percent: 100, compensation: "none" }, exceptions: [] },
    is_active: true,
    version: 1,
    created_at: null,
    updated_at: null,
  },
];

const ring = (points: [number, number][]) => [...points, points[0]];

export const downtown: SubZone = {
  id: 1,
  zone_id: 1,
  code: "DEMO_BB_DOWNTOWN",
  name: { ar: "وسط المدينة", en: "Downtown" },
  is_active: true,
  polygon: {
    type: "Polygon",
    coordinates: [
      ring([
        [55.27, 25.193],
        [55.28, 25.193],
        [55.283, 25.1965],
        [55.278, 25.199],
        [55.27, 25.199],
        [55.269, 25.196],
      ]),
    ],
  },
  bbox: { min_lat: 25.193, max_lat: 25.199, min_lng: 55.269, max_lng: 55.283 },
  version: 1,
  active_addresses_count: 0,
  created_at: null,
  updated_at: null,
};

export const businessBay: Zone = {
  id: 1,
  code: "DEMO_BB",
  name: { ar: "الخليج التجاري", en: "Business Bay" },
  is_active: true,
  polygon: {
    type: "Polygon",
    coordinates: [
      ring([
        [55.255, 25.1855],
        [55.2615, 25.1925],
        [55.2685, 25.2],
        [55.279, 25.2],
        [55.285, 25.196],
        [55.285, 25.188],
        [55.276, 25.185],
        [55.262, 25.185],
      ]),
    ],
  },
  bbox: { min_lat: 25.185, max_lat: 25.2, min_lng: 55.255, max_lng: 55.285 },
  default_travel_buffer_min: null,
  sort_order: 10,
  version: 1,
  active_addresses_count: 3,
  sub_zones: [downtown],
  created_at: null,
  updated_at: null,
};

function publicService(lang: "ar" | "en", name: string, includes: string[]): PublicService {
  return {
    code: "STANDARD_VISIT",
    kind: "standard_visit",
    name,
    description: lang === "ar" ? "تنظيف عام وترتيب للغرف." : "General cleaning and tidying of rooms.",
    includes,
    excludes: [lang === "ar" ? "التنظيف العميق" : "Deep cleaning"],
    duration_minutes: 240,
    min_workers: 1,
    max_workers: 4,
    materials_mode: "customer",
    currency: "AED",
    price_from_fils: 12000,
    price_unit: "per_worker_visit",
    vat_inclusive_display: true,
    packages: [
      {
        code: "WEEKLY_1",
        name: lang === "ar" ? "مرة أسبوعيًا" : "Once a week",
        visits_per_week: 1,
        term_weeks: 4,
        term_months: null,
        discount_type: "percent",
        discount_value: 0,
        min_visits_for_discount: null,
        auto_renew_allowed: true,
        max_skips_per_month: 1,
        max_freeze_days: 30,
      },
    ],
    live_out_plans: [],
  };
}

/** POST /admin/catalog/preview answer for a renamed standard visit (R-07 line totals for 1–2 workers). */
export const servicePreview: CatalogPreview = {
  payload: {
    ar: publicService("ar", "زيارة تنظيف (4 ساعات)", ["تنظيف المطبخ", "تنظيف الحمامات"]),
    en: publicService("en", "Cleaning visit (4 hours)", ["Kitchen cleaning", "Bathroom cleaning"]),
  },
  price_examples: [
    { workers: 1, gross_fils: 12000, net_fils: 11429, vat_fils: 571 },
    { workers: 2, gross_fils: 24000, net_fils: 22857, vat_fils: 1143 },
  ],
};
