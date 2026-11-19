import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { runDetail, runRow } from "@/test/financeFixtures";
import { renderWithProviders } from "@/test/render";
import { ReconciliationRunsScreen } from "./ReconciliationRunsScreen";

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
    usePathname: () => "/admin/finance/reconciliation",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = { fetchReconciliationRuns: vi.fn(), createFetchRun: vi.fn(), uploadSettlementRun: vi.fn(), fetchSettlementFormats: vi.fn() };
vi.mock("@/lib/admin/finance/endpoints", () => ({
  fetchReconciliationRuns: (...a: unknown[]) => api.fetchReconciliationRuns(...a),
  createFetchRun: (...a: unknown[]) => api.createFetchRun(...a),
  uploadSettlementRun: (...a: unknown[]) => api.uploadSettlementRun(...a),
  fetchSettlementFormats: (...a: unknown[]) => api.fetchSettlementFormats(...a),
  settlementTemplateUrl: (key: string) => `/backend/api/v1/admin/reconciliation/formats/${key}/template`,
  createExport: vi.fn(),
  fetchExport: vi.fn(),
  fetchExportUrl: vi.fn(),
}));

const page = (rows: ReturnType<typeof runRow>[], unresolvedTotal = 2) => ({
  data: rows,
  meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1, unresolved_total: unresolvedTotal },
});
const FORMAT = {
  key: "tarteeba_settlement_v1",
  label: { ar: "تسوية ترتيبة (CSV)", en: "Tarteeba settlement (CSV)" },
  accepts: [".csv"],
  columns: [
    { name: "type", required: true, format: "charge|refund|…" },
    { name: "fee", required: false, format: "0.00" },
  ],
};
const ACCOUNTANT = ["reconciliation.run", "payments.view"];

beforeEach(() => {
  url.set("");
  // The page URL: useSearchParams follows history.replaceState like Next's own integration does.
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchReconciliationRuns.mockResolvedValue(page([runRow()]));
  api.fetchSettlementFormats.mockResolvedValue([FORMAT]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("A09 reconciliation runs", () => {
  it("lists each run with its five counts, what needs action and the provider's charges, fees and net", async () => {
    api.fetchReconciliationRuns.mockResolvedValue(
      page([
        runRow(),
        runRow({ id: 40, report_date: "2026-11-17", source: "fetch", source_file_name: null, unresolved_count: 0, counts: { matched: 9, amount_mismatch: 0, missing_in_system: 0, missing_in_gateway: 0, status_mismatch: 0 } }),
        runRow({ id: 39, report_date: "2026-11-16", status: "failed", status_label: { ar: "تعذّرت", en: "Failed" }, failure_code: "parse_failed", failure_label: { ar: "تعذّرت قراءة الملف", en: "The file couldn't be read" }, totals_brief: null, unresolved_count: 0 }),
      ]),
    );
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    await screen.findAllByText("settlement-2026-11-18.csv");
    const rows = screen.getAllByRole("row");
    const first = rows[1];
    expect(within(first).getAllByRole("link")[0]).toHaveAttribute("href", "/admin/finance/reconciliation/41");
    expect(first).toHaveTextContent("Uploaded");
    expect(first).toHaveTextContent("settlement-2026-11-18.csv");
    expect(first).toHaveTextContent("Matched 8");
    expect(first).toHaveTextContent("Amount differs 1");
    expect(first).toHaveTextContent("Not in our records 1");
    expect(first).toHaveTextContent("AED 7,059.00");
    expect(first).toHaveTextContent("AED 176.00");
    expect(first).toHaveTextContent("AED 6,523.00");
    // What needs action is in the danger colour, zero is not.
    const unresolved = (row: HTMLElement) => within(within(row).getAllByRole("cell")[4]);
    expect(unresolved(first).getByText("2")).toHaveClass("text-danger-700");
    expect(unresolved(rows[2]).getByText("0")).not.toHaveClass("text-danger-700");
    expect(rows[2]).toHaveTextContent("Fetched");
    expect(rows[3]).toHaveTextContent("Failed");
    expect(rows[3]).toHaveTextContent("The file couldn't be read");
    expect(screen.getByText("2 differences need action across all runs.")).toBeInTheDocument();
  });

  it("filters by report date, status and 'needs action only' in the URL, with the API's own parameter names", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    await screen.findByText("settlement-2026-11-18.csv");
    await user.click(screen.getByLabelText("Needs action only"));
    await waitFor(() => expect(api.fetchReconciliationRuns).toHaveBeenLastCalledWith(expect.objectContaining({ unresolved: true })));
    await user.selectOptions(screen.getByLabelText("Status"), "failed");
    await waitFor(() => expect(api.fetchReconciliationRuns).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", unresolved: true })));
    expect(url.get().get("unresolved")).toBe("1");
  });

  it("refreshes in the background every 5 seconds while a run is being read, and stops once it is done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.fetchReconciliationRuns.mockResolvedValueOnce(page([runRow({ id: 42, status: "processing", status_label: { ar: "قيد القراءة", en: "Reading" }, totals_brief: null, unresolved_count: 0 })]));
    api.fetchReconciliationRuns.mockResolvedValue(page([runRow({ id: 42 })]));
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    expect(await within(await screen.findByRole("table")).findByText("Reading")).toBeInTheDocument();
    expect(api.fetchReconciliationRuns).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200);
    });
    // The poll is a background read: it must not count as staff activity.
    await waitFor(() => expect(api.fetchReconciliationRuns).toHaveBeenCalledTimes(2));
    expect(api.fetchReconciliationRuns).toHaveBeenLastCalledWith(expect.any(Object), { background: true });
    expect(await within(screen.getByRole("table")).findByText("Done")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(api.fetchReconciliationRuns).toHaveBeenCalledTimes(2);
  });

  it("says there is no reconciliation yet and offers both ways to start, only to those who may run it", async () => {
    api.fetchReconciliationRuns.mockResolvedValue(page([], 0));
    const { unmount } = renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    expect(await screen.findByText("No reconciliation yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Fetch report" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Upload file" })).toHaveLength(2);
    unmount();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ["payments.view"] });
    expect(await screen.findByText("No reconciliation yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fetch report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload file" })).not.toBeInTheDocument();
  });

  it("shows the permission-denied state without either permission, and a retry after an error", async () => {
    const { unmount } = renderWithProviders(<ReconciliationRunsScreen />, { permissions: ["bookings.view"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchReconciliationRuns).not.toHaveBeenCalled();
    unmount();
    api.fetchReconciliationRuns.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue(page([runRow()]));
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findAllByRole("row")).toHaveLength(2);
  });
});

