import type {
  CalendarDay,
  CancelPlan,
  SubscriptionCalendar,
  SubscriptionDetail,
  SubscriptionEvent,
  SubscriptionOccurrence,
  SubscriptionPage,
  SubscriptionRow,
  WorkerCandidate,
} from "@/lib/admin/subscriptions/types";

// Shapes as the Phase 4 API answers them (A5a, A5b, A6 and A8 contracts; the generated schema types every one). "Now" in tests is Fri 23 Oct 2026 (TEST_NOW); a
// subscription starts Sun 1 Nov 2026, the first period runs 1 Nov to 28 Nov.

export const morning = { id: 1, code: "MORNING", start: "10:00", end: "14:00" };

export const subscriptionRow = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  id: 31,
  ulid: "01jsub0000000000000000031",
  reference: "TRS-7K2M9Q",
  type: "recurring",
  plan_label: { ar: "أسبوعي ×2", en: "Weekly ×2" },
  visits_per_week: 2,
  customer: { id: 11, name: "Sara Ahmed", phone_masked: "+971 50 *** 0001" },
  address: { label: "Home", area: "Business Bay" },
  zone: { id: 1, name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } },
  status: "active",
  status_label: { ar: "نشط", en: "Active" },
  paused_to: null,
  term_end_date: "2026-11-28",
  next_renewal_at: "2026-11-26T06:00:00+00:00",
  payment_health: "paid",
  renewal_attempts: 0,
  next_attempt_at: null,
  conflicts_count: 0,
  cancel_review_requested_at: null,
  primary_worker: { id: 14, name: "Maria S." },
  backup_worker: null,
  confirmation_deadline_at: null,
  first_visit_at: "2026-11-01T06:00:00+00:00",
  ...over,
});

export const subscriptionPage = (rows: SubscriptionRow[] = [subscriptionRow()], counts: Record<string, number> = {}): SubscriptionPage => ({
  data: rows,
  meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1, counts_by_status: counts },
});

export const occurrence = (over: Partial<SubscriptionOccurrence> = {}): SubscriptionOccurrence => ({
  id: 501,
  ulid: "01jocc0000000000000000501",
  occurrence_date: "2026-11-01",
  scheduled_date: "2026-11-01",
  slot: morning,
  state: "materialized",
  state_label: "Booked",
  origin: "pattern",
  conflict: null,
  booking: { id: 90, reference: "TRB-V3V3V3", status: "confirmed" },
  visit: { id: 70, status: "worker_assigned", is_exception: false, original_date: null },
  workers: [{ id: 14, name: "Maria S." }],
  period_sequence: 1,
  reschedule_request: null,
  editable: { this: true, following: true, skip: true, undo_skip: false },
  ...over,
});

const period = (over: Partial<SubscriptionDetail["periods"][number]> = {}): SubscriptionDetail["periods"][number] => ({
  id: 201,
  ulid: "01jper0000000000000000201",
  sequence: 1,
  start: "2026-11-01",
  end: "2026-11-28",
  visits_planned: 8,
  visits_completed: 0,
  status: "paid",
  amount_fils: 96000,
  notified_amount_fils: null,
  payment: { id: 55, ulid: "01jpay0000000000000000055", status: "captured", card_label: "Visa •••• 4242" },
  invoice: { id: 8, number: "INV-2026-0008" },
  refunded_fils: 0,
  refundable_fils: 96000,
  ...over,
});
export const subscriptionPeriod = period;

