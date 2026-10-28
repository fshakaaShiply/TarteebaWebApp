import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { AdminCreditNoteDetail, AdminInvoice, AdminPayment, AdminRefund, BillingRefusal, FinanceSummary, RefundReason } from "@/lib/admin/types";
import { AdminZoneProvider } from "@/lib/admin/zone";
import { renderWithProviders } from "@/test/render";
import { BillingRefusalsScreen } from "./billing-refusals/BillingRefusalsScreen";
import { CreditNotesScreen } from "./credit-notes/CreditNotesScreen";
import { CreditNoteDetailScreen } from "./credit-notes/[id]/CreditNoteDetailScreen";
import { FinanceSummaryScreen } from "./FinanceSummaryScreen";
import { InvoicesScreen } from "./invoices/InvoicesScreen";
import { PaymentsScreen } from "./payments/PaymentsScreen";
import { RefundsScreen } from "./refunds/RefundsScreen";

// The page URL: useSearchParams follows history.replaceState like Next's own integration does.
const url = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set(next: string) {
      params = new URLSearchParams(next.split("?")[1] ?? "");
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/admin/finance/payments",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = {
  fetchPayments: vi.fn(),
  fetchRefunds: vi.fn(),
  fetchInvoices: vi.fn(),
  fetchCreditNotes: vi.fn(),
  fetchCreditNote: vi.fn(),
  fetchCreditNotePdf: vi.fn(),
  fetchBillingRefusals: vi.fn(),
  retryBillingRefusal: vi.fn(),
  fetchRefundReasons: vi.fn(),
  fetchFinanceSummary: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchRefundReasons: (...a: unknown[]) => api.fetchRefundReasons(...a),
  fetchFinanceSummary: (...a: unknown[]) => api.fetchFinanceSummary(...a),
  fetchPayments: (...a: unknown[]) => api.fetchPayments(...a),
  fetchRefunds: (...a: unknown[]) => api.fetchRefunds(...a),
  fetchInvoices: (...a: unknown[]) => api.fetchInvoices(...a),
  fetchCreditNotes: (...a: unknown[]) => api.fetchCreditNotes(...a),
  fetchCreditNote: (...a: unknown[]) => api.fetchCreditNote(...a),
  fetchCreditNotePdf: (...a: unknown[]) => api.fetchCreditNotePdf(...a),
  fetchBillingRefusals: (...a: unknown[]) => api.fetchBillingRefusals(...a),
  retryBillingRefusal: (...a: unknown[]) => api.retryBillingRefusal(...a),
}));

const page = <T,>(rows: T[]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });

// Shapes from the local API (GET /admin/payments, /admin/refunds, /admin/invoices, /admin/credit-notes).
const paymentRow: AdminPayment = {
  id: 9,
  ulid: "01m5mxexxwvwpdgwypmp1b0f25",
  customer: { id: 2, ulid: "01C2", name: "Omar Khalid", phone: "+971500000002" },
  payable: { type: "booking", id: 9, public_id: "01B9", reference: "TRB-EBABPY" },
  gateway: "fake",
  gateway_payment_ref: "fpay_0dc4e2ad",
  method: "card",
  card: null,
  intent: "authorize",
  status: "partially_refunded",
  status_label: { ar: "مسترد جزئيًا", en: "Partially refunded" },
  currency: "AED",
  amount_fils: 12000,
  vat_fils: 571,
  discount_fils: 0,
  net_fils: 11429,
  captured_fils: 12000,
  refunded_fils: 3000,
  fee_fils: null,
  net_settled_fils: null,
  invoice: {
    id: 5,
    number: "INV-2026-000005",
    status: "credited_partial",
    status_label: { ar: "مستردة جزئيًا", en: "Partially refunded (invoice)" },
    issue_date: "2026-10-23",
    total_fils: 12000,
    credited_fils: 3000,
    currency: "AED",
  },
  needs_review: true,
  attempts: 1,
  failure_code: null,
  created_at: "2026-10-23T17:38:11+00:00",
  authorized_at: null,
  captured_at: null,
  voided_at: null,
};

