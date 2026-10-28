import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import type { BookingDetail } from "../types";
import {
  availableActions,
  cancelTermsOf,
  minutesUntil,
  openRefundsFils,
  optionFieldErrors,
  optionIndexOf,
  overrideRequiredOf,
  priceHigherDetails,
  refundableOf,
  refundableOfBooking,
  refundsOfBooking,
  rescheduleTermsOf,
  slotUnavailable,
  visitStatusOf,
} from "./actions";

type ActionFields = Parameters<typeof availableActions>[0];

const booking = (over: Partial<ActionFields> = {}): ActionFields => ({
  status: "pending_confirmation",
  payment_status: "authorized",
  visits: [{ status: "scheduled" } as BookingDetail["visits"][number]],
  capture_unknown_at: null,
  created_by_staff_id: null,
  cancellation: { party: null, cancelled_by_id: null, fee_fils: null, refund_fils: null, review_requested_at: null, review: null },
  ...over,
});

const coordinator = [
  "bookings.view",
  "bookings.create_manual",
  "bookings.confirm",
  "bookings.reject",
  "bookings.propose_alternative",
  "bookings.reschedule",
  "bookings.cancel",
];
const can = (list: string[]) => (p: string) => list.includes(p);
const sorted = (set: Set<string>) => [...set].sort();

describe("A03 actions by status and permission", () => {
  it("offers confirm, reject, alternatives and cancel on a request pending confirmation", () => {
    expect(sorted(availableActions(booking(), can(coordinator)))).toEqual(["addNote", "cancel", "confirm", "propose", "reject"]);
  });

  it("offers no alternatives while a capture answer is unknown or the payment is still verifying", () => {
    expect(availableActions(booking({ capture_unknown_at: "2026-10-23T10:00:00Z" }), can(coordinator)).has("propose")).toBe(false);
    expect(availableActions(booking({ payment_status: "verifying" }), can(coordinator)).has("propose")).toBe(false);
  });

  it("offers no Confirm while the provider is still verifying the payment (the API answers PAYMENT_VERIFYING at once)", () => {
    expect(availableActions(booking({ payment_status: "verifying" }), can(coordinator)).has("confirm")).toBe(false);
    // The payment row may move first: its own status counts too.
    expect(availableActions(booking({ payment: { status: "verifying" } }), can(coordinator)).has("confirm")).toBe(false);
    expect(availableActions(booking({ payment: { status: "authorized" } }), can(coordinator)).has("confirm")).toBe(true);
    // Reject and cancel stay available.
    expect(sorted(availableActions(booking({ payment_status: "verifying" }), can(coordinator)))).toEqual(["addNote", "cancel", "reject"]);
  });

  it("reschedules a confirmed booking only before its visit starts", () => {
    expect(availableActions(booking({ status: "confirmed" }), can(coordinator)).has("reschedule")).toBe(true);
    const started = booking({ status: "confirmed", visits: [{ status: "in_progress" } as BookingDetail["visits"][number]] });
    expect(availableActions(started, can(coordinator)).has("reschedule")).toBe(false);
  });

  it("hides what the role lacks (the accountant reads only)", () => {
    expect(sorted(availableActions(booking(), can(["bookings.view", "payments.view"])))).toEqual([]);
  });

  it("offers a new payment link only for a manual booking still held", () => {
    expect(availableActions(booking({ status: "held", created_by_staff_id: 2 }), can(coordinator)).has("paymentLink")).toBe(true);
    expect(availableActions(booking({ status: "held" }), can(coordinator)).has("paymentLink")).toBe(false);
  });

  it("offers to keep the booking while a cancellation review is open", () => {
    const review = booking({
      status: "confirmed",
      cancellation: { party: null, cancelled_by_id: null, fee_fils: null, refund_fils: null, review_requested_at: "2026-10-23T08:00:00Z", review: null },
    });
    expect(availableActions(review, can(coordinator)).has("declineReview")).toBe(true);
    expect(availableActions(review, can(coordinator)).has("resolveReview")).toBe(false);
  });

  it("lets finance (refunds.create without bookings.cancel) resolve a waiting review, and nothing else", () => {
    const review = booking({
      status: "confirmed",
      cancellation: { party: null, cancelled_by_id: null, fee_fils: null, refund_fils: null, review_requested_at: "2026-10-23T08:00:00Z", review: null },
    });
    const accountant = can(["bookings.view", "payments.view", "refunds.create", "invoices.manage"]);
    expect(sorted(availableActions(review, accountant))).toEqual(["resolveReview"]);
    expect(availableActions(booking({ status: "confirmed" }), accountant).has("resolveReview")).toBe(false);
    // A system admin (both permissions) keeps the coordinator's way.
    expect(availableActions(review, can([...coordinator, "refunds.create"])).has("resolveReview")).toBe(false);
  });

  it("offers nothing but notes on an ended booking", () => {
    expect(sorted(availableActions(booking({ status: "cancelled" }), can(coordinator)))).toEqual(["addNote"]);
  });
});

