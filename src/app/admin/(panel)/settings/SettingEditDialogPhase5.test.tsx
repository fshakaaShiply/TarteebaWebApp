import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Setting } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { SettingEditDialog } from "./SettingEditDialog";
import { SettingValue } from "./SettingsScreen";

const updateSetting = vi.fn();
vi.mock("@/lib/admin/endpoints", () => ({
  updateSetting: (...args: unknown[]) => updateSetting(...args),
  fetchSettings: vi.fn(),
}));

const setting = (over: Partial<Setting>): Setting => ({
  key: "complaint.window_days",
  value: 14,
  type: "int",
  group: "quality",
  description: null,
  version: 5,
  updated_at: "2026-11-18T10:00:00+00:00",
  ...over,
});

const SLA = {
  urgent: { first_response: 30, resolution: 240 },
  high: { first_response: 120, resolution: 720 },
  medium: { first_response: 240, resolution: 1440 },
  low: { first_response: 720, resolution: 2880 },
};
const PRIORITIES = {
  quality: "medium",
  lateness: "medium",
  conduct: "high",
  damage: "high",
  billing: "medium",
  other: "low",
  support: "low",
  rating_1: "high",
  rating_2: "medium",
  rating_3: "low",
  rating_4: "low",
};

function open(s: Setting, locale: "ar" | "en" = "en") {
  renderWithProviders(<SettingEditDialog setting={s} onClose={vi.fn()} onStale={vi.fn()} />, { locale });
  return { user: userEvent.setup() };
}

const reasonBox = () => screen.getByLabelText(/Reason for the change/);

