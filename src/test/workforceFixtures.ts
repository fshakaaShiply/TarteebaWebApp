import type { Worker } from "@/lib/admin/types";
import type {
  AttendanceDay,
  AttendanceDaysPage,
  IncentiveAdjustment,
  IncentivePosting,
  IncentiveProposal,
  IncentiveRule,
  ProposalsPage,
  WaitlistEntry,
  WorkerDocument,
  WorkerStats,
} from "@/lib/admin/workforce/types";

/*
 * Answers of the Phase 5 workforce, incentive and waitlist routes in the API's shapes (contracts A5 §7 and A6 §5.2).
 * The tests' clock is 2026-10-23 (Dubai), so the last month that has ended is 2026-09 and attendance days are the 22nd or
 * earlier.
 */

export const document = (over: Partial<WorkerDocument> = {}): WorkerDocument => ({
  id: 7,
  worker_id: 3,
  type: "residency",
  type_label: { ar: "تأشيرة الإقامة", en: "Residency visa" },
  title: null,
  number_last4: "67-1",
  issued_at: "2024-03-15",
  expires_at: "2026-11-13",
  alert_days_before: 30,
  state: "expiring",
  days_left: 21,
  file: { mime: "application/pdf", size_bytes: 182311, file_name: "DEMO-W05-residency.pdf" },
  notes: null,
  supersedes_id: null,
  superseded_by_id: null,
  archived_at: null,
  created_by: { id: 4, name: "Huda HR" },
  updated_at: "2026-10-16T09:00:00+00:00",
  version: 1,
  ...over,
});

export const attendanceDay = (over: Partial<AttendanceDay> = {}): AttendanceDay => ({
  worker: { id: 3, employee_no: "DEMO-W01", display_name: "Maria S.", home_zone_id: 1 },
  date: "2026-10-22",
  expected: true,
  rest_day: false,
  leave: null,
  status: null,
  status_label: null,
  source: null,
  stored: false,
  check_in_at: null,
  check_out_at: null,
  late_minutes: null,
  note: null,
  evidence: {},
  recorded_by: null,
  recorded_at: null,
  locked: false,
  conflicts_with_evidence: false,
  live_out: null,
  version: 0,
  ...over,
});

export const attendanceSheet = (data: AttendanceDay[], over: Partial<AttendanceDaysPage["meta"]> = {}): AttendanceDaysPage => ({
  data,
  meta: {
    current_page: 1,
    per_page: 50,
    total: data.length,
    last_page: 1,
    date: "2026-10-22",
    counts: { expected: data.length, present: 0, absent: 0, late: 0, half_day: 0, unrecorded: data.length, leave: 0 },
    ...over,
  },
});

export const proposal = (over: Partial<IncentiveProposal> = {}): IncentiveProposal => ({
  id: 41,
  worker: { id: 3, employee_no: "DEMO-W01", display_name: "Maria S.", full_name: { ar: "ماريا", en: "Maria Santos" }, home_zone: { id: 1, name: { ar: "الخليج التجاري", en: "Business Bay" } } },
  period: { start: "2026-09-01", end: "2026-09-30" },
  status: "proposed",
  status_label: { ar: "مقترح", en: "Proposed" },
  score_bp: 8292,
  proposed_fils: 35000,
  approved_fils: null,
  currency: "AED",
  scores: { hours: 7750, rating: 9500, punctuality: 9615, repeat_requests: 4193 },
  gates: [],
  metrics_summary: { worked_minutes: 7440, completed_visits: 31, rating_avg_x100: 490, ratings_count: 20, absent_days: 1, late_days: 0, requested_percent: 42, complaints_upheld: 0 },
  rule: { id: 8, name: { ar: "قاعدة الحوافز", en: "Incentive rule" }, version: 1 },
  approved: null,
  rejected: null,
  posting: null,
  locked_attendance: false,
  metrics_stale_at: null,
  version: 1,
  computed_at: "2026-10-05T06:00:00+00:00",
  ...over,
});

export const proposalsPage = (data: IncentiveProposal[], over: Partial<ProposalsPage["meta"]> = {}): ProposalsPage => ({
  data,
  meta: {
    current_page: 1,
    per_page: 25,
    total: data.length,
    last_page: 1,
    period: "2026-09",
    totals: {
      proposed: { count: data.filter((p) => p.status === "proposed").length, fils: data.filter((p) => p.status === "proposed").reduce((s, p) => s + p.proposed_fils, 0) },
      approved: { count: data.filter((p) => p.status === "approved").length, fils: data.filter((p) => p.status === "approved").reduce((s, p) => s + (p.approved_fils ?? 0), 0) },
      rejected: { count: 0, fils: 0 },
      posted: { count: 0, fils: 0 },
    },
    rule: { id: 8, name: { ar: "قاعدة الحوافز", en: "Incentive rule" }, version: 1 },
    ...over,
  },
});

