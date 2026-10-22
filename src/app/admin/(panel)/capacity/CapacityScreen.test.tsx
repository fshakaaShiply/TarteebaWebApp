import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapacitySlot, CapacityView, SlotRuleSnapshot, Vehicle } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { CapacityScreen } from "./CapacityScreen";

const api = { fetchCapacity: vi.fn(), overrideCapacity: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchCapacity: (...a: unknown[]) => api.fetchCapacity(...a),
  overrideCapacity: (...a: unknown[]) => api.overrideCapacity(...a),
  fetchAllVehicles: async (): Promise<Vehicle[]> => [
    {
      id: 1,
      plate_no: "DEMO-VAN-1",
      model: "Toyota Hiace",
      seats: 7,
      insurance_expires_at: null,
      registration_expires_at: null,
      status: "active",
      zone_id: 1,
      zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } },
      default_driver_id: null,
      version: 1,
      created_at: null,
      updated_at: null,
    },
  ],
  fetchAllWorkers: async () => [],
  fetchAllZones: async () => [],
  fetchAllServices: async () => [],
}));

const slot = (over: Partial<CapacitySlot>): CapacitySlot => ({
  slot_template_id: 1,
  code: "MORNING",
  name: { ar: "الفترة الصباحية", en: "Morning" },
  start: "10:00",
  end: "14:00",
  service_kind: "standard_visit",
  is_active: true,
  service: { id: 1, code: "STANDARD_VISIT" },
  status: "available",
  reason: null,
  available_workers: 5,
  reserved_workers: 2,
  reserved_competing: 0,
  remaining_workers: 3,
  vehicles: [{ id: 1, seats: 7, reserved_seats: 2, free: 5 }],
  max_single_vehicle_free: 5,
  total_free_seats: 5,
  bookings_count: 1,
  max_bookings: null,
  rule: null,
  max_workers_fit: 3,
  holds: { active: 0, converted: 1 },
  zone_workers: 6,
  excluded: { not_active: 0, rest_day: 1, leave: 0 },
  ...over,
});

// GET /admin/capacity for DEMO_BB (CapacityBreakdown): one open slot, one closed by a blackout.
const view: CapacityView = {
  date: "2026-10-24",
  zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } },
  timezone: "Asia/Dubai",
  travel_buffer_minutes: 30,
  live_out_block_scope: "whole_day",
  slots: [
    slot({}),
    slot({ slot_template_id: 2, code: "EVENING", name: { ar: "الفترة المسائية", en: "Evening" }, start: "15:00", end: "19:00", status: "closed", reason: "blackout" }),
  ],
};

const consoleError = vi.spyOn(console, "error");

