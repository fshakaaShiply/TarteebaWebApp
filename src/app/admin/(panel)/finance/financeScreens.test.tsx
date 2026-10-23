import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { AdminCreditNoteDetail, AdminInvoice, AdminPayment, AdminRefund, BillingRefusal } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { BillingRefusalsScreen } from "./billing-refusals/BillingRefusalsScreen";
import { CreditNotesScreen } from "./credit-notes/CreditNotesScreen";
import { CreditNoteDetailScreen } from "./credit-notes/[id]/CreditNoteDetailScreen";
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
};
vi.mock("@/lib/admin/endpoints", () => ({
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
  payable: { type: "booking", id: 9, public_id: "01B9" },
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
  reason_code: "goodwill",
  reason: null,
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
    expect(within(row).getByRole("link", { name: "Booking #9" })).toHaveAttribute("href", "/admin/bookings/9");
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
  it("shows the provider's status, the estimate while it is open, the reason and the credit note", async () => {
    url.set("/admin/finance/refunds?payment_id=9");
    renderWithProviders(<RefundsScreen />, { permissions: ["refunds.create", "payments.view"] });
    const row = (await screen.findByRole("link", { name: "View credit note" })).closest("tr")!;
    expect(api.fetchRefunds).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 9, page: 1 }));
    expect(row).toHaveTextContent("Goodwill gesture");
    expect(screen.getByText("Showing payment #9 only.")).toBeInTheDocument();
    expect(row).toHaveTextContent("Processing");
    expect(row).toHaveTextContent("Expected within 5 to 10 business days");
    expect(row).toHaveTextContent("Test Accountant");
    expect(within(row).getByRole("link", { name: "View credit note" })).toHaveAttribute("href", "/admin/finance/credit-notes/3");
    expect(within(row).getByRole("link", { name: "fpay_0dc4e2ad" })).toHaveAttribute("href", "/admin/finance/payments/9");
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

  it("lists credit notes against their invoice, with the refund's reason", async () => {
    renderWithProviders(<CreditNotesScreen />, { permissions: ["payments.view"] });
    const link = await screen.findByRole("link", { name: "CN-2026-000003" });
    const row = link.closest("tr")!;
    expect(within(row).getByRole("link", { name: "INV-2026-000005" })).toHaveAttribute("href", "/admin/finance/invoices/5");
    expect(row).toHaveTextContent("Goodwill gesture");
    expect(row).toHaveTextContent("AED 30");
  });

  it("shows a credit note's lines, totals, supplier block and PDF download", async () => {
    renderWithProviders(<CreditNoteDetailScreen id="3" />, { permissions: ["payments.view"] });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("CN-2026-000003");
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
