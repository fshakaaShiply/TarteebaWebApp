import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { AdminInvoiceDetail } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { InvoiceDetailScreen } from "./InvoiceDetailScreen";

const api = { fetchInvoice: vi.fn(), fetchInvoicePdf: vi.fn(), emailInvoice: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchInvoice: (...a: unknown[]) => api.fetchInvoice(...a),
  fetchInvoicePdf: (...a: unknown[]) => api.fetchInvoicePdf(...a),
  emailInvoice: (...a: unknown[]) => api.emailInvoice(...a),
}));

// GET /admin/invoices/4 from the local API (Accept-Language: en), with a credit note added.
const invoice = (over: Partial<AdminInvoiceDetail> = {}): AdminInvoiceDetail => ({
  id: 4,
  ulid: "01m5mxf7gdp9hwase019hpqdmy",
  number: "INV-2026-000004",
  status: "credited_partial",
  status_label: "Partially refunded",
  issue_reason: "capture",
  issue_date: "2026-10-23",
  supply_date: "2026-10-25",
  issued_at: "2026-10-23T17:38:20+00:00",
  customer: { id: 2, name: "Omar Khalid", phone: "+971500000002" },
  booking: { id: 9, reference: "TRB-QHKXMS" },
  payment: { id: 9, ulid: "01m5mxexxwvwpdgwypmp1b0f25", status: "partially_refunded", gateway_payment_ref: "fpay_0dc4e2ad", captured_fils: 12000, refunded_fils: 6000 },
  subtotal_fils: 11429,
  discount_fils: 0,
  net_fils: 11429,
  vat_rate_bp: 500,
  vat_rate: "5%",
  vat_fils: 571,
  total_fils: 12000,
  credited_fils: 6000,
  currency: "AED",
  total_text: "AED 120.00",
  pdf_ready: true,
  emailed_at: null,
  supplier: { name: "Tarteeba", address: "To be confirmed", trn: "To be confirmed", address_is_placeholder: true, trn_is_placeholder: true },
  supplier_trn: null,
  customer_trn: null,
  lines: [
    {
      type: "service",
      code: "STANDARD_VISIT",
      description: "Cleaning visit (price per worker)",
      unit: "per_worker_visit",
      quantity: 1,
      unit_price_excl_vat_fils: 11429,
      unit_price_incl_vat_fils: 12000,
      net_before_discount_fils: 11429,
      discount_fils: 0,
      net_fils: 11429,
      vat_rate_bp: 500,
      vat_rate: "5%",
      vat_fils: 571,
      total_fils: 12000,
    },
  ],
  credit_notes: [
    { id: 3, number: "CN-2026-000003", issue_date: "2026-10-23", refund_id: 3, reason_code: "goodwill", reason: null, net_fils: 5714, vat_fils: 286, total_fils: 6000 },
  ],
  version: 1,
  ...over,
});

