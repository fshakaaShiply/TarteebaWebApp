import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isBuiltAdminPage } from "@/lib/admin/alerts";
import { AdminApiError } from "@/lib/admin/client";
import type { AdminPaymentDetail, AdminRefund } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { PaymentDetailScreen } from "./PaymentDetailScreen";

const api = { fetchPayment: vi.fn(), fetchRefundReasons: vi.fn(), clearPaymentReview: vi.fn(), fetchWalletEnabled: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchPayment: (...a: unknown[]) => api.fetchPayment(...a),
  fetchRefundReasons: (...a: unknown[]) => api.fetchRefundReasons(...a),
}));
vi.mock("@/lib/admin/finance/endpoints", () => ({
  clearPaymentReview: (...a: unknown[]) => api.clearPaymentReview(...a),
  fetchWalletEnabled: (...a: unknown[]) => api.fetchWalletEnabled(...a),
}));

const payment = (over: Partial<AdminPaymentDetail> = {}): AdminPaymentDetail =>
  ({
    id: 9,
    ulid: "01m5mxexxwvwpdgwypmp1b0f25",
    customer: { id: 2, ulid: "01C2", name: "Omar Khalid", phone: "+971500000002" },
    payable: { type: "booking", id: 9, public_id: "01B9", reference: "TRB-7K2Q9M" },
    gateway: "fake",
    gateway_payment_ref: "fpay_0dc4e2ad",
    method: "card",
    card: null,
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
    fee_fils: 600,
    net_settled_fils: 23400,
    invoice: null,
    needs_review: false,
    attempts: 1,
    failure_code: null,
    created_at: "2026-10-23T17:38:11+00:00",
    authorized_at: null,
    captured_at: "2026-10-23T17:38:19+00:00",
    voided_at: null,
    version: 5,
    refundable_fils: 24000,
    three_ds_status: null,
    failure_message: null,
    gateway_session_ref: null,
    verifying_since: null,
    review_reason: null,
    review_reason_label: null,
    void_reason: null,
    void_reason_label: null,
    updated_at: "2026-10-23T17:38:19+00:00",
    events: [],
    refunds: [],
    review: { needs_review: false, reason: null, reason_label: null, cleared_at: null, cleared_by: null, note: null },
    disputed_fils: 0,
    reconciliation: [],
    ...over,
  }) as AdminPaymentDetail;

const flagged = payment({
  needs_review: true,
  review_reason: "amount_mismatch",
  review_reason_label: { ar: "اختلف مبلغ المزود عن مبلغنا", en: "The provider's amount differs from ours" },
  review: { needs_review: true, reason: "amount_mismatch", reason_label: { ar: "اختلف مبلغ المزود عن مبلغنا", en: "The provider's amount differs from ours" }, cleared_at: null, cleared_by: null, note: null },
});

const refundRow = (over: Partial<AdminRefund> = {}): AdminRefund =>
  ({
    id: 3,
    ulid: "01R3",
    amount_fils: 3000,
    currency: "AED",
    status: "succeeded",
    status_label: { ar: "تم الاسترداد", en: "Refunded" },
    reason_code: "complaint_compensation",
    reason_label: { ar: "تعويض شكوى", en: "Complaint compensation" },
    reason_text: null,
    requested_by: { type: "staff", id: 4, name: "Test Accountant" },
    gateway: "fake",
    destination: "card",
    context: null,
    gateway_refund_ref: "fref_1",
    failure_code: null,
    failure_message: null,
    credit_note_id: null,
    credit_note: null,
    estimated_arrival_text: null,
    needs_review: false,
    created_at: "2026-10-23T17:40:00+00:00",
    submitted_at: null,
    succeeded_at: "2026-10-23T17:41:00+00:00",
    failed_at: null,
    last_checked_at: null,
    ...over,
  }) as AdminRefund;

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchRefundReasons.mockResolvedValue([]);
  api.fetchWalletEnabled.mockResolvedValue(false);
  api.fetchPayment.mockResolvedValue(payment());
});

const open = (permissions: readonly string[] = ["payments.view", "refunds.create", "reconciliation.run"], locale: "en" | "ar" = "en") =>
  renderWithProviders(<PaymentDetailScreen id="9" />, { permissions, locale });

