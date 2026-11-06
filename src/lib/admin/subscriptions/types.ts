import type { components, operations } from "@/lib/api/schema";
import type { PageMeta, Translatable } from "../types";

/*
 * A08 subscriptions (spec §17; design §7.2): the shapes of GET/POST /admin/subscriptions/**. The row, the detail, an
 * occurrence, the Live-out day write come from the generated schema; the answers the schema types as a bare string or
 * an open map (the visit previews, the skip, freeze and cancel previews, a history row's payload, the calendar summary)
 * are narrowed here from the contracts (A5a, A5b, A6), as the shared admin types do for the same kind of loosely typed
 * answer. The Live-out day preview is the write's generated answer without `data` (the same code, rolled back).
 */

type Schemas = components["schemas"];

export type SubscriptionRow = Schemas["AdminSubscriptionResource"];
export type SubscriptionDetail = Schemas["AdminSubscriptionDetailResource"];
export type SubscriptionOccurrence = Schemas["AdminOccurrenceResource"];
export type SubscriptionPeriod = SubscriptionDetail["periods"][number];
export type RescheduleRequestRow = SubscriptionDetail["reschedule_requests"][number];
export type SubscriptionActions = SubscriptionDetail["actions"];
export type RenewalBlock = SubscriptionDetail["renewal"];

/** The detail's `cancel_review` object (the API's Scramble type says string; it is the review record). */
export type CancelReviewBlock = {
  requested_by?: unknown;
  reason_code?: string | null;
  reason_text?: string | null;
  party?: "customer" | "company" | null;
  preview?: unknown;
  decision?: string | null;
  resolved_at?: string | null;
  requested_at?: string | null;
};

