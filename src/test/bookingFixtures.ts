import type { BookingDetail, BookingRow, DashboardSummary, SlotTemplateOption, VisitCandidates } from "@/lib/admin/types";

// Shapes as the local API answers them (Phase 3 resources, seeded demo data: zone DEMO_BB, service STANDARD_VISIT).

export const zoneOptions = [
  { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" }, is_active: true },
  { id: 2, code: "DEMO_AR", name: { ar: "المرابع العربية", en: "Arabian Ranches" }, is_active: true },
];

export const serviceOptions = [
  { id: 1, code: "STANDARD_VISIT", name: { ar: "زيارة تنظيف", en: "Cleaning visit" }, kind: "standard_visit" as const, is_active: true },
];

/** GET /admin/slot-templates/options: the seeded slots (a live-out one and an inactive one are never offered for visits). */
export const slotTemplateOptions: SlotTemplateOption[] = [
  { id: 1, code: "MORNING", name: { ar: "الفترة الصباحية", en: "Morning" }, start_time: "10:00", end_time: "14:00", service_kind: "standard_visit", is_active: true },
  { id: 2, code: "EVENING", name: { ar: "المسائية", en: "Evening" }, start_time: "15:00", end_time: "19:00", service_kind: "standard_visit", is_active: true },
  { id: 3, code: "LIVE_OUT_DAY", name: { ar: "دوام كامل", en: "Live-out day" }, start_time: "08:00", end_time: "18:00", service_kind: "live_out", is_active: true },
  { id: 4, code: "NIGHT", name: { ar: "ليلية", en: "Night" }, start_time: "20:00", end_time: "23:00", service_kind: "standard_visit", is_active: false },
];

export const bookingRow = (over: Partial<BookingRow> = {}): BookingRow => ({
  id: 4,
  ulid: "01m5jxahxpamqgkzzygcxp2vjr",
  reference: "TRB-R4RYSD",
  kind: "single",
  customer: { id: "01m5dtszzdhx5gtmwvj7bmbvm9", name: "Sara Ahmed", phone: "+971500000001" },
  service: { id: 1, code: "STANDARD_VISIT", name: { ar: "زيارة تنظيف", en: "Cleaning visit" } },
  service_date: "2026-10-24",
  slot: { id: 1, code: "MORNING", name: { ar: "الفترة الصباحية", en: "Morning" }, start: "10:00", end: "14:00" },
  zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } },
  workers_count: 2,
  status: "pending_confirmation",
  status_label: { ar: "بانتظار التأكيد", en: "Pending confirmation" },
  payment_status: "authorized",
  payment_status_label: { ar: "تم حجز المبلغ", en: "Payment authorized" },
  source: "app",
  source_label: { ar: "التطبيق", en: "App" },
  total_fils: 24000,
  currency: "AED",
  hold_expires_at: "2026-10-22T23:12:18+00:00",
  confirmation_deadline_at: "2099-10-23T08:00:00+00:00",
  created_at: "2026-10-22T22:57:18+00:00",
  ...over,
});

