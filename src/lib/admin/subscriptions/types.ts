import type { components, operations } from "@/lib/api/schema";

/*
 * A08 subscriptions (spec §17; design §7.2): the shapes of GET/POST /admin/subscriptions/**, all from the generated
 * schema (the API names its previews since P4-239: SkipPreview, FreezePreview, CancelPreview, StaffMovePreview,
 * FollowingEditPreview, LiveOutDaysPreview; the calendar, the history and `cancel_review` are typed too). Nothing here
 * is a hand-written copy of an API shape; only the closed lists the screens offer as filters are spelled out.
 */

type Schemas = components["schemas"];
/** The JSON body of an operation's 200 answer. */
type Ok<Op extends keyof operations> = operations[Op] extends { responses: { 200: { content: { "application/json": infer Body } } } } ? Body : never;

export type SubscriptionRow = Schemas["AdminSubscriptionResource"];
export type SubscriptionDetail = Schemas["AdminSubscriptionDetailResource"];
export type SubscriptionOccurrence = Schemas["AdminOccurrenceResource"];
export type SubscriptionPeriod = SubscriptionDetail["periods"][number];
export type RescheduleRequestRow = SubscriptionDetail["reschedule_requests"][number];
export type SubscriptionActions = SubscriptionDetail["actions"];
export type RenewalBlock = SubscriptionDetail["renewal"];
/** An add-on of the contract with its name (P4-244); `name` is null for a code the catalogue no longer has. */
export type AddonDetail = SubscriptionDetail["addon_details"][number];
/** The cancellation review as recorded (P4-243): `refundable_fils` / `refundable_periods` are what a resolve takes now. */
export type CancelReviewBlock = NonNullable<SubscriptionDetail["cancel_review"]>;
export type SlotRef = SubscriptionOccurrence["slot"];
/** An occurrence's conflict code (P4-245): SLOT_FULL, SLOT_CLOSED or BLACKOUT. */
export type ConflictCode = NonNullable<SubscriptionOccurrence["conflict"]>["code"];

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

export type SubscriptionPage = Ok<"admin.subscription.subscriptions.index">;
export type VisitsPage = Ok<"admin.subscription.subscriptions.visits">;
export type SubscriptionEvent = Schemas["SubscriptionEventResource"];
export type EventsPage = Ok<"admin.subscription.subscriptions.events">;

export type SubscriptionCalendar = Ok<"admin.subscription.subscriptions.calendar">["data"];
export type CalendarDay = SubscriptionCalendar["days"][number];
export type CalendarDayType = CalendarDay["type"];
export type CalendarSummary = SubscriptionCalendar["summary"];

export type WorkerCandidate = Ok<"admin.subscription.subscriptions.worker-candidates">["data"][number];
export type CandidateRole = "primary" | "backup";

export type ConfirmPreview = Ok<"admin.subscription.subscriptions.confirm.preview">["data"];
export type ConfirmPreviewSide = NonNullable<ConfirmPreview["primary"]>;
export type UnfitDay = ConfirmPreviewSide["unfit"][number];

export type RenewPreview = Ok<"admin.subscription.subscriptions.renew.preview">["data"];

/** POST …/skip/preview (staff have no monthly limit). */
export type SkipPreview = Schemas["SkipPreview"];
export type FreezePreview = Schemas["FreezePreview"];
/** POST …/visits/{v}/preview with scope this: Booking's staff reschedule preview (every money key 0). */
export type MovePreview = Schemas["StaffMovePreview"];
/** POST …/visits/{v}/preview with scope following, and the visit write's `edit`. */
export type FollowingPreview = Schemas["FollowingEditPreview"];

/**
 * A date's reason (P4-245: Scheduling's ClosedReason ∪ FullReason), in the previews' `conflicts {date: reason}`, the new
 * dates of a pattern edit, an occurrence conflict's details and a move preview's availability.
 */
export type DateReason = FollowingPreview["conflicts"][string];
export const DATE_REASONS = [
  "lead_time",
  "blackout",
  "rule_closed",
  "horizon",
  "past",
  "inactive",
  "workers",
  "seats",
  "max_bookings",
] as const satisfies readonly DateReason[];

/** POST …/live-out-days/{date}/preview; each day's `substitute` is {id, name} (P4-241). */
export type LiveOutDaysPreview = Schemas["LiveOutDaysPreview"];
export type LiveOutDaysResult = Ok<"admin.subscription.subscriptions.live-out-days.update">;
export type LiveOutDayRow = LiveOutDaysPreview["days"][number];

/** POST …/cancel/preview: CancelPreview (+ rule_applied and compensation for the company). */
export type CancelPlan = Schemas["CancelPreview"];
export type CancelPlanPeriod = CancelPlan["periods"][number];
export type CancelParty = CancelPlan["party"];

export type CancelResult = Ok<"admin.subscription.subscriptions.cancel">;
export type ResolveResult = Ok<"admin.subscription.subscriptions.cancel-review.resolve">;
export type VisitWriteResult = Ok<"admin.subscription.subscriptions.visits.update">;
export type AssignResult = Ok<"admin.subscription.subscriptions.assign-primary">;
export type UnfreezeResult = Ok<"admin.subscription.subscriptions.unfreeze">;
export type RenewResult = Ok<"admin.subscription.subscriptions.renew">;
