import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { IdempotencyKeys, newIdempotencyKey } from "@/lib/admin/idempotency";
import type { AdminPaymentDetail, AdminRefund } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { PaymentDetailScreen } from "./PaymentDetailScreen";
import { RefundDialog } from "./RefundDialog";

const api = { createRefund: vi.fn(), fetchPayment: vi.fn(), fetchInvoices: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  createRefund: (...a: unknown[]) => api.createRefund(...a),
  fetchPayment: (...a: unknown[]) => api.fetchPayment(...a),
  fetchInvoices: (...a: unknown[]) => api.fetchInvoices(...a),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const refund = (over: Partial<AdminRefund> = {}): AdminRefund => ({
  id: 3,
  ulid: "01R3",
  amount_fils: 18000,
  currency: "AED",
  status: "processing",
  status_label: { ar: "قيد المعالجة", en: "Processing" },
  reason_code: "complaint_compensation",
  reason_label: { ar: "تعويض شكوى", en: "Complaint compensation" },
  reason_text: null,
  requested_by: { type: "staff", id: 4, name: "Test Accountant" },
  gateway: "fake",
  gateway_refund_ref: null,
  failure_code: null,
  failure_message: null,
  credit_note_id: null,
  estimated_arrival_text: { ar: "خلال 5 إلى 10 أيام عمل", en: "within 5 to 10 business days" },
  needs_review: false,
  created_at: "2026-10-23T17:40:00+00:00",
  submitted_at: "2026-10-23T17:40:00+00:00",
  succeeded_at: null,
  failed_at: null,
  last_checked_at: null,
  ...over,
});

const payment = (over: Partial<AdminPaymentDetail> = {}): AdminPaymentDetail => ({
  id: 9,
  ulid: "01m5mxexxwvwpdgwypmp1b0f25",
  customer: { id: 2, ulid: "01C2", name: "Omar Khalid", phone: "+971500000002" },
  payable: { type: "booking", id: 9, public_id: "01B9" },
  gateway: "fake",
  gateway_payment_ref: "fpay_0dc4e2ad",
  method: "card",
  card: { brand: "visa", brand_label: "Visa", last4: "4242", label: "Visa •••• 4242", payment_method_id: null },
  intent: "authorize",
  status: "captured",
  status_label: { ar: "تم الدفع", en: "Paid" },
  currency: "AED",
  amount_fils: 24000,
  vat_fils: 1143,
  discount_fils: 0,
  net_fils: 22857,
  captured_fils: 24000,
  refunded_fils: 0,
  fee_fils: null,
  net_settled_fils: null,
  needs_review: false,
  attempts: 1,
  failure_code: null,
  created_at: "2026-10-23T17:38:11+00:00",
  authorized_at: "2026-10-23T17:38:11+00:00",
  captured_at: "2026-10-23T17:38:19+00:00",
  voided_at: null,
  version: 5,
  refundable_fils: 24000,
  three_ds_status: null,
  failure_message: null,
  gateway_session_ref: "fses_2d07",
  verifying_since: null,
  review_reason: null,
  void_reason: null,
  updated_at: "2026-10-23T17:38:19+00:00",
  events: [
    {
      id: 28,
      source: "call",
      type: "call.capture",
      outcome: "applied",
      provider_event_id: null,
      signature_valid: null,
      received_at: "2026-10-23T17:38:19+00:00",
      processed_at: "2026-10-23T17:38:19+00:00",
      payload: { raw: { status: "captured", amount_fils: 24000 } },
    },
  ],
  refunds: [],
  ...over,
});

function openDialog(p = payment()) {
  const onClose = vi.fn();
  // The payment page owns the key store (it outlives the dialog).
  const keys = new IdempotencyKeys(newIdempotencyKey, { holdAfterUnknown: true });
  renderWithProviders(<RefundDialog payment={p} keys={keys} onClose={onClose} />, { permissions: ["payments.view", "refunds.create"] });
  return { onClose, user: userEvent.setup() };
}

async function fillAndReview(user: ReturnType<typeof userEvent.setup>, amount: string, reason = "complaint_compensation") {
  const field = screen.getByLabelText(/Amount to refund/);
  await user.clear(field);
  await user.type(field, amount);
  await user.selectOptions(screen.getByLabelText(/^Reason/), reason);
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

const consoleError = vi.spyOn(console, "error");

describe("RefundDialog", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("never asks for more than is left, then confirms the exact amount and sends it in fils", async () => {
    api.createRefund.mockResolvedValue(refund());
    const { user, onClose } = openDialog();
    // Starts at the whole refundable amount; the reason must be chosen.
    expect(screen.getByLabelText(/Amount to refund/)).toHaveValue("240.00");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Choose the reason for the refund.")).toBeInTheDocument();

    await fillAndReview(user, "240.01");
    expect(await screen.findByText("At most AED 240 can be refunded.")).toBeInTheDocument();
    expect(api.createRefund).not.toHaveBeenCalled();

    await fillAndReview(user, "180");
    const dialog = await screen.findByRole("dialog", { name: "Confirm the refund" });
    expect(dialog).toHaveTextContent("RefundAED 180");
    expect(dialog).toHaveTextContent("Left to refund afterwardsAED 60");
    expect(dialog).toHaveTextContent("Complaint compensation");
    expect(api.createRefund).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Refund AED 180" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(1));
    const [paymentId, payload, key] = api.createRefund.mock.calls[0];
    expect(paymentId).toBe(9);
    expect(payload).toEqual({ amount_fils: 18000, reason_code: "complaint_compensation", reason_text: null });
    expect(key).toMatch(UUID);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The toast states the provider's status, not "refunded".
    expect(await screen.findByText("Refund of AED 180 sent. Provider status: Processing.")).toBeInTheDocument();
  });

  it("needs a note for other", async () => {
    const { user } = openDialog();
    await fillAndReview(user, "50", "other");
    expect(await screen.findByText("Explain the reason in a note.")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Note/), "Agreed by phone");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("dialog", { name: "Confirm the refund" })).toHaveTextContent("“Agreed by phone”");
  });

  it("retries a lost answer with the same Idempotency-Key and the same request", async () => {
    api.createRefund.mockRejectedValueOnce(new AdminApiError(502, { code: "BAD_GATEWAY", message: "", details: {} })).mockResolvedValueOnce(refund());
    const { user, onClose } = openDialog();
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180" }));
    expect(await screen.findByText("We don't know yet whether the refund was sent")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(2));
    const [first, second] = api.createRefund.mock.calls;
    expect(second[2]).toBe(first[2]);
    expect(second[1]).toEqual(first[1]);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the key after an unknown outcome even when the amount changes, so the customer is never refunded twice", async () => {
    api.createRefund
      .mockRejectedValueOnce(AdminApiError.network())
      .mockRejectedValueOnce(new AdminApiError(422, { code: "IDEMPOTENCY_KEY_REUSED", message: "", details: {} }))
      .mockResolvedValueOnce(refund());
    const { user } = openDialog();
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180" }));
    await screen.findByText("We don't know yet whether the refund was sent");

    // The accountant goes back and asks for less: the same key goes with it, and the API says the first one arrived.
    await user.click(screen.getByRole("button", { name: "Back" }));
    await fillAndReview(user, "100");
    await user.click(screen.getByRole("button", { name: "Refund AED 100" }));
    expect(await screen.findByText("The first attempt was received")).toBeInTheDocument();
    const [first, second] = api.createRefund.mock.calls;
    expect(second[2]).toBe(first[2]);
    expect(second[1]).toMatchObject({ amount_fils: 10000 });

    // Showing the earlier refund sends exactly the first request again.
    await user.click(screen.getByRole("button", { name: "Show the refund of AED 180" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(3));
    expect(api.createRefund.mock.calls[2][2]).toBe(first[2]);
    expect(api.createRefund.mock.calls[2][1]).toEqual({ amount_fils: 18000, reason_code: "complaint_compensation", reason_text: null });
  });

  it("takes the API's refundable amount when another refund got there first", async () => {
    api.createRefund.mockRejectedValue(new AdminApiError(422, { code: "REFUND_AMOUNT_INVALID", message: "", details: { refundable_fils: 6000 } }));
    const { user } = openDialog();
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180" }));
    expect(await screen.findByText("At most AED 60 can be refunded.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Refund this payment" })).toBeInTheDocument();
  });
});

