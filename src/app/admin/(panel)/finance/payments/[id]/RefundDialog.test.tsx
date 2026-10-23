import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { IdempotencyKeys, newIdempotencyKey } from "@/lib/admin/idempotency";
import type { AdminInvoice, AdminPaymentDetail, AdminRefund } from "@/lib/admin/types";
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

async function fill(user: ReturnType<typeof userEvent.setup>, amount: string, reason = "complaint_compensation") {
  const field = screen.getByLabelText(/Amount to refund/);
  await user.clear(field);
  await user.type(field, amount);
  await user.selectOptions(screen.getByLabelText(/^Reason/), reason);
}

async function fillAndReview(user: ReturnType<typeof userEvent.setup>, amount: string, reason = "complaint_compensation") {
  await fill(user, amount, reason);
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
    expect(await screen.findByText("At most AED 240.00 can be refunded.")).toBeInTheDocument();
    expect(api.createRefund).not.toHaveBeenCalled();

    await fillAndReview(user, "180");
    const dialog = await screen.findByRole("dialog", { name: "Confirm the refund" });
    expect(dialog).toHaveTextContent("RefundAED 180.00");
    expect(dialog).toHaveTextContent("Left to refund afterwardsAED 60.00");
    expect(dialog).toHaveTextContent("Complaint compensation");
    expect(api.createRefund).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Refund AED 180.00" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(1));
    const [paymentId, payload, key] = api.createRefund.mock.calls[0];
    expect(paymentId).toBe(9);
    expect(payload).toEqual({ amount_fils: 18000, reason_code: "complaint_compensation", reason_text: null });
    expect(key).toMatch(UUID);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The toast states the provider's status, not "refunded", and a refund still processing is not a success yet.
    const toast = await screen.findByText("Refund of AED 180.00 sent. Provider status: Processing.");
    expect(toast.parentElement).toHaveClass("bg-info-50");
  });

  it("uses the success tone only when the provider reports the refund done", async () => {
    api.createRefund.mockResolvedValue(refund({ status: "succeeded", status_label: { ar: "تم الاسترداد", en: "Refunded" } }));
    const { user } = openDialog();
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));
    const toast = await screen.findByText("Refund of AED 180.00 sent. Provider status: Refunded.");
    expect(toast.parentElement).toHaveClass("bg-sage-100");
  });

  it("keeps the dialog open with the provider's message when the provider declines at once (201, failed)", async () => {
    api.createRefund.mockResolvedValue(
      refund({ status: "failed", status_label: { ar: "تعذر الاسترداد", en: "Refund failed" }, failure_code: "card_expired", failure_message: "The card has expired." }),
    );
    const { user, onClose } = openDialog();
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));

    const form = await screen.findByRole("dialog", { name: "Refund this payment" });
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("The provider declined the refund of AED 180.00");
    expect(alert).toHaveTextContent("The card has expired.");
    expect(alert).toHaveTextContent("No money was refunded. Provider status: Refund failed. (card_expired)");
    expect(onClose).not.toHaveBeenCalled();
    // Back on the form, no success message anywhere.
    expect(screen.getByRole("dialog", { name: "Refund this payment" })).toBeInTheDocument();
    expect(screen.queryByText(/sent\. Provider status/)).not.toBeInTheDocument();
  });

  it("never sends the refund from a double-click on Continue", async () => {
    api.createRefund.mockResolvedValue(refund());
    const { user } = openDialog();
    await fill(user, "180");
    await user.dblClick(screen.getByRole("button", { name: "Continue" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm the refund" });
    // In a browser the second click lands on what now sits where Continue was: the Refund button. It is the click's
    // second of a double-click (detail 2), which never refunds.
    fireEvent.click(within(dialog).getByRole("button", { name: "Refund AED 180.00" }), { detail: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.createRefund).not.toHaveBeenCalled();
    // Focus is on the summary, not on the Refund button.
    expect(document.activeElement).toHaveTextContent("Left to refund afterwards");
    expect(document.activeElement).not.toBe(within(dialog).getByRole("button", { name: "Refund AED 180.00" }));
  });

  it("stays open when the second click of a double-click lands outside the shorter confirm step", async () => {
    // The page behind the modal has pointer-events: none, so this user's check is off (for the click outside). The click
    // goes to a fresh element: user-event caches an earlier check on document.body even with the check off.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onClose = vi.fn();
    const keys = new IdempotencyKeys(newIdempotencyKey, { holdAfterUnknown: true });
    renderWithProviders(<RefundDialog payment={payment()} keys={keys} onClose={onClose} />, { permissions: ["payments.view", "refunds.create"] });
    await fillAndReview(user, "180");
    await screen.findByRole("dialog", { name: "Confirm the refund" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const outside = document.body.appendChild(document.createElement("div"));
    await user.click(outside);
    outside.remove();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Confirm the refund" })).toBeInTheDocument();
  });

  it("never sends the refund from pressing Enter twice on Continue", async () => {
    api.createRefund.mockResolvedValue(refund());
    const { user } = openDialog();
    await fill(user, "180");
    screen.getByRole("button", { name: "Continue" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Confirm the refund" });
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(api.createRefund).not.toHaveBeenCalled();
    // A deliberate activation of the Refund button still works.
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(1));
  });

  it("goes back to the amount from the confirmation", async () => {
    const { user } = openDialog();
    await fillAndReview(user, "180");
    await user.click(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByLabelText(/Amount to refund/)).toHaveFocus());
    expect(screen.getByLabelText(/Amount to refund/)).toHaveValue("180");
  });

  it("shows a customer without a name by phone, isolated left to right", async () => {
    const { user } = openDialog(payment({ customer: { id: 2, ulid: "01C2", name: "", phone: "+971500000002" } }));
    await fillAndReview(user, "180");
    const phone = within(await screen.findByRole("dialog", { name: "Confirm the refund" })).getByText("+971500000002");
    expect(phone.tagName).toBe("BDI");
    expect(phone).toHaveAttribute("dir", "ltr");
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
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));
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
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));
    await screen.findByText("We don't know yet whether the refund was sent");

    // The accountant goes back and asks for less: the same key goes with it, and the API says the first one arrived.
    await user.click(screen.getByRole("button", { name: "Back" }));
    await fillAndReview(user, "100");
    await user.click(screen.getByRole("button", { name: "Refund AED 100.00" }));
    expect(await screen.findByText("The first attempt was received")).toBeInTheDocument();
    const [first, second] = api.createRefund.mock.calls;
    expect(second[2]).toBe(first[2]);
    expect(second[1]).toMatchObject({ amount_fils: 10000 });

    // Showing the earlier refund sends exactly the first request again.
    await user.click(screen.getByRole("button", { name: "Show the refund of AED 180.00" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(3));
    expect(api.createRefund.mock.calls[2][2]).toBe(first[2]);
    expect(api.createRefund.mock.calls[2][1]).toEqual({ amount_fils: 18000, reason_code: "complaint_compensation", reason_text: null });
  });

  it("takes the API's refundable amount when another refund got there first", async () => {
    api.createRefund.mockRejectedValue(new AdminApiError(422, { code: "REFUND_AMOUNT_INVALID", message: "", details: { refundable_fils: 6000 } }));
    const { user } = openDialog();
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));
    expect(await screen.findByText("At most AED 60.00 can be refunded.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Refund this payment" })).toBeInTheDocument();
  });
});

