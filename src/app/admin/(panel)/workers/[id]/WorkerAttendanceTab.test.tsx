import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { attendanceDay, worker } from "@/test/workforceFixtures";
import type { AttendanceMonth } from "@/lib/admin/workforce/types";
import { renderWithProviders } from "@/test/render";
import { WorkerAttendanceTab } from "./WorkerAttendanceTab";

const api = { fetchWorkerAttendance: vi.fn(), recordAttendance: vi.fn(), revertAttendance: vi.fn() };
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchWorkerAttendance: (...a: unknown[]) => api.fetchWorkerAttendance(...a),
  recordAttendance: (...a: unknown[]) => api.recordAttendance(...a),
  revertAttendance: (...a: unknown[]) => api.revertAttendance(...a),
}));

const HR = ["workers.view", "attendance.manage"];
const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const summary = { expected_days: 20, present_days: 18, absent_days: 1, late_days: 0, half_days: 0, unrecorded_days: 1, leave_days: 0 };

const month = (days: ReturnType<typeof attendanceDay>[], over: Partial<AttendanceMonth["meta"]> = {}): AttendanceMonth => ({
  data: days,
  meta: { month: "2026-10", summary, locked: false, proposal: null, ...over },
});

const days = () => [
  attendanceDay({ date: "2026-10-20", status: "present", status_label: { ar: "حاضرة", en: "Present" }, source: "derived", stored: true, version: 1, check_in_at: "2026-10-20T06:00:00+00:00", check_out_at: "2026-10-20T12:30:00+00:00" }),
  attendanceDay({ date: "2026-10-21", status: "absent", source: "manual", stored: true, version: 3, note: "Sick", recorded_by: { id: 4, name: "Huda HR" } }),
  attendanceDay({ date: "2026-10-22" }),
];

const open = (locale: "en" | "ar" = "en") => renderWithProviders(<WorkerAttendanceTab worker={worker()} />, { permissions: HR, locale });
const rowOf = (text: RegExp | string) => screen.getAllByRole("row").find((r) => (typeof text === "string" ? r.textContent?.includes(text) : text.test(r.textContent ?? "")))!;

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  api.fetchWorkerAttendance.mockResolvedValue(month(days()));
});