describe("fetching a report", () => {
  it("starts a run for the chosen date and says it is read in the background", async () => {
    api.createFetchRun.mockResolvedValue(runDetail({ status: "pending" }));
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    await user.click((await screen.findAllByRole("button", { name: "Fetch report" }))[0]);
    const dialog = await screen.findByRole("dialog");
    // No date yet: nothing is sent.
    await user.click(within(dialog).getByRole("button", { name: "Fetch report" }));
    expect(within(dialog).getByText("Choose the report date.")).toBeInTheDocument();
    expect(api.createFetchRun).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Report date/), "2026-10-18");
    await user.click(within(dialog).getByRole("button", { name: "Fetch report" }));
    await waitFor(() => expect(api.createFetchRun).toHaveBeenCalledWith({ report_date: "2026-10-18" }));
    expect(await screen.findByText(/Reading the report in the background/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers to replace a date that already has a run, with a reason, and links to that run", async () => {
    api.createFetchRun
      .mockRejectedValueOnce(new AdminApiError(409, { code: "RECONCILIATION_RUN_EXISTS", message: "exists", details: { run_id: 41 } }))
      .mockResolvedValue(runDetail({ status: "pending", id: 43 }));
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    await user.click((await screen.findAllByRole("button", { name: "Fetch report" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Report date/), "2026-10-18");
    await user.click(within(dialog).getByRole("button", { name: "Fetch report" }));
    expect(await within(dialog).findByText("A report for this date has already been read. Replace it if you want to read it again.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open that run" })).toHaveAttribute("href", "/admin/finance/reconciliation/41");
    await user.click(within(dialog).getByRole("button", { name: "Replace it" }));
    // The reason is required and at least 3 characters.
    await user.click(within(dialog).getByRole("button", { name: "Replace and fetch" }));
    expect(within(dialog).getByText("Write at least 3 characters.")).toBeInTheDocument();
    expect(api.createFetchRun).toHaveBeenCalledTimes(1);
    await user.type(within(dialog).getByLabelText(/Why replace it/), "Provider corrected the file");
    await user.click(within(dialog).getByRole("button", { name: "Replace and fetch" }));
    await waitFor(() => expect(api.createFetchRun).toHaveBeenLastCalledWith({ report_date: "2026-10-18", replace: true, reason: "Provider corrected the file" }));
  });

  it("asks for another provider when the API names the ones it can fetch, and says to upload when it names none", async () => {
    api.createFetchRun.mockRejectedValueOnce(new AdminApiError(422, { code: "GATEWAY_UNKNOWN", message: "unknown", details: { gateways: [] } }));
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    await user.click((await screen.findAllByRole("button", { name: "Fetch report" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Report date/), "2026-10-18");
    await user.click(within(dialog).getByRole("button", { name: "Fetch report" }));
    expect(await within(dialog).findByText("No provider can be fetched from here. Upload its settlement file instead.")).toBeInTheDocument();
  });
});

describe("uploading a settlement file", () => {
  async function openUpload(user: ReturnType<typeof userEvent.setup>) {
    await user.click((await screen.findAllByRole("button", { name: "Upload file" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Tarteeba settlement \(CSV\)/);
    return dialog;
  }

  it("sends the date, the format and the file, and links a blank template", async () => {
    api.uploadSettlementRun.mockResolvedValue(runDetail({ status: "pending" }));
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    const dialog = await openUpload(user);
    expect(within(dialog).getByRole("link", { name: /Download a blank file/ })).toHaveAttribute("href", "/backend/api/v1/admin/reconciliation/formats/tarteeba_settlement_v1/template");
    // Nothing chosen: the dialog says what is missing and sends nothing.
    await user.click(within(dialog).getByRole("button", { name: "Upload and read" }));
    expect(within(dialog).getByText("Choose the report date.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose the file to upload.")).toBeInTheDocument();
    expect(api.uploadSettlementRun).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Report date/), "2026-10-18");
    const file = new File(["type,currency,amount\ncharge,AED,120.00\n"], "settlement.csv", { type: "text/csv" });
    await user.upload(within(dialog).getByLabelText(/Settlement file/), file);
    await user.click(within(dialog).getByRole("button", { name: "Upload and read" }));
    await waitFor(() => expect(api.uploadSettlementRun).toHaveBeenCalledTimes(1));
    expect(api.uploadSettlementRun).toHaveBeenCalledWith({ report_date: "2026-10-18", file, format: "tarteeba_settlement_v1" });
  });

  it("turns away a file of another type before anything is sent", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    const dialog = await openUpload(user);
    await user.upload(within(dialog).getByLabelText(/Settlement file/), new File(["x"], "statement.pdf", { type: "application/pdf" }));
    expect(await within(dialog).findByText(/statement\.pdf/)).toBeInTheDocument();
    expect(api.uploadSettlementRun).not.toHaveBeenCalled();
  });

  it("explains a file the API refuses: the wrong date, a duplicate of the active run, a file that is too large", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    const dialog = await openUpload(user);
    await user.type(within(dialog).getByLabelText(/Report date/), "2026-10-18");
    await user.upload(within(dialog).getByLabelText(/Settlement file/), new File(["type\n"], "settlement.csv", { type: "text/csv" }));

    api.uploadSettlementRun.mockRejectedValueOnce(new AdminApiError(422, { code: "SETTLEMENT_DATE_MISMATCH", message: "x", details: { file_date: "2026-11-17" } }));
    await user.click(within(dialog).getByRole("button", { name: "Upload and read" }));
    expect(await within(dialog).findByText(/The file is for 2026-11-17, not the report date you chose/)).toBeInTheDocument();

    api.uploadSettlementRun.mockRejectedValueOnce(new AdminApiError(409, { code: "SETTLEMENT_FILE_DUPLICATE", message: "x", details: { run_id: 41 } }));
    await user.click(within(dialog).getByRole("button", { name: "Upload and read" }));
    expect(await within(dialog).findByText(/same file as the one already used for this date/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open that run" })).toHaveAttribute("href", "/admin/finance/reconciliation/41");

    api.uploadSettlementRun.mockRejectedValueOnce(new AdminApiError(422, { code: "SETTLEMENT_FILE_TOO_LARGE", message: "x", details: { max_bytes: 10485760, max_lines: 50000 } }));
    await user.click(within(dialog).getByRole("button", { name: "Upload and read" }));
    expect(await within(dialog).findByText(/up to 10 MB and 50000 lines/)).toBeInTheDocument();
  });

  it("replaces a run that already exists when the person asks to, with the reason", async () => {
    api.uploadSettlementRun
      .mockRejectedValueOnce(new AdminApiError(409, { code: "RECONCILIATION_RUN_EXISTS", message: "x", details: { run_id: 41 } }))
      .mockResolvedValue(runDetail({ status: "pending", id: 44 }));
    const user = userEvent.setup();
    renderWithProviders(<ReconciliationRunsScreen />, { permissions: ACCOUNTANT });
    const dialog = await openUpload(user);
    await user.type(within(dialog).getByLabelText(/Report date/), "2026-10-18");
    const file = new File(["type\n"], "corrected.csv", { type: "text/csv" });
    await user.upload(within(dialog).getByLabelText(/Settlement file/), file);
    await user.click(within(dialog).getByRole("button", { name: "Upload and read" }));
    await user.click(await within(dialog).findByRole("button", { name: "Replace it" }));
    await user.type(within(dialog).getByLabelText(/Why replace it/), "Corrected statement");
    await user.click(within(dialog).getByRole("button", { name: "Replace and upload" }));
    await waitFor(() => expect(api.uploadSettlementRun).toHaveBeenLastCalledWith({ report_date: "2026-10-18", file, format: "tarteeba_settlement_v1", replace: true, reason: "Corrected statement" }));
  });
});
