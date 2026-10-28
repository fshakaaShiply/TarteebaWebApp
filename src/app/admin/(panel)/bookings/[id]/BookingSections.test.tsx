import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { AdminRefund, BookingDetail } from "@/lib/admin/types";
import { bookingDetail } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { CancelReviewTask, PaymentCard } from "./BookingSections";

const api = { fetchRefundsByPhone: vi.fn(), previewCancellation: vi.fn(), resolveCancelReview: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchRefundsByPhone: (...a: unknown[]) => api.fetchRefundsByPhone(...a),
  previewCancellation: (...a: unknown[]) => api.previewCancellation(...a),
  resolveCancelReview: (...a: unknown[]) => api.resolveCancelReview(...a),
}));

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });

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
    // Opening the page is staff activity: no X-Background-Poll (a poll's change would send it, see BookingRefresh.test).
    expect(api.fetchRefundsByPhone).toHaveBeenCalledWith("+971500000001", { background: false });
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

  const invoiced = () =>
    captured({ invoice: { id: 318, number: "INV-2026-000318", status: "credited_partial", status_label: { ar: "مستردة جزئيًا", en: "Partially refunded" } } });

  it("links the tax invoice to its A09 page for finance readers", async () => {
    api.fetchRefundsByPhone.mockResolvedValue([]);
    renderWithProviders(<PaymentCard booking={invoiced()} />, { permissions: ["bookings.view", "invoices.manage"] });
    const link = screen.getByRole("link", { name: "Open tax invoice INV-2026-000318" });
    expect(link).toHaveAttribute("href", "/admin/finance/invoices/318");
    expect(link).toHaveTextContent("INV-2026-000318");
    expect(screen.getByText("Partially refunded")).toBeInTheDocument();
  });

  it("shows the invoice number as plain text to roles that can't open invoices", () => {
    renderWithProviders(<PaymentCard booking={invoiced()} />, { permissions: ["bookings.view"] });
    expect(screen.getByText("INV-2026-000318")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /INV-2026-000318/ })).not.toBeInTheDocument();
    expect(screen.getByText("Partially refunded")).toBeInTheDocument();
  });

  it("says the invoice is not issued yet while money was taken but Billing has not issued it", () => {
    renderWithProviders(<PaymentCard booking={captured()} />, { permissions: ["bookings.view"] });
    expect(screen.getByText("Tax invoice").nextSibling).toHaveTextContent("Not issued yet");
    renderWithProviders(<PaymentCard booking={bookingDetail({ invoice: null })} />, { permissions: ["bookings.view"] });
    expect(screen.getAllByText("Tax invoice")).toHaveLength(1);
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

  const ACCOUNTANT = ["bookings.view", "payments.view", "refunds.create", "invoices.manage"];

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchRefundsByPhone.mockResolvedValue([]);
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("a coordinator (cancel, no refund permission) keeps Decline and Cancel, and is told finance decides the refund", () => {
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ["bookings.view", "bookings.cancel"] });
    expect(screen.getByRole("button", { name: "Cancel with a refund decision" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep the booking" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve with refund" })).not.toBeInTheDocument();
    expect(screen.getByText(/The refund is for finance to decide/)).toBeInTheDocument();
  });

  it("an accountant (refunds, no cancel permission) resolves it with a refund instead of a dead end", () => {
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ACCOUNTANT });
    expect(screen.getByRole("button", { name: "Resolve with refund" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel with a refund decision" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep the booking" })).not.toBeInTheDocument();
  });

  it("someone with both permissions keeps the coordinator's actions and no note", () => {
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ["bookings.view", "bookings.cancel", "refunds.create"] });
    expect(screen.getByRole("button", { name: "Cancel with a refund decision" })).toBeInTheDocument();
    expect(screen.queryByText(/finance to decide/)).not.toBeInTheDocument();
  });

  it("resolve: checks the amount against what is refundable and the note, then sends it with Idempotency-Key and If-Match", async () => {
    api.resolveCancelReview.mockResolvedValue({ payment: "refunded", fee_fils: 4000, refund_fils: 20000, booking: captured({ status: "cancelled" }) });
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Resolve with refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Resolve the cancellation of TRB-R4RYSD" });
    expect(dialog).toHaveTextContent("Customer's reason: ");
    expect(dialog).toHaveTextContent("Can still be refundedAED 240");
    const amount = within(dialog).getByRole("textbox", { name: /Refund amount/ });
    const note = within(dialog).getByRole("textbox", { name: /Note/ });

    await user.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    expect(within(dialog).getByText("Enter the amount to refund.")).toBeInTheDocument();
    expect(within(dialog).getByText("Write a reason.")).toBeInTheDocument();

    await user.type(amount, "300");
    await user.type(note, "ok");
    await user.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    expect(within(dialog).getByText("The refund can't be more than what can still be refunded.")).toBeInTheDocument();
    expect(within(dialog).getByText("Write at least 3 characters.")).toBeInTheDocument();
    expect(api.resolveCancelReview).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, "200");
    await user.type(note, " — late notice, fee kept");
    await user.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    await waitFor(() =>
      expect(api.resolveCancelReview).toHaveBeenCalledWith(4, { refund_fils: 20000, note: "ok — late notice, fee kept" }, 3, expect.stringMatching(/^[0-9a-f-]{36}$/)),
    );
    expect(await screen.findByText("TRB-R4RYSD is cancelled. A refund of AED 200 was requested from the payment provider.")).toBeInTheDocument();
  });

  it("resolve: a crew already on the road (409 INVALID_STATE) is for operations; an amount above the refundable shows the API's cap", async () => {
    api.resolveCancelReview
      .mockRejectedValueOnce(apiError(422, "REFUND_AMOUNT_INVALID", { refundable_fils: 18000 }))
      .mockRejectedValueOnce(apiError(409, "INVALID_STATE", { visit_status: "en_route" }));
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Resolve with refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Resolve the cancellation of TRB-R4RYSD" });
    const amount = within(dialog).getByRole("textbox", { name: /Refund amount/ });
    await user.type(amount, "200");
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Customer called, partial refund");
    await user.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    expect(await within(dialog).findByText("At most AED 180 can still be refunded.")).toBeInTheDocument();
    expect(amount).toHaveAccessibleDescription("At most AED 180 can still be refunded.");
    expect(dialog).toHaveTextContent("Can still be refundedAED 180");

    await user.clear(amount);
    await user.type(amount, "180");
    await user.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    expect(await within(dialog).findByText("The visit is already under way")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("turning the team back is for operations to decide");
    // Each attempt had its own body, so its own key.
    expect(api.resolveCancelReview.mock.calls[0][3]).not.toBe(api.resolveCancelReview.mock.calls[1][3]);
  });

  it("resolve: a refund still processing lowers what can be refunded, as the API's cap does", async () => {
    // A reschedule's price difference of AED 40 the provider has not confirmed yet (not in refunded_fils), and a
    // failed one that frees its amount again.
    api.fetchRefundsByPhone.mockResolvedValue([
      refund({ amount_fils: 4000, status: "processing" }),
      refund({ id: 2, ulid: "01R2", amount_fils: 1000, status: "failed" }),
    ]);
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Resolve with refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Resolve the cancellation of TRB-R4RYSD" });
    await waitFor(() => expect(dialog).toHaveTextContent("Can still be refundedAED 200"));
    const amount = within(dialog).getByRole("textbox", { name: /Refund amount/ });
    expect(amount).toHaveAccessibleDescription("From 0 to AED 200.");

    await user.type(amount, "240");
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Full refund asked");
    await user.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    expect(within(dialog).getByText("The refund can't be more than what can still be refunded.")).toBeInTheDocument();
    expect(api.resolveCancelReview).not.toHaveBeenCalled();
  });

  it("resolve: a review no longer waiting (409 CANCEL_REVIEW_NOT_PENDING) says so", async () => {
    api.resolveCancelReview.mockRejectedValue(apiError(409, "CANCEL_REVIEW_NOT_PENDING"));
    renderWithProviders(<CancelReviewTask booking={review()} onStale={vi.fn()} />, { permissions: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Resolve with refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Resolve the cancellation of TRB-R4RYSD" });
    await user.type(within(dialog).getByRole("textbox", { name: /Refund amount/ }), "0");
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "No refund under the policy");
    await user.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    expect(await within(dialog).findByText("No cancellation request is waiting for review on this booking.")).toBeInTheDocument();
    expect(api.resolveCancelReview).toHaveBeenCalledWith(4, { refund_fils: 0, note: "No refund under the policy" }, 3, expect.any(String));
  });

  it("resolve: STALE_VERSION closes the dialog and asks to reload", async () => {
    api.resolveCancelReview.mockRejectedValue(apiError(409, "STALE_VERSION"));
    const onStale = vi.fn();
    renderWithProviders(<CancelReviewTask booking={review()} onStale={onStale} />, { permissions: ACCOUNTANT });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Resolve with refund" }));
    const dialog = screen.getByRole("alertdialog", { name: "Resolve the cancellation of TRB-R4RYSD" });
    await user.type(within(dialog).getByRole("textbox", { name: /Refund amount/ }), "50");
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Partial refund agreed");
    await user.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    await waitFor(() => expect(onStale).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
