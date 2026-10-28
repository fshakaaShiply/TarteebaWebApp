import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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

// GET /admin/settings rows seeded by SettingsDefaults "Operations (Phase 3)".
const setting = (over: Partial<Setting>): Setting => ({
  key: "booking.alternative_proposal_hours",
  value: 24,
  type: "int",
  group: "booking",
  description: "How long a customer has to answer proposed alternative times (C31)",
  version: 1,
  updated_at: "2026-10-23T14:35:18+00:00",
  ...over,
});

function open(s: Setting) {
  const onClose = vi.fn();
  renderWithProviders(<SettingEditDialog setting={s} onClose={onClose} onStale={vi.fn()} />);
  return { onClose, user: userEvent.setup() };
}

describe("Phase 3 settings editors", () => {
  beforeEach(() => {
    updateSetting.mockReset();
  });

  it("labels the Phase 3 keys in our words and edits whole numbers", async () => {
    updateSetting.mockResolvedValue({ key: "visit.auto_start_after_min", value: 10, type: "int", version: 2 });
    const { user } = open(setting({ key: "visit.auto_start_after_min", value: 0, group: "operations" }));
    expect(screen.getByRole("dialog", { name: "Edit: Start visits automatically (minutes after arrival)" })).toBeInTheDocument();
    const value = screen.getByLabelText("Value");
    await user.clear(value);
    await user.type(value, "10");
    await user.type(screen.getByLabelText(/Reason for the change/), "Teams start late");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("visit.auto_start_after_min", 10, "Teams start late", 1));
  });

  it("edits the day-before reminder as a 24-hour time", async () => {
    updateSetting.mockResolvedValue({ key: "reminder.day_before_time", value: "17:30", type: "string", version: 2 });
    const { user } = open(setting({ key: "reminder.day_before_time", type: "string", value: "18:00", group: "notifications" }));
    const value = screen.getByLabelText("Value");
    expect(value).toHaveAttribute("type", "time");
    expect(value).toHaveValue("18:00");
    // A time input is set as a whole (the browser's picker), not typed character by character.
    fireEvent.change(value, { target: { value: "17:30" } });
    await user.type(screen.getByLabelText(/Reason for the change/), "Earlier reminder");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("reminder.day_before_time", "17:30", "Earlier reminder", 1));
  });

  it("edits the refund estimate in Arabic and English and needs both", async () => {
    updateSetting.mockResolvedValue({ key: "refund.estimated_arrival_text", value: {}, type: "json", version: 2 });
    const { user } = open(
      setting({
        key: "refund.estimated_arrival_text",
        type: "json",
        group: "finance",
        value: { ar: "خلال 5 إلى 10 أيام عمل", en: "within 5 to 10 business days" },
      }),
    );
    const group = screen.getByRole("group", { name: "Value" });
    const arabic = within(group).getByLabelText("Arabic text");
    const english = within(group).getByLabelText("English text");
    expect(arabic).toHaveAttribute("dir", "rtl");
    expect(english).toHaveValue("within 5 to 10 business days");

    await user.clear(english);
    await user.type(screen.getByLabelText(/Reason for the change/), "Provider is faster");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the text in both Arabic and English.")).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();

    await user.clear(arabic);
    await user.type(arabic, "خلال 3 إلى 5 أيام عمل");
    await user.type(english, "within 3 to 5 business days");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateSetting).toHaveBeenCalledWith(
        "refund.estimated_arrival_text",
        { ar: "خلال 3 إلى 5 أيام عمل", en: "within 3 to 5 business days" },
        "Provider is faster",
        1,
      ),
    );
  });

  it("switches the confirmation SMS on and off", async () => {
    updateSetting.mockResolvedValue({ key: "notifications.sms_on_confirm", value: false, type: "bool", version: 2 });
    const { user } = open(setting({ key: "notifications.sms_on_confirm", type: "bool", value: true, group: "notifications" }));
    expect(screen.getByRole("dialog", { name: "Edit: Text message on confirmation" })).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Value" }));
    await user.type(screen.getByLabelText(/Reason for the change/), "Cost");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("notifications.sms_on_confirm", false, "Cost", 1));
  });

  it.each([
    ["round.plan_extra_rounds", "Draft an extra round when a van has already left", /listed as not planned/, "تجهيز جولة إضافية إذا كانت السيارة قد انطلقت"],
    ["round.extra_round_prefer_other_van", "Put the extra round on another free van first", /another van that is free and has the seats/, "وضع الجولة الإضافية على سيارة أخرى متاحة أولًا"],
  ])("labels the trip planner switch %s in both languages and switches it", async (key, english, describes, arabic) => {
    updateSetting.mockResolvedValue({ key, value: false, type: "bool", version: 2 });
    // Our label and description replace the API's own description.
    const row = setting({ key, type: "bool", value: true, group: "operations", description: "API description" });
    const { user } = open(row);
    const dialog = screen.getByRole("dialog", { name: `Edit: ${english}` });
    expect(dialog).toHaveTextContent(describes);
    expect(dialog).not.toHaveTextContent("API description");
    await user.click(screen.getByRole("switch", { name: "Value" }));
    await user.type(screen.getByLabelText(/Reason for the change/), "Ops trial");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith(key, false, "Ops trial", 1));

    cleanup();
    renderWithProviders(<SettingEditDialog setting={row} onClose={vi.fn()} onStale={vi.fn()} />, { locale: "ar" });
    expect(screen.getByRole("dialog", { name: new RegExp(arabic) })).toBeInTheDocument();
  });

  it("shows the time and both texts in the settings list", () => {
    renderWithProviders(
      <>
        <SettingValue setting={setting({ key: "reminder.day_before_time", type: "string", value: "18:00" })} />
        <SettingValue setting={setting({ key: "refund.estimated_arrival_text", type: "json", value: { ar: "خلال 5 إلى 10 أيام عمل", en: "within 5 to 10 business days" } })} />
      </>,
    );
    expect(screen.getByText("18:00")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("خلال 5 إلى 10 أيام عمل")).toHaveAttribute("lang", "ar");
    expect(screen.getByText("within 5 to 10 business days")).toHaveAttribute("lang", "en");
  });
});