export const subscriptionDetail = (over: Partial<SubscriptionDetail> = {}): SubscriptionDetail => ({
  id: 31,
  ulid: "01jsub0000000000000000031",
  reference: "TRS-7K2M9Q",
  type: "recurring",
  status: "active",
  status_label: { ar: "نشط", en: "Active" },
  plan_label: { ar: "أسبوعي ×2", en: "Weekly ×2" },
  package: { id: 3, code: "WEEKLY_2", version: 1 },
  plan: null,
  customer: { id: 11, ulid: "01jcus0000000000000000011", name: "Sara Ahmed", phone: "+971500000001", status: "active", status_label: { ar: "نشط", en: "Active" } },
  zone: { id: 1, name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } },
  address: { label: "Home", building: "Tower 1", area: "Business Bay", lat: 25.19, lng: 55.27 },
  service: { id: 1, code: "STANDARD_VISIT", name: { ar: "زيارة تنظيف", en: "Cleaning visit" } },
  source: "app",
  created_at: "2026-10-22T22:57:18+00:00",
  start_date: "2026-11-01",
  term_end_date: "2026-11-28",
  end_date: null,
  auto_renew: true,
  auto_renew_allowed: true,
  workers_count: 1,
  visits_per_period: 8,
  confirmation_deadline_at: null,
  first_visit_at: "2026-11-01T06:00:00+00:00",
  confirmed_at: "2026-10-23T08:00:00+00:00",
  confirmed_by: { id: 2, name: "Coordinator" },
  rejected_reason: null,
  cancelled: null,
  terms: {},
  pattern: { days_of_week: [0, 3], rest_weekdays: null, slot: morning, pattern_from: "2026-11-01" },
  addons: [],
  addon_details: [],
  materials_by: "customer",
  instructions: "Please ring twice",
  priorities: null,
  workers: { primary: { id: 14, name: "Maria S." }, backup: null },
  payment_method: { id: 5, label: "Visa •••• 4242", expired: false },
  mit_consent: { at: "2026-10-22T22:57:18+00:00", version: "1" },
  payment_health: "paid",
  periods: [period()],
  upcoming: [occurrence(), occurrence({ id: 502, ulid: "01jocc0000000000000000502", occurrence_date: "2026-11-04", scheduled_date: "2026-11-04" })],
  conflicts: [],
  reschedule_requests: [],
  freeze: null,
  renewal: {
    state: "scheduled",
    attempt_under_way: false,
    attempt_no: 0,
    max_attempts: 3,
    failed_at: null,
    amount_fils: 96000,
    payment_method_label: "Visa •••• 4242",
    decline_code: null,
    decline_message: null,
    next_attempt_at: null,
    cancels_on: null,
    last_paid_visit_date: null,
    unreserved_from_date: null,
    unreserved_visits_count: 0,
    on_hold_for_review: false,
    payment: null,
    next_renewal_at: "2026-11-26T06:00:00+00:00",
    next_notice_at: null,
  },
  discount: { type: null, value: 0, eligible: true, revoked_at: null, min_visits_for_discount: null, consumed_visits: 0 },
  coupon: null,
  cancel_review: null,
  capture_unknown_at: null,
  actions: {
    confirm: false,
    reject: false,
    freeze: true,
    unfreeze: false,
    skip: true,
    undo_skip: false,
    renew: false,
    cancel: true,
    resolve_review: false,
    edit_following: true,
    assign: true,
  },
  version: 7,
  ...over,
});

/** A request still waiting for staff: nothing captured, the confirmation deadline running. */
export const pendingDetail = (over: Partial<SubscriptionDetail> = {}): SubscriptionDetail =>
  subscriptionDetail({
    status: "pending_confirmation",
    status_label: { ar: "بانتظار التأكيد", en: "Pending confirmation" },
    payment_health: "pending",
    confirmation_deadline_at: "2099-10-23T08:00:00+00:00",
    confirmed_at: null,
    confirmed_by: null,
    workers: { primary: null, backup: null },
    periods: [period({ status: "pending_payment", payment: { id: 55, ulid: "01jpay0000000000000000055", status: "authorized", card_label: "Visa •••• 4242" }, invoice: null, refundable_fils: 0 })],
    actions: { confirm: true, reject: true, freeze: false, unfreeze: false, skip: false, undo_skip: false, renew: false, cancel: false, resolve_review: false, edit_following: false, assign: true },
    ...over,
  });