export const bookingDetail = (over: Partial<BookingDetail> = {}): BookingDetail => ({
  ...bookingRow(),
  version: 3,
  address: {
    id: "01m5jx8m574825dx5g39qqmarz",
    lat: 25.19,
    lng: 55.27,
    area: null,
    label: "Home",
    street: null,
    zone_id: 1,
    building: "Tower 1",
    has_pets: true,
    pets_note: "A cat",
    zone_code: "DEMO_BB",
    sub_zone_id: null,
    unit_number: "1203",
    property_type: "apartment",
    sub_zone_code: null,
    parking_available: false,
    access_instructions: null,
    entry_permit_required: true,
    cleaning_materials_available: false,
  },
  priorities: ["kitchen", "bathrooms"],
  instructions: "Please ring twice",
  materials_by: "customer",
  preferred_worker: null,
  amounts: { subtotal_fils: 24000, addons_fils: 0, discount_fils: 0, net_fils: 22857, vat_rate_bp: 500, vat_fils: 1143, total_fils: 24000, currency: "AED" },
  lines: [
    {
      code: "STANDARD_VISIT",
      type: "service",
      unit: "per_worker_visit",
      quantity: 2,
      description: { ar: "زيارة تنظيف (سعر العاملة)", en: "Cleaning visit (price per worker)" },
      net_fils: 22857,
      vat_fils: 1143,
      gross_fils: 24000,
    },
  ],
  applied_rules: [],
  coupon: null,
  policy_snapshot: [],
  confirmed_at: null,
  cancelled_at: null,
  cancel_reason_code: null,
  cancel_reason_text: null,
  cancelled_by_type: null,
  rejected_reason: null,
  expired_at: null,
  visits: [
    {
      id: 4,
      ulid: "01m5jxahxst3kdzw3s4ew8f7r7",
      service_date: "2026-10-24",
      start: "10:00",
      end: "14:00",
      status: "scheduled",
      status_label: { ar: "مجدولة", en: "Scheduled" },
      sub_zone_id: null,
      assignments: [],
    },
  ],
  hold: null,
  payment: {
    id: "01m5jxahxw4z2hfd721cxrjbz6",
    status: "authorized",
    status_label: { ar: "تم حجز المبلغ", en: "Payment authorized" },
    intent: "authorize",
    gateway: "fake",
    gateway_payment_ref: "fpay_7d840edef61f3792fc64c510",
    method: "card",
    amount_fils: 24000,
    captured_fils: 0,
    refunded_fils: 0,
    currency: "AED",
    attempts: 1,
    needs_review: false,
    failure_code: null,
    authorized_at: "2026-10-22T22:57:19+00:00",
    captured_at: null,
    voided_at: null,
    void_reason: null,
    created_at: "2026-10-22T22:57:18+00:00",
  },
  invoice: null,
  history: [],
  timeline: [],
  photos: [],
  created_by_staff_id: null,
  confirmed_by: null,
  rejected_reason_code: null,
  cancellation: { party: null, cancelled_by_id: null, fee_fils: null, refund_fils: null, review_requested_at: null, review: null },
  reschedule_fee_fils: 0,
  reschedules_count: 0,
  customer_reschedules_count: 0,
  capture_unknown_at: null,
  alternative_proposals: [],
  reschedule_requests: [],
  notes: [],
  ...over,
});

const worker = (id: number, name: string, zone = 1) => ({
  id,
  ulid: `01W${id}`,
  employee_no: `DEMO-W0${id}`,
  display_name: name,
  full_name: { ar: name, en: name },
  home_zone_id: zone,
});

const reason = (code: string, en: string) => ({ code, label: { ar: en, en } });

export const visitCandidates = (missing = 2): VisitCandidates => ({
  visit: {
    id: 4,
    ulid: "01m5jxahxst3kdzw3s4ew8f7r7",
    version: 1,
    booking: {
      id: 4,
      ulid: "01m5jxahxpamqgkzzygcxp2vjr",
      reference: "TRB-R4RYSD",
      status: "pending_confirmation",
      status_label: { ar: "بانتظار التأكيد", en: "Pending confirmation" },
      service_id: 1,
      preferred_worker_id: null,
    },
    service_date: "2026-10-24",
    slot_template_id: 1,
    start: "10:00",
    end: "14:00",
    zone_id: 1,
    area: null,
    status: "scheduled",
    status_label: { ar: "مجدولة", en: "Scheduled" },
    workers_count: 2,
    assigned_count: 2 - missing,
    missing,
    vehicle_id: 1,
    workers: missing < 2 ? [{ id: 3, display_name: "Lakshmi N.", full_name: { ar: "لاكشمي", en: "Lakshmi Nair" }, assigned_at: "2026-10-23T10:00:00Z" }] : [],
    arrived_at: null,
    started_at: null,
    completed_at: null,
    late_minutes: null,
  },
  preferred_worker: null,
  candidates: [
    { rank: 1, worker: worker(1, "Maria S."), reasons: [reason("same_zone", "Based in the visit's zone.")], preferred: false, same_zone: true, served_customer_visits: 0, skill_match: null, assigned_minutes_this_week: 0, average_rating: null },
    { rank: 2, worker: worker(4, "Nirmala P."), reasons: [reason("same_zone", "Based in the visit's zone.")], preferred: false, same_zone: true, served_customer_visits: 0, skill_match: null, assigned_minutes_this_week: 0, average_rating: null },
    { rank: 3, worker: worker(5, "Tigist B."), reasons: [reason("same_zone", "Based in the visit's zone.")], preferred: false, same_zone: true, served_customer_visits: 0, skill_match: null, assigned_minutes_this_week: 0, average_rating: null },
  ],
  excluded: [
    { worker: worker(7, "Joy R.", 2), reason: reason("other_zone", "Based in another zone."), reasons: [reason("other_zone", "Based in another zone.")], overridable: true, rules: ["other_zone"] },
    { worker: worker(8, "Rosa M."), reason: reason("leave", "On leave."), reasons: [reason("leave", "On leave.")], overridable: false, rules: ["leave"] },
  ],
});