const refundRow: AdminRefund = {
  id: 3,
  ulid: "01R3",
  amount_fils: 3000,
  currency: "AED",
  status: "processing",
  status_label: { ar: "قيد المعالجة", en: "Processing" },
  reason_code: "goodwill",
  reason_label: { ar: "بادرة حسن نية", en: "Goodwill gesture" },
  reason_text: null,
  requested_by: { type: "staff", id: 4, name: "Test Accountant" },
  gateway: "fake",
  gateway_refund_ref: "fref_1",
  failure_code: null,
  failure_message: null,
  credit_note_id: 3,
  credit_note: { id: 3, number: "CN-2026-000003", issue_date: "2026-10-23", total_fils: 3000 },
  estimated_arrival_text: { ar: "خلال 5 إلى 10 أيام عمل", en: "within 5 to 10 business days" },
  needs_review: false,
  created_at: "2026-10-23T18:00:00+00:00",
  submitted_at: "2026-10-23T18:00:00+00:00",
  succeeded_at: null,
  failed_at: null,
  last_checked_at: null,
  payment: { id: 9, ulid: "01m5mxexxwvwpdgwypmp1b0f25", status: "partially_refunded", gateway_payment_ref: "fpay_0dc4e2ad", payable_type: "booking", payable_id: 9 },
  customer: { id: 2, ulid: "01C2", name: "Omar Khalid", phone: "+971500000002" },
};

const invoiceRow: AdminInvoice = {
  id: 5,
  ulid: "01I5",
  number: "INV-2026-000005",
  status: "credited_partial",
  status_label: "Partially refunded",
  issue_reason: "capture",
  issue_date: "2026-10-23",
  supply_date: "2026-10-25",
  issued_at: "2026-10-23T18:00:00+00:00",
  customer: { id: 2, name: "Omar Khalid", phone: "+971500000002" },
  booking: { id: 10, reference: "TRB-EBABPY" },
  payment: { id: 9, ulid: "01P9", status: "partially_refunded", gateway_payment_ref: "fpay_1", captured_fils: 12000, refunded_fils: 3000 },
  subtotal_fils: 11429,
  discount_fils: 0,
  net_fils: 11429,
  vat_rate_bp: 500,
  vat_rate: "5%",
  vat_fils: 571,
  total_fils: 12000,
  credited_fils: 3000,
  currency: "AED",
  total_text: "AED 120.00",
  pdf_ready: true,
  emailed_at: null,
};

const creditNote: AdminCreditNoteDetail = {
  id: 3,
  ulid: "01N3",
  number: "CN-2026-000003",
  title: "Tax Credit Note",
  issue_date: "2026-10-23",
  issued_at: "2026-10-23T18:00:01+00:00",
  invoice: { id: 5, number: "INV-2026-000005", status: "credited_partial" },
  refund_id: 3,
  payment_id: 9,
  customer: { id: 2, name: "Omar Khalid" },
  booking_reference: "TRB-EBABPY",
  // A reason configured on the API (refund reasons are a config list): the page shows the API's label, both languages.
  reason_code: "loyalty_credit",
  reason_label: { ar: "رصيد ولاء", en: "Loyalty credit" },
  reason: "Long-standing customer",
  net_fils: 2857,
  vat_rate_bp: 500,
  vat_rate: "5%",
  vat_fils: 143,
  total_fils: 3000,
  currency: "AED",
  total_text: "AED 30.00",
  pdf_ready: true,
  supplier: { name: "Tarteeba", address: "To be confirmed", trn: "To be confirmed", address_is_placeholder: true, trn_is_placeholder: true },
  lines: [{ line: 0, type: "service", code: "STANDARD_VISIT", description: "Cleaning visit (price per worker)", net_fils: 2857, vat_rate_bp: 500, vat_rate: "5%", vat_fils: 143, total_fils: 3000 }],
};

