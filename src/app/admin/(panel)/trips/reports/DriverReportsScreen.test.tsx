import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { driverReport } from "@/test/opsBoardFixtures";
import { renderWithProviders } from "@/test/render";
import { DriverReportsScreen } from "./DriverReportsScreen";

const api = { fetchDriverReports: vi.fn(), updateDriverReport: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchDriverReports: (...a: unknown[]) => api.fetchDriverReports(...a),
  updateDriverReport: (...a: unknown[]) => api.updateDriverReport(...a),
}));

const page = (rows = [driverReport()]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });
const consoleError = vi.spyOn(console, "error");

describe("A06 driver reports", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchDriverReports.mockResolvedValue(page());
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("lists the open reports with the round, the stop's area, the reason and the expected delay", async () => {
    renderWithProviders(<DriverReportsScreen />, { permissions: ["trips.manage"] });
    const row = (await screen.findByText("Traffic on Al Khail Road")).closest("tr")!;
    expect(api.fetchDriverReports).toHaveBeenCalledWith({ page: 1, perPage: 25, status: "open", type: "", date: undefined });
    expect(row).toHaveTextContent("Delay");
    expect(row).toHaveTextContent("Stop 2 · Business Bay");
    expect(row).toHaveTextContent("+15 min");
    expect(row).toHaveTextContent("Test Driver");
    expect(row).toHaveTextContent("Open");
    expect(within(row).getByRole("link", { name: /Drop-off · DEMO-VAN-1/ })).toHaveAttribute("href", "/admin/trips?date=2026-10-24&slot_template_id=1");

    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Type" }), "vehicle_issue");
    await waitFor(() => expect(api.fetchDriverReports).toHaveBeenLastCalledWith({ page: 1, perPage: 25, status: "open", type: "vehicle_issue", date: undefined }));
  });

  it("marks a report handled with a note", async () => {
    api.updateDriverReport.mockResolvedValue(
      driverReport({ status: "resolved", status_label: { ar: "تمت المعالجة", en: "Resolved" }, handled_note: "Called the customer" }),
    );
    renderWithProviders(<DriverReportsScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mark handled: Delay on DEMO-VAN-1" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delay on DEMO-VAN-1" });
    expect(dialog).toHaveTextContent("The driver wrote: “Traffic on Al Khail Road”");
    expect(within(dialog).getByRole("combobox", { name: /New status/ })).toHaveValue("resolved");
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Called the customer");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateDriverReport).toHaveBeenCalledWith(31, { status: "resolved", note: "Called the customer" }));
    expect(await screen.findByText("Report updated: Handled.")).toBeInTheDocument();
  });

  it("shows the API's refusal (a report already closed meanwhile)", async () => {
    api.updateDriverReport.mockRejectedValue(new AdminApiError(409, { code: "INVALID_STATE", message: "This report cannot move to that status.", details: {} }));
    renderWithProviders(<DriverReportsScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Mark handled: Delay on DEMO-VAN-1" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /New status/ }), "acknowledged");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("This report cannot move to that status.")).toBeInTheDocument();
    expect(api.updateDriverReport).toHaveBeenCalledWith(31, { status: "acknowledged", note: null });
  });

  it("is read-only for schedule viewers and denies everyone else", async () => {
    const { unmount } = renderWithProviders(<DriverReportsScreen />, { permissions: ["schedule.view"] });
    await screen.findByText("Traffic on Al Khail Road");
    expect(screen.queryByRole("button", { name: /Mark handled/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Marking them handled needs the trips permission/)).toBeInTheDocument();
    unmount();
    renderWithProviders(<DriverReportsScreen />, { permissions: ["bookings.view"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("says when nothing is open", async () => {
    api.fetchDriverReports.mockResolvedValue(page([]));
    renderWithProviders(<DriverReportsScreen />, { permissions: ["trips.manage"], locale: "ar" });
    expect(await screen.findByText("لا توجد بلاغات مفتوحة.")).toBeInTheDocument();
  });
});