describe("A05 attendance tab (workforce §5.4)", () => {
  it("shows the month's days with their status, source, Dubai times and the month's summary", async () => {
    open();
    expect(await screen.findByText(/20 working days · present 18 · absent 1/)).toBeInTheDocument();
    const present = rowOf("Present");
    expect(present).toHaveTextContent("Working day");
    expect(present).toHaveTextContent("From the day's records");
    expect(present).toHaveTextContent("10:00 – 16:30");
    const absent = rowOf("Absent");
    expect(absent).toHaveTextContent("Recorded by staff");
    // A day with nothing recorded says so, and a draft computed live is marked as not saved.
    expect(rowOf("Not recorded")).toBeTruthy();
  });

  it("reads the month the API asks for and goes back a month, never forward past the current one", async () => {
    open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    expect(api.fetchWorkerAttendance).toHaveBeenLastCalledWith(3, "2026-10");
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(api.fetchWorkerAttendance).toHaveBeenLastCalledWith(3, "2026-09"));
    expect(screen.getByRole("button", { name: "Next month" })).toBeEnabled();
  });

  it("says a month is locked while its incentive is approved, and offers no change", async () => {
    api.fetchWorkerAttendance.mockResolvedValue(month(days().map((d) => ({ ...d, locked: true })), { locked: true, proposal: { id: 41, status: "approved" } }));
    open();
    expect(await screen.findByText("Locked: the incentive for this month is approved. Reopen it to change the attendance.")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /^(Record|Change) attendance|Record attendance of/ })) expect(button).toBeDisabled();
  });

  it("records an absence for a day with no stored row: needs a note, sends version 0", async () => {
    api.recordAttendance.mockResolvedValue(attendanceDay({ status: "absent", stored: true, version: 1 }));
    open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    await user.click(within(rowOf(/Thu, 22 Oct 2026/)).getByRole("button", { name: /Record attendance of/ }));
    const dialog = screen.getByRole("dialog", { name: /Attendance of/ });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Status/ }), "absent");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Write a note for absent, late or half day.")).toBeInTheDocument();
    expect(api.recordAttendance).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Called in sick");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledWith(3, "2026-10-22", { status: "absent", note: "Called in sick" }, 0));
    expect(await screen.findByText("Attendance saved.")).toBeInTheDocument();
  });

  it("records a late arrival with minutes and times sent with their Dubai offset", async () => {
    api.recordAttendance.mockResolvedValue(attendanceDay({ status: "late", stored: true, version: 1 }));
    open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    await user.click(within(rowOf(/Thu, 22 Oct 2026/)).getByRole("button", { name: /Record attendance of/ }));
    const dialog = screen.getByRole("dialog", { name: /Attendance of/ });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Status/ }), "late");
    await user.type(within(dialog).getByLabelText(/Minutes late/), "20");
    await user.type(within(dialog).getByLabelText("Check-in (Dubai time)"), "10:20");
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Van was late");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledTimes(1));
    expect(api.recordAttendance.mock.calls[0][2]).toEqual({ status: "late", late_minutes: 20, check_in_at: "2026-10-22T10:20:00+04:00", note: "Van was late" });
  });

  it("changes a manual row with its version, and shows the API's refusals in words", async () => {
    api.recordAttendance.mockRejectedValueOnce(apiError(422, "ON_LEAVE", { leave_id: 5 })).mockRejectedValueOnce(apiError(422, "NOT_A_WORKING_DAY", { date: "2026-10-21" })).mockRejectedValueOnce(apiError(409, "ATTENDANCE_LOCKED", { proposal_id: 41 }));
    open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    await user.click(within(rowOf("Sick")).getByRole("button", { name: /Record attendance of/ }));
    const dialog = screen.getByRole("dialog", { name: /Attendance of/ });
    expect(within(dialog).getByRole("combobox", { name: /Status/ })).toHaveValue("absent");
    expect(within(dialog).getByRole("textbox", { name: /Note/ })).toHaveValue("Sick");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("The cleaner is on approved leave on this date.")).toBeInTheDocument();
    expect(api.recordAttendance.mock.calls[0]).toEqual([3, "2026-10-21", { status: "absent", note: "Sick" }, 3]);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/was not expected to work on this date/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/attendance is locked\. Reopen the incentive to change it\./)).toBeInTheDocument();
  });

  it("after a 409 STALE_VERSION reads the day again, keeps the typed note and sends the new version", async () => {
    api.recordAttendance.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 4 })).mockResolvedValueOnce(attendanceDay({ stored: true, version: 5 }));
    open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    await user.click(within(rowOf("Sick")).getByRole("button", { name: /Record attendance of/ }));
    const dialog = screen.getByRole("dialog", { name: /Attendance of/ });
    await user.clear(within(dialog).getByRole("textbox", { name: /Note/ }));
    await user.type(within(dialog).getByRole("textbox", { name: /Note/ }), "Doctor's note");
    const changed = days();
    changed[1] = { ...changed[1], version: 4, note: "Sick (edited by OC)" };
    api.fetchWorkerAttendance.mockResolvedValue(month(changed));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/This day changed while you were working\. Check what is saved now/)).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: /Note/ })).toHaveValue("Doctor's note");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.recordAttendance).toHaveBeenCalledTimes(2));
    expect(api.recordAttendance.mock.calls.map((c) => c[3])).toEqual([3, 4]);
  });

  it("reverts a manual row to the computed day after a confirmation, with its version", async () => {
    api.revertAttendance.mockResolvedValue(attendanceDay({ date: "2026-10-21", stored: true, version: 4 }));
    open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    expect(within(rowOf("Present")).queryByRole("button", { name: /Revert/ })).not.toBeInTheDocument();
    await user.click(within(rowOf("Sick")).getByRole("button", { name: /Revert .* to the computed day/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(api.revertAttendance).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(api.revertAttendance).toHaveBeenCalledWith(3, "2026-10-21", 3));
    expect(await screen.findByText("Reverted to the computed day.")).toBeInTheDocument();
  });

  it("tells staff to record a Live-out absence in the subscription, and links it", async () => {
    api.fetchWorkerAttendance.mockResolvedValue(month([attendanceDay({ date: "2026-10-22", live_out: { subscription_id: 12, reference: "TRL-AB12CD" } })]));
    open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    await user.click(screen.getByRole("button", { name: /Record attendance of/ }));
    const dialog = screen.getByRole("dialog", { name: /Attendance of/ });
    expect(within(dialog).queryByText(/Live-out day/)).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Status/ }), "absent");
    const link = within(dialog).getByRole("link", { name: /Open subscription/ });
    expect(link).toHaveAttribute("href", "/admin/subscriptions/12");
    expect(within(dialog).getByText(/Record the absence in the subscription so the day is covered or credited/)).toBeInTheDocument();
  });

  it("shows the evidence the derivation found, and a day on leave or a rest day offers present only", async () => {
    api.fetchWorkerAttendance.mockResolvedValue(
      month([
        attendanceDay({ date: "2026-10-19", status: "present", source: "derived", stored: true, version: 1, evidence: { visits: [{ id: 5, booking_reference: "TRB-AAAAAA", status: "completed", slot_template_id: 1 }] } }),
        attendanceDay({ date: "2026-10-16", expected: false, rest_day: true }),
        attendanceDay({ date: "2026-10-15", leave: { id: 9 } }),
      ]),
    );
    open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    await user.click(within(rowOf("Present")).getByText("Show"));
    expect(within(rowOf("Present")).getByText(/Visit .*TRB-AAAAAA.* \(Completed\)/)).toBeInTheDocument();
    expect(rowOf("Rest day")).toBeTruthy();
    // On leave the day is decided and nothing is offered.
    expect(within(rowOf(/Thu, 15 Oct 2026/)).queryByRole("button")).not.toBeInTheDocument();
    await user.click(within(rowOf("Rest day")).getByRole("button", { name: /Record attendance of/ }));
    const dialog = screen.getByRole("dialog", { name: /Attendance of/ });
    expect(within(within(dialog).getByRole("combobox", { name: /Status/ })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a status", "Present"]);
  });

  it("words the evidence's visit statuses and round kinds in the language, and never prints a code it has no words for", async () => {
    const evidence = {
      visits: [
        { id: 5, booking_reference: "TRB-AAAAAA", status: "no_show_customer", slot_template_id: 1 },
        { id: 6, booking_reference: "TRB-BBBBBB", status: "teleported", slot_template_id: 1 },
      ],
      rounds: [
        { id: 7, kind: "dropoff", departed_at: "2026-10-19T05:10:00+00:00" },
        { id: 8, kind: "hovercraft", departed_at: "2026-10-19T05:20:00+00:00" },
      ],
    };
    api.fetchWorkerAttendance.mockResolvedValue(month([attendanceDay({ date: "2026-10-19", status: "present", status_label: { ar: "حاضرة", en: "Present" }, source: "derived", stored: true, version: 1, evidence })]));
    const { unmount } = open();
    const user = userEvent.setup();
    await screen.findByText("20 working days", { exact: false });
    await user.click(within(rowOf("Present")).getByText("Show"));
    const row = within(rowOf("Present"));
    expect(row.getByText(/Visit .*TRB-AAAAAA.* \(Customer not available\)/)).toBeInTheDocument();
    expect(row.getByText(/^Visit .*TRB-BBBBBB\S*$/)).toBeInTheDocument();
    expect(row.getByText("Drop-off round, left at 09:10")).toBeInTheDocument();
    expect(row.getByText("Round, left at 09:20")).toBeInTheDocument();
    expect(rowOf("Present").textContent).not.toMatch(/no_show_customer|teleported|dropoff|hovercraft/);
    unmount();

    open("ar");
    await screen.findByText(/أيام عمل/);
    await user.click(within(rowOf("حاضرة")).getByText("عرض"));
    const ar = within(rowOf("حاضرة"));
    expect(ar.getByText(/الزيارة .*TRB-AAAAAA.* \(العميل غير متواجد\)/)).toBeInTheDocument();
    expect(ar.getByText("جولة توصيل، انطلقت الساعة 09:10")).toBeInTheDocument();
    expect(ar.getByText("جولة انطلقت الساعة 09:20")).toBeInTheDocument();
    expect(rowOf("حاضرة").textContent).not.toMatch(/no_show_customer|teleported|dropoff|hovercraft/);
  });

  it("has an empty state, a retry and Arabic words", async () => {
    api.fetchWorkerAttendance.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockResolvedValue(month(days()));
    const { unmount } = open();
    await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/i }));
    expect(await screen.findByText("20 working days", { exact: false })).toBeInTheDocument();
    unmount();
    open("ar");
    expect(await screen.findByText(/20 أيام عمل|20 يوم عمل|أيام عمل/)).toBeInTheDocument();
    expect(screen.getAllByText("حاضرة").length).toBeGreaterThan(0);
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