const refusal: BillingRefusal = {
  id: 1,
  document: "invoice",
  payment_id: 12,
  refund_id: null,
  problems: ["captured_amount_mismatch"],
  details: { booking_total_fils: 24000, captured_fils: 12000, pricing_basis: "booking" },
  attempts: 2,
  reported: true,
  first_refused_at: "2026-10-23T10:00:00+00:00",
  last_refused_at: "2026-10-23T11:00:00+00:00",
  retry_after: "2026-10-23T17:00:00+00:00",
  flagged_at: "2026-10-23T10:00:01+00:00",
};

// GET /admin/refund-reasons: staff reasons, then the one only the system records.
const reasons: RefundReason[] = [
  { code: "goodwill", label: { ar: "بادرة حسن نية", en: "Goodwill gesture" }, selectable: true, requires_text: false },
  { code: "other", label: { ar: "سبب آخر", en: "Other" }, selectable: true, requires_text: true },
  { code: "price_difference", label: { ar: "فرق السعر بعد تعديل الحجز", en: "Price difference after a booking change" }, selectable: false, requires_text: false },
];

// GET /admin/finance/summary as the API contract shows it (month to date, every zone).
const summary: FinanceSummary = {
  period: { from: "2026-10-01", to: "2026-10-19", days: 19, timezone: "Asia/Dubai" },
  zone: null,
  currency: "AED",
  generated_at: "2026-10-19T08:00:00+00:00",
  cards: {
    collected: { label: { ar: "المحصل (شامل الضريبة)", en: "Collected (incl. VAT)" }, amount_fils: 4824000, payments: 201 },
    vat: {
      label: { ar: "ضريبة القيمة المضافة", en: "VAT" },
      amount_fils: 229714,
      invoices: 199,
      invoiced_fils: 4824000,
      credited_fils: 6286,
      credit_notes: 6,
      net_fils: 223428,
    },
    refunds: { label: { ar: "الاستردادات", en: "Refunds" }, amount_fils: 132000, refunds: 6 },
    reconciliation_differences: { label: { ar: "فروقات التسوية", en: "Reconciliation differences" }, count: null, available: false },
  },
};

const consoleError = vi.spyOn(console, "error");
let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchPayments.mockResolvedValue(page([paymentRow]));
  api.fetchRefunds.mockResolvedValue(page([refundRow]));
  api.fetchInvoices.mockResolvedValue(page([invoiceRow]));
  api.fetchCreditNotes.mockResolvedValue(page([creditNote]));
  api.fetchCreditNote.mockResolvedValue(creditNote);
  api.fetchBillingRefusals.mockResolvedValue(page([refusal]));
  api.fetchRefundReasons.mockResolvedValue(reasons);
  api.fetchFinanceSummary.mockResolvedValue(summary);
  consoleError.mockClear();
  replaceState = vi.spyOn(window.history, "replaceState").mockImplementation((_data, _unused, next) => url.set(String(next)));
});
afterEach(() => {
  replaceState.mockRestore();
  url.set("/");
  expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
});

