import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { Setting } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { SettingEditDialog } from "./SettingEditDialog";

const updateSetting = vi.fn();
vi.mock("@/lib/admin/endpoints", () => ({
  updateSetting: (...args: unknown[]) => updateSetting(...args),
}));

const setting = (over: Partial<Setting>): Setting => ({
  key: "booking.hold_minutes",
  value: 15,
  type: "int",
  group: "booking",
  description: "Capacity hold while the customer pays",
  version: 3,
  updated_at: null,
  ...over,
});

function open(s: Setting) {
  const onClose = vi.fn();
  const onStale = vi.fn();
  renderWithProviders(
    <SettingEditDialog setting={s} onClose={onClose} onStale={onStale} />,
  );
  return { onClose, onStale, user: userEvent.setup() };
}

describe("SettingEditDialog", () => {
  // Block body: a function returned from beforeEach would run as a teardown hook.
  beforeEach(() => {
    updateSetting.mockReset();
  });

  it("uses our bilingual label and requires a reason", async () => {
    const { user } = open(setting({}));
    expect(
      screen.getByRole("dialog", { name: "Edit: Hold while paying (minutes)" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Enter the reason for this change."),
    ).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("validates whole numbers before saving and sends the loaded version", async () => {
    updateSetting.mockResolvedValue({
      key: "booking.hold_minutes",
      value: 20,
      type: "int",
      version: 4,
    });
    const { user, onClose } = open(setting({}));

    const value = screen.getByLabelText("Value");
    await user.clear(value);
    await user.type(value, "1.5");
    await user.type(
      screen.getByLabelText(/Reason for the change/),
      "Ops request",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Enter a whole number."),
    ).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();

    await user.clear(value);
    await user.type(value, "20");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateSetting).toHaveBeenCalledWith(
        "booking.hold_minutes",
        20,
        "Ops request",
        3,
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("edits money in AED and saves integer fils", async () => {
    updateSetting.mockResolvedValue({
      key: "fee",
      value: 4550,
      type: "money_fils",
      version: 2,
    });
    const { user } = open(
      setting({
        key: "fee",
        type: "money_fils",
        value: 1200,
        description: "A fee",
      }),
    );

    const value = screen.getByLabelText("Value");
    expect(value).toHaveValue("12.00");
    await user.clear(value);
    await user.type(value, "45.505");
    await user.type(screen.getByLabelText(/Reason for the change/), "New fee");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Use at most two decimals."),
    ).toBeInTheDocument();

    await user.clear(value);
    await user.type(value, "45.5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateSetting).toHaveBeenCalledWith("fee", 4550, "New fee", 3),
    );
  });

  it("checks JSON time ranges", async () => {
    const { user } = open(
      setting({
        key: "live_out.window",
        type: "time_range",
        value: { start: "09:00", end: "18:00" },
        group: "scheduling",
      }),
    );

    const value = screen.getByLabelText("Value");
    await user.clear(value);
    await user.click(value);
    await user.paste('{"start":"18:00","end":"09:00"}');
    await user.type(screen.getByLabelText(/Reason for the change/), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("The end time must be after the start time."),
    ).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();
  });

  it("toggles booleans with a switch", async () => {
    updateSetting.mockResolvedValue({
      key: "coupons.allow_stacking",
      value: true,
      type: "bool",
      version: 2,
    });
    const { user } = open(
      setting({
        key: "coupons.allow_stacking",
        type: "bool",
        value: false,
        group: "catalog",
      }),
    );

    const toggle = screen.getByRole("switch", { name: "Value" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.type(screen.getByLabelText(/Reason for the change/), "Allow it");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateSetting).toHaveBeenCalledWith(
        "coupons.allow_stacking",
        true,
        "Allow it",
        3,
      ),
    );
  });

  it("hands STALE_VERSION to the page so it can ask for a reload", async () => {
    updateSetting.mockImplementation(async () => {
      throw new AdminApiError(409, {
        code: "STALE_VERSION",
        message: "",
        details: {},
      });
    });
    const { user, onStale } = open(setting({}));

    await user.type(screen.getByLabelText(/Reason for the change/), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onStale).toHaveBeenCalled());
  });

  it("shows the API's INVALID_SETTING_VALUE on the value", async () => {
    updateSetting.mockImplementation(async () => {
      throw new AdminApiError(422, {
        code: "INVALID_SETTING_VALUE",
        message: "",
        details: {},
      });
    });
    const { user } = open(setting({}));

    await user.type(screen.getByLabelText(/Reason for the change/), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This value isn't valid for this setting."),
    ).toBeInTheDocument();
  });
});
