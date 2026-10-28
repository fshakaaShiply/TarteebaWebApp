import { AdminApiError } from "../client";
import type { AdminRefund, BookingDetail, BookingStatus, CancelPreview, PaymentStatus, ReschedulePreview, VisitStatus } from "../types";

/*
 * A03 booking actions (spec §7.1, §10, §11.4, §14.3; Booking Actions): which ones a booking offers in its status, to a
 * user with the permission. Hiding is for clarity only: the API checks the status, the version and the permission
 * again (409 INVALID_STATE / STALE_VERSION, 403).
 */

export type BookingAction =
  | "confirm"
  | "reject"
  | "propose"
  | "reschedule"
  | "cancel"
  | "declineReview"
  | "resolveReview"
  | "paymentLink"
  | "addNote";

/** Reason codes the API accepts (config booking.reject_reasons and booking.staff_cancel_reasons). */
export const REJECT_REASONS = ["no_capacity", "out_of_area", "worker_unavailable", "duplicate", "other"] as const;
export const CANCEL_REASONS = [
  "customer_request",
  "no_capacity",
  "worker_unavailable",
  "vehicle_issue",
  "weather",
  "duplicate",
  "payment_issue",
  "other",
] as const;
/** Staff say whose cancellation it is: the customer's (policy fee) or the company's (company refund rule). */
export const CANCEL_PARTIES = ["customer", "company"] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** Statuses a person can cancel from (CancelBooking::CANCELLABLE). */
const CANCELLABLE: readonly BookingStatus[] = ["held", "pending_confirmation", "alternative_proposed", "confirmed"];
/** A staff reschedule moves a confirmed booking whose visit has not started (RescheduleCheck). */
const MOVABLE_VISIT: readonly VisitStatus[] = ["scheduled", "worker_assigned"];
/** Alternatives need money still held for the booking (ProposeAlternatives). */
const PROPOSABLE_PAYMENT: readonly PaymentStatus[] = ["authorized", "captured"];

export const NOTE_PERMISSIONS = ["bookings.create_manual", "bookings.confirm", "bookings.reschedule", "bookings.cancel"] as const;

type PaymentState = Pick<BookingDetail, "payment_status"> & { payment?: { status: string } | null };

/**
 * The payment provider is still checking the payment (spec §7.2): the API refuses a capture at once (409
 * PAYMENT_VERIFYING), so Confirm is not offered until the provider answers.
 */
export function paymentVerifying(booking: PaymentState): boolean {
  return booking.payment_status === "verifying" || booking.payment?.status === "verifying";
}

export function availableActions(
  booking: Pick<BookingDetail, "status" | "payment_status" | "visits" | "capture_unknown_at" | "created_by_staff_id" | "cancellation"> & PaymentState,
  can: (permission: string) => boolean,
): Set<BookingAction> {
  const out = new Set<BookingAction>();
  const status = booking.status;
  const visit = booking.visits[0];

  if (status === "pending_confirmation") {
    if (can("bookings.confirm") && !paymentVerifying(booking)) out.add("confirm");
    if (can("bookings.reject")) out.add("reject");
    if (
      can("bookings.propose_alternative") &&
      booking.capture_unknown_at === null &&
      PROPOSABLE_PAYMENT.includes(booking.payment_status)
    ) {
      out.add("propose");
    }
  }
  if (status === "confirmed" && can("bookings.reschedule") && (!visit || MOVABLE_VISIT.includes(visit.status))) out.add("reschedule");
  if (CANCELLABLE.includes(status) && can("bookings.cancel")) out.add("cancel");
  if (booking.cancellation.review_requested_at && can("bookings.cancel")) out.add("declineReview");
  // Finance (refunds.create without bookings.cancel) finishes a waiting review with a refund (POST …/cancel-review/
  // resolve); coordinators keep "keep the booking" and "cancel" (P3-38: finance stays read-only on operations).
  if (booking.cancellation.review_requested_at && can("refunds.create") && !can("bookings.cancel")) out.add("resolveReview");
  if (status === "held" && booking.created_by_staff_id !== null && can("bookings.create_manual")) out.add("paymentLink");
  if (NOTE_PERMISSIONS.some((p) => can(p))) out.add("addNote");
  return out;
}