const link = (list: string, path: string, params: Record<string, string | number> = {}) => ({ list, path, params });

export const dashboardSummary = (over: Partial<DashboardSummary["cards"]> = {}): DashboardSummary => ({
  date: "2026-10-23",
  timezone: "Asia/Dubai",
  is_today: true,
  generated_at: "2026-10-23T14:57:03+00:00",
  zone: null,
  cards: {
    todays_bookings: {
      label: { ar: "حجوزات اليوم", en: "Today's bookings" },
      value: 18,
      workers: 26,
      by_slot: [
        { slot_template_id: 1, code: "MORNING", name: { ar: "صباحي", en: "Morning" }, start: "10:00", end: "14:00", bookings: 10 },
        { slot_template_id: 2, code: "EVENING", name: { ar: "مسائي", en: "Evening" }, start: "15:00", end: "19:00", bookings: 8 },
      ],
      link: link("bookings", "/api/v1/admin/bookings", { from: "2026-10-23", to: "2026-10-23" }),
    },
    pending_confirmation: {
      label: { ar: "بانتظار التأكيد", en: "Pending confirmation" },
      value: 6,
      for_date: 2,
      overdue: 1,
      next_deadline: { booking_id: 4, reference: "TRB-R4RYSD", deadline_at: "2026-10-23T16:00:00+00:00", minutes_left: 35, link: link("booking", "/api/v1/admin/bookings/4") },
      oldest_request: { booking_id: 1, reference: "TRB-AFG8D7", pending_since: "2026-10-23T12:47:00+00:00", waiting_minutes: 130, link: link("booking", "/api/v1/admin/bookings/1") },
      link: link("bookings", "/api/v1/admin/bookings", { status: "pending_confirmation" }),
    },
    uncovered_visits: {
      label: { ar: "زيارات غير مغطاة", en: "Uncovered visits" },
      value: 2,
      missing_workers: 3,
      link: link("schedule", "/api/v1/admin/schedule", { view: "day", date: "2026-10-23" }),
    },
    on_time_rate: {
      label: { ar: "الوصول في الموعد", en: "On-time arrival" },
      value: 92,
      arrived: 12,
      on_time: 11,
      late: 1,
      overdue: 0,
      grace_minutes: 10,
      link: link("schedule", "/api/v1/admin/schedule", { view: "day", date: "2026-10-23" }),
    },
    ...over,
  },
  panels: {
    bookings_by_status: [
      { status: "pending_confirmation", label: { ar: "بانتظار التأكيد", en: "Pending confirmation" }, bookings: 2, link: link("bookings", "/api/v1/admin/bookings", { from: "2026-10-23", to: "2026-10-23", status: "pending_confirmation" }) },
      { status: "confirmed", label: { ar: "مؤكد", en: "Confirmed" }, bookings: 0, link: link("bookings", "/api/v1/admin/bookings", { status: "confirmed" }) },
    ],
    bookings_by_slot: [
      { slot_template_id: 1, code: "MORNING", name: { ar: "صباحي", en: "Morning" }, start: "10:00", end: "14:00", bookings: 10, workers: 14, uncovered_visits: 1, link: null },
    ],
    bookings_by_zone: [
      { zone_id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay & Downtown" }, bookings: 18, workers: 26, link: link("bookings", "/api/v1/admin/bookings", { from: "2026-10-23", to: "2026-10-23", zone_id: 1 }) },
    ],
    workers: { total: 12, available: 9, absent: 1, live_out: 2, off: 0, assigned: 7, late: 1, link: null },
    fleet: {
      vehicles: { total: 2, active: 2, maintenance: 0, inactive: 0, in_use: 2 },
      rounds: [
        { slot_template_id: 1, code: "MORNING", name: { ar: "صباحي", en: "Morning" }, start: "10:00", end: "14:00", rounds: 2, planned: 0, departed: 2, completed: 0, cancelled: 0, seats_used: 10, seats_total: 14, link: null },
      ],
    },
  },
  quick_stats: {
    sales: null,
    occupancy: { percent: 20, used_units: 4, available_units: 20 },
    cancellations: { total: 1, customer: 1, company: 0, system: 0 },
    rating: null,
  },
});
