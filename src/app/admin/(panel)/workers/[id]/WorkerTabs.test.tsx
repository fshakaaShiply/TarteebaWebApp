import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { ShiftRow, Worker, WorkerLeave } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { WorkerInfoTab } from "./WorkerInfoTab";
import { WorkerLeavesTab } from "./WorkerLeavesTab";
import { WorkerScheduleTab } from "./WorkerScheduleTab";

const api = {
  fetchWorkerLeaves: vi.fn(),
  approveLeave: vi.fn(),
  rejectLeave: vi.fn(),
  cancelLeave: vi.fn(),
  requestLeave: vi.fn(),
  updateWorkerShifts: vi.fn(),
  updateWorker: vi.fn(),
  fetchWorker: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchWorkerLeaves: (...a: unknown[]) => api.fetchWorkerLeaves(...a),
  approveLeave: (...a: unknown[]) => api.approveLeave(...a),
  rejectLeave: (...a: unknown[]) => api.rejectLeave(...a),
  cancelLeave: (...a: unknown[]) => api.cancelLeave(...a),
  requestLeave: (...a: unknown[]) => api.requestLeave(...a),
  updateWorkerShifts: (...a: unknown[]) => api.updateWorkerShifts(...a),
  updateWorker: (...a: unknown[]) => api.updateWorker(...a),
  fetchWorker: (...a: unknown[]) => api.fetchWorker(...a),
  fetchAllWorkers: async () => [],
  fetchAllVehicles: async () => [],
  fetchAllZones: async () => [],
}));

// DemoWorkforceSeeder (R-14): Maria works Sunday–Thursday and Saturday 09:00–20:00 and rests on Friday.
const week: ShiftRow[] = [0, 1, 2, 3, 4, 5, 6].map((d) =>
  d === 5
    ? { day_of_week: d, is_working: false, start_time: null, end_time: null }
    : { day_of_week: d, is_working: true, start_time: "09:00", end_time: "20:00" },
);

const maria: Worker = {
  id: 1,
  ulid: "01m5jm537rh4yrgc2hqg2e0s25",
  employee_no: "DEMO-W01",
  full_name: { ar: "ماريا سانتوس", en: "Maria Santos" },
  display_name: "Maria S.",
  phone: null,
  nationality: "PH",
  languages: ["en", "tl", "ar"],
  employment_status: "active",
  hired_at: "2026-09-01",
  home_zone_id: 1,
  home_zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } },
  can_live_out: true,
  weekly_rest_day: 5,
  notes: "Demo worker (R-14), not a real person.",
  shifts: week,
  upcoming_leaves: [],
  version: 4,
  created_at: null,
  updated_at: null,
};

const requested: WorkerLeave = {
  id: 12,
  worker_id: 1,
  type: "annual",
  date_from: "2026-11-02",
  date_to: "2026-11-04",
  days: 3,
  status: "requested",
  reason: "Family visit",
  requested_by: { id: 5, name: "Test HR" },
  requested_at: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
  cancelled_by: null,
  cancelled_at: null,
  cancellation_note: null,
  version: 1,
  updated_at: null,
};

const shortfall = new AdminApiError(409, {
  code: "CAPACITY_SHORTFALL",
  message: "",
  details: {
    shortfalls: [{ date: "2026-11-03", zone_id: 1, slot_template_id: 1, slot: "MORNING", kind: "workers", service_id: 1, reserved: 5, available: 4 }],
  },
});

const consoleError = vi.spyOn(console, "error");