export const liveOutDetail = (over: Partial<SubscriptionDetail> = {}): SubscriptionDetail =>
  subscriptionDetail({
    id: 32,
    ulid: "01jsub0000000000000000032",
    reference: "TRS-L0NG01",
    type: "live_out",
    plan_label: { ar: "Live-out شهري", en: "Live-out monthly" },
    pattern: { days_of_week: null, rest_weekdays: [5], slot: { id: 3, code: "LIVE_OUT_DAY", start: "08:00", end: "18:00" }, pattern_from: "2026-11-01" },
    workers: { primary: { id: 14, name: "Angela" }, backup: { id: 15, name: "Rosa" } },
    actions: { confirm: false, reject: false, freeze: false, unfreeze: false, skip: false, undo_skip: false, renew: false, cancel: true, resolve_review: false, edit_following: true, assign: true },
    ...over,
  });

export const calendarDay = (date: string, over: Partial<CalendarDay> = {}): CalendarDay => ({
  date,
  type: "service",
  worker: { id: 14, name: "Angela" },
  substitute: null,
  credited: false,
  visit: null,
  occurrence_state: "planned",
  flags: [],
  ...over,
});

/** November 2026 of a Live-out contract starting Sun 1 Nov: Fridays rest, 2 Nov a public holiday, 11 Nov an absence. */
export function novemberCalendar(): SubscriptionCalendar {
  const days: CalendarDay[] = [];
  for (let d = 1; d <= 30; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 5) days.push(calendarDay(date, { type: "rest", worker: null }));
    else if (d === 2) days.push(calendarDay(date, { type: "public_holiday", worker: null }));
    else if (d === 11) days.push(calendarDay(date, { type: "absence", substitute: { id: 15, name: "Rosa" }, flags: ["substitute"] }));
    else days.push(calendarDay(date));
  }
  return { month: "2026-11", days, summary: { service: 24, rest: 4, public_holiday: 1, absence: 1, dropped: 0, credited: 0 } };
}

export const candidate = (id: number, name: string, over: Partial<WorkerCandidate> = {}): WorkerCandidate => ({
  worker: { id, name, zone: { id: 1, name: { ar: "الخليج", en: "Business Bay" } }, can_live_out: true, weekly_rest_day: 5 },
  fits: 8,
  of: 8,
  reasons: [],
  current: false,
  ...over,
});

export const event = (over: Partial<SubscriptionEvent> = {}): SubscriptionEvent => ({
  id: 900,
  type: "confirmed",
  type_label: "Confirmed",
  payload: { from: "pending_confirmation", to: "active", captured_fils: 96000, primary_worker_id: 14, backup_worker_id: null },
  workers: [{ id: 14, name: "Maria S." }],
  slots: [],
  occurrence_id: null,
  actor: { type: "staff", id: 2, name: "Coordinator" },
  created_at: "2026-10-23T08:00:00+00:00",
  ...over,
});

/** A customer cancellation with a period paid and one visit used: fee 12.00, refund 828.00. */
export const cancelPlan = (over: Partial<CancelPlan> = {}): CancelPlan => ({
  allowed: true,
  blocked_reason: null,
  review_required: false,
  party: "customer",
  periods: [
    {
      ulid: "01jper0000000000000000201",
      start: "2026-11-01",
      end: "2026-11-28",
      paid_fils: 96000,
      refundable_fils: 96000,
      visits_planned: 8,
      visits_consumed: 1,
      visits_unused: 7,
      unused_value_fils: 84000,
      fee_fils: 1200,
      clawback_fils: 0,
      refund_fils: 82800,
    },
  ],
  totals: { paid_fils: 96000, unused_value_fils: 84000, fee_fils: 1200, clawback_fils: 0, clawback_waived_fils: 0, refund_fils: 82800 },
  discount: { eligible: true, min_visits_for_discount: null, consumed_visits: 1, revoked: false },
  fee_basis: null,
  unpaid: { action: "none" },
  refund_to: { label: "Visa •••• 4242" },
  explanation: { ar: "…", en: "One visit was used; the fee is taken from the unused value." },
  ...over,
});
