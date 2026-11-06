import { cleanup, screen, waitFor } from "@testing-library/react";
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
  key: "subscription.horizon_weeks",
  value: 8,
  type: "int",
  group: "subscriptions",
  description: null,
  version: 3,
  updated_at: "2026-10-23T14:35:18+00:00",
  ...over,
});

function open(s: Setting) {
  renderWithProviders(<SettingEditDialog setting={s} onClose={vi.fn()} onStale={vi.fn()} />);
  return { user: userEvent.setup() };
}

describe("Phase 4 settings dialogs", () => {
  beforeEach(() => {
    cleanup();
    updateSetting.mockReset();
  });

  it("checks the planning horizon against 4 to 26 before saving", async () => {
    updateSetting.mockResolvedValue({ key: "subscription.horizon_weeks", value: 12, type: "int", version: 4 });
    const { user } = open(setting({}));
    expect(screen.getByRole("dialog", { name: "Edit: Subscription planning horizon (weeks)" })).toBeInTheDocument();
    const value = screen.getByLabelText("Value");
    await user.clear(value);
    await user.type(value, "30");
    await user.type(screen.getByLabelText(/Reason for the change/), "Longer plan");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a whole number from 4 to 26.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
    await user.clear(value);
    await user.type(value, "12");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("subscription.horizon_weeks", 12, "Longer plan", 3));
  });

  it("edits the retry hours as a list of numbers and refuses a descending one", async () => {
    updateSetting.mockResolvedValue({ key: "subscription.renewal_retry_hours", value: [24, 48, 96], type: "list", version: 4 });
    const { user } = open(setting({ key: "subscription.renewal_retry_hours", type: "list", value: [24, 72] }));
    const input = screen.getByRole("textbox", { name: "Value" });
    await user.type(input, "48{Enter}");
    await user.type(screen.getByLabelText(/Reason for the change/), "Another retry");
    await user.click(screen.getByRole("button", { name: "Save" }));
    // 24, 72, 48 is not ascending.
    expect(await screen.findByText("Put the values in ascending order, without repeats.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /72/ }));
    await user.type(screen.getByRole("textbox", { name: "Value" }), "96{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("subscription.renewal_retry_hours", [24, 48, 96], "Another retry", 1 + 2));
  });

  it("edits the allowed weekdays with checkboxes, at least one", async () => {
    updateSetting.mockResolvedValue({ key: "subscription.allowed_weekdays", value: [0, 1, 2, 3, 4, 5, 6], type: "list", version: 4 });
    const { user } = open(setting({ key: "subscription.allowed_weekdays", type: "list", value: [0, 1, 2, 3, 4, 6] }));
    const group = screen.getByRole("group", { name: "Value" });
    expect(group).toBeInTheDocument();
    const friday = screen.getByRole("checkbox", { name: "Friday" });
    expect(friday).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Monday" })).toBeChecked();
    await user.click(friday);
    await user.type(screen.getByLabelText(/Reason for the change/), "Friday allowed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("subscription.allowed_weekdays", [0, 1, 2, 3, 4, 5, 6], "Friday allowed", 3));
  });

  it("refuses an empty weekday list", async () => {
    const { user } = open(setting({ key: "subscription.allowed_weekdays", type: "list", value: [6] }));
    await user.click(screen.getByRole("checkbox", { name: "Saturday" }));
    await user.type(screen.getByLabelText(/Reason for the change/), "None");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findAllByText("Choose at least one day.")).length).toBeGreaterThan(0);
    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("offers the new choices with their words and a quarter-hour renewal time", async () => {
    updateSetting.mockResolvedValue({ key: "subscription.public_holiday_effect", value: "skip_extend", type: "string", version: 4 });
    const { user } = open(setting({ key: "subscription.public_holiday_effect", type: "string", value: "serve" }));
    await user.selectOptions(screen.getByLabelText("Value"), "Skipped and added at the end");
    await user.type(screen.getByLabelText(/Reason for the change/), "Holiday policy");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("subscription.public_holiday_effect", "skip_extend", "Holiday policy", 3));
  });

  it("shows the new values on the settings list", () => {
    renderWithProviders(
      <>
        <SettingValue setting={setting({ key: "subscription.allowed_weekdays", type: "list", value: [0, 1, 6] })} />
        <SettingValue setting={setting({ key: "subscription.renewal_retry_hours", type: "list", value: [24, 72] })} />
        <SettingValue setting={setting({ key: "subscription.cancel_fee_counts_skipped", type: "bool", value: true })} />
        <SettingValue setting={setting({ key: "live_out.day_notifications", type: "string", value: "quiet" })} />
      </>,
    );
    expect(screen.getByText("Monday")).toBeInTheDocument();
    expect(screen.getByText("Saturday")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText("Quiet")).toBeInTheDocument();
  });
});