const invoice = (id: number, paymentId: number): AdminInvoice =>
  ({
    id,
    number: `INV-2026-${String(id).padStart(6, "0")}`,
    status: "issued",
    status_label: "Paid",
    total_fils: 24000,
    payment: { id: paymentId },
  }) as unknown as AdminInvoice;

describe("PaymentDetailScreen", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    window.sessionStorage.clear();
    api.fetchInvoices.mockResolvedValue({ data: [], meta: { current_page: 1, per_page: 100, total: 0, last_page: 1 } });
  });

  it("shows the amounts, the provider's refund status and the event log; Refund needs refunds.create", async () => {
    api.fetchPayment.mockResolvedValue(payment({ refunds: [refund()], refundable_fils: 6000, status: "partially_refunded" }));
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view"] });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("fpay_0dc4e2ad");
    // Two decimals throughout, like the printed invoice (P2-35).
    expect(screen.getByText("Left to refund").nextSibling).toHaveTextContent("AED 60.00");
    expect(screen.getByText("Amount (VAT included)").nextSibling).toHaveTextContent("AED 240.00");
    expect(screen.getByText("VAT").nextSibling).toHaveTextContent("AED 11.43");
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Expected within 5 to 10 business days")).toBeInTheDocument();
    expect(screen.getByText("call.capture")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refund" })).not.toBeInTheDocument();
    // The customer's invoices since the payment was created (a day earlier for the time zone), page by page.
    expect(api.fetchInvoices).toHaveBeenCalledWith({ customerId: 2, from: "2026-10-22", page: 1, perPage: 100 });
  });

  it("finds the payment's invoice past the customer's first 100 invoices", async () => {
    api.fetchPayment.mockResolvedValue(payment());
    api.fetchInvoices.mockImplementation(async ({ page }: { page: number }) =>
      page === 1
        ? { data: Array.from({ length: 100 }, (_, i) => invoice(200 + i, 50 + i)), meta: { current_page: 1, per_page: 100, total: 101, last_page: 2 } }
        : { data: [invoice(5, 9)], meta: { current_page: 2, per_page: 100, total: 101, last_page: 2 } },
    );
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view"] });
    expect(await screen.findByRole("link", { name: "INV-2026-000005" })).toHaveAttribute("href", "/admin/finance/invoices/5");
    expect(screen.queryByText("No invoice found for this payment yet.")).not.toBeInTheDocument();
  });

  it("says why the payment needs review in words, keeping the code as detail", async () => {
    api.fetchPayment.mockResolvedValue(payment({ needs_review: true, review_reason: "success_reported_for_voided_payment" }));
    renderWithProviders(<PaymentDetailScreen id="9" />, { locale: "ar", permissions: ["payments.view"] });
    const notice = (await screen.findByText("تحتاج هذه الدفعة إلى مراجعة شخص من الفريق")).parentElement!;
    expect(notice).toHaveTextContent("السبب: أبلغ المزود عن نجاح الدفعة بعد أن أصبحت حالتها «أُلغيت الدفعة».");
    expect(within(notice).getByText("success_reported_for_voided_payment")).toHaveAttribute("dir", "ltr");
  });

  it("keeps a refund's key when the dialog is closed after an unknown outcome and opened again", async () => {
    api.fetchPayment.mockResolvedValue(payment());
    api.createRefund.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValueOnce(refund());
    const user = userEvent.setup();
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view", "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Refund" }));
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));
    await screen.findByText("We don't know yet whether the refund was sent");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Refund" }));
    await user.click(await screen.findByRole("button", { name: "Send the earlier refund of AED 180.00 again" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(2));
    const [first, second] = api.createRefund.mock.calls;
    expect(second[2]).toBe(first[2]);
    expect(second[1]).toEqual(first[1]);
  });

  it("keeps the dialog and the refund's key when the payment refresh after a lost refund fails too", async () => {
    // The backend that lost the refund's answer is still unreachable when the page refreshes the payment.
    api.fetchPayment.mockResolvedValueOnce(payment()).mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue(payment());
    api.createRefund.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValueOnce(refund());
    const user = userEvent.setup();
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view", "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Refund" }));
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));
    await screen.findByText("We don't know yet whether the refund was sent");
    await waitFor(() => expect(api.fetchPayment).toHaveBeenCalledTimes(2));

    // The page says the refresh failed but stays, with the dialog and its unknown-outcome notice.
    expect(await screen.findByText("This payment couldn't be refreshed. What you see may be out of date.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Confirm the refund" })).toHaveTextContent("We don't know yet whether the refund was sent");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(2));
    const [first, second] = api.createRefund.mock.calls;
    expect(second[2]).toBe(first[2]);
    expect(second[1]).toEqual(first[1]);
  });

  it("offers the same refund again after a reload when its answer never arrived", async () => {
    api.fetchPayment.mockResolvedValue(payment());
    api.createRefund.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValueOnce(refund());
    const user = userEvent.setup();
    const first = renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view", "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Refund" }));
    await fillAndReview(user, "180");
    await user.click(screen.getByRole("button", { name: "Refund AED 180.00" }));
    await screen.findByText("We don't know yet whether the refund was sent");
    first.unmount();

    // The accountant reloads the page (same tab) and opens the refund again.
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view", "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Refund" }));
    await user.click(await screen.findByRole("button", { name: "Send the earlier refund of AED 180.00 again" }));
    await waitFor(() => expect(api.createRefund).toHaveBeenCalledTimes(2));
    const [before, after] = api.createRefund.mock.calls;
    expect(after[2]).toBe(before[2]);
    expect(after[1]).toEqual(before[1]);
  });

  it("offers Refund to refunds.create only while money is left", async () => {
    api.fetchPayment.mockResolvedValue(payment({ refundable_fils: 0, status: "refunded" }));
    renderWithProviders(<PaymentDetailScreen id="9" />, { permissions: ["payments.view", "refunds.create"] });
    expect(await screen.findByRole("button", { name: "Refund" })).toBeDisabled();
    expect(screen.getByText("Only a payment that has been taken, with money left to refund, can be refunded.")).toBeInTheDocument();
  });
});