describe("A09 payments list", () => {
  it("reads its filters from the URL and lists each payment with the provider's status and amounts", async () => {
    url.set("/admin/finance/payments?status=partially_refunded&needs_review=1");
    renderWithProviders(<PaymentsScreen />, { permissions: ["payments.view", "bookings.view"] });
    const link = await screen.findByRole("link", { name: "fpay_0dc4e2ad" });
    expect(link).toHaveAttribute("href", "/admin/finance/payments/9");
    expect(api.fetchPayments).toHaveBeenCalledWith({
      page: 1,
      perPage: 25,
      status: "partially_refunded",
      from: undefined,
      to: undefined,
      phone: undefined,
      payableType: undefined,
      needsReview: true,
      reference: undefined,
    });
    const row = link.closest("tr")!;
    expect(row).toHaveTextContent("Partially refunded");
    expect(row).toHaveTextContent("Needs review");
    expect(row).toHaveTextContent("AED 114.29");
    expect(row).toHaveTextContent("AED 5.71");
    // The booking by its reference, the invoice by its number and Billing's status label.
    expect(within(row).getByRole("link", { name: "Booking TRB-EBABPY" })).toHaveAttribute("href", "/admin/bookings/9");
    expect(within(row).getByRole("link", { name: "INV-2026-000005" })).toHaveAttribute("href", "/admin/finance/invoices/5");
    expect(row).toHaveTextContent("Partially refunded (invoice)");
  });

  it("shows the booking's id without a reference, unlinked without bookings.view, and a dash before the invoice", async () => {
    api.fetchPayments.mockResolvedValue(
      page([
        { ...paymentRow, invoice: null, payable: { type: "booking", id: 9, public_id: null, reference: null } },
        { ...paymentRow, id: 10, gateway_payment_ref: "fpay_2", invoice: null, payable: { type: "wallet_topup", id: 4, public_id: null, reference: null } },
      ]),
    );
    renderWithProviders(<PaymentsScreen />, { permissions: ["payments.view"] });
    const row = (await screen.findByRole("link", { name: "fpay_0dc4e2ad" })).closest("tr")!;
    expect(row).toHaveTextContent("Booking #9");
    expect(within(row).queryByRole("link", { name: /Booking/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: /INV-/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "fpay_2" }).closest("tr")).toHaveTextContent("Wallet top-up #4");
  });

  it("writes a filter to the URL and waits for a phone search the API can use", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaymentsScreen />, { permissions: ["payments.view"] });
    await screen.findByRole("link", { name: "fpay_0dc4e2ad" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "refunded");
    expect(url.get().get("status")).toBe("refunded");
    await waitFor(() => expect(api.fetchPayments).toHaveBeenLastCalledWith(expect.objectContaining({ status: "refunded", page: 1 })));
    await user.type(screen.getByRole("searchbox", { name: "Customer phone" }), "05");
    expect(await screen.findByText(/Enter at least 4 digits/)).toBeInTheDocument();
    expect(api.fetchPayments).not.toHaveBeenCalledWith(expect.objectContaining({ phone: "05" }));
  });

  it("is for payments.view only", () => {
    renderWithProviders(<PaymentsScreen />, { permissions: ["invoices.manage"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchPayments).not.toHaveBeenCalled();
  });
});

describe("A09 refunds list", () => {
  it("shows the provider's status, the estimate while it is open, the reason and the credit note by its number", async () => {
    url.set("/admin/finance/refunds?payment_id=9");
    renderWithProviders(<RefundsScreen />, { permissions: ["refunds.create", "payments.view"] });
    const row = (await screen.findByRole("link", { name: "CN-2026-000003" })).closest("tr")!;
    expect(api.fetchRefunds).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 9, page: 1 }));
    expect(row).toHaveTextContent("Goodwill gesture");
    expect(screen.getByText("Showing payment #9 only.")).toBeInTheDocument();
    expect(row).toHaveTextContent("Processing");
    expect(row).toHaveTextContent("Expected within 5 to 10 business days");
    expect(row).toHaveTextContent("Test Accountant");
    expect(within(row).getByRole("link", { name: "CN-2026-000003" })).toHaveAttribute("href", "/admin/finance/credit-notes/3");
    expect(within(row).getByRole("link", { name: "fpay_0dc4e2ad" })).toHaveAttribute("href", "/admin/finance/payments/9");
  });

  it("shows the credit note's number unlinked to refunds.create alone", async () => {
    renderWithProviders(<RefundsScreen />, { permissions: ["refunds.create"] });
    const row = (await screen.findByText("CN-2026-000003")).closest("tr")!;
    expect(within(row).queryByRole("link", { name: "CN-2026-000003" })).not.toBeInTheDocument();
  });

  it("filters by every reason the API lists, the system-only ones too", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RefundsScreen />, { permissions: ["refunds.create", "payments.view"] });
    const select = screen.getByRole("combobox", { name: "Reason" });
    await screen.findByRole("option", { name: "Price difference after a booking change" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All reasons",
      "Goodwill gesture",
      "Other",
      "Price difference after a booking change",
    ]);
    await user.selectOptions(select, "price_difference");
    expect(url.get().get("reason_code")).toBe("price_difference");
    await waitFor(() => expect(api.fetchRefunds).toHaveBeenLastCalledWith(expect.objectContaining({ reasonCode: "price_difference", page: 1 })));
  });

  it("says when the reasons can't be loaded and loads them again on request, while the list still shows", async () => {
    api.fetchRefundReasons.mockRejectedValueOnce(new AdminApiError(500, { code: "SERVER_ERROR", message: "", details: {} }));
    const user = userEvent.setup();
    renderWithProviders(<RefundsScreen />, { permissions: ["refunds.create", "payments.view"] });
    expect(await screen.findByText("The refund reasons couldn't be loaded")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "CN-2026-000003" })).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Reason" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["All reasons"]);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await within(select).findByRole("option", { name: "Goodwill gesture" })).toBeInTheDocument();
    expect(screen.queryByText("The refund reasons couldn't be loaded")).not.toBeInTheDocument();
    expect(api.fetchRefundReasons).toHaveBeenCalledTimes(2);
  });

  it("holds the reason filter while the reasons load", async () => {
    let answer!: (value: RefundReason[]) => void;
    api.fetchRefundReasons.mockReturnValueOnce(new Promise<RefundReason[]>((resolve) => (answer = resolve)));
    renderWithProviders(<RefundsScreen />, { permissions: ["payments.view"] });
    const select = await screen.findByRole("combobox", { name: "Reason" });
    expect(select).toBeDisabled();
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Loading the reasons…"]);
    answer(reasons);
    expect(await within(select).findByRole("option", { name: "Goodwill gesture" })).toBeInTheDocument();
    expect(select).toBeEnabled();
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("All reasons");
  });

  it("keeps a reason from the URL that the API's list does not name", async () => {
    url.set("/admin/finance/refunds?reason_code=loyalty_credit");
    renderWithProviders(<RefundsScreen />, { permissions: ["payments.view"] });
    await screen.findByRole("option", { name: "Goodwill gesture" });
    expect(screen.getByRole("combobox", { name: "Reason" })).toHaveValue("loyalty_credit");
    expect(api.fetchRefunds).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: "loyalty_credit" }));
  });
});