describe("A05 worker tabs", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchWorkerLeaves.mockResolvedValue({ data: [requested], meta: { current_page: 1, per_page: 20, total: 1, last_page: 1 } });
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("approves a leave anyway after a capacity shortfall: force + a reason of at least 10 characters", async () => {
    api.approveLeave.mockRejectedValueOnce(shortfall).mockResolvedValueOnce({ ...requested, status: "approved", version: 2 });
    renderWithProviders(<WorkerLeavesTab worker={maria} />, {
      permissions: ["workers.view", "leave.manage", "capacity.override"],
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Approve the leave from Mon, 2 Nov 2026" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Approve Maria S.'s leave?" });
    await user.type(within(confirm).getByLabelText("Note (optional)"), "Covered");
    await user.click(within(confirm).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(api.approveLeave).toHaveBeenCalledWith(12, "Covered", 1, undefined));
    const dialog = await screen.findByRole("dialog", { name: "Booked requests would be left short" });
    const row = within(within(dialog).getByRole("table")).getAllByRole("row")[1];
    expect(within(row).getByText("MORNING")).toBeInTheDocument();
    expect(within(row).getAllByRole("cell").map((c) => c.textContent).slice(-3)).toEqual(["5", "4", "1"]);

    await user.type(within(dialog).getByLabelText(/Reason for saving anyway/), "too short");
    await user.click(within(dialog).getByRole("button", { name: "Save anyway" }));
    expect(await within(dialog).findByText("Enter a reason of at least 10 characters.")).toBeInTheDocument();
    expect(api.approveLeave).toHaveBeenCalledTimes(1);

    await user.type(within(dialog).getByLabelText(/Reason for saving anyway/), " — Siti covers both visits");
    await user.click(within(dialog).getByRole("button", { name: "Save anyway" }));
    await waitFor(() =>
      expect(api.approveLeave).toHaveBeenLastCalledWith(12, "Covered", 1, { reason: "too short — Siti covers both visits" }),
    );
  });

  it("tells staff without capacity.override to move the requests instead", async () => {
    api.approveLeave.mockRejectedValue(shortfall);
    renderWithProviders(<WorkerLeavesTab worker={maria} />, { permissions: ["workers.view", "leave.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve the leave from Mon, 2 Nov 2026" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog", { name: "Booked requests would be left short" });
    expect(within(dialog).queryByRole("button", { name: "Save anyway" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Only staff with the capacity override permission/)).toBeInTheDocument();
  });

  it("names who already holds the time on RESOURCE_CONFLICT", async () => {
    api.approveLeave.mockRejectedValue(
      new AdminApiError(409, {
        code: "RESOURCE_CONFLICT",
        message: "",
        details: { resource_type: "worker", resource_id: 1, date: "2026-11-03", holder_type: "visit", holder_id: 41, from: "10:00" },
      }),
    );
    renderWithProviders(<WorkerLeavesTab worker={maria} />, { permissions: ["workers.view", "leave.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve the leave from Mon, 2 Nov 2026" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Approve" }));
    expect(
      await screen.findByText("Maria S. already has a visit (#41) on Tuesday, 3 November 2026, from 10:00."),
    ).toBeInTheDocument();
  });

  it("needs a note to reject", async () => {
    renderWithProviders(<WorkerLeavesTab worker={maria} />, { permissions: ["workers.view", "leave.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reject the leave from Mon, 2 Nov 2026" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Reject Maria S.'s leave?" });
    await user.click(within(confirm).getByRole("button", { name: "Reject" }));
    expect(await within(confirm).findByText("Add a note explaining the decision.")).toBeInTheDocument();
    expect(api.rejectLeave).not.toHaveBeenCalled();
  });

  it("shows only the upcoming dates to staff without leave.manage", () => {
    renderWithProviders(
      <WorkerLeavesTab worker={{ ...maria, upcoming_leaves: [{ id: 12, date_from: "2026-11-02", date_to: "2026-11-04", days: 3, status: "approved" }] }} />,
      { permissions: ["workers.view"] },
    );
    expect(screen.getByText("Mon, 2 Nov 2026 – Wed, 4 Nov 2026")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(api.fetchWorkerLeaves).not.toHaveBeenCalled();
  });

  it("edits the week Monday first, keeps the rest day off and saves seven rows with the rest day", async () => {
    api.updateWorkerShifts.mockResolvedValue({ ...maria, version: 5 });
    renderWithProviders(<WorkerScheduleTab worker={maria} />, { permissions: ["workers.view", "workers.manage"] });
    const user = userEvent.setup();

    const week = screen.getByRole("list", { name: "Shifts by day" });
    const items = within(week).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/^Monday/);
    expect(items[6]).toHaveTextContent(/^Sunday/);
    expect(within(items[4]).getByText("Rest day")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Works on Friday" }));
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(await screen.findByText("This is the rest day, so it must be a day off.")).toBeInTheDocument();
    expect(api.updateWorkerShifts).not.toHaveBeenCalled();

    // Move the rest day to Saturday together with the shifts: Saturday off, Friday works until midnight.
    await user.selectOptions(screen.getByRole("combobox", { name: "Weekly rest day" }), "6");
    await user.click(screen.getByRole("switch", { name: "Works on Saturday" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Ends (Friday)" }), "24:00");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => expect(api.updateWorkerShifts).toHaveBeenCalledTimes(1));
    const [id, input, version, force] = api.updateWorkerShifts.mock.calls[0];
    expect([id, version, force]).toEqual([1, 4, undefined]);
    expect(input.weekly_rest_day).toBe(6);
    expect(input.shifts.map((r: ShiftRow) => r.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(input.shifts[5]).toEqual({ day_of_week: 5, is_working: true, start_time: "09:00", end_time: "24:00" });
    expect(input.shifts[6]).toEqual({ day_of_week: 6, is_working: false, start_time: null, end_time: null });
  });

  it("shows the basic profile without empty phone or notes rows", () => {
    const basic = { ...maria } as Partial<Worker>;
    delete basic.phone;
    delete basic.notes;
    renderWithProviders(<WorkerInfoTab worker={basic as Worker} />, { permissions: ["workers.view"] });
    expect(screen.getByText(/You see the basic profile/)).toBeInTheDocument();
    expect(screen.getByText("Maria S.")).toBeInTheDocument();
    expect(screen.queryByText("Phone")).not.toBeInTheDocument();
    expect(screen.queryByText("Internal notes")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("renders the leave tab in Arabic", async () => {
    renderWithProviders(<WorkerLeavesTab worker={maria} />, { permissions: ["workers.view", "leave.manage"], locale: "ar" });
    expect(await screen.findByRole("button", { name: "تسجيل إجازة" })).toBeInTheDocument();
    expect(await screen.findByText("مطلوبة")).toBeInTheDocument();
  });
});
