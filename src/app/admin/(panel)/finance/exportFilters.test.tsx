import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinanceSummary } from "@/lib/admin/types";
import { AdminZoneProvider } from "@/lib/admin/zone";
import { exportRecord, itemRow, runDetail, runRow, walletPage } from "@/test/financeFixtures";
import { renderWithProviders } from "@/test/render";
import { WalletPanel } from "./_components/WalletPanel";
import { CreditNotesScreen } from "./credit-notes/CreditNotesScreen";
import { FinanceSummaryScreen } from "./FinanceSummaryScreen";
import { InvoicesScreen } from "./invoices/InvoicesScreen";
import { PaymentsScreen } from "./payments/PaymentsScreen";
import { ReconciliationRunScreen } from "./reconciliation/[id]/ReconciliationRunScreen";
import { ReconciliationRunsScreen } from "./reconciliation/ReconciliationRunsScreen";
import { RefundsScreen } from "./refunds/RefundsScreen";

/*
 * What each A09 page hands its Export button (A1b §3.2; P5-F126, P5-F152): the file must hold the rows the page lists,
 * so every filter the page sends to its list goes into the export under the report's own name, and the run page sends its
 * tab (`view`) even when it is the default one.
 */

const url = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set(next: string) {
      params = new URLSearchParams(next);
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
    usePathname: () => "/admin/finance",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = {
  createExport: vi.fn(),
  fetchPayments: vi.fn(),
  fetchRefunds: vi.fn(),
  fetchRefundReasons: vi.fn(),
  fetchInvoices: vi.fn(),
  fetchCreditNotes: vi.fn(),
  fetchFinanceSummary: vi.fn(),
  fetchReconciliationRuns: vi.fn(),
  fetchReconciliationRun: vi.fn(),
  fetchReconciliationItems: vi.fn(),
  fetchCustomerWallet: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchPayments: (...a: unknown[]) => api.fetchPayments(...a),
  fetchRefunds: (...a: unknown[]) => api.fetchRefunds(...a),
  fetchRefundReasons: (...a: unknown[]) => api.fetchRefundReasons(...a),
  fetchInvoices: (...a: unknown[]) => api.fetchInvoices(...a),
  fetchCreditNotes: (...a: unknown[]) => api.fetchCreditNotes(...a),
  fetchFinanceSummary: (...a: unknown[]) => api.fetchFinanceSummary(...a),
}));
vi.mock("@/lib/admin/finance/endpoints", () => ({
  createExport: (...a: unknown[]) => api.createExport(...a),
  fetchExport: vi.fn(),
  fetchExportUrl: vi.fn(),
  fetchReconciliationRuns: (...a: unknown[]) => api.fetchReconciliationRuns(...a),
  fetchReconciliationRun: (...a: unknown[]) => api.fetchReconciliationRun(...a),
  fetchReconciliationItems: (...a: unknown[]) => api.fetchReconciliationItems(...a),
  fetchReconciliationItem: vi.fn(),
  resolveItem: vi.fn(),
  reopenItem: vi.fn(),
  recheckRun: vi.fn(),
  fetchSettlementFormats: vi.fn().mockResolvedValue([]),
  createFetchRun: vi.fn(),
  uploadSettlementRun: vi.fn(),
  settlementTemplateUrl: (key: string) => key,
  fetchCustomerWallet: (...a: unknown[]) => api.fetchCustomerWallet(...a),
  adjustCustomerWallet: vi.fn(),
  recordRefundOutcome: vi.fn(),
  reinstateRefund: vi.fn(),
  clearRefundReview: vi.fn(),
}));

const page = <T,>(rows: T[]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });
const itemsPage = {
  data: [itemRow()],
  meta: {
    current_page: 1,
    per_page: 50,
    total: 1,
    last_page: 1,
    counts_by_status: { matched: 8, amount_mismatch: 1, missing_in_system: 0, missing_in_gateway: 0, status_mismatch: 1 },
    unresolved_count: 2,
    documents_issues: 1,
  },
};
const summary = (from: string, to: string): FinanceSummary =>
  ({
    period: { from, to, days: 16, timezone: "Asia/Dubai" },
    zone: null,
    currency: "AED",
    generated_at: "2026-11-16T08:00:00+00:00",
    cards: {
      collected: { label: { ar: "المحصل (شامل الضريبة)", en: "Collected (incl. VAT)" }, amount_fils: 4824000, payments: 201 },
      vat: { label: { ar: "ضريبة القيمة المضافة", en: "VAT" }, amount_fils: 229714, invoices: 199, invoiced_fils: 4824000, credited_fils: 6286, credit_notes: 6, net_fils: 223428 },
      refunds: { label: { ar: "الاستردادات", en: "Refunds" }, amount_fils: 132000, refunds: 6 },
      reconciliation_differences: { label: { ar: "فروقات التسوية", en: "Reconciliation differences" }, count: 0, available: false, latest_run: null },
      balance: { label: { ar: "الرصيد", en: "Balance" }, paid_from_balance_fils: 0, credited_to_balance_fils: 0, outstanding_fils: 0, available: false },
    },
  }) as FinanceSummary;

