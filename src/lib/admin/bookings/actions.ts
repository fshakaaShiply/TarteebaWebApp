import { AdminApiError } from "../client";
import type { BookingDetail, BookingStatus, PaymentStatus, VisitStatus } from "../types";

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

/** 409 OVERRIDE_REQUIRED (assignment): the soft rules each worker breaks, and whether this user may override. */
export function overrideRequiredOf(error: unknown): { workers: { workerId: number; rules: string[] }[]; canOverride: boolean } | null {
  if (!(error instanceof AdminApiError) || error.code !== "OVERRIDE_REQUIRED") return null;
  const list = Array.isArray(error.details.workers) ? error.details.workers : [];
  const workers = list
    .filter((w): w is { worker_id: number; rules?: unknown } => !!w && typeof w === "object" && typeof (w as { worker_id?: unknown }).worker_id === "number")
    .map((w) => ({ workerId: w.worker_id, rules: Array.isArray(w.rules) ? w.rules.filter((r): r is string => typeof r === "string") : [] }));
  return { workers, canOverride: error.details.can_override === true };
}