describe("InvoiceDetailScreen", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchInvoice.mockResolvedValue(invoice());
  });

  it("shows the tax invoice: supplier with the R-16 placeholders marked, lines with VAT, totals and credit notes", async () => {
    renderWithProviders(<InvoiceDetailScreen id="4" />, { permissions: ["payments.view", "bookings.view"] });
    const title = await screen.findByRole("heading", { level: 1 });
    expect(title).toHaveTextContent("INV-2026-000004");
    // The invoice status as the API labels it.
    expect(within(title.closest("section")!).getByText("Partially refunded")).toBeInTheDocument();

    const supplier = screen.getByRole("heading", { name: "Supplier" }).closest("section")!;
    expect(within(supplier).getByText("Tarteeba")).toBeInTheDocument();
    const placeholders = within(supplier).getAllByText("To be confirmed");
    expect(placeholders).toHaveLength(2);
    for (const p of placeholders) expect(p).toHaveClass("italic", "text-danger-700");
    expect(within(supplier).getByText(/aren't configured yet/)).toBeInTheDocument();

    const lines = screen.getByRole("table", { name: "Lines of invoice INV-2026-000004" });
    const row = within(lines).getAllByRole("row")[1];
    expect(row).toHaveTextContent("Cleaning visit (price per worker)");
    expect(row).toHaveTextContent("AED 114.29");
    expect(row).toHaveTextContent("5%");
    expect(row).toHaveTextContent("AED 5.71");
    expect(screen.getByText("VAT (5%)").nextSibling).toHaveTextContent("AED 5.71");
    // Two decimals like the API's total_text and the printed PDF (P2-35), never "AED 120" next to "AED 114.29".
    expect(screen.getByText("Total (AED)").nextSibling).toHaveTextContent(/^AED 120\.00$/);
    expect(screen.getByText("Total (AED)").nextSibling).toHaveTextContent(invoice().total_text);
    expect(screen.getByText("Credited by credit notes").nextSibling).toHaveTextContent(/^AED 60\.00$/);
    expect(screen.getByRole("link", { name: "CN-2026-000003" })).toHaveAttribute("href", "/admin/finance/credit-notes/3");
    expect(screen.getByRole("link", { name: "TRB-QHKXMS" })).toHaveAttribute("href", "/admin/bookings/9");
    // Resending needs invoices.manage.
    expect(screen.queryByRole("button", { name: /Resend by email/ })).not.toBeInTheDocument();
  });

  it("lays the narrow side cards out in one column, and lets long references wrap", async () => {
    api.fetchInvoice.mockResolvedValue(invoice({ payment: { ...invoice().payment, gateway_payment_ref: "fpay_7772c804095fe589f3ac02b5" } }));
    renderWithProviders(<InvoiceDetailScreen id="4" />, { permissions: ["payments.view"] });
    const details = (await screen.findByRole("heading", { name: "Invoice details" })).closest("section")!;
    const supplier = screen.getByRole("heading", { name: "Supplier" }).closest("section")!;
    for (const card of [details, supplier]) {
      const list = card.querySelector("dl")!;
      // The old class override left "sm:grid-cols-2 sm:grid-cols-1", and two columns won.
      expect(list.className).not.toMatch(/sm:grid-cols-2/);
      expect(list).toHaveClass("grid-cols-1");
    }
    // The supplier address still spans the whole (single) column without adding an implicit second one.
    expect(within(supplier).getByText("Address").parentElement).toHaveClass("col-span-full");
    const reference = within(details).getByText("fpay_7772c804095fe589f3ac02b5");
    expect(reference).toHaveClass("wrap-anywhere");
    expect(screen.getByRole("heading", { level: 1 }).querySelector("bdi")).toHaveClass("wrap-anywhere");
  });

  it("downloads the PDF through a short-lived signed link", async () => {
    const expires = new Date(Date.now() + 15 * 60_000).toISOString();
    api.fetchInvoicePdf.mockResolvedValue({ url: "https://files.example.test/inv-4.pdf?signature=abc", expires_at: expires, file_name: "INV-2026-000004.pdf" });
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDetailScreen id="4" />, { permissions: ["payments.view"] });
    await user.click(await screen.findByRole("button", { name: "Download PDF of INV-2026-000004" }));
    expect(api.fetchInvoicePdf).toHaveBeenCalledWith(4);
    const link = await screen.findByRole("link", { name: "Open INV-2026-000004.pdf" });
    expect(link).toHaveAttribute("href", "https://files.example.test/inv-4.pdf?signature=abc");
    expect(link).toHaveAttribute("download", "INV-2026-000004.pdf");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await waitFor(() => expect(link).toHaveFocus());
    expect(screen.getByText(/The link works until/)).toBeInTheDocument();
  });

  it("says when the PDF can't be made right now", async () => {
    api.fetchInvoicePdf.mockRejectedValue(new AdminApiError(503, { code: "INVOICE_PDF_UNAVAILABLE", message: "", details: {} }));
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDetailScreen id="4" />, { permissions: ["payments.view"] });
    await user.click(await screen.findByRole("button", { name: "Download PDF of INV-2026-000004" }));
    expect(await screen.findByText("The PDF isn't available right now. Try again in a few minutes.")).toBeInTheDocument();
  });

  it("resends the invoice by e-mail with invoices.manage, and explains a missing address", async () => {
    api.emailInvoice
      .mockResolvedValueOnce({ status: "queued", email: "omar@example.test", message: "" })
      .mockRejectedValueOnce(new AdminApiError(422, { code: "EMAIL_MISSING", message: "", details: {} }));
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDetailScreen id="4" />, { permissions: ["invoices.manage"] });
    const resend = await screen.findByRole("button", { name: "Resend by email: invoice INV-2026-000004" });
    await user.click(resend);
    expect(await screen.findByText("Invoice INV-2026-000004 is on its way to the customer's email address.")).toBeInTheDocument();
    expect(screen.queryByText(/omar@example\.test/)).not.toBeInTheDocument();
    expect(api.emailInvoice).toHaveBeenCalledWith(4);
    await user.click(resend);
    expect(await screen.findByText("This customer has no email address on their profile, so the invoice can't be emailed.")).toBeInTheDocument();
  });
});
