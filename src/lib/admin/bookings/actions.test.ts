import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import type { BookingDetail } from "../types";
import { availableActions, minutesUntil, optionIndexOf, overrideRequiredOf, priceHigherDetails, refundableOf } from "./actions";

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

  it("counts whole minutes to a deadline", () => {
    const now = Date.parse("2026-10-23T10:00:00Z");
    expect(minutesUntil("2026-10-23T10:30:59Z", now)).toBe(30);
    expect(minutesUntil("2026-10-23T09:00:00Z", now)).toBe(-60);
    expect(minutesUntil(null, now)).toBeNull();
  });
});