describe("A09 payment page: review flag", () => {
  it("shows why the payment was flagged and clears the flag with a note, sending the payment's version", async () => {
    api.fetchPayment.mockResolvedValue(flagged);
    api.clearPaymentReview.mockResolvedValue(payment());
    const user = userEvent.setup();
    open();
    const banner = await screen.findByText("This payment needs a person to check it");
    expect(banner.closest("[role]")).toHaveTextContent("The provider's amount differs from ours");
    await user.click(screen.getByRole("button", { name: "Clear flag" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    expect(within(dialog).getByText("Write a note.")).toBeInTheDocument();
    expect(api.clearPaymentReview).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/^Note/), "Checked the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    await waitFor(() => expect(api.clearPaymentReview).toHaveBeenCalledWith(9, "Checked the provider statement", 5));
    expect(await screen.findByText("The payment's review flag was cleared.")).toBeInTheDocument();
  });

  it("explains in words why the API refused to clear it, and that a flag cleared meanwhile needs nothing more", async () => {
    api.fetchPayment.mockResolvedValue(flagged);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Clear flag" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Note/), "Checked the provider statement");
    api.clearPaymentReview.mockRejectedValueOnce(new AdminApiError(409, { code: "PAYMENT_VERIFYING", message: "x", details: {} }));
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    expect(await within(dialog).findByText("The provider hasn't settled this payment yet. Clear the flag once it has.")).toBeInTheDocument();
    // Someone cleared it meanwhile: the page reads the payment again, and the dialog says there is nothing left to do.
    api.fetchPayment.mockResolvedValue(payment({ version: 6 }));
    api.clearPaymentReview.mockRejectedValueOnce(new AdminApiError(409, { code: "NOT_FLAGGED", message: "x", details: {} }));
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    expect(await within(dialog).findByText("Nothing was saved. This payment no longer needs this action, so close this window.")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("This payment changed meanwhile");
    expect(within(dialog).getByRole("button", { name: "Clear flag" })).toBeDisabled();
    expect(api.clearPaymentReview).toHaveBeenCalledTimes(2);
  });

  it("after 409 STALE_VERSION takes the payment's new version from the page, so the next confirmation can succeed", async () => {
    api.fetchPayment.mockResolvedValue(flagged);
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Clear flag" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Note/), "Checked the provider statement");
    api.fetchPayment.mockResolvedValue({ ...flagged, version: 6 });
    api.clearPaymentReview.mockRejectedValueOnce(new AdminApiError(409, { code: "STALE_VERSION", message: "x", details: {} })).mockResolvedValue(payment({ version: 7 }));
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    expect(await within(dialog).findByText(/The payment has been read again: if you still want to clear its flag, confirm again/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    await waitFor(() => expect(api.clearPaymentReview).toHaveBeenCalledTimes(2));
    expect(api.clearPaymentReview.mock.calls.map((c) => c[2])).toEqual([5, 6]);
    expect(await screen.findByText("The payment's review flag was cleared.")).toBeInTheDocument();
  });

  it("disables the button with the reason while the provider has not settled the payment", async () => {
    api.fetchPayment.mockResolvedValue({ ...flagged, status: "verifying", verifying_since: "2026-10-23T17:38:19+00:00" });
    open();
    const button = await screen.findByRole("button", { name: "Clear flag" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Available once the provider has settled this payment.")).toBeInTheDocument();
  });

  it("offers no Clear flag without reconciliation.run, and says when the flag was cleared and by whom", async () => {
    api.fetchPayment.mockResolvedValue(flagged);
    const { unmount } = open(["payments.view", "refunds.create"]);
    await screen.findByText("This payment needs a person to check it");
    expect(screen.queryByRole("button", { name: "Clear flag" })).not.toBeInTheDocument();
    unmount();
    api.fetchPayment.mockResolvedValue(
      payment({ review: { needs_review: false, reason: "amount_mismatch", reason_label: null, cleared_at: "2026-11-18T08:00:00+00:00", cleared_by: { id: 4, name: "Test Accountant" }, note: "Checked the statement" } }),
    );
    open();
    expect(await screen.findByText(/The review flag was cleared on/)).toHaveTextContent("Test Accountant");
    expect(screen.getByText(/The review flag was cleared on/)).toHaveTextContent("“Checked the statement”");
  });
});

describe("A09 payment page: amounts, disputes and reconciliation", () => {
  it("shows the fee and the net settled once reconciliation has filled them", async () => {
    open();
    const amounts = (await screen.findByRole("heading", { name: "Amounts" })).closest("section")!;
    expect(amounts).toHaveTextContent("Provider feeAED 6.00");
    expect(amounts).toHaveTextContent("Net settledAED 234.00");
    expect(amounts).not.toHaveTextContent("Disputed");
  });

  it("holds a disputed amount out of what is left to refund, and says so", async () => {
    api.fetchPayment.mockResolvedValue(payment({ disputed_fils: 6000, refundable_fils: 18000 }));
    open();
    const amounts = (await screen.findByRole("heading", { name: "Amounts" })).closest("section")!;
    expect(amounts).toHaveTextContent("Disputed by the customer's bank");
    expect(amounts).toHaveTextContent("AED 60.00");
    expect(amounts).toHaveTextContent("Left to refundAED 180.00");
    expect(amounts).toHaveTextContent("the amount the customer's bank disputed");
  });

  it("lists where the payment stands in the provider's reports, linked to the run", async () => {
    api.fetchPayment.mockResolvedValue(
      payment({
        reconciliation: [
          { item_id: 501, run_id: 41, report_date: "2026-10-22", line_type: "charge", status: "amount_mismatch", reason_code: "amount_differs", resolved: false },
          { item_id: 502, run_id: 40, report_date: "2026-10-21", line_type: "refund", status: "matched", reason_code: "ok", resolved: false },
        ],
      }),
    );
    open();
    const card = (await screen.findByRole("heading", { name: "Reconciliation" })).closest("section")!;
    const links = within(card).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/admin/finance/reconciliation/41");
    expect(links[1]).toHaveAttribute("href", "/admin/finance/reconciliation/40");
    expect(card).toHaveTextContent("Amount differs");
    expect(card).toHaveTextContent("Needs action");
    expect(card).toHaveTextContent("Matched");
  });

  it("shows no reconciliation card for a payment no report named", async () => {
    open();
    await screen.findByRole("heading", { name: "Amounts" });
    expect(screen.queryByRole("heading", { name: "Reconciliation" })).not.toBeInTheDocument();
  });
});

describe("A09 payment page: refunds with their destination and context", () => {
  it("names where each refund went and what it compensates, linking the case only when the API gave a link and the page exists", async () => {
    api.fetchPayment.mockResolvedValue(
      payment({
        refunds: [
          refundRow({ id: 3, destination: "card" }),
          refundRow({
            id: 4,
            ulid: "01R4",
            destination: "wallet",
            gateway: "wallet",
            gateway_refund_ref: null,
            context: { type: "complaint", id: 41, reference: "TC-ABC123", link: { list: "complaint", path: "/api/v1/admin/complaints/41", params: {} } },
          }),
          refundRow({ id: 5, ulid: "01R5", context: { type: "complaint", id: 42, reference: "TC-NOLINK", link: null } }),
        ],
      }),
    );
    open();
    const refunds = (await screen.findByRole("heading", { name: "Refunds" })).closest("section")!;
    const items = within(refunds).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Card");
    expect(items[1]).toHaveTextContent("Tarteeba balance");
    expect(items[1]).toHaveTextContent("Complaint TC-ABC123");
    // The case page belongs to A10 (a later slice): the link appears once that page is built.
    const link = within(items[1]).queryByRole("link", { name: "Complaint TC-ABC123" });
    expect(Boolean(link)).toBe(isBuiltAdminPage("/admin/quality/41"));
    if (link) expect(link).toHaveAttribute("href", "/admin/quality/41");
    // No link for a person without complaints.manage: the reference is plain text.
    expect(items[2]).toHaveTextContent("Complaint TC-NOLINK");
    expect(within(items[2]).queryByRole("link", { name: /TC-NOLINK/ })).not.toBeInTheDocument();
  });
});
