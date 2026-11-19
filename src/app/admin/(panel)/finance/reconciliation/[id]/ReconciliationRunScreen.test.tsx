import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { RefundReason } from "@/lib/admin/types";
import { accepted, confirmed, itemDetail, itemRow, recorded, refundItem, runDetail, stray } from "@/test/financeFixtures";
import { renderWithProviders } from "@/test/render";
import { ReconciliationRunScreen } from "./ReconciliationRunScreen";

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
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/admin/finance/reconciliation/41",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = {
  fetchReconciliationRun: vi.fn(),
  fetchReconciliationItems: vi.fn(),
  fetchReconciliationItem: vi.fn(),
  resolveItem: vi.fn(),
  reopenItem: vi.fn(),
  recheckRun: vi.fn(),
  fetchRefundReasons: vi.fn(),
};
vi.mock("@/lib/admin/finance/endpoints", () => ({
  fetchReconciliationRun: (...a: unknown[]) => api.fetchReconciliationRun(...a),
  fetchReconciliationItems: (...a: unknown[]) => api.fetchReconciliationItems(...a),
  fetchReconciliationItem: (...a: unknown[]) => api.fetchReconciliationItem(...a),
  resolveItem: (...a: unknown[]) => api.resolveItem(...a),
  reopenItem: (...a: unknown[]) => api.reopenItem(...a),
  recheckRun: (...a: unknown[]) => api.recheckRun(...a),
  fetchSettlementFormats: vi.fn().mockResolvedValue([]),
  createFetchRun: vi.fn(),
  uploadSettlementRun: vi.fn(),
  settlementTemplateUrl: (key: string) => key,
  createExport: vi.fn(),
  fetchExport: vi.fn(),
  fetchExportUrl: vi.fn(),
}));
vi.mock("@/lib/admin/endpoints", () => ({ fetchRefundReasons: (...a: unknown[]) => api.fetchRefundReasons(...a) }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASONS: RefundReason[] = [
  { code: "goodwill", label: { ar: "بادرة حسن نية", en: "Goodwill gesture" }, selectable: true, requires_text: false },
  { code: "other", label: { ar: "سبب آخر", en: "Other" }, selectable: true, requires_text: true },
  { code: "price_difference", label: { ar: "فرق السعر", en: "Price difference" }, selectable: false, requires_text: false },
];
const ACCOUNTANT = ["reconciliation.run", "payments.view", "refunds.create"];
const itemsPage = (rows: ReturnType<typeof itemRow>[]) => ({
  data: rows,
  meta: {
    current_page: 1,
    per_page: 50,
    total: rows.length,
    last_page: 1,
    counts_by_status: { matched: 8, amount_mismatch: 1, missing_in_system: 0, missing_in_gateway: 0, status_mismatch: 1 },
    unresolved_count: 2,
    documents_issues: 1,
  },
});
const amountItem = itemRow();
const refundLine = refundItem();
const refundFacts = { id: 9, ulid: "01REFR3", status: "processing" as const, amount_fils: 12000, currency: "AED", gateway_refund_ref: null, reason_code: "goodwill", needs_review: true, succeeded_at: null, failed_at: null };

beforeEach(() => {
  url.set("");
  push.mockReset();
  Object.values(api).forEach((fn) => fn.mockReset());
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchReconciliationRun.mockResolvedValue(runDetail());
  api.fetchReconciliationItems.mockResolvedValue(itemsPage([amountItem, refundLine]));
  api.fetchRefundReasons.mockResolvedValue(REASONS);
});
afterEach(() => vi.restoreAllMocks());

const open = (permissions: readonly string[] = ACCOUNTANT, locale: "en" | "ar" = "en") => renderWithProviders(<ReconciliationRunScreen id="41" />, { permissions, locale });

describe("A09 reconciliation run page", () => {
  it("shows the report's facts and the totals in three columns, with the server's differences in the danger colour", async () => {
    open();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(/Reconciliation/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Done");
    const facts = screen.getByRole("heading", { name: "About this report" }).closest("section")!;
    expect(facts).toHaveTextContent("Uploaded · Tarteeba settlement (CSV)");
    expect(facts).toHaveTextContent("settlement-2026-11-18.csv");
    expect(facts).toHaveTextContent("a".repeat(64));
    expect(facts).toHaveTextContent("Test Accountant");

    const totals = screen.getByRole("heading", { name: "Totals" }).closest("section")!;
    expect(within(totals).getByRole("heading", { name: "The provider's report" })).toBeInTheDocument();
    expect(within(totals).getByRole("heading", { name: "Our records" })).toBeInTheDocument();
    expect(within(totals).getByRole("heading", { name: "Tax documents" })).toBeInTheDocument();
    const row = (label: string) => within(totals).getByText(label).closest("div")!;
    expect(row("Charges")).toHaveTextContent("AED 7,059.00");
    expect(row("Fees")).toHaveTextContent("AED 176.00");
    expect(within(totals).getAllByText("Payout")[0].closest("div")).toHaveTextContent("AED 6,523.00");
    expect(row("Charges against invoices")).toHaveTextContent("AED 31.50");
    expect(within(row("Charges against invoices")).getByText("AED 31.50").closest("dd")).toHaveClass("text-danger-700");
    expect(within(row("Refunds against credit notes").querySelector("dd") as HTMLElement).getByText("AED 0.00").closest("dd")).not.toHaveClass("text-danger-700");
    expect(within(row("Payout difference").querySelector("dd") as HTMLElement).getByText("AED 0.00").closest("dd")).not.toHaveClass("text-danger-700");
    expect(totals).toHaveTextContent("Document checks to look at:");
    expect(totals).toHaveTextContent("Invoice differs · 1");
  });

  it("lists the differences first, with references, our record, both amounts and the difference", async () => {
    open();
    const table = await screen.findByRole("table", { name: "Items of this run" });
    await within(table).findAllByText(/TRB-7K2Q9M/);
    expect(api.fetchReconciliationItems).toHaveBeenCalledWith(41, expect.objectContaining({ view: "differences", page: 1 }));
    const [, first, second] = within(table).getAllByRole("row");
    expect(first).toHaveTextContent("Amount differs");
    expect(first).toHaveTextContent("The amounts differ");
    expect(first).toHaveTextContent("fpay_b3");
    expect(first).toHaveTextContent("TRB-7K2Q9M");
    expect(first).toHaveTextContent("AED 219.00");
    expect(first).toHaveTextContent("AED 224.00");
    expect(within(first).getByText("AED 5.00")).toHaveClass("text-danger-700");
    expect(within(first).getByRole("link", { name: /Payment/ })).toHaveAttribute("href", "/admin/finance/payments/9");
    expect(first).toHaveTextContent("Invoice differs");
    expect(second).toHaveTextContent("Status differs");
    expect(second).toHaveTextContent("fref_r3");
    expect(second).toHaveTextContent("No credit note");
    expect(within(first).getByRole("button", { name: "Copy Charge" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Differences (2)", selected: true })).toBeInTheDocument();
  });

  it("switches tab and filters in the URL, sending the API's own names", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("table", { name: "Items of this run" });
    await user.click(screen.getByRole("tab", { name: "Documents (1)" }));
    await waitFor(() => expect(api.fetchReconciliationItems).toHaveBeenLastCalledWith(41, expect.objectContaining({ view: "documents" })));
    expect(url.get().get("view")).toBe("documents");
    await user.selectOptions(screen.getByLabelText("Line type"), "refund");
    await waitFor(() => expect(api.fetchReconciliationItems).toHaveBeenLastCalledWith(41, expect.objectContaining({ view: "documents", lineType: "refund" })));
    await user.type(screen.getByLabelText("Search"), "fref_r3");
    await waitFor(() => expect(api.fetchReconciliationItems).toHaveBeenLastCalledWith(41, expect.objectContaining({ q: "fref_r3" })));
  });

  it("says nothing needs action when the differences tab is empty", async () => {
    api.fetchReconciliationItems.mockResolvedValue(itemsPage([]));
    open();
    expect(await screen.findByText("No differences need action.")).toBeInTheDocument();
  });

  it("lists the errors of a file that could not be read, by line, and shows no items", async () => {
    api.fetchReconciliationRun.mockResolvedValue(
      runDetail({
        status: "failed",
        status_label: { ar: "تعذّرت", en: "Failed" },
        failure_code: "parse_failed",
        failure_label: { ar: "تعذّرت قراءة الملف", en: "The file couldn't be read" },
        totals: null,
        errors: [
          { line: 4, column: "amount", code: "AMOUNT_INVALID", message: { ar: "مبلغ غير صالح", en: "The amount isn't valid" } },
          { line: 9, column: "type", code: "TYPE_UNKNOWN", message: { ar: "نوع غير معروف", en: "Unknown line type" } },
        ],
        errors_total: 130,
      }),
    );
    open();
    const errors = await screen.findByRole("table", { name: "Errors by line" });
    expect(within(errors).getAllByRole("row")).toHaveLength(3);
    expect(errors).toHaveTextContent("The amount isn't valid");
    expect(errors).toHaveTextContent("AMOUNT_INVALID");
    expect(screen.getByText("Showing 2 of 130 errors.")).toBeInTheDocument();
    expect(screen.getByText("Nothing was matched. Correct these lines, then upload the file again.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Items of this run" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload again" })).toBeInTheDocument();
  });

  it("says a run is being read and keeps no actions on it", async () => {
    api.fetchReconciliationRun.mockResolvedValue(runDetail({ status: "processing", status_label: { ar: "قيد القراءة", en: "Reading" }, totals: null }));
    open();
    expect(await screen.findByText("The report is being read. This page refreshes by itself.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recheck" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Items of this run" })).not.toBeInTheDocument();
  });

  it("links a replaced run to the newer one and changes nothing on it", async () => {
    api.fetchReconciliationRun.mockResolvedValue(runDetail({ status: "superseded", status_label: { ar: "مستبدلة", en: "Replaced" }, superseded_by_run_id: 45 }));
    open();
    expect(await screen.findByRole("link", { name: "Open the newer run" })).toHaveAttribute("href", "/admin/finance/reconciliation/45");
    await screen.findByRole("table", { name: "Items of this run" });
    expect(screen.queryByRole("button", { name: /^Resolve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recheck" })).not.toBeInTheDocument();
  });

  it("hides every action from someone who may only read, and shows the permission state to someone who may not", async () => {
    const { unmount } = open(["payments.view"]);
    await screen.findAllByText(/TRB-7K2Q9M/);
    expect(screen.queryByRole("button", { name: /^Resolve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recheck" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Replace/ })).not.toBeInTheDocument();
    unmount();
    open(["bookings.view"]);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("rechecks the run and says how many items it looked at", async () => {
    api.recheckRun.mockResolvedValue({ data: runDetail(), rechecked: 4, auto_resolved: 1 });
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Recheck" }));
    expect(await screen.findByText("Rechecked 4 items; 1 was resolved by the new facts.")).toBeInTheDocument();
    expect(api.recheckRun).toHaveBeenCalledWith(41);
  });

  it("starts a replace from the run, with the date and the replace choice already filled", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Replace: upload a corrected file" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Report date/)).toHaveValue("2026-11-18");
    expect(within(dialog).getByLabelText("Replace the report already read for this date")).toBeChecked();
  });

  it("reads in Arabic", async () => {
    open(ACCOUNTANT, "ar");
    expect(await screen.findByText("التسوية")).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "الفروقات (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الإجماليات" })).toBeInTheDocument();
  });
});

describe("resolving an item", () => {
  async function openResolve(row: ReturnType<typeof itemRow>, detail: ReturnType<typeof itemDetail>) {
    api.fetchReconciliationItem.mockResolvedValue(detail);
    const user = userEvent.setup();
    open();
    const ref = row.refund_ref ?? row.gateway_ref;
    await user.click(await screen.findByRole("button", { name: `Resolve the item ${ref}` }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText(/^Resolution/);
    return { user, dialog };
  }

  it("resolves with a note only, sending the item's version and an Idempotency-Key", async () => {
    api.resolveItem.mockResolvedValue({ data: itemDetail(amountItem, []), refund: null });
    const { user, dialog } = await openResolve(amountItem, itemDetail(amountItem, [accepted, stray]));
    // The facts come first: the provider's line against our records, and the payment's figures.
    expect(dialog).toHaveTextContent("AED 219.00");
    expect(dialog).toHaveTextContent("AED 224.00");
    expect(dialog).toHaveTextContent("Left to refund");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(within(dialog).getByText("Choose how to resolve it.")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/^Resolution/), "accepted");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(within(dialog).getByText("Write a note.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider rounds up");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(api.resolveItem).toHaveBeenCalledTimes(1));
    expect(api.resolveItem).toHaveBeenCalledWith(501, { resolution_code: "accepted", note: "Provider rounds up" }, 1, expect.stringMatching(UUID));
    expect(await screen.findByText("The item was resolved.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("books money only after the exact amount is confirmed, and asks again when the amount moved", async () => {
    api.resolveItem
      .mockRejectedValueOnce(new AdminApiError(409, { code: "TERMS_CHANGED", message: "x", details: { amount_fils: 13000 } }))
      .mockResolvedValue({ data: itemDetail(refundLine, []), refund: { id: 9, status: "succeeded", status_label: { ar: "تم الاسترداد", en: "Refunded" }, amount_fils: 13000 } });
    const { user, dialog } = await openResolve(refundLine, itemDetail(refundLine, [confirmed], { refund_facts: refundFacts }));
    await user.selectOptions(within(dialog).getByLabelText(/^Resolution/), "refund_confirmed");
    await user.type(within(dialog).getByLabelText(/^Note/), "Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Step two: the exact amount, nothing sent yet.
    expect(api.resolveItem).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Amount to book").closest("div")).toHaveTextContent("AED 120.00");
    await user.click(within(dialog).getByRole("button", { name: "Book AED 120.00" }));
    await waitFor(() => expect(api.resolveItem).toHaveBeenCalledTimes(1));
    const first = api.resolveItem.mock.calls[0];
    expect(first[1]).toEqual({ resolution_code: "refund_confirmed", note: "Seen on the provider statement", expected_amount_fils: 12000 });
    expect(first[2]).toBe(1);
    // TERMS_CHANGED: the new amount replaces the old one, marked, and a fresh confirmation is needed.
    expect(await within(dialog).findByText("The amount changed")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The line's amount is now AED 130.00 (it was AED 120.00). Check it, then confirm again.");
    expect(api.resolveItem).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Book AED 130.00" }));
    await waitFor(() => expect(api.resolveItem).toHaveBeenCalledTimes(2));
    const second = api.resolveItem.mock.calls[1];
    expect(second[1].expected_amount_fils).toBe(13000);
    // The body changed, so the intent is new: a new key.
    expect(second[3]).toMatch(UUID);
    expect(second[3]).not.toBe(first[3]);
    expect(await screen.findByText("The item was resolved. Refund status: Refunded.")).toBeInTheDocument();
  });

  it("asks for the refund reason with provider_refund_recorded, from the selectable reasons only", async () => {
    api.resolveItem.mockResolvedValue({ data: itemDetail(refundLine, []), refund: null });
    const { user, dialog } = await openResolve(refundLine, itemDetail(refundLine, [recorded]));
    await user.selectOptions(within(dialog).getByLabelText(/^Resolution/), "provider_refund_recorded");
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider paid it by hand");
    const reason = await within(dialog).findByLabelText(/^Refund reason/);
    await waitFor(() => expect(reason).toBeEnabled());
    expect(within(reason).queryByRole("option", { name: "Price difference" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByText("Choose the refund reason.")).toBeInTheDocument();
    await user.selectOptions(reason, "goodwill");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Book AED 120.00" }));
    await waitFor(() => expect(api.resolveItem).toHaveBeenCalledTimes(1));
    expect(api.resolveItem.mock.calls[0][1]).toEqual({
      resolution_code: "provider_refund_recorded",
      note: "Provider paid it by hand",
      refund_reason_code: "goodwill",
      expected_amount_fils: 12000,
    });
  });

  it("pairs a stray charge with its refund line", async () => {
    api.resolveItem.mockResolvedValue({ data: itemDetail(amountItem, []), refund: null });
    const partner = refundItem({ id: 777, line_no: 9, gateway_ref: "fpay_b3", refund_ref: "fref_x", gateway_amount_fils: 21900, system_amount_fils: null });
    const { user, dialog } = await openResolve(amountItem, itemDetail(amountItem, [stray], { pair_candidates: [partner] }));
    await user.selectOptions(within(dialog).getByLabelText(/^Resolution/), "stray_charge_refunded");
    await user.type(within(dialog).getByLabelText(/^Note/), "Refunded at the provider");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(within(dialog).getByText("Choose the matching refund line.")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/^Matching refund line/), "777");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(api.resolveItem).toHaveBeenCalledTimes(1));
    expect(api.resolveItem.mock.calls[0][1]).toEqual({ resolution_code: "stray_charge_refunded", note: "Refunded at the provider", paired_item_id: 777 });
  });

  it("says in words why the API refused: the run was replaced, no refund permission, a pair that doesn't fit, an open refund", async () => {
    const { user, dialog } = await openResolve(amountItem, itemDetail(amountItem, [accepted]));
    await user.selectOptions(within(dialog).getByLabelText(/^Resolution/), "accepted");
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider rounds up");
    const submit = () => user.click(within(dialog).getByRole("button", { name: "Resolve" }));

    api.resolveItem.mockRejectedValueOnce(new AdminApiError(409, { code: "RECONCILIATION_RUN_NOT_ACTIVE", message: "x", details: { status: "superseded" } }));
    await submit();
    expect(await within(dialog).findByText(/This run was replaced or did not finish/)).toBeInTheDocument();

    api.resolveItem.mockRejectedValueOnce(new AdminApiError(403, { code: "REFUND_PERMISSION_REQUIRED", message: "x", details: {} }));
    await submit();
    await waitFor(() => expect(within(dialog).queryByText(/This run was replaced or did not finish/)).not.toBeInTheDocument());
    expect(await within(dialog).findByText("Deciding the refund amount needs the refunds permission. Ask an accountant or a system admin.")).toBeInTheDocument();

    api.resolveItem.mockRejectedValueOnce(new AdminApiError(409, { code: "OPEN_REFUND_EXISTS", message: "x", details: { refund: { id: 1, ulid: "u", amount_fils: 6000, status: "processing" } } }));
    await submit();
    expect(await within(dialog).findByText("This payment already has a refund open (AED 60.00, processing). Wait for the provider's answer first.")).toBeInTheDocument();

    api.resolveItem.mockRejectedValueOnce(new AdminApiError(422, { code: "PAIRED_ITEM_INVALID", message: "x", details: { reason: "amount_differs" } }));
    await submit();
    expect(await within(dialog).findByText(/different amounts/)).toBeInTheDocument();
  });

  it("keeps the same key and says so when the answer was lost, so pressing again never books twice", async () => {
    const { user, dialog } = await openResolve(amountItem, itemDetail(amountItem, [accepted]));
    await user.selectOptions(within(dialog).getByLabelText(/^Resolution/), "accepted");
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider rounds up");
    api.resolveItem.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue({ data: itemDetail(amountItem, []), refund: null });
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(await within(dialog).findByText("We don't know yet whether this was saved")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(api.resolveItem).toHaveBeenCalledTimes(2));
    expect(api.resolveItem.mock.calls[1][3]).toBe(api.resolveItem.mock.calls[0][3]);
  });

  it("warns that a money resolution needs the refund permission", async () => {
    api.fetchReconciliationItem.mockResolvedValue(itemDetail(refundLine, [confirmed], { refund_facts: refundFacts }));
    const user = userEvent.setup();
    open(["reconciliation.run", "payments.view"]);
    await user.click(await screen.findByRole("button", { name: "Resolve the item fref_r3" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(await within(dialog).findByLabelText(/^Resolution/), "refund_confirmed");
    expect(within(dialog).getByText(/needs the refund permission/)).toBeInTheDocument();
  });

  it("shows an error with a retry when the item's facts can't be loaded", async () => {
    api.fetchReconciliationItem.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue(itemDetail(amountItem, [accepted]));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Resolve the item fpay_b3" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByLabelText(/^Resolution/)).toBeInTheDocument();
  });
});

describe("reopening a resolution", () => {
  const resolvedBy = (code: "accepted" | "refund_confirmed", type: "staff" | "system" = "staff") =>
    itemRow({
      id: 600,
      needs_action: false,
      version: 4,
      resolution: { at: "2026-11-19T07:00:00+00:00", by: { type, id: type === "staff" ? 4 : null, name: type === "staff" ? "Test Accountant" : null }, code, label: { ar: "مقبول كما هو", en: "Accepted as it is" }, note: "Provider rounds up", refund: null, paired_item_id: null, carried: false },
    });

  it("takes a note-only resolution back with a reason, sending the item's version", async () => {
    api.fetchReconciliationItems.mockResolvedValue(itemsPage([resolvedBy("accepted")]));
    api.reopenItem.mockResolvedValue(itemDetail(amountItem, []));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Reopen the item fpay_b3" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reopen" }));
    expect(within(dialog).getByText("Write a note.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Why reopen it/), "Provider sent a corrected report");
    await user.click(within(dialog).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(api.reopenItem).toHaveBeenCalledWith(600, "Provider sent a corrected report", 4));
    expect(await screen.findByText("The item needs action again.")).toBeInTheDocument();
  });

  it("offers no reopen for a resolution that booked money, or one the system closed", async () => {
    api.fetchReconciliationItems.mockResolvedValue(itemsPage([resolvedBy("refund_confirmed"), { ...resolvedBy("accepted", "system"), id: 601 }]));
    open();
    await screen.findAllByText(/TRB-7K2Q9M/);
    expect(screen.queryByRole("button", { name: /^Reopen/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Closed by the system|The system/)).toBeInTheDocument();
  });

  it("says in words when the API refuses to reopen", async () => {
    api.fetchReconciliationItems.mockResolvedValue(itemsPage([resolvedBy("accepted")]));
    api.reopenItem.mockRejectedValue(new AdminApiError(409, { code: "RESOLUTION_NOT_REOPENABLE", message: "x", details: { resolution_code: "refund_confirmed" } }));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Reopen the item fpay_b3" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Why reopen it/), "Mistake in the note");
    await user.click(within(dialog).getByRole("button", { name: "Reopen" }));
    expect(await within(dialog).findByText(/booked money or paired two lines/)).toBeInTheDocument();
  });
});