describe("A09 invoices and credit notes", () => {
  it("lists invoices with their status, totals and booking", async () => {
    renderWithProviders(<InvoicesScreen />, { permissions: ["invoices.manage"] });
    const link = await screen.findByRole("link", { name: "INV-2026-000005" });
    expect(link).toHaveAttribute("href", "/admin/finance/invoices/5");
    const row = link.closest("tr")!;
    expect(row).toHaveTextContent("Partially refunded");
    expect(row).toHaveTextContent("AED 120");
    expect(row).toHaveTextContent("AED 30");
    // Without bookings.view the reference is shown, not linked.
    expect(within(row).queryByRole("link", { name: "TRB-EBABPY" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Documents not issued" })).toHaveAttribute("href", "/admin/finance/billing-refusals");
  });

  it("lists one payment's invoices from a payment page link, until the filter is cleared", async () => {
    const user = userEvent.setup();
    url.set("/admin/finance/invoices?payment_id=9");
    renderWithProviders(<InvoicesScreen />, { permissions: ["payments.view"] });
    await screen.findByRole("link", { name: "INV-2026-000005" });
    expect(api.fetchInvoices).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 9, page: 1 }));
    expect(screen.getByText("Showing the invoices of payment #9 only.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all invoices" }));
    expect(url.get().get("payment_id")).toBeNull();
    await waitFor(() => expect(api.fetchInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ paymentId: undefined })));
  });

  it("lists credit notes against their invoice, with the refund's reason", async () => {
    renderWithProviders(<CreditNotesScreen />, { permissions: ["payments.view"] });
    const link = await screen.findByRole("link", { name: "CN-2026-000003" });
    const row = link.closest("tr")!;
    expect(within(row).getByRole("link", { name: "INV-2026-000005" })).toHaveAttribute("href", "/admin/finance/invoices/5");
    // The API's reason_label, never the code.
    expect(row).toHaveTextContent("Loyalty credit");
    expect(row).not.toHaveTextContent("loyalty_credit");
    expect(row).toHaveTextContent("AED 30");
  });

  it("shows the API's reason label on the credit notes list in Arabic too", async () => {
    renderWithProviders(<CreditNotesScreen />, { permissions: ["payments.view"], locale: "ar" });
    const row = (await screen.findByRole("link", { name: "CN-2026-000003" })).closest("tr")!;
    expect(row).toHaveTextContent("رصيد ولاء");
  });

  it("shows a credit note's lines, totals, supplier block and PDF download", async () => {
    renderWithProviders(<CreditNoteDetailScreen id="3" />, { permissions: ["payments.view"] });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("CN-2026-000003");
    // The reason as the API labels it, with the refund's own note.
    const reason = screen.getByText("Loyalty credit").parentElement!;
    expect(reason).toHaveTextContent("Loyalty credit“Long-standing customer”");
    expect(screen.getByRole("table", { name: "Lines of credit note CN-2026-000003" })).toHaveTextContent("Cleaning visit (price per worker)");
    expect(screen.getByText("Total credited (AED)").nextSibling).toHaveTextContent("AED 30");
    expect(screen.getAllByText("To be confirmed")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open the payment" })).toHaveAttribute("href", "/admin/finance/payments/9");
    expect(screen.getByRole("button", { name: "Download PDF of CN-2026-000003" })).toBeInTheDocument();
  });
});