/** "other" needs a written reason (RejectBookingRequest, CancelBookingRequest). */
export function reasonTextRequired(code: string): boolean {
  return code === "other";
}

/** Minutes left until an instant (negative once passed), whole minutes rounded towards zero. */
export function minutesUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return null;
  return Math.trunc((at - now) / 60_000);
}

/** details.option_index of an option error (OPTION_PRICE_HIGHER, OPTION_UNAVAILABLE, OPTION_SAME_AS_BOOKING …). */
export function optionIndexOf(error: unknown): number | null {
  if (!(error instanceof AdminApiError)) return null;
  const index = error.details.option_index;
  return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * The VALIDATION_FAILED messages of one alternative (`options.N.service_date` on its date; `options.N.slot_template_id`
 * or the whole option, `options.N`, on its time), e.g. the alternatives preview refusing the same time twice.
 */
export function optionFieldErrors(error: unknown, index: number): { date: string | null; slot: string | null } {
  if (!(error instanceof AdminApiError) || error.code !== "VALIDATION_FAILED") return { date: null, slot: null };
  const first = (field: string) => error.fieldErrors[field]?.[0] ?? null;
  return {
    date: first(`options.${index}.service_date`),
    slot: first(`options.${index}.slot_template_id`) ?? first(`options.${index}`),
  };
}

/** 422 OPTION_PRICE_HIGHER: how much more the option costs than the customer authorized. */
export function priceHigherDetails(error: unknown): { priceDiffFils: number; authorizedFils: number } | null {
  if (!(error instanceof AdminApiError) || error.code !== "OPTION_PRICE_HIGHER") return null;
  const diff = error.details.price_diff_fils;
  const authorized = error.details.authorized_fils;
  if (typeof diff !== "number" || typeof authorized !== "number") return null;
  return { priceDiffFils: diff, authorizedFils: authorized };
}

/** details.refundable_fils of REFUND_AMOUNT_REQUIRED / REFUND_AMOUNT_INVALID / REFUND_PERMISSION_REQUIRED. */
export function refundableOf(error: unknown): number | null {
  if (!(error instanceof AdminApiError)) return null;
  const value = error.details.refundable_fils;
  return typeof value === "number" && value >= 0 ? value : null;
}

type RefundRow = Pick<AdminRefund, "status" | "amount_fils"> & {
  payment?: { ulid?: string | null; payable_id?: number | null; payable_type?: string | null } | null;
};

/**
 * The refunds of this booking's payment among a customer's refunds (GET /admin/refunds?phone= lists every booking of
 * that phone): by the payment's ULID, or a payment whose payable is this booking.
 */
export function refundsOfBooking<T extends RefundRow>(rows: readonly T[], booking: Pick<BookingDetail, "id" | "payment">): T[] {
  return rows.filter(
    (r) => r.payment && (r.payment.ulid === booking.payment?.id || (r.payment.payable_id === booking.id && (r.payment.payable_type ?? "").includes("booking"))),
  );
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumberOrNull = (v: unknown): v is number | null => v === null || isNumber(v);
const changedList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : []);

/** The amounts a 409 TERMS_CHANGED says changed (details.changed), e.g. ["fee_fils", "refund_fils"]. */
export type TermsChanged<T> = T & { changed: string[] };

/**
 * 409 TERMS_CHANGED of a staff cancellation: the new cancel preview (nothing was cancelled) and which amounts moved.
 * Null for any other error or a details shape the dialog cannot show.
 */
export function cancelTermsOf(error: unknown): TermsChanged<CancelPreview> | null {
  if (!(error instanceof AdminApiError) || error.code !== "TERMS_CHANGED") return null;
  const d = error.details;
  if (typeof d.mode !== "string" || !isNumberOrNull(d.fee_fils) || !isNumberOrNull(d.refund_fils) || !isNumber(d.paid_fils)) return null;
  const explanation = d.explanation && typeof d.explanation === "object" ? (d.explanation as { ar?: unknown; en?: unknown }) : null;
  return {
    allowed: d.allowed !== false,
    mode: d.mode,
    fee_fils: d.fee_fils,
    kept_fees_fils: isNumber(d.kept_fees_fils) ? d.kept_fees_fils : 0,
    refund_fils: d.refund_fils,
    paid_fils: d.paid_fils,
    held_fils: isNumber(d.held_fils) ? d.held_fils : 0,
    requires_review: d.requires_review === true,
    rule_applied: typeof d.rule_applied === "string" ? d.rule_applied : "",
    explanation: {
      ar: typeof explanation?.ar === "string" ? explanation.ar : "",
      en: typeof explanation?.en === "string" ? explanation.en : "",
    },
    changed: changedList(d.changed),
  };
}

/** 409 TERMS_CHANGED of a staff reschedule: the new reschedule preview (nothing was moved) and which amounts moved. */
export function rescheduleTermsOf(error: unknown): TermsChanged<ReschedulePreview> | null {
  if (!(error instanceof AdminApiError) || error.code !== "TERMS_CHANGED") return null;
  const d = error.details;
  if (!isNumber(d.new_total_fils) || !isNumber(d.fee_fils)) return null;
  const availability = d.availability && typeof d.availability === "object" ? (d.availability as { status?: unknown; reason?: unknown }) : null;
  return {
    allowed: d.allowed !== false,
    blockers: changedList(d.blockers),
    requires_approval: d.requires_approval === true,
    fee_fils: d.fee_fils,
    price_diff_fils: isNumber(d.price_diff_fils) ? d.price_diff_fils : 0,
    new_total_fils: d.new_total_fils,
    refund_fils: isNumber(d.refund_fils) ? d.refund_fils : 0,
    paid_fils: isNumber(d.paid_fils) ? d.paid_fils : 0,
    kept_fees_fils: isNumber(d.kept_fees_fils) ? d.kept_fees_fils : 0,
    currency: typeof d.currency === "string" ? d.currency : "AED",
    availability: {
      status: typeof availability?.status === "string" ? availability.status : "available",
      reason: typeof availability?.reason === "string" ? availability.reason : null,
    },
    rule_applied: typeof d.rule_applied === "string" ? d.rule_applied : "staff",
    explanation: typeof d.explanation === "string" ? d.explanation : "",
    changed: changedList(d.changed),
  };
}

/** A slot the previews report as unable to take the booking now (staff with capacity.override may still book it). */
export function slotUnavailable(availability: { status: string } | null | undefined): boolean {
  return availability?.status === "full" || availability?.status === "closed";
}

/** 409 INVALID_STATE with details.visit_status (e.g. the crew is already en route), else null. */
export function visitStatusOf(error: unknown): string | null {
  if (!(error instanceof AdminApiError) || error.code !== "INVALID_STATE") return null;
  return typeof error.details.visit_status === "string" ? error.details.visit_status : null;
}

/** 409 OVERRIDE_REQUIRED (assignment): the soft rules each worker breaks, and whether this user may override. */
export function overrideRequiredOf(error: unknown): { workers: { workerId: number; rules: string[] }[]; canOverride: boolean } | null {
  if (!(error instanceof AdminApiError) || error.code !== "OVERRIDE_REQUIRED") return null;
  const list = Array.isArray(error.details.workers) ? error.details.workers : [];
  const workers = list
    .filter((w): w is { worker_id: number; rules?: unknown } => !!w && typeof w === "object" && typeof (w as { worker_id?: unknown }).worker_id === "number")
    .map((w) => ({ workerId: w.worker_id, rules: Array.isArray(w.rules) ? w.rules.filter((r): r is string => typeof r === "string") : [] }));
  return { workers, canOverride: error.details.can_override === true };
}