describe("capacity view and manual override", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchCapacity.mockResolvedValue(view);
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("shows each slot's workers, exclusions, seats and booking limit", async () => {
    renderWithProviders(<CapacityScreen />, { permissions: ["schedule.view"] });
    const morning = (await screen.findByRole("heading", { name: "Morning" })).closest("section")!;
    expect(within(morning).getByText("Available")).toBeInTheDocument();
    expect(within(morning).getByText("Rest day:")).toBeInTheDocument();
    expect(within(morning).getByRole("meter", { name: "Seats booked on DEMO-VAN-1" })).toHaveAttribute("aria-valuenow", "2");
    expect(within(morning).getByText("2 of 7 seats booked · 5 free")).toBeInTheDocument();
    expect(within(morning).getByText("1 booking · no limit")).toBeInTheDocument();
    expect(within(morning).getByText("No rule: open with no booking limit")).toBeInTheDocument();
    // No override without capacity.override.
    expect(screen.queryByRole("button", { name: /^Override/ })).not.toBeInTheDocument();
    expect(api.fetchCapacity).toHaveBeenCalledWith({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), zoneId: 1 });
  });

  it("overrides a blackout with a reason of at least 10 characters and an explicit confirmation", async () => {
    api.overrideCapacity.mockResolvedValue({ rule: {}, relaxed: [{ type: "blackout", id: 3 }], capacity: { ...view.slots[1], status: "available" } });
    renderWithProviders(<CapacityScreen />, { permissions: ["schedule.view", "capacity.override"] });
    const user = userEvent.setup();

    const evening = (await screen.findByRole("heading", { name: "Evening" })).closest("section")!;
    expect(within(evening).getByText("Blackout date")).toBeInTheDocument();
    // The open slot has nothing to override.
    const morning = screen.getByRole("heading", { name: "Morning" }).closest("section")!;
    expect(within(morning).queryByRole("button", { name: /^Override/ })).not.toBeInTheDocument();

    // Each card's button names its slot.
    await user.click(within(evening).getByRole("button", { name: "Override Evening, 15:00–19:00" }));
    const dialog = await screen.findByRole("dialog", { name: /Override capacity: Evening/ });
    expect(within(dialog).getByText("Workers and seats stay hard limits")).toBeInTheDocument();
    expect(within(dialog).getByText(/The blackout on .* in Business Bay & Downtown/)).toBeInTheDocument();
    expect(within(dialog).getByText("Applies to every service in this slot.")).toBeInTheDocument();

    const reason = within(dialog).getByLabelText(/^Reason/);
    await user.type(reason, "VIP call");
    await user.click(within(dialog).getByRole("button", { name: "Apply override" }));
    expect(await within(dialog).findByText("Enter a reason of at least 10 characters.")).toBeInTheDocument();
    expect(within(dialog).getByText("Confirm to continue.")).toBeInTheDocument();
    expect(api.overrideCapacity).not.toHaveBeenCalled();
    await waitFor(() => expect(reason).toHaveFocus());

    // With only the confirmation missing, the box gets focus and its error is its description.
    await user.type(reason, " booked by phone");
    await user.click(within(dialog).getByRole("button", { name: "Apply override" }));
    const confirm = within(dialog).getByRole("checkbox", { name: /I understand this override is recorded/ });
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAccessibleDescription("Confirm to continue.");
    expect(api.overrideCapacity).not.toHaveBeenCalled();

    await user.click(confirm);
    await user.click(within(dialog).getByRole("button", { name: "Apply override" }));
    await waitFor(() =>
      expect(api.overrideCapacity).toHaveBeenCalledWith({
        date: "2026-10-24",
        zone_id: 1,
        slot_template_id: 2,
        action: "open",
        reason: "VIP call booked by phone",
      }),
    );
  });

  it("returns focus to the slot's Override button when the dialog closes", async () => {
    renderWithProviders(<CapacityScreen />, { permissions: ["schedule.view", "capacity.override"] });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Override Evening, 15:00–19:00" });
    await user.click(button);
    const dialog = await screen.findByRole("dialog", { name: /Override capacity: Evening/ });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());

    // Cancel too.
    await user.click(button);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("opens a blackout for every service and offers no cap raise while the blackout closes the slot", async () => {
    api.overrideCapacity.mockResolvedValue({ rule: {}, relaxed: [{ type: "blackout", id: 3 }], capacity: null });
    // The card is evaluated for the first service of the kind (CapacityBreakdown), whose own cap rule applies.
    const serviceCap: SlotRuleSnapshot = {
      id: 8,
      slot_template_id: 2,
      zone_id: 1,
      service_id: 1,
      day_of_week: null,
      date_from: null,
      date_to: null,
      is_open: true,
      max_bookings: 4,
      source: "admin",
      reason: null,
      version: 1,
    };
    api.fetchCapacity.mockResolvedValue({ ...view, slots: [{ ...view.slots[1], rule: serviceCap }] });
    renderWithProviders(<CapacityScreen />, { permissions: ["schedule.view", "capacity.override"] });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Override Evening, 15:00–19:00" }));
    const dialog = await screen.findByRole("dialog", { name: /Override capacity: Evening/ });
    // One action only: no "Raise the booking limit" select (the API answers NOTHING_TO_OVERRIDE to it here).
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Open the slot")).toBeInTheDocument();
    expect(within(dialog).getByText("Applies to every service in this slot.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^Reason/), "Corporate event, all hands");
    await user.click(within(dialog).getByRole("checkbox", { name: /I understand/ }));
    await user.click(within(dialog).getByRole("button", { name: "Apply override" }));
    await waitFor(() => expect(api.overrideCapacity).toHaveBeenCalledTimes(1));
    expect(api.overrideCapacity.mock.calls[0][0]).not.toHaveProperty("service_id");
  });

  it("limits the override to the service of a closed rule it relaxes", async () => {
    api.overrideCapacity.mockResolvedValue({ rule: {}, relaxed: [{ type: "rule", id: 8 }], capacity: null });
    const closed: SlotRuleSnapshot = {
      id: 8,
      slot_template_id: 2,
      zone_id: 1,
      service_id: 1,
      day_of_week: null,
      date_from: null,
      date_to: null,
      is_open: false,
      max_bookings: null,
      source: "admin",
      reason: null,
      version: 1,
    };
    api.fetchCapacity.mockResolvedValue({ ...view, slots: [{ ...view.slots[1], reason: "rule_closed", rule: closed }] });
    renderWithProviders(<CapacityScreen />, { permissions: ["schedule.view", "capacity.override"] });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Override Evening, 15:00–19:00" }));
    const dialog = await screen.findByRole("dialog", { name: /Override capacity: Evening/ });
    expect(within(dialog).getByText(/^Applies to STANDARD_VISIT only/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Reason/), "Corporate event, all hands");
    await user.click(within(dialog).getByRole("checkbox", { name: /I understand/ }));
    await user.click(within(dialog).getByRole("button", { name: "Apply override" }));
    await waitFor(() => expect(api.overrideCapacity).toHaveBeenCalledWith(expect.objectContaining({ service_id: 1, action: "open" })));
  });

  it("renders in Arabic", async () => {
    renderWithProviders(<CapacityScreen />, { permissions: ["schedule.view"], locale: "ar" });
    expect(await screen.findByRole("heading", { name: "الفترة الصباحية" })).toBeInTheDocument();
    expect(screen.getByText("يوم إغلاق")).toBeInTheDocument();
  });
});