describe("A09 documents not issued", () => {
  it("explains why and what was compared, and retries with invoices.manage", async () => {
    api.retryBillingRefusal
      .mockRejectedValueOnce(new AdminApiError(422, { code: "BILLING_DOCUMENT_REFUSED", message: "", details: { problems: ["captured_amount_mismatch"] } }))
      .mockResolvedValueOnce({ status: "issued", document: "invoice", id: 6, number: "INV-2026-000006" });
    const user = userEvent.setup();
    renderWithProviders(<BillingRefusalsScreen />, { permissions: ["invoices.manage"] });
    const row = (await screen.findByText("The amount taken differs from the booking total")).closest("tr")!;
    expect(row).toHaveTextContent("Booking total:AED 240");
    expect(row).toHaveTextContent("Amount taken:AED 120");
    expect(row).toHaveTextContent("Flagged for review");
    expect(row).toHaveTextContent("2 attempts");

    const retry = within(row).getByRole("button", { name: "Retry now: Tax invoice for payment #12" });
    await user.click(retry);
    expect(await within(row).findByText("Still can't be issued: The amount taken differs from the booking total.")).toBeInTheDocument();
    await user.click(retry);
    expect(await screen.findByText("Tax invoice INV-2026-000006 issued.")).toBeInTheDocument();
  });

  it("is read-only without invoices.manage", async () => {
    renderWithProviders(<BillingRefusalsScreen />, { permissions: ["payments.view"] });
    await screen.findByText("The amount taken differs from the booking total");
    expect(screen.queryByRole("button", { name: /Retry now/ })).not.toBeInTheDocument();
  });
});