beforeEach(() => {
  url.set("");
  Object.values(api).forEach((fn) => fn.mockReset());
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  // What matters here is what was asked for: the file "fails" at once, so the button is free for the next export.
  api.createExport.mockResolvedValue(exportRecord({ status: "failed", failure_code: "internal_error", file_name: null }));
  api.fetchPayments.mockResolvedValue(page([]));
  api.fetchRefunds.mockResolvedValue(page([]));
  api.fetchRefundReasons.mockResolvedValue([]);
  api.fetchInvoices.mockResolvedValue(page([]));
  api.fetchCreditNotes.mockResolvedValue(page([]));
  api.fetchFinanceSummary.mockResolvedValue(summary("2026-11-01", "2026-11-19"));
  api.fetchReconciliationRuns.mockResolvedValue({ ...page([runRow()]), meta: { ...page([]).meta, unresolved_total: 2 } });
  api.fetchReconciliationRun.mockResolvedValue(runDetail());
  api.fetchReconciliationItems.mockResolvedValue(itemsPage);
  api.fetchCustomerWallet.mockResolvedValue(walletPage());
});
afterEach(() => vi.restoreAllMocks());

const ACCOUNTANT = ["payments.view", "refunds.create", "invoices.manage", "reconciliation.run", "customers.view", "reports.export"];

/** Opens the export menu named `button` and asks for Excel; returns what was sent. */
async function exportExcel(button = "Export") {
  const user = userEvent.setup();
  const before = api.createExport.mock.calls.length;
  const trigger = await screen.findByRole("button", { name: button });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Excel (.xlsx)" }));
  await waitFor(() => expect(api.createExport).toHaveBeenCalledTimes(before + 1));
  return api.createExport.mock.calls.at(-1)![0] as { report: string; format: string; filters: Record<string, unknown> };
}

async function render(ui: ReactElement, query: string, permissions: readonly string[] = ACCOUNTANT) {
  url.set(query);
  return renderWithProviders(ui, { permissions });
}