export const adjustment = (over: Partial<IncentiveAdjustment> = {}): IncentiveAdjustment => ({
  id: 4,
  worker: { id: 3, employee_no: "DEMO-W01", display_name: "Maria S." },
  period: "2026-09",
  amount_fils: -5000,
  currency: "AED",
  reason: "Overpaid in August",
  corrects_posting: null,
  posting: null,
  created_by: { id: 4, name: "Huda HR" },
  created_at: "2026-10-10T08:00:00+00:00",
  version: 1,
  ...over,
});

export const posting = (over: Partial<IncentivePosting> = {}): IncentivePosting => ({
  id: 1,
  reference: "INC-2026-09-01",
  period: { start: "2026-09-01", end: "2026-09-30" },
  lines_count: 2,
  total_fils: 90000,
  currency: "AED",
  posted_by: { id: 4, name: "Huda HR" },
  posted_at: "2026-10-06T06:00:00+00:00",
  ...over,
});

export const rule = (over: Partial<IncentiveRule> = {}): IncentiveRule => ({
  id: 8,
  name: { ar: "قاعدة الحوافز", en: "Incentive rule" },
  weights: { hours: 40, rating: 30, punctuality: 20, repeat_requests: 10 },
  thresholds: { hours_target_minutes: 9600, min_hours_minutes: 4800, rating_floor_x100: 300, min_ratings: 5, max_absent_days: 2 },
  amounts: [
    { min_score_bp: 6000, amount_fils: 20000 },
    { min_score_bp: 7500, amount_fils: 35000 },
    { min_score_bp: 9000, amount_fils: 50000 },
  ],
  is_active: true,
  activated_at: "2026-10-01T06:00:00+00:00",
  version: 2,
  created_at: "2026-09-20T06:00:00+00:00",
  updated_at: "2026-10-01T06:00:00+00:00",
  ...over,
});

export const stats = (over: Partial<WorkerStats> = {}): WorkerStats => ({
  worker_id: 3,
  period: { from: "2026-10-01", to: "2026-10-23" },
  visits: { completed: 31, no_show: 1 },
  hours: { worked_minutes: 7440, planned_minutes: 7800 },
  requested_by_name: { visits: 13, eligible: 31, percent: 42 },
  rating: { average: 4.9, count: 20, low_count: 1 },
  complaints: { upheld: 0, partial: 0, not_upheld: 1, open: 0 },
  team_arrivals: { recorded: 30, on_time: 27, percent: 90 },
  substitutions: { replaced_unavailable: 1, replaced_late: 0, reassigned: 0, covered: 2 },
  attendance: { expected_days: 26, present_days: 25, absent_days: 1, late_days: 0, half_days: 0, unrecorded_days: 0, leave_days: 0 },
  incentive: { proposal_id: 41, period_start: "2026-09-01", status: "proposed", proposed_fils: 35000, approved_fils: null },
  ...over,
});

export const waitlistEntry = (over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
  id: 41,
  ulid: "01JD0000000000000000000041",
  customer: { id: "01JA0000000000000000000001", name: "Maryam Saleh", phone_masked: "•••••••••4567", status: "active" },
  address: { id: "01JC0000000000000000000001", label: "Home", area_text: "Al Barsha", usable: true },
  zone: { id: 3, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay" } },
  service: { id: 1, code: "STANDARD_VISIT", name: { ar: "زيارة تنظيف", en: "Cleaning visit" } },
  date: "2026-10-26",
  slot: { id: 13, code: "MORNING", name: { ar: "الفترة الصباحية", en: "Morning" }, start: "10:00", end: "14:00" },
  workers_count: 2,
  status: "waiting",
  status_label: { ar: "في الانتظار", en: "Waiting" },
  position: 2,
  offers_count: 0,
  offer: { state: "none", expires_at: null, offered_at: null, offered_by: null },
  book_by: "2026-10-25T18:00:00+00:00",
  expires_at: "2026-10-26T06:00:00+00:00",
  created_at: "2026-10-20T08:00:00+00:00",
  closed_at: null,
  closed_reason: null,
  booking: null,
  slot_now: { status: "limited", remaining_for_team: 2 },
  actions: { notify: true, notify_blocked_reason: null },
  ...over,
});

export const worker = (over: Partial<Worker> = {}): Worker => ({
  id: 3,
  ulid: "01m5jm537rh4yrgc2hqg2e0s25",
  employee_no: "DEMO-W01",
  full_name: { ar: "ماريا سانتوس", en: "Maria Santos" },
  display_name: "Maria S.",
  phone: null,
  nationality: "PH",
  languages: ["en", "tl", "ar"],
  employment_status: "active",
  hired_at: "2026-09-01",
  home_zone_id: 1,
  home_zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } },
  can_live_out: false,
  weekly_rest_day: 5,
  notes: null,
  shifts: [],
  upcoming_leaves: [],
  version: 4,
  created_at: null,
  updated_at: null,
  ...over,
});
