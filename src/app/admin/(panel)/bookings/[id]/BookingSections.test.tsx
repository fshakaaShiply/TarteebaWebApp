import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRefund, BookingDetail } from "@/lib/admin/types";
import { bookingDetail } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { CancelReviewTask, PaymentCard } from "./BookingSections";

const api = { fetchRefundsByPhone: vi.fn(), previewCancellation: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchRefundsByPhone: (...a: unknown[]) => api.fetchRefundsByPhone(...a),
  previewCancellation: (...a: unknown[]) => api.previewCancellation(...a),
}));

const PAYMENT_ULID = "01m5jxahxw4z2hfd721cxrjbz6";
const refund = (over: Partial<AdminRefund>): AdminRefund => ({
  id: 1,
  ulid: "01R1",
  amount_fils: 3000,
  currency: "AED",
  status: "processing",
  status_label: { ar: "قيد المعالجة", en: "Processing" },
  reason_code: "price_difference",
  reason_label: { ar: "فرق السعر", en: "Price difference" },
  reason_text: null,
  requested_by: { type: "system", id: null, name: null },
  gateway: "fake",
  gateway_refund_ref: null,
  failure_code: null,
  failure_message: null,
  credit_note_id: null,
  estimated_arrival_text: null,
  needs_review: false,
  created_at: "2026-10-23T10:00:00+00:00",
  submitted_at: "2026-10-23T10:00:00+00:00",
  succeeded_at: null,
  failed_at: null,
  last_checked_at: null,
  payment: { id: 9, ulid: PAYMENT_ULID, status: "captured", gateway_payment_ref: "fpay_1", payable_type: "booking", payable_id: 4 },
  ...over,
});

/** A confirmed booking whose money was taken, nothing refunded yet as far as the payment row knows. */
const captured = (over: Partial<BookingDetail> = {}) => {
  const base = bookingDetail({ status: "confirmed", payment_status: "captured" });
  return bookingDetail({
    status: "confirmed",
    payment_status: "captured",
    payment: { ...base.payment!, status: "captured", captured_fils: 24000, refunded_fils: 0 },
    ...over,
  });
};

const consoleError = vi.spyOn(console, "error");

describe("payment and refunds summary", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("lists refunds still processing or failed, with the provider's status, though none succeeded or came from a cancellation", async () => {
    api.fetchRefundsByPhone.mockResolvedValue([
      refund({}),
      refund({ id: 2, ulid: "01R2", amount_fils: 1500, status: "failed", status_label: { ar: "فشل", en: "Failed" }, reason_code: "unaccepted_payment", reason_label: { ar: "…", en: "Payment the booking did not accept" } }),
      // Another booking's refund for the same phone is left out.
      refund({ id: 3, ulid: "01R3", payment: { id: 10, ulid: "01OTHER", status: "captured", gateway_payment_ref: "fpay_2", payable_type: "booking", payable_id: 99 } }),
    ]);
    renderWithProviders(<PaymentCard booking={captured()} />, { permissions: ["bookings.view", "payments.view"] });
    const list = (await screen.findByText("Refunds (status from the payment provider)")).parentElement!;
    expect(api.fetchRefundsByPhone).toHaveBeenCalledWith("+971500000001");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Processing");
    expect(rows[0]).toHaveTextContent("Price difference");
    expect(rows[1]).toHaveTextContent("Failed");
  });

  it("does not look for refunds when no money was taken", () => {
    renderWithProviders(<PaymentCard booking={bookingDetail()} />, { permissions: ["bookings.view", "payments.view"] });
    expect(api.fetchRefundsByPhone).not.toHaveBeenCalled();
  });
});

describe("cancellation review task (§10.4)", () => {
  const review = () =>
    captured({
      cancellation: {
        party: null,
        cancelled_by_id: null,
        fee_fils: null,
        refund_fils: null,
        review_requested_at: "2026-10-23T08:00:00+00:00",
        review: { party: "customer", reason_code: "customer_request", reason_text: null } as BookingDetail["cancellation"]["review"],
      },
    });

  it("a coordinator (cancel, no refund permission) is told who can decide: someone with both permissions", () => {
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ["bookings.view", "bookings.cancel"] });
    expect(screen.getByRole("button", { name: "Cancel with a refund decision" })).toBeInTheDocument();
    expect(screen.getByText(/Deciding the refund also needs the refund permission/)).toBeInTheDocument();
    expect(screen.queryByText(/accountant/)).not.toBeInTheDocument();
  });

  it("an accountant (refunds, no cancel permission) sees why there is no action instead of a dead end", () => {
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ["bookings.view", "refunds.create"] });
    expect(screen.queryByRole("button", { name: "Cancel with a refund decision" })).not.toBeInTheDocument();
    expect(screen.getByText(/cancelling also needs the permission to cancel bookings/)).toBeInTheDocument();
  });

  it("someone with both permissions gets the actions and no note", () => {
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ["bookings.view", "bookings.cancel", "refunds.create"] });
    expect(screen.getByRole("button", { name: "Cancel with a refund decision" })).toBeInTheDocument();
    expect(screen.queryByText(/also needs/)).not.toBeInTheDocument();
  });
});