describe("A09 exports hold the page's rows", () => {
  it("payments: every list filter, under the API's names", async () => {
    await render(<PaymentsScreen />, "status=captured&from=2026-11-01&to=2026-11-16&phone=0501234&payable_type=booking&needs_review=1&reference=fpay_1");
    await waitFor(() => expect(api.fetchPayments).toHaveBeenCalled());
    expect(api.fetchPayments).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "captured", from: "2026-11-01", to: "2026-11-16", phone: "0501234", payableType: "booking", needsReview: true, reference: "fpay_1" }),
    );
    expect(await exportExcel()).toEqual({
      report: "payments",
      format: "xlsx",
      filters: { status: "captured", from: "2026-11-01", to: "2026-11-16", phone: "0501234", payable_type: "booking", needs_review: 1, reference: "fpay_1" },
    });
  });

  it("payments: a filter changed on the page goes into the next export", async () => {
    await render(<PaymentsScreen />, "");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Status"), "captured");
    await user.click(screen.getByLabelText("Needs review only"));
    await waitFor(() => expect(api.fetchPayments).toHaveBeenLastCalledWith(expect.objectContaining({ status: "captured", needsReview: true })));
    expect((await exportExcel()).filters).toEqual({ status: "captured", needs_review: 1 });
  });

  it("refunds: every list filter, the Phase 5 destination and context too", async () => {
    await render(<RefundsScreen />, "status=processing&from=2026-11-01&to=2026-11-16&payment_id=9&reason_code=goodwill&needs_review=1&phone=0501234&destination=card&context_type=complaint");
    await waitFor(() =>
      expect(api.fetchRefunds).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "processing", paymentId: 9, reasonCode: "goodwill", needsReview: true, phone: "0501234", destination: "card", contextType: "complaint" }),
      ),
    );
    expect(await exportExcel()).toEqual({
      report: "refunds",
      format: "xlsx",
      filters: {
        status: "processing",
        from: "2026-11-01",
        to: "2026-11-16",
        payment_id: 9,
        reason_code: "goodwill",
        needs_review: 1,
        phone: "0501234",
        destination: "card",
        context_type: "complaint",
      },
    });
  });

  it("invoices and their lines: the same filters for both files", async () => {
    await render(<InvoicesScreen />, "status=issued&from=2026-11-01&to=2026-11-16&search=TRB-7K2Q9M&payment_id=9");
    await waitFor(() => expect(api.fetchInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ status: "issued", paymentId: 9, search: "TRB-7K2Q9M" })));
    const filters = { status: "issued", from: "2026-11-01", to: "2026-11-16", search: "TRB-7K2Q9M", payment_id: 9 };
    expect(await exportExcel("Export")).toEqual({ report: "invoices", format: "xlsx", filters });
    expect(await exportExcel("Export lines")).toEqual({ report: "invoice_lines", format: "xlsx", filters });
  });

  it("credit notes: period, invoice and search", async () => {
    await render(<CreditNotesScreen />, "from=2026-11-01&to=2026-11-16&search=CN-2026&invoice_id=5");
    await waitFor(() => expect(api.fetchCreditNotes).toHaveBeenLastCalledWith(expect.objectContaining({ invoiceId: 5, search: "CN-2026" })));
    expect(await exportExcel()).toEqual({ report: "credit_notes", format: "xlsx", filters: { from: "2026-11-01", to: "2026-11-16", invoice_id: 5, search: "CN-2026" } });
  });

  it("reconciliation runs: report dates, status and 'needs action'", async () => {
    await render(<ReconciliationRunsScreen />, "from=2026-11-01&to=2026-11-18&status=completed&unresolved=1");
    await waitFor(() => expect(api.fetchReconciliationRuns).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-11-01", to: "2026-11-18", status: "completed", unresolved: true })));
    expect(await exportExcel()).toEqual({ report: "reconciliation_runs", format: "xlsx", filters: { from: "2026-11-01", to: "2026-11-18", status: "completed", unresolved: 1 } });
  });

  it("a run's items: the run, the default tab by name, then the tab chosen on the page", async () => {
    await render(<ReconciliationRunScreen id="41" />, "");
    await screen.findByRole("heading", { name: "Items" });
    expect(await exportExcel()).toEqual({ report: "reconciliation_items", format: "xlsx", filters: { run_id: 41, view: "differences" } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "All" }));
    await waitFor(() => expect(api.fetchReconciliationItems).toHaveBeenLastCalledWith(41, expect.objectContaining({ view: "all" })));
    expect((await exportExcel()).filters).toEqual({ run_id: 41, view: "all" });
  });

  it("a run's items: status and line type as lists, and says that the search is not part of the file", async () => {
    await render(<ReconciliationRunScreen id="41" />, "view=matched&status=amount_mismatch&line_type=refund&q=fpay");
    await waitFor(() =>
      expect(api.fetchReconciliationItems).toHaveBeenLastCalledWith(41, expect.objectContaining({ view: "matched", status: "amount_mismatch", lineType: "refund", q: "fpay" })),
    );
    expect(screen.getByText("The export holds every item of this tab with its filters: it doesn't apply the search.")).toBeInTheDocument();
    // The report has no search filter (A1b §3.2): the file holds the tab's rows with these filters.
    expect((await exportExcel()).filters).toEqual({ run_id: 41, view: "matched", status: ["amount_mismatch"], line_type: ["refund"] });
  });

  it("a run's items: no note about the search without one, or without reports.export", async () => {
    const { unmount } = await render(<ReconciliationRunScreen id="41" />, "");
    await screen.findByRole("heading", { name: "Items" });
    expect(screen.queryByText(/doesn't apply the search/)).not.toBeInTheDocument();
    unmount();
    await render(<ReconciliationRunScreen id="41" />, "q=fpay", ["reconciliation.run", "payments.view"]);
    await waitFor(() => expect(api.fetchReconciliationItems).toHaveBeenLastCalledWith(41, expect.objectContaining({ q: "fpay" })));
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    expect(screen.queryByText(/doesn't apply the search/)).not.toBeInTheDocument();
  });

  it("the VAT summary: the period the API counted and the zone on screen", async () => {
    api.fetchFinanceSummary.mockResolvedValue({ ...summary("2026-11-01", "2026-11-16"), zone: { id: 3, code: "DXB", name: { ar: "دبي", en: "Dubai" } } });
    url.set("from=2026-11-01&to=2026-11-16");
    renderWithProviders(
      <AdminZoneProvider initialZoneId={3}>
        <FinanceSummaryScreen />
      </AdminZoneProvider>,
      { permissions: [...ACCOUNTANT, "bookings.view"] },
    );
    await waitFor(() => expect(api.fetchFinanceSummary).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-16", zoneId: 3 }));
    expect(await exportExcel("Export VAT summary")).toEqual({ report: "vat_summary", format: "xlsx", filters: { from: "2026-11-01", to: "2026-11-16", zone_id: 3 } });
  });

  it("the VAT summary: with no period chosen, the API's own period, and every zone for those without the zone picker", async () => {
    url.set("");
    renderWithProviders(
      <AdminZoneProvider initialZoneId={3}>
        <FinanceSummaryScreen />
      </AdminZoneProvider>,
      { permissions: ACCOUNTANT },
    );
    expect(await exportExcel("Export VAT summary")).toEqual({ report: "vat_summary", format: "xlsx", filters: { from: "2026-11-01", to: "2026-11-19" } });
  });

  it("the customer balance: that customer's movements", async () => {
    await render(<WalletPanel customerUlid="01C2" />, "");
    await screen.findByText("Spendable balance");
    const panel = screen.getByRole("heading", { name: "Balance" }).closest("section")!;
    const user = userEvent.setup();
    await user.click(within(panel).getByRole("button", { name: "Export" }));
    await user.click(within(panel).getByRole("button", { name: "CSV (.csv)" }));
    await waitFor(() => expect(api.createExport).toHaveBeenCalledWith({ report: "wallet_transactions", format: "csv", filters: { customer_id: "01C2" } }));
  });
});