describe("A09 finance summary", () => {
  const card = (label: string) => screen.getByText(label).parentElement!;

  it("opens on month to date for every zone, with the API's labels and two decimals", async () => {
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["payments.view"] });
    expect(await screen.findByText("Collected (incl. VAT)")).toBeInTheDocument();
    // Nothing chosen: the API's own default period (month to date) and every zone.
    expect(api.fetchFinanceSummary).toHaveBeenCalledWith({ from: undefined, to: undefined, zoneId: null });
    // The date fields show the period the API counted (it answered 1–19 October), not this browser's guess.
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-19");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Payments & invoices");
    expect(screen.getByText(/· 19 days · All zones$/)).toBeInTheDocument();

    expect(card("Collected (incl. VAT)")).toHaveTextContent("AED 48,240.00");
    expect(card("Collected (incl. VAT)")).toHaveTextContent("201 payments taken");
    expect(card("VAT")).toHaveTextContent("AED 2,297.14");
    expect(card("VAT")).toHaveTextContent("Net of credit notes: AED 2,234.28");
    expect(card("VAT")).toHaveTextContent("Credited: AED 62.86 (6 credit notes)");
    expect(card("VAT")).toHaveTextContent("Invoiced: AED 48,240.00 (199 invoices)");
    expect(card("Refunds")).toHaveTextContent("AED 1,320.00");
    expect(card("Refunds")).toHaveTextContent("6 refunds completed by the provider");
    // No reconciliation yet: a dash and why, never a zero.
    expect(card("Reconciliation differences")).toHaveTextContent("—");
    expect(card("Reconciliation differences")).toHaveTextContent("Shown once reconciliation with the provider's settlement reports is set up.");
  });

  it("shows the labels in Arabic", async () => {
    renderWithProviders(<FinanceSummaryScreen />, { locale: "ar", permissions: ["invoices.manage"] });
    expect(await screen.findByText("المحصل (شامل الضريبة)")).toBeInTheDocument();
    expect(screen.getByText("فروقات التسوية")).toBeInTheDocument();
  });

  it("asks for the chosen period and keeps it in the URL", async () => {
    url.set("/admin/finance?from=2026-09-01&to=2026-09-30");
    const user = userEvent.setup();
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["payments.view"] });
    await screen.findByText("Collected (incl. VAT)");
    expect(api.fetchFinanceSummary).toHaveBeenCalledWith({ from: "2026-09-01", to: "2026-09-30", zoneId: null });
    await user.click(screen.getByRole("button", { name: "This month to date" }));
    expect(url.get().toString()).toBe("");
    await waitFor(() => expect(api.fetchFinanceSummary).toHaveBeenLastCalledWith({ from: undefined, to: undefined, zoneId: null }));
  });

  it("shows this browser's month to date in the fields until the API says which period it counted", async () => {
    let answer!: (value: FinanceSummary) => void;
    api.fetchFinanceSummary.mockReturnValueOnce(new Promise<FinanceSummary>((resolve) => (answer = resolve)));
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["payments.view"] });
    // Today is 23 October in the tests.
    expect(await screen.findByLabelText("From")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-23");
    answer(summary);
    expect(await screen.findByText("Collected (incl. VAT)")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-19");
  });

  it("follows the API's period in the fields left to the default when a refetch crosses Dubai midnight", async () => {
    // Opened on 31 October at 23:55 in Dubai: the browser and the API agree on October.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T19:55:00Z"));
    api.fetchFinanceSummary.mockResolvedValueOnce({ ...summary, period: { ...summary.period, to: "2026-10-31", days: 31 } });
    const user = userEvent.setup();
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["payments.view"] });
    expect(await screen.findByText(/· 31 days · All zones$/)).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-31");

    // Ten minutes later it is 1 November in Dubai: the API counts the new month, and the fields say so.
    vi.setSystemTime(new Date("2026-10-31T20:05:00Z"));
    api.fetchFinanceSummary.mockResolvedValueOnce({ ...summary, period: { ...summary.period, from: "2026-11-01", to: "2026-11-01", days: 1 } });
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/· 1 day · All zones$/)).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-11-01");
    expect(api.fetchFinanceSummary).toHaveBeenLastCalledWith({ from: undefined, to: undefined, zoneId: null });
  });

  it("asks for a period once the date fields stop changing, not for each digit of a typed year", async () => {
    // The API refuses a span over 366 days.
    api.fetchFinanceSummary.mockImplementation(async ({ from }: { from?: string }) => {
      if (from && from < "2025-10-23") {
        throw new AdminApiError(422, { code: "VALIDATION_FAILED", message: "", details: { fields: { to: ["Choose a period of at most 366 days."] } } });
      }
      return summary;
    });
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["payments.view"] });
    await screen.findByText("Collected (incl. VAT)");
    const field = screen.getByLabelText("From");
    // Typing "2026" into the year of a native date field: a whole date per digit.
    for (const value of ["0002-10-01", "0020-10-01", "0202-10-01", "2026-10-01"]) fireEvent.change(field, { target: { value } });
    expect(url.get().get("from")).toBe("2026-10-01");
    expect(field).toHaveValue("2026-10-01");
    await waitFor(() => expect(api.fetchFinanceSummary).toHaveBeenLastCalledWith({ from: "2026-10-01", to: undefined, zoneId: null }));
    expect(api.fetchFinanceSummary.mock.calls.map(([query]) => query.from)).toEqual([undefined, "2026-10-01"]);
    expect(await screen.findByText(/· 19 days · All zones$/)).toBeInTheDocument();
    expect(screen.queryByText("These figures can't be shown")).not.toBeInTheDocument();
  });

  it("shows the API's own message when the period is refused", async () => {
    url.set("/admin/finance?from=2025-01-01&to=2026-10-19");
    api.fetchFinanceSummary.mockRejectedValue(
      new AdminApiError(422, { code: "VALIDATION_FAILED", message: "", details: { fields: { to: ["Choose a period of at most 366 days."] } } }),
    );
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["payments.view"] });
    expect(await screen.findByText("Choose a period of at most 366 days.")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toHaveAccessibleDescription(/Choose a period of at most 366 days\./);
    expect(screen.getByText("These figures can't be shown")).toBeInTheDocument();
    expect(screen.getByText("Change the dates above.")).toBeInTheDocument();
    expect(screen.queryByText("Collected (incl. VAT)")).not.toBeInTheDocument();
  });

  it("follows the top bar's zone for those who see the zone picker", async () => {
    api.fetchFinanceSummary.mockResolvedValue({ ...summary, zone: { id: 3, code: "DXB", name: { ar: "دبي", en: "Dubai" } } });
    renderWithProviders(
      <AdminZoneProvider initialZoneId={3}>
        <FinanceSummaryScreen />
      </AdminZoneProvider>,
      { permissions: ["payments.view", "bookings.view"] },
    );
    expect(await screen.findByText(/· 19 days · Dubai$/)).toBeInTheDocument();
    expect(api.fetchFinanceSummary).toHaveBeenCalledWith({ from: undefined, to: undefined, zoneId: 3 });
  });

  it("counts every zone for those without the zone picker, whatever zone this browser remembers", async () => {
    renderWithProviders(
      <AdminZoneProvider initialZoneId={3}>
        <FinanceSummaryScreen />
      </AdminZoneProvider>,
      { permissions: ["payments.view"] },
    );
    await screen.findByText("Collected (incl. VAT)");
    expect(api.fetchFinanceSummary).toHaveBeenCalledWith({ from: undefined, to: undefined, zoneId: null });
  });

  it("shows the reconciliation count once it exists", async () => {
    api.fetchFinanceSummary.mockResolvedValue({
      ...summary,
      cards: { ...summary.cards, reconciliation_differences: { ...summary.cards.reconciliation_differences, count: 2, available: true } },
    });
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["payments.view"] });
    await screen.findByText("Collected (incl. VAT)");
    const recon = card("Reconciliation differences");
    expect(within(recon).getByText("2")).toHaveClass("text-danger-700");
    expect(recon).toHaveTextContent("Settlement items that don't match and aren't resolved yet.");
  });

  it("offers a retry when the figures can't be loaded", async () => {
    api.fetchFinanceSummary.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue(summary);
    const user = userEvent.setup();
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["payments.view"] });
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Collected (incl. VAT)")).toBeInTheDocument();
  });

  it("is for payments.view or invoices.manage", () => {
    renderWithProviders(<FinanceSummaryScreen />, { permissions: ["refunds.create"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchFinanceSummary).not.toHaveBeenCalled();
  });
});