describe("PaymentDetailScreen", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchInvoices.mockResolvedValue({ data: [], meta: { current_page: 1, per_page: 100, total: 0, last_page: 1 } });
  });

  it("shows the amounts, the provider's refund status and the event log; Refund needs refunds.create", async () => {
    api.fetchPayment.mockResolvedValue(payment({ refunds: [refund()], refundable_fils: 6000, status: "partially_refunded" }));
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view"] });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("fpay_0dc4e2ad");
    expect(screen.getByText("Left to refund").nextSibling).toHaveTextContent("AED 60");
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Expected within 5 to 10 business days")).toBeInTheDocument();
    expect(screen.getByText("call.capture")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refund" })).not.toBeInTheDocument();
    expect(api.fetchInvoices).toHaveBeenCalledWith({ customerId: 2, perPage: 100 });
  });

  it("keeps a refund's key when the dialog is closed after an unknown outcome and opened again", async () => {
    api.fetchPayment.mockResolvedValue(payment());
    api.createRefund.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValueOnce(refund());
    const user = userEvent.setup();
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view", "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Refund" }));
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180" }));
    await screen.findByText("We don't know yet whether the refund was sent");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Refund" }));
    await user.click(await screen.findByRole("button", { name: "Send the earlier refund of AED 180 again" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(2));
    const [first, second] = api.createRefund.mock.calls;
    expect(second[2]).toBe(first[2]);
    expect(second[1]).toEqual(first[1]);
  });

  it("offers Refund to refunds.create only while money is left", async () => {
    api.fetchPayment.mockResolvedValue(payment({ refundable_fils: 0, status: "refunded" }));
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view", "refunds.create"] });
    expect(await screen.findByRole("button", { name: "Refund" })).toBeDisabled();
    expect(screen.getByText("Only a payment that has been taken, with money left to refund, can be refunded.")).toBeInTheDocument();
  });
});
