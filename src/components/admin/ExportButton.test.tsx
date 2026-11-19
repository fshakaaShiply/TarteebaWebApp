import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { exportRecord } from "@/test/financeFixtures";
import { renderWithProviders } from "@/test/render";
import { ExportButton } from "./ExportButton";

const api = { createExport: vi.fn(), fetchExport: vi.fn(), fetchExportUrl: vi.fn() };
vi.mock("@/lib/admin/finance/endpoints", () => ({
  createExport: (...a: unknown[]) => api.createExport(...a),
  fetchExport: (...a: unknown[]) => api.fetchExport(...a),
  fetchExportUrl: (...a: unknown[]) => api.fetchExportUrl(...a),
}));

const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

const FILTERS = { from: "2026-11-01", to: "2026-11-16", status: "captured" };

describe("ExportButton", () => {
  it("is hidden without reports.export", () => {
    renderWithProviders(<ExportButton report="payments" filters={FILTERS} />, { permissions: ["payments.view"] });
    expect(screen.queryByRole("button", { name: /Export/ })).not.toBeInTheDocument();
  });

  it("offers Excel and CSV, and PDF only for the VAT summary", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<ExportButton report="payments" />, { permissions: ["reports.export"] });
    await user.click(screen.getByRole("button", { name: /Export/ }));
    const group = screen.getByRole("group", { name: "File format" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Excel (.xlsx)", "CSV (.csv)"]);
    unmount();
    renderWithProviders(<ExportButton report="vat_summary" label="Export VAT summary" />, { permissions: ["reports.export"] });
    await user.click(screen.getByRole("button", { name: /Export VAT summary/ }));
    expect(within(screen.getByRole("group", { name: "File format" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Excel (.xlsx)", "CSV (.csv)", "PDF (.pdf)"]);
  });

  it("closes on Escape and returns focus to the button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportButton report="payments" />, { permissions: ["reports.export"] });
    const button = screen.getByRole("button", { name: /Export/ });
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "File format" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("asks for the file with the list's filters, follows it every 2 seconds as a background read, then opens the signed link", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.createExport.mockResolvedValue(exportRecord({ status: "queued", file_name: null }));
    api.fetchExport.mockResolvedValueOnce(exportRecord({ status: "running" })).mockResolvedValueOnce(exportRecord({ status: "ready" }));
    api.fetchExportUrl.mockResolvedValue({ url: "https://files.test/payments.xlsx?sig=1", expires_at: "2026-11-16T06:45:00+00:00", file_name: "payments.xlsx" });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<ExportButton report="payments" filters={FILTERS} />, { permissions: ["reports.export"] });
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(screen.getByRole("button", { name: "Excel (.xlsx)" }));
    expect(api.createExport).toHaveBeenCalledWith({ report: "payments", format: "xlsx", filters: FILTERS });
    expect(await screen.findByText("Preparing your file…")).toBeInTheDocument();
    // The button is busy while the file is prepared.
    expect(screen.getByRole("button", { name: /Export/ })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(api.fetchExport).toHaveBeenCalledWith(7, { background: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://files.test/payments.xlsx?sig=1"));
    expect(await screen.findByText("Your file is ready: payments_2026-11-01_2026-11-16_20261116-1030.xlsx")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Export/ })).toBeEnabled());
  });

  it("says why a file failed, and that an oversized one needs narrower filters", async () => {
    api.createExport.mockResolvedValue(exportRecord({ status: "failed", failure_code: "too_large", file_name: null }));
    const user = userEvent.setup();
    renderWithProviders(<ExportButton report="payments" />, { permissions: ["reports.export"] });
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(screen.getByRole("button", { name: "CSV (.csv)" }));
    expect(await screen.findByText("There are too many rows to export in one file. Narrow the filters and try again.")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("names the limit when the API refuses a file that is too large, and the CSV hint for Excel", async () => {
    api.createExport.mockRejectedValue(new AdminApiError(422, { code: "EXPORT_TOO_LARGE", message: "x", details: { rows: 20000, max_rows: 10000, format: "xlsx", hint: "csv" } }));
    const user = userEvent.setup();
    renderWithProviders(<ExportButton report="payments" />, { permissions: ["reports.export"] });
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(screen.getByRole("button", { name: "Excel (.xlsx)" }));
    expect(await screen.findByText("There are too many rows to export in one file (up to 10,000). Narrow the filters and try again. CSV takes more rows than Excel.")).toBeInTheDocument();
  });

  it("says when the person may not read that data, and when the period is too long", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportButton report="vat_summary" />, { permissions: ["reports.export"] });
    api.createExport.mockRejectedValueOnce(new AdminApiError(403, { code: "FORBIDDEN", message: "x", details: {} }));
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(screen.getByRole("button", { name: "PDF (.pdf)" }));
    expect(await screen.findByText("You don't have permission for this action.")).toBeInTheDocument();
    api.createExport.mockRejectedValueOnce(new AdminApiError(422, { code: "EXPORT_PERIOD_TOO_LONG", message: "x", details: { max_days: 366 } }));
    await user.click(screen.getByRole("button", { name: /Export/ }));
    await user.click(screen.getByRole("button", { name: "CSV (.csv)" }));
    expect(await screen.findByText("The period is too long. Choose at most 366 days.")).toBeInTheDocument();
  });
});
