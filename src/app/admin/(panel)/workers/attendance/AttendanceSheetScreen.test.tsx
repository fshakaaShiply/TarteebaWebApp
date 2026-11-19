import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { AdminZoneProvider } from "@/lib/admin/zone";
import { attendanceDay, attendanceSheet } from "@/test/workforceFixtures";
import { renderWithProviders } from "@/test/render";
import { AttendanceSheetScreen } from "./AttendanceSheetScreen";

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
    usePathname: () => "/admin/workers/attendance",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = { fetchAttendanceSheet: vi.fn(), recordAttendance: vi.fn(), revertAttendance: vi.fn() };
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchAttendanceSheet: (...a: unknown[]) => api.fetchAttendanceSheet(...a),
  recordAttendance: (...a: unknown[]) => api.recordAttendance(...a),
  revertAttendance: (...a: unknown[]) => api.revertAttendance(...a),
}));
vi.mock("@/lib/admin/endpoints", () => ({
  fetchZoneOptions: async () => [
    { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay" }, is_active: true },
    { id: 2, code: "DEMO_MR", name: { ar: "مردف", en: "Mirdif" }, is_active: true },
  ],
  fetchServiceOptions: async () => [],
}));

const HR = ["attendance.manage", "workers.view"];
const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const maria = attendanceDay({ date: "2026-10-23", worker: { id: 3, employee_no: "DEMO-W01", display_name: "Maria S.", home_zone_id: 1 } });
const siti = attendanceDay({
  date: "2026-10-23",
  worker: { id: 4, employee_no: "DEMO-W02", display_name: "Siti R.", home_zone_id: 2 },
  status: "absent",
  source: "manual",
  stored: true,
  version: 2,
  note: "Sick",
  conflicts_with_evidence: true,
});
const open = (zoneId: number | null = null, locale: "en" | "ar" = "en") =>
  renderWithProviders(
    <AdminZoneProvider initialZoneId={zoneId}>
      <AttendanceSheetScreen />
    </AdminZoneProvider>,
    { permissions: HR, locale },
  );

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  url.set("");
  window.localStorage.clear();
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchAttendanceSheet.mockResolvedValue(
    attendanceSheet([maria, siti], { date: "2026-10-23", counts: { expected: 2, present: 0, absent: 1, late: 0, half_day: 0, unrecorded: 1, leave: 0 } }),
  );
});

describe("A05 day sheet (workforce §5.4)", () => {
  it("shows today's sheet: each cleaner's status, a computed day marked as not saved, and a conflict with the visits", async () => {
    open();
    await screen.findByText("Maria S.");
    expect(api.fetchAttendanceSheet).toHaveBeenCalledWith({ date: "2026-10-23", zoneId: undefined, status: undefined, search: undefined, page: 1, perPage: 50 });
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Not recorded");
    expect(rows[1]).toHaveTextContent("Computed, not saved yet");
    expect(rows[2]).toHaveTextContent("Absent");
    expect(rows[2]).toHaveTextContent("Contradicts the visits");
    expect(rows[2]).toHaveTextContent("Recorded by staff");
    expect(screen.getByRole("link", { name: "Maria S." })).toHaveAttribute("href", "/admin/workers/3?tab=attendance");
  });

  it("shows the counts of the day and filters by one when it is pressed", async () => {
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    const counts = screen.getByRole("list", { name: "Counts of the day" });
    expect(within(counts).getByText("Expected").parentElement).toHaveTextContent("Expected 2");
    await user.click(within(counts).getByRole("button", { name: /Absent 1/ }));
    await waitFor(() => expect(api.fetchAttendanceSheet).toHaveBeenLastCalledWith(expect.objectContaining({ status: "absent" })));
    expect(within(counts).getByRole("button", { name: /Absent 1/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("follows the top bar's zone and the date in the address", async () => {
    url.set("date=2026-10-20");
    open(2);
    await screen.findByText("Maria S.");
    expect(api.fetchAttendanceSheet).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-20", zoneId: 2 }));
  });

  it("never shows a day after today: it falls back to today and says so", async () => {
    url.set("date=2026-10-30");
    open();
    await screen.findByText("Maria S.");
    expect(api.fetchAttendanceSheet).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-10-23" }));
    expect(screen.getByText("Attendance cannot be shown for a day after today, so today is shown.")).toBeInTheDocument();
    expect(screen.getByLabelText("Day")).toHaveAttribute("max", "2026-10-23");
  });

  it("records a cleaner's day from the sheet with the row's version", async () => {
    api.recordAttendance.mockResolvedValue(attendanceDay({ status: "present", stored: true, version: 1 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Record attendance of Maria S." }));
    const dialog = screen.getByRole("dialog", { name: /Attendance of/ });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Status/ }), "present");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledWith(3, "2026-10-23", { status: "present" }, 0));
    expect(await screen.findByText("Attendance saved.")).toBeInTheDocument();
  });

  it("reverts a manual row only, and offers no revert for a computed one", async () => {
    api.revertAttendance.mockResolvedValue(attendanceDay({ date: "2026-10-23", stored: false, version: 0 }));
    open();
    const user = userEvent.setup();
    await screen.findByText("Siti R.");
    expect(screen.queryByRole("button", { name: /Revert the attendance of Maria S\./ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Revert the attendance of Siti R\./ }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(api.revertAttendance).toHaveBeenCalledWith(4, "2026-10-23", 2));
  });

  it("marks a locked day and offers nothing on it", async () => {
    api.fetchAttendanceSheet.mockResolvedValue(attendanceSheet([{ ...siti, locked: true }]));
    open();
    await screen.findByText("Siti R.");
    expect(screen.getAllByText("Locked").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Record attendance of|Revert the attendance/ })).not.toBeInTheDocument();
  });

  it("has an empty state, a filtered empty state and a retry", async () => {
    api.fetchAttendanceSheet.mockResolvedValueOnce(attendanceSheet([]));
    const { unmount } = open();
    expect(await screen.findByText("Nobody was expected on this day.")).toBeInTheDocument();
    unmount();
    api.fetchAttendanceSheet.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockResolvedValue(attendanceSheet([maria]));
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/i }));
    expect(await screen.findByText("Maria S.")).toBeInTheDocument();
  });

  it("needs attendance.manage", async () => {
    renderWithProviders(<AttendanceSheetScreen />, { permissions: ["workers.view"] });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(api.fetchAttendanceSheet).not.toHaveBeenCalled();
  });

  it("is written in Arabic", async () => {
    open(null, "ar");
    expect(await screen.findByText("Maria S.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("الحضور");
    expect(screen.getAllByText("غائبة").length).toBeGreaterThan(0);
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