export type SubscriptionType = "recurring" | "live_out";
export const SUBSCRIPTION_STATUSES = [
  "pending_payment",
  "pending_confirmation",
  "active",
  "paused",
  "expiring",
  "renewal_failed",
  "suspended",
  "ended",
  "cancelled",
  "expired",
  "rejected",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_HEALTHS = ["paid", "pending", "verifying", "renewal_failed", "suspended", "refunded", "none"] as const;
export type PaymentHealth = (typeof PAYMENT_HEALTHS)[number];

export type SubscriptionPage = {
  data: SubscriptionRow[];
  meta: PageMeta & { counts_by_status: Record<string, number> };
};

export type VisitsPage = {
  data: SubscriptionOccurrence[];
  meta: PageMeta & { from?: string; to?: string };
};

export type SubscriptionEvent = Omit<Schemas["SubscriptionEventResource"], "payload"> & { payload: Record<string, unknown> };
export type EventsPage = { data: SubscriptionEvent[]; meta: PageMeta };

export type CalendarDayType = "service" | "rest" | "public_holiday" | "absence" | "dropped";
export type CalendarSummary = { service: number; rest: number; public_holiday: number; absence: number; dropped: number; credited: number };
export type CalendarDay = {
  date: string;
  type: CalendarDayType | string;
  worker: { id: number; name: string } | null;
  substitute: { id: number; name: string } | null;
  credited: boolean;
  visit: { id: string | number; status: string } | null;
  occurrence_state: string | null;
  flags: string[];
};
export type SubscriptionCalendar = { month: string; days: CalendarDay[]; summary: CalendarSummary };

export type WorkerCandidate = {
  worker: { id: number; name: string; zone: { id: number; name: Translatable }; can_live_out: boolean; weekly_rest_day: number };
  fits: number;
  of: number;
  reasons: string[];
  current: boolean;
};
export type CandidateRole = "primary" | "backup";

export type UnfitDay = { date: string; reasons: string[] };
export type ConfirmPreviewSide = { worker_id: number | null; fits: number; of: number; unfit: UnfitDay[] };
export type ConfirmPreview = {
  primary: ConfirmPreviewSide | null;
  backup: ConfirmPreviewSide | null;
  started: { date: string }[];
  payment: { status: string | null; amount_fils: number };
};

export type RenewPreview = { amount_fils: number | null; card_label: string | null; period: { start: string; end: string }; attempt_no: number };

export type SlotRef = { id: number; code: string; start: string; end: string } | null;

/** POST …/skip/preview (the customer's answer; staff have no monthly limit). */
export type SkipPreview = {
  allowed: boolean;
  reason: string | null;
  visit: { ulid: string; date: string; slot: SlotRef };
  appended_date: string | null;
  new_term_end_date: string | null;
  fee_fils: number;
  refund_fils: number;
  discount_effect: string;
  explanation: Translatable;
};

export type FreezePreview = {
  allowed: boolean;
  reason: string | null;
  from: string;
  to: string;
  days: number;
  affected: { ulid: string; date: string }[];
  appended_dates: string[];
  new_term_end_date: string | null;
  fee_fils: number;
  refund_fils: number;
  freeze_days_used_this_period: number;
  max_freeze_days: number | null;
  explanation: Translatable;
};

/** POST …/visits/{v}/preview with scope this: Booking's staff reschedule preview (every money key 0). */
export type MovePreview = {
  allowed: boolean;
  blockers: string[];
  requires_approval: boolean;
  availability: { status: string; reason: string | null };
  explanation: string;
};

export type FollowingPreview = {
  from: string;
  kept: { date: string }[];
  replaced: { date: string }[];
  new: { date: string; status: "available" | "unavailable" | "planned" | string; reason?: string }[];
  price: { checks: { date: string; old_unit_fils: number; new_unit_fils: number }[]; allowed: boolean };
  term_end_date: string | null;
  conflicts: Record<string, string>;
};

/**
 * POST …/live-out-days/{date}: the generated answer of the write (ChangeLiveOutDays). Each day's `substitute` is the
 * substitute worker's id (or null), not a name: the dialog finds the name among the workers it already holds.
 */
export type LiveOutDaysResult = operations["admin.subscription.subscriptions.live-out-days.update"]["responses"][200]["content"]["application/json"];
/** POST …/live-out-days/{date}/preview: the same code rolled back, so the write's answer without the subscription. */
export type LiveOutDaysPreview = Omit<LiveOutDaysResult, "data">;
export type LiveOutDayRow = LiveOutDaysPreview["days"][number];

export type CancelParty = "customer" | "company";
export type CancelPlanPeriod = {
  ulid: string;
  start: string;
  end: string;
  paid_fils: number;
  refundable_fils: number;
  visits_planned: number;
  visits_consumed: number;
  visits_unused: number;
  unused_value_fils: number;
  fee_fils: number;
  clawback_fils: number;
  refund_fils: number;
};
/** POST …/cancel/preview: CancelPreview (+ rule_applied and compensation for the company). */
export type CancelPlan = {
  allowed: boolean;
  blocked_reason: string | null;
  review_required: boolean;
  party: CancelParty;
  periods: CancelPlanPeriod[];
  totals: { paid_fils: number; unused_value_fils: number; fee_fils: number; clawback_fils: number; clawback_waived_fils: number; refund_fils: number };
  discount: { eligible: boolean; min_visits_for_discount: number | null; consumed_visits: number; revoked: boolean };
  fee_basis: { date: string; start: string; skipped: boolean; rule: string } | null;
  unpaid: { action: string };
  refund_to: { label: string } | null;
  explanation: Translatable;
  rule_applied?: string | null;
  compensation?: string | null;
};

export type CancelResult = { data: SubscriptionDetail; refunds: { ulid: string; amount_fils: number; status: string }[]; review_requested: boolean };
export type VisitWriteResult = { data: SubscriptionDetail; conflicts: Record<string, string>; edit?: FollowingPreview; credited?: { occurrence_id: number; date: string; new_date: string | null } | null };
export type AssignResult = { data: SubscriptionDetail; assigned: string[]; kept: string[]; unfit: UnfitDay[] };
export type UnfreezeResult = { data: SubscriptionDetail; restored: { date: string }[]; still_frozen: { date: string; reason: string }[] };
export type RenewResult = { data: SubscriptionDetail; payment: { ulid: string; status: string } | null };