describe("Phase 5 settings dialogs", () => {
  beforeEach(() => {
    cleanup();
    updateSetting.mockReset();
  });

  it("checks a number against the API's range before saving (complaint window 1 to 90)", async () => {
    updateSetting.mockResolvedValue({ key: "complaint.window_days", value: 30, type: "int", version: 6 });
    const { user } = open(setting({}));
    expect(screen.getByRole("dialog", { name: "Edit: Days after the visit (or cancellation) a complaint can be opened" })).toBeInTheDocument();
    expect(screen.getByText("A whole number from 1 to 90.")).toBeInTheDocument();
    const value = screen.getByLabelText("Value");
    await user.clear(value);
    await user.type(value, "91");
    await user.type(reasonBox(), "Longer window");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a whole number from 1 to 90.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
    await user.clear(value);
    await user.type(value, "30");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("complaint.window_days", 30, "Longer window", 5));
  });

  it("refuses to clear a key that now has a range, even when the stored value is null", async () => {
    const { user } = open(setting({ key: "rating.low_threshold", value: null }));
    expect(screen.queryByText(/Leave it empty/)).not.toBeInTheDocument();
    await user.type(reasonBox(), "Fix");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a value.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("turns the wallet on with a switch", async () => {
    updateSetting.mockResolvedValue({ key: "wallet.enabled", value: true, type: "bool", version: 6 });
    const { user } = open(setting({ key: "wallet.enabled", type: "bool", value: false, group: "finance" }));
    await user.click(screen.getByRole("switch"));
    await user.type(reasonBox(), "Owner decision");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("wallet.enabled", true, "Owner decision", 5));
  });

  it("picks the complaint clock from its two choices", async () => {
    updateSetting.mockResolvedValue({ key: "complaint.sla_clock", value: "calendar", type: "string", version: 6 });
    const { user } = open(setting({ key: "complaint.sla_clock", type: "string", value: "working_hours" }));
    await user.selectOptions(screen.getByLabelText("Value"), "Round the clock");
    await user.type(reasonBox(), "Weekend cover");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("complaint.sla_clock", "calendar", "Weekend cover", 5));
  });

  it("edits the deadlines per priority and saves exactly the four priorities", async () => {
    updateSetting.mockResolvedValue({ key: "complaint.sla_targets", value: SLA, type: "json", version: 6 });
    const { user } = open(setting({ key: "complaint.sla_targets", type: "json", value: SLA }));
    const urgent = screen.getByRole("group", { name: "Urgent" });
    const first = within(urgent).getByLabelText("First reply");
    expect(first).toHaveValue("30");
    await user.clear(first);
    await user.type(first, "20");
    await user.type(reasonBox(), "Faster urgent replies");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateSetting).toHaveBeenCalledWith("complaint.sla_targets", { ...SLA, urgent: { first_response: 20, resolution: 240 } }, "Faster urgent replies", 5),
    );
  });

  it("refuses a resolution shorter than the first reply and an out-of-range target", async () => {
    const { user } = open(setting({ key: "complaint.sla_targets", type: "json", value: SLA }));
    const urgent = screen.getByRole("group", { name: "Urgent" });
    const first = within(urgent).getByLabelText("First reply");
    await user.clear(first);
    await user.type(first, "300");
    await user.type(reasonBox(), "Test");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The resolution can't be shorter than the first reply.")).toBeInTheDocument();
    await user.clear(first);
    await user.type(first, "2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Each target is from 5 to 20160 minutes.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("edits the starting priority of one category and keeps all 11 keys", async () => {
    updateSetting.mockResolvedValue({ key: "complaint.default_priorities", value: PRIORITIES, type: "json", version: 6 });
    const { user } = open(setting({ key: "complaint.default_priorities", type: "json", value: PRIORITIES }));
    expect(screen.getAllByRole("combobox")).toHaveLength(11);
    await user.selectOptions(screen.getByLabelText("Lateness"), "High");
    await user.type(reasonBox(), "Lateness matters");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateSetting).toHaveBeenCalledWith("complaint.default_priorities", { ...PRIORITIES, lateness: "high" }, "Lateness matters", 5),
    );
  });

  it("offers the three compensation options as checkboxes and saves the subset in order", async () => {
    updateSetting.mockResolvedValue({ key: "compensation.types", value: ["refund", "free_visit"], type: "list", version: 6 });
    const { user } = open(setting({ key: "compensation.types", type: "list", value: ["refund", "credit", "free_visit"] }));
    expect(screen.getByRole("group", { name: "Value" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Balance credit" }));
    await user.type(reasonBox(), "Wallet is off");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("compensation.types", ["refund", "free_visit"], "Wallet is off", 5));
  });

  it("edits the document reminders as a descending list of at most three", async () => {
    updateSetting.mockResolvedValue({ key: "documents.expiry_reminder_days", value: [30, 7], type: "list", version: 6 });
    const { user } = open(setting({ key: "documents.expiry_reminder_days", type: "list", value: [7], group: "workforce" }));
    const input = screen.getByRole("textbox", { name: "Value" });
    await user.type(input, "30{Enter}");
    await user.type(reasonBox(), "Earlier reminder");
    await user.click(screen.getByRole("button", { name: "Save" }));
    // 7, 30 is not descending.
    expect(await screen.findByText("Put the values in descending order, without repeats.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /7/ }));
    await user.type(screen.getByRole("textbox", { name: "Value" }), "7{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("documents.expiry_reminder_days", [30, 7], "Earlier reminder", 5));
  });

  it("edits the waitlist quiet hours as two times, across midnight", async () => {
    updateSetting.mockResolvedValue({ key: "waitlist.quiet_hours", value: { from: "23:00", to: "08:00" }, type: "time_range", version: 6 });
    const { user } = open(setting({ key: "waitlist.quiet_hours", type: "time_range", value: { to: "08:00", from: "22:00" }, group: "booking" }));
    const from = screen.getByLabelText("From");
    expect(from).toHaveValue("22:00");
    expect(screen.getByLabelText("To")).toHaveValue("08:00");
    await user.clear(from);
    await user.type(from, "23:00");
    await user.type(reasonBox(), "Later quiet start");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("waitlist.quiet_hours", { from: "23:00", to: "08:00" }, "Later quiet start", 5));
  });

  it("refuses a quiet hour left blank", async () => {
    const { user } = open(setting({ key: "waitlist.quiet_hours", type: "time_range", value: { from: "22:00", to: "08:00" } }));
    await user.clear(screen.getByLabelText("To"));
    await user.type(reasonBox(), "Test");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter both times in 24-hour format, for example 22:00.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("shows the API's own refusal of a value (INVALID_SETTING_VALUE) on the field", async () => {
    const { AdminApiError } = await import("@/lib/admin/client");
    updateSetting.mockRejectedValue(new AdminApiError(422, { code: "INVALID_SETTING_VALUE", message: "Not allowed.", details: { key: "incentives.compute_day_of_month" } }));
    const { user } = open(setting({ key: "incentives.compute_day_of_month", value: 5, group: "workforce" }));
    await user.type(reasonBox(), "Try");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This value isn't valid for this setting.")).toBeInTheDocument();
  });

  it("renders the deadlines editor and its labels in Arabic", () => {
    open(setting({ key: "complaint.sla_targets", type: "json", value: SLA }), "ar");
    expect(screen.getByRole("dialog", { name: "تعديل: مهلة الرد الأول ومهلة الحل لكل أولوية، بالدقائق" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "عاجلة" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("الرد الأول")).toHaveLength(4);
  });

  it("shows the new values on the settings list", () => {
    renderWithProviders(
      <>
        <SettingValue setting={setting({ key: "complaint.sla_targets", type: "json", value: SLA })} />
        <SettingValue setting={setting({ key: "complaint.default_priorities", type: "json", value: PRIORITIES })} />
        <SettingValue setting={setting({ key: "compensation.types", type: "list", value: ["refund", "free_visit"] })} />
        <SettingValue setting={setting({ key: "waitlist.quiet_hours", type: "time_range", value: { to: "08:00", from: "22:00" } })} />
      </>,
    );
    expect(screen.getByText("first reply 30 min · resolution 240 min")).toBeInTheDocument();
    expect(screen.getByText("Conduct, Damage or loss, Rated 1 star")).toBeInTheDocument();
    expect(screen.getByText("Money back")).toBeInTheDocument();
    expect(screen.getByText("Free re-clean")).toBeInTheDocument();
    expect(screen.getByText("22:00–08:00")).toBeInTheDocument();
  });

  it("says when there are no quiet hours", () => {
    renderWithProviders(<SettingValue setting={setting({ key: "waitlist.quiet_hours", type: "time_range", value: { from: "09:00", to: "09:00" } })} />);
    expect(screen.getByText("No quiet hours")).toBeInTheDocument();
  });
});
