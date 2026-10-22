import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { Setting } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { SettingEditDialog } from "./SettingEditDialog";

const updateSetting = vi.fn();
vi.mock("@/lib/admin/endpoints", () => ({
  updateSetting: (...args: unknown[]) => updateSetting(...args),
  fetchAllZones: async () => [],
  fetchAllVehicles: async () => [],
  fetchAllWorkers: async () => [],
}));

// SettingsDefaults (R-13): every day 08:00–20:00. GET /admin/settings answers the week as a list.
const workingHours: Setting = {
  key: "booking.working_hours",
  value: Array.from({ length: 7 }, () => ({ open: "08:00", close: "20:00" })),
  type: "weekly_hours",
  group: "booking",
  description: "Hours the bookings team confirms requests, per weekday (R-13, D-09)",
  version: 1,
  updated_at: null,
};

const holidays: Setting = {
  key: "calendar.public_holidays",
  value: [],
  type: "list",
  group: "booking",
  description: "Public holidays (YYYY-MM-DD)",
  version: 2,
  updated_at: null,
};

const consoleError = vi.spyOn(console, "error");

function open(s: Setting, locale: "en" | "ar" = "en") {
  renderWithProviders(<SettingEditDialog setting={s} onClose={vi.fn()} onStale={vi.fn()} />, { locale, permissions: ["settings.manage"] });
  return userEvent.setup();
}

describe("weekly hours editor (booking.working_hours)", () => {
  beforeEach(() => {
    updateSetting.mockReset();
    consoleError.mockClear();
  });
  afterEach(() => {
    // Every label exists in both languages (next-intl reports a missing message through console.error).
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("lists the week Monday first and saves keys \"0\"…\"6\" with null for a closed day and 24:00", async () => {
    updateSetting.mockResolvedValue({ key: workingHours.key, value: {}, type: "weekly_hours", version: 2 });
    const user = open(workingHours);
    const dialog = screen.getByRole("dialog", { name: "Edit: Working hours for confirming requests" });

    const rows = within(dialog).getAllByRole("switch");
    expect(rows.map((r) => r.closest("li")!.querySelector("span")!.textContent)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);

    await user.click(within(dialog).getByRole("switch", { name: "Friday is a working day" }));
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Closes (Thursday)" }), "24:00");
    await user.type(within(dialog).getByLabelText(/Reason for the change/), "Late Thursday shift");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
    const [key, value, reason, version] = updateSetting.mock.calls[0];
    expect([key, reason, version]).toEqual(["booking.working_hours", "Late Thursday shift", 1]);
    expect(Object.keys(value)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(value["5"]).toBeNull();
    expect(value["4"]).toEqual({ open: "08:00", close: "24:00" });
    expect(value["0"]).toEqual({ open: "08:00", close: "20:00" });
  });

  it("refuses a closing time before the opening time and applies a day to the whole week", async () => {
    updateSetting.mockResolvedValue({ key: workingHours.key, value: {}, type: "weekly_hours", version: 2 });
    const user = open(workingHours);

    await user.selectOptions(screen.getByRole("combobox", { name: "Opens (Monday)" }), "21:00");
    await user.type(screen.getByLabelText(/Reason for the change/), "Evening team");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The closing time must be after the opening time.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByRole("combobox", { name: "Closes (Monday)" }), "23:30");
    await user.click(screen.getByRole("button", { name: "Apply Monday's hours to all days" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledTimes(1));
    const value = updateSetting.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.values(value).every((d) => JSON.stringify(d) === JSON.stringify({ open: "21:00", close: "23:30" }))).toBe(true);
  });

  it("shows the API's capacity shortfall without a force path", async () => {
    updateSetting.mockRejectedValue(
      new AdminApiError(409, {
        code: "CAPACITY_SHORTFALL",
        message: "",
        details: { shortfalls: [{ date: "2026-10-25", zone_id: 1, slot_template_id: 1, slot: "MORNING", kind: "workers", reserved: 3, available: 2 }] },
      }),
    );
    const user = open({ ...workingHours, key: "travel.buffer_minutes", type: "int", value: 30, group: "scheduling" });
    await user.clear(screen.getByLabelText("Value"));
    await user.type(screen.getByLabelText("Value"), "60");
    await user.type(screen.getByLabelText(/Reason for the change/), "Longer trips");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This change would leave booked requests without enough workers or seats.")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Slots that would be short" })).toBeInTheDocument();
  });

  it("renders in Arabic", () => {
    open(workingHours, "ar");
    expect(screen.getByRole("dialog", { name: "تعديل: ساعات العمل لتأكيد الطلبات" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "الإثنين يوم عمل" })).toBeInTheDocument();
  });
});

describe("public holidays editor (calendar.public_holidays)", () => {
  beforeEach(() => {
    updateSetting.mockReset();
    consoleError.mockClear();
  });

  it("adds dates in order, refuses duplicates and saves the sorted list", async () => {
    updateSetting.mockResolvedValue({ key: holidays.key, value: [], type: "list", version: 3 });
    const user = open(holidays);
    const input = screen.getByLabelText("Add a holiday");

    fireEvent.change(input, { target: { value: "2026-12-03" } });
    await user.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(input, { target: { value: "2026-12-02" } });
    await user.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(input, { target: { value: "2026-12-02" } });
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("This date is already in the list.")).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Public holidays" });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector("bdi")!.textContent)).toEqual(["2026-12-02", "2026-12-03"]);

    await user.type(screen.getByLabelText(/Reason for the change/), "National Day");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("calendar.public_holidays", ["2026-12-02", "2026-12-03"], "National Day", 2));
  });
});
