import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { exportRecord } from "@/test/financeFixtures";
import { renderWithProviders } from "@/test/render";
import { ExportsScreen } from "./ExportsScreen";

const api = { fetchExports: vi.fn(), fetchExportUrl: vi.fn() };
vi.mock("@/lib/admin/finance/endpoints", () => ({
  fetchExports: (...a: unknown[]) => api.fetchExports(...a),
  fetchExportUrl: (...a: unknown[]) => api.fetchExportUrl(...a),
}));

const assign = vi.fn();
const realLocation = window.location;
const page = (rows: ReturnType<typeof exportRecord>[]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  assign.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
});
afterEach(() => Object.defineProperty(window, "location", { configurable: true, value: realLocation }));

describe("A09 exports page", () => {
  it("lists the files asked for, each with its status, size and when it stops being available", async () => {
    api.fetchExports.mockResolvedValue(
      page([
        exportRecord(),
        exportRecord({ id: 8, report: "refunds", report_label: { ar: "الاستردادات", en: "Refunds" }, status: "running", status_label: { ar: "قيد التجهيز", en: "Preparing" }, file_name: null, row_count: null, size_bytes: null, expires_at: null }),
        exportRecord({ id: 9, status: "failed", status_label: { ar: "تعذّر", en: "Failed" }, failure_code: "too_large", file_name: null, expires_at: null }),
        exportRecord({ id: 10, status: "expired", status_label: { ar: "منتهي", en: "Expired" }, expires_at: null }),
      ]),
    );
    renderWithProviders(<ExportsScreen />, { permissions: ["reports.export"] });
    const table = await screen.findByRole("table", { name: "Exports" });
    await within(table).findAllByText("payments_2026-11-01_2026-11-16_20261116-1030.xlsx");
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Payments");
    expect(rows[1]).toHaveTextContent("Ready");
    expect(rows[1]).toHaveTextContent("120 rows");
    expect(rows[1]).toHaveTextContent("20 KB");
    expect(within(rows[1]).getByRole("button", { name: /Download payments_2026/ })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("Refunds");
    expect(rows[2]).toHaveTextContent("Preparing");
    expect(within(rows[2]).queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("There are too many rows to export in one file. Narrow the filters and try again.");
    expect(within(rows[4]).queryByRole("button", { name: /Download/ })).not.toBeInTheDocument();
  });

  it("asks for a fresh link on each download and opens it", async () => {
    api.fetchExports.mockResolvedValue(page([exportRecord()]));
    api.fetchExportUrl.mockResolvedValue({ url: "https://files.test/a.xlsx?sig=2", expires_at: "2026-11-16T06:45:00+00:00", file_name: "a.xlsx" });
    const user = userEvent.setup();
    renderWithProviders(<ExportsScreen />, { permissions: ["reports.export"] });
    await user.click(await screen.findByRole("button", { name: /Download payments_2026/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://files.test/a.xlsx?sig=2"));
    await user.click(screen.getByRole("button", { name: /Download payments_2026/ }));
    await waitFor(() => expect(api.fetchExportUrl).toHaveBeenCalledTimes(2));
  });

  it("says when the file expired meanwhile, and reads the list again", async () => {
    api.fetchExports.mockResolvedValue(page([exportRecord()]));
    api.fetchExportUrl.mockRejectedValue(new AdminApiError(410, { code: "EXPORT_EXPIRED", message: "x", details: {} }));
    const user = userEvent.setup();
    renderWithProviders(<ExportsScreen />, { permissions: ["reports.export"] });
    await user.click(await screen.findByRole("button", { name: /Download payments_2026/ }));
    expect(await screen.findByText("This file has expired. Ask for the export again.")).toBeInTheDocument();
    await waitFor(() => expect(api.fetchExports.mock.calls.length).toBeGreaterThan(1));
  });

  it("has an empty state, an error with a retry, and keeps out those without reports.export", async () => {
    api.fetchExports.mockResolvedValueOnce(page([]));
    const { unmount } = renderWithProviders(<ExportsScreen />, { permissions: ["reports.export"] });
    expect(await screen.findByText("No exports yet.")).toBeInTheDocument();
    unmount();
    api.fetchExports.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue(page([exportRecord()]));
    const user = userEvent.setup();
    const second = renderWithProviders(<ExportsScreen />, { permissions: ["reports.export"] });
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Payments")).toBeInTheDocument();
    second.unmount();
    renderWithProviders(<ExportsScreen />, { permissions: ["payments.view"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });
});
