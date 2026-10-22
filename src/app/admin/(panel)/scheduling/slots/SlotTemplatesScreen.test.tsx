import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlotTemplate } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { SlotTemplatesScreen } from "./SlotTemplatesScreen";

const api = { fetchSlotTemplates: vi.fn(), updateSlotTemplate: vi.fn(), createSlotTemplate: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchSlotTemplates: (...a: unknown[]) => api.fetchSlotTemplates(...a),
  updateSlotTemplate: (...a: unknown[]) => api.updateSlotTemplate(...a),
  createSlotTemplate: (...a: unknown[]) => api.createSlotTemplate(...a),
}));

// SchedulingSeeder's morning slot.
const morning: SlotTemplate = {
  id: 1,
  code: "MORNING",
  name: { ar: "الفترة الصباحية", en: "Morning" },
  start_time: "10:00",
  end_time: "14:00",
  service_kind: "standard_visit",
  is_active: true,
  sort_order: 1,
  version: 1,
  updated_at: null,
};

describe("A11 slot template editor", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchSlotTemplates.mockResolvedValue({ data: [morning], meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 } });
  });

  it("moves focus to the end time when the time window is the only problem", async () => {
    renderWithProviders(<SlotTemplatesScreen />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Morning" }));
    const editor = await screen.findByRole("dialog", { name: "Edit slot: Morning" });

    const end = within(editor).getByLabelText(/^Ends/);
    await user.selectOptions(end, "09:00");
    await user.click(within(editor).getByRole("button", { name: "Save changes" }));

    // Without the Controller's ref, react-hook-form cannot focus the select and focus stays on Save, unannounced.
    await waitFor(() => expect(end).toHaveFocus());
    expect(end).toHaveAttribute("aria-invalid", "true");
    expect(end).toHaveAccessibleDescription("The end time must be after the start time.");
    expect(api.updateSlotTemplate).not.toHaveBeenCalled();
  });

  it("moves focus to the start time when it is the one off the 15-minute grid", async () => {
    // A stored start off the grid stays selectable but has to be fixed before saving.
    api.fetchSlotTemplates.mockResolvedValue({
      data: [{ ...morning, start_time: "10:10" }],
      meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 },
    });
    renderWithProviders(<SlotTemplatesScreen />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Morning" }));
    const editor = await screen.findByRole("dialog", { name: "Edit slot: Morning" });

    await user.click(within(editor).getByRole("button", { name: "Save changes" }));

    const start = within(editor).getByLabelText(/^Starts/);
    await waitFor(() => expect(start).toHaveFocus());
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(api.updateSlotTemplate).not.toHaveBeenCalled();
  });
});