describe("A03 error details", () => {
  it("reads the option that failed and the price rule", () => {
    const error = new AdminApiError(422, {
      code: "OPTION_PRICE_HIGHER",
      message: "",
      details: { option_index: 1, price_diff_fils: 3000, authorized_fils: 24000 },
    });
    expect(optionIndexOf(error)).toBe(1);
    expect(priceHigherDetails(error)).toEqual({ priceDiffFils: 3000, authorizedFils: 24000 });
    expect(priceHigherDetails(new AdminApiError(409, { code: "OPTION_UNAVAILABLE", message: "", details: { option_index: 0 } }))).toBeNull();
  });

  it("reads the refundable amount and the soft rules of an assignment", () => {
    expect(refundableOf(new AdminApiError(422, { code: "REFUND_AMOUNT_REQUIRED", message: "", details: { refundable_fils: 12000 } }))).toBe(12000);
    const override = new AdminApiError(409, {
      code: "OVERRIDE_REQUIRED",
      message: "",
      details: { workers: [{ worker_id: 7, rules: ["other_zone"] }, { bad: true }], can_override: false },
    });
    expect(overrideRequiredOf(override)).toEqual({ workers: [{ workerId: 7, rules: ["other_zone"] }], canOverride: false });
  });

  it("reads the new terms of a 409 TERMS_CHANGED (cancel and reschedule) and what changed", () => {
    const cancel = new AdminApiError(409, {
      code: "TERMS_CHANGED",
      message: "",
      details: {
        allowed: true,
        mode: "refund",
        fee_fils: null,
        kept_fees_fils: 0,
        refund_fils: null,
        paid_fils: 24000,
        held_fils: 0,
        requires_review: true,
        rule_applied: "exception_review",
        explanation: { ar: "مراجعة", en: "Review required." },
        currency: "AED",
        changed: ["fee_fils", "refund_fils"],
      },
    });
    expect(cancelTermsOf(cancel)).toMatchObject({ mode: "refund", fee_fils: null, refund_fils: null, requires_review: true, changed: ["fee_fils", "refund_fils"] });
    expect(rescheduleTermsOf(cancel)).toBeNull();
    expect(cancelTermsOf(new AdminApiError(409, { code: "STALE_VERSION", message: "", details: {} }))).toBeNull();

    const move = new AdminApiError(409, {
      code: "TERMS_CHANGED",
      message: "",
      details: {
        allowed: true,
        blockers: [],
        fee_fils: 0,
        price_diff_fils: 2000,
        new_total_fils: 26000,
        refund_fils: 0,
        paid_fils: 24000,
        availability: { status: "limited", reason: null },
        changed: ["new_total_fils"],
      },
    });
    expect(rescheduleTermsOf(move)).toMatchObject({ new_total_fils: 26000, fee_fils: 0, availability: { status: "limited" }, changed: ["new_total_fils"] });
  });

  it("reads the crew's visit status, a full slot and what may be refunded on the booking", () => {
    expect(visitStatusOf(new AdminApiError(409, { code: "INVALID_STATE", message: "", details: { visit_status: "en_route" } }))).toBe("en_route");
    expect(visitStatusOf(new AdminApiError(409, { code: "INVALID_STATE", message: "", details: {} }))).toBeNull();
    expect(slotUnavailable({ status: "closed" })).toBe(true);
    expect(slotUnavailable({ status: "limited" })).toBe(false);
    const payment = { captured_fils: 24000, refunded_fils: 4000 } as BookingDetail["payment"];
    expect(refundableOfBooking({ payment })).toBe(20000);
    expect(refundableOfBooking({ payment: null })).toBe(0);
    // Refunds still open are held back like the API's cap (Payment::refundableFils), never below 0.
    expect(refundableOfBooking({ payment }, 3000)).toBe(17000);
    expect(refundableOfBooking({ payment }, 30000)).toBe(0);
  });

  it("counts the booking's own refunds still open (requested or processing)", () => {
    const row = (status: "requested" | "processing" | "succeeded" | "failed", amount: number, payment: { ulid: string; payable_id: number; payable_type: string }) => ({
      status,
      amount_fils: amount,
      payment,
    });
    const own = { ulid: "01PAY", payable_id: 4, payable_type: "booking" };
    const other = { ulid: "01OTHER", payable_id: 9, payable_type: "booking" };
    const rows = [row("processing", 4000, own), row("requested", 500, own), row("succeeded", 2000, own), row("failed", 1000, own), row("processing", 7000, other)];
    const mine = refundsOfBooking(rows, { id: 4, payment: { id: "01PAY" } as BookingDetail["payment"] });
    expect(mine).toHaveLength(4);
    expect(openRefundsFils(mine)).toBe(4500);
  });

  it("reads one alternative's field errors from a VALIDATION_FAILED (a whole option lands on its time)", () => {
    const error = new AdminApiError(422, {
      code: "VALIDATION_FAILED",
      message: "",
      details: { fields: { "options.1": ["Offered twice."], "options.0.service_date": ["Too far ahead."] } },
    });
    expect(optionFieldErrors(error, 1)).toEqual({ date: null, slot: "Offered twice." });
    expect(optionFieldErrors(error, 0)).toEqual({ date: "Too far ahead.", slot: null });
    expect(optionFieldErrors(new AdminApiError(409, { code: "PAYMENT_VERIFYING", message: "", details: {} }), 0)).toEqual({ date: null, slot: null });
  });

  it("counts whole minutes to a deadline", () => {
    const now = Date.parse("2026-10-23T10:00:00Z");
    expect(minutesUntil("2026-10-23T10:30:59Z", now)).toBe(30);
    expect(minutesUntil("2026-10-23T09:00:00Z", now)).toBe(-60);
    expect(minutesUntil(null, now)).toBeNull();
  });
});
