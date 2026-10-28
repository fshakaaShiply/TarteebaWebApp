import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { serviceOptions, zoneOptions } from "@/test/bookingFixtures";
import { dayBoard, driverPickList, planResult, round, slotPickList, vehiclePickList } from "@/test/opsBoardFixtures";
import { renderWithProviders } from "@/test/render";
import { TripPlannerScreen } from "./TripPlannerScreen";

const url = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set(next: string) {
      params = new URLSearchParams(next.split("?")[1] ?? "");
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
    usePathname: () => "/admin/trips",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = {
  fetchRounds: vi.fn(),
  planRounds: vi.fn(),
  updateRound: vi.fn(),
  reorderStops: vi.fn(),
  addStop: vi.fn(),
  removeStop: vi.fn(),
  setPassengers: vi.fn(),
  publishRound: vi.fn(),
  cancelRound: vi.fn(),
  fetchSchedule: vi.fn(),
  fetchSlotTemplateOptions: vi.fn(),
  fetchDriverOptions: vi.fn(),
  fetchVehicleOptions: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchRounds: (...a: unknown[]) => api.fetchRounds(...a),
  planRounds: (...a: unknown[]) => api.planRounds(...a),
  updateRound: (...a: unknown[]) => api.updateRound(...a),
  reorderStops: (...a: unknown[]) => api.reorderStops(...a),
  addStop: (...a: unknown[]) => api.addStop(...a),
  removeStop: (...a: unknown[]) => api.removeStop(...a),
  setPassengers: (...a: unknown[]) => api.setPassengers(...a),
  publishRound: (...a: unknown[]) => api.publishRound(...a),
  cancelRound: (...a: unknown[]) => api.cancelRound(...a),
  // The day board only lists the visits a stop can be added from; slots and drivers come from their pick-lists.
  fetchSchedule: (...a: unknown[]) => api.fetchSchedule(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchSlotTemplateOptions: (...a: unknown[]) => api.fetchSlotTemplateOptions(...a),
  fetchDriverOptions: (...a: unknown[]) => api.fetchDriverOptions(...a),
  // The vans come from their pick-list (trips.manage reads it), never from the fleet list.
  fetchVehicleOptions: (...a: unknown[]) => api.fetchVehicleOptions(...a),
}));

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const PLANNER = ["trips.manage", "schedule.view", "fleet.manage", "bookings.view"];
const consoleError = vi.spyOn(console, "error");

const panel = async () => (await screen.findByRole("heading", { level: 3, name: "Drop-off · DEMO-VAN-1" })).closest("section")!;

describe("A06 trip planner", () => {
  let replaceState: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchRounds.mockResolvedValue([round()]);
    api.fetchSchedule.mockImplementation(async () => dayBoard());
    api.fetchSlotTemplateOptions.mockImplementation(async () => slotPickList());
    api.fetchDriverOptions.mockImplementation(async () => driverPickList());
    api.fetchVehicleOptions.mockImplementation(async () => vehiclePickList());
    for (const fn of [api.updateRound, api.reorderStops, api.addStop, api.removeStop, api.setPassengers, api.publishRound, api.cancelRound]) {
      fn.mockResolvedValue(round({ version: 6 }));
    }
    replaceState = vi.spyOn(window.history, "replaceState").mockImplementation((_data, _unused, next) => url.set(String(next)));
    url.set("/admin/trips?date=2026-10-24&slot_template_id=1");
  });
  afterEach(() => {
    replaceState.mockRestore();
    url.set("/admin/trips");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("shows each round with its van, driver, departure, seat counter and the stops in order with their lateness", async () => {
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const section = await panel();
    expect(api.fetchRounds).toHaveBeenCalledWith({ date: "2026-10-24", slotTemplateId: 1, zoneId: null });
    expect(screen.getByRole("heading", { level: 2, name: "Morning · 10:00–14:00" })).toBeInTheDocument();
    expect(section).toHaveTextContent("Test Driver");
    expect(section).toHaveTextContent("Leaves 09:15 · back by 11:00");
    expect(within(section).getByRole("meter", { name: "Seats taken on DEMO-VAN-1" })).toHaveAttribute("aria-valuenow", "2");
    expect(section).toHaveTextContent("2 of 7 seats");
    expect(section).toHaveTextContent("Not published");

    const first = within(section).getByRole("listitem", { name: "Stop 1 of 2: TRB-K2M9QX" });
    expect(first).toHaveTextContent("Tower 1 · #1203 · Downtown");
    expect(first).toHaveTextContent("Arrives 09:40");
    expect(first).not.toHaveTextContent("late");
    const second = within(section).getByRole("listitem", { name: "Stop 2 of 2: TRB-P7Q1ZZ" });
    expect(second).toHaveTextContent("22 min late");
    expect(second).toHaveTextContent("Stop 2 arrives at 10:22, 22 minutes after the start of the slot; the allowed delay is 15 minutes.");
    expect(second).toHaveTextContent("Stop 2: 1 worker(s) of the team have no seat.");
    expect(within(section).getByRole("img", { name: /Stop order: start at 09:15, then stop 1 TRB-K2M9QX at 09:40, stop 2 TRB-P7Q1ZZ at 10:22/ })).toBeInTheDocument();
  });

  it("drafts the slot's rounds and lists the visits it could not place, with the reason", async () => {
    api.planRounds.mockResolvedValue(planResult());
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    await panel();
    await user.click(screen.getByRole("button", { name: "Draft rounds" }));
    await waitFor(() => expect(api.planRounds).toHaveBeenCalledWith({ date: "2026-10-24", slot_template_id: 1, zone_id: null }));
    // The result names the date and slot it was drafted for.
    const result = (await screen.findByRole("heading", { name: "Draft result · Sat, 24 Oct 2026 · Morning 10:00–14:00" })).closest("section")!;
    expect(result).toHaveTextContent("New rounds: 1 · rounds extended: 0 · visits already planned: 0.");
    expect(result).toHaveTextContent("1 visit not planned");
    expect(within(result).getByRole("link", { name: "TRB-R4RYSD" })).toHaveAttribute("href", "/admin/bookings/4");
    expect(result).toHaveTextContent("The booking isn't confirmed yet.");
    expect(result).toHaveTextContent("Both rides");
  });

  it("counts each visit once, though the API lists its drop-off and its pickup apart", async () => {
    const unplanned = planResult().unplanned[0];
    api.planRounds.mockResolvedValue({
      ...planResult(),
      rounds: [],
      // TRB-41NQR4: one visit, already on a drop-off draft and a pickup draft.
      already_planned: [
        { visit_id: 7, kind: "dropoff", round_id: 11 },
        { visit_id: 7, kind: "pickup", round_id: 12 },
      ],
      // Another visit whose two rides could not be placed, each for its own reason.
      unplanned: [
        { ...unplanned, visit_id: 9, kind: "dropoff", reason: "seats_full" },
        { ...unplanned, visit_id: 9, kind: "pickup", reason: "resource_conflict" },
      ],
    });
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    await panel();
    await user.click(screen.getByRole("button", { name: "Draft rounds" }));
    const result = (await screen.findByRole("heading", { name: /^Draft result/ })).closest("section")!;
    expect(result).toHaveTextContent("New rounds: 0 · rounds extended: 0 · visits already planned: 1.");
    expect(within(result).getByRole("heading", { name: "1 visit not planned" })).toBeInTheDocument();
    // Each ride keeps its own line and reason.
    expect(result).toHaveTextContent("The team doesn't fit the van's free seats.");
    expect(result).toHaveTextContent("The van or the driver is busy: no free departure is left that day.");
  });

  it("keeps a draft's result and refusal with the date and slot it ran for", async () => {
    api.planRounds.mockRejectedValueOnce(new AdminApiError(422, { code: "NOTHING_TO_PLAN", message: "No visit of this slot can be planned.", details: {} }));
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    await panel();
    await user.click(screen.getByRole("button", { name: "Draft rounds" }));
    expect(await screen.findByText("No visit of this slot can be planned.")).toBeInTheDocument();
    // Before, the 24 October refusal stayed on screen for the next day.
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(url.get().get("date")).toBe("2026-10-25");
    await waitFor(() => expect(screen.queryByText("No visit of this slot can be planned.")).not.toBeInTheDocument());

    // A draft that answers after the page moved on shows only on its own date.
    let answer: (value: ReturnType<typeof planResult>) => void = () => undefined;
    api.planRounds.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await user.click(screen.getByRole("button", { name: "Draft rounds" }));
    await waitFor(() => expect(api.planRounds).toHaveBeenLastCalledWith({ date: "2026-10-25", slot_template_id: 1, zone_id: null }));
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(url.get().get("date")).toBe("2026-10-26");
    answer({ ...planResult(), date: "2026-10-25" });
    await waitFor(() => expect(api.fetchRounds).toHaveBeenLastCalledWith({ date: "2026-10-26", slotTemplateId: 1, zoneId: null }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("heading", { name: /^Draft result/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(await screen.findByRole("heading", { name: /^Draft result · Sun, 25 Oct 2026/ })).toBeInTheDocument();
  });

  it("keeps the zone in the URL with the date and slot: a linked zone is adopted, a new choice written back", async () => {
    url.set("/admin/trips?date=2026-10-24&slot_template_id=1&zone_id=1");
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    await panel();
    expect(api.fetchRounds).toHaveBeenCalledWith({ date: "2026-10-24", slotTemplateId: 1, zoneId: 1 });
    expect(api.fetchRounds).not.toHaveBeenCalledWith(expect.objectContaining({ zoneId: null }));
    expect(url.get().toString()).toBe("date=2026-10-24&slot_template_id=1&zone_id=1");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(url.get().toString()).toBe("date=2026-10-25&slot_template_id=1&zone_id=1");
    await waitFor(() => expect(api.fetchRounds).toHaveBeenLastCalledWith({ date: "2026-10-25", slotTemplateId: 1, zoneId: 1 }));

    const zone = screen.getByRole("combobox", { name: "Zone" });
    await within(zone).findByRole("option", { name: "Arabian Ranches" });
    await user.selectOptions(zone, "2");
    await waitFor(() => expect(url.get().toString()).toBe("date=2026-10-25&slot_template_id=1&zone_id=2"));
    await user.selectOptions(zone, "");
    await waitFor(() => expect(url.get().toString()).toBe("date=2026-10-25&slot_template_id=1"));
  });

  it("lets a trips manager without schedule.view pick a slot and draft: the slots come from their pick-list", async () => {
    api.planRounds.mockResolvedValue(planResult());
    url.set("/admin/trips?date=2026-10-24");
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    await panel();
    const slot = screen.getByRole("combobox", { name: "Slot" });
    await within(slot).findByRole("option", { name: "Morning · 10:00–14:00" });
    // Active slots only: the retired one is not offered.
    expect(within(slot).getAllByRole("option").map((o) => o.textContent)).toEqual(["All slots", "Morning · 10:00–14:00", "Evening · 15:00–19:00"]);
    expect(screen.queryByText(/schedule view permission/)).not.toBeInTheDocument();

    await user.selectOptions(slot, "2");
    expect(url.get().get("slot_template_id")).toBe("2");
    await user.click(screen.getByRole("button", { name: "Draft rounds" }));
    await waitFor(() => expect(api.planRounds).toHaveBeenCalledWith({ date: "2026-10-24", slot_template_id: 2, zone_id: null }));
    // No day board is loaded just to list the slots.
    expect(api.fetchSchedule).not.toHaveBeenCalled();
  });

  it("keeps a retired slot from a link selectable, marked inactive", async () => {
    url.set("/admin/trips?date=2026-10-24&slot_template_id=3");
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    await panel();
    const slot = screen.getByRole("combobox", { name: "Slot" });
    expect(await within(slot).findByRole("option", { name: "Night (inactive) · 20:00–23:00" })).toBeInTheDocument();
    expect(slot).toHaveValue("3");
  });

  it("names the extra rounds a draft added because a van's round had already left, with that round's van from the answer", async () => {
    const onRoad = round({ status: "departed", status_label: { ar: "انطلقت", en: "Departed" } });
    api.fetchRounds.mockResolvedValue([onRoad]);
    api.planRounds.mockResolvedValue({
      ...planResult(),
      rounds: [
        // R-19: on another free van, after round #11 (DEMO-VAN-1) left.
        {
          ...round({ id: 12, vehicle: { ...onRoad.vehicle, id: 2, plate_no: "DEMO-VAN-2" }, depart_local: "12:00", follows_round_id: 11, follows_round: { id: 11, plate_no: "DEMO-VAN-1" } }),
          plan: "created",
        },
        // A second trip of a van whose round on the road is not on this page (another zone): the answer still names it.
        {
          ...round({ id: 14, kind: "pickup", kind_label: { ar: "إعادة", en: "Pickup" }, depart_local: "14:15", follows_round_id: 9, follows_round: { id: 9, plate_no: "DEMO-VAN-1" } }),
          plan: "extended",
        },
        { ...round({ id: 15 }), plan: "created" },
      ],
      unplanned: [],
    });
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    await panel();
    await user.click(screen.getByRole("button", { name: "Draft rounds" }));
    const result = (await screen.findByRole("heading", { name: /^Draft result/ })).closest("section")!;
    expect(result).toHaveTextContent("New rounds: 2 · rounds extended: 1");
    // Named by why each exists: round 14 was extended by this run (counted above as extended), not added.
    const extra = within(result).getByRole("heading", { name: "2 extra rounds after a round that had already left" });
    const items = within(extra.parentElement!).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Drop-off · DEMO-VAN-2, departs 12:00: added because round #11 (DEMO-VAN-1) had already left.",
      "Pickup · DEMO-VAN-1, departs 14:15: extended; it runs after round #9 (DEMO-VAN-1), which had already left.",
    ]);
    expect(result).not.toHaveTextContent(/rounds? added because/);
    expect(result).toHaveTextContent("Each is a draft on the same van or on another free van: check its warnings and publish it like any other round.");
  });

  it("still names an extra round after a reload: its panel reads the stored round on the road and its van", async () => {
    api.fetchRounds.mockResolvedValue([
      round({ id: 12, vehicle: { ...round().vehicle, id: 2, plate_no: "DEMO-VAN-2" }, follows_round_id: 41, follows_round: { id: 41, plate_no: "DXB-A-1234" } }),
      round(),
    ]);
    renderWithProviders(<TripPlannerScreen />, { permissions: ["schedule.view"] });
    const extra = (await screen.findByRole("heading", { level: 3, name: "Drop-off · DEMO-VAN-2" })).closest("section")!;
    expect(extra).toHaveTextContent("Extra round: added because round #41 (DXB-A-1234) had already left.");
    // An ordinary round says nothing of the kind.
    expect(await panel()).not.toHaveTextContent("Extra round");
  });

  it("names the extra rounds in Arabic", async () => {
    api.planRounds.mockResolvedValue({
      ...planResult(),
      rounds: [
        { ...round({ id: 12, depart_local: "12:00", follows_round_id: 9, follows_round: { id: 9, plate_no: "DEMO-VAN-1" } }), plan: "created" },
        {
          ...round({ id: 14, kind: "pickup", kind_label: { ar: "إعادة", en: "Pickup" }, depart_local: "14:15", follows_round_id: 9, follows_round: { id: 9, plate_no: "DEMO-VAN-1" } }),
          plan: "extended",
        },
      ],
      unplanned: [],
    });
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER, locale: "ar" });
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 3, name: "توصيل · DEMO-VAN-1" });
    await user.click(screen.getByRole("button", { name: "تجهيز الجولات" }));
    expect(await screen.findByText("جولتان إضافيتان بعد جولة كانت قد انطلقت")).toBeInTheDocument();
    expect(screen.getByText(/أُضيفت لأن الجولة/).textContent).toBe("توصيل · DEMO-VAN-1، تنطلق 12:00: أُضيفت لأن الجولة #9 (DEMO-VAN-1) كانت قد انطلقت.");
    expect(screen.getByText(/مُدّدت، وهي تلي/).textContent).toBe("استلام · DEMO-VAN-1، تنطلق 14:15: مُدّدت، وهي تلي الجولة #9 (DEMO-VAN-1) التي كانت قد انطلقت.");
  });

  it("links stops and unplanned visits to their booking only with bookings.view", async () => {
    api.planRounds.mockResolvedValue(planResult());
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage", "schedule.view"] });
    const user = userEvent.setup();
    const section = await panel();
    expect(within(section).getByRole("listitem", { name: "Stop 1 of 2: TRB-K2M9QX" })).toHaveTextContent("TRB-K2M9QX");
    expect(within(section).queryByRole("link", { name: /TRB-/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Draft rounds" }));
    const result = (await screen.findByRole("heading", { name: /^Draft result/ })).closest("section")!;
    expect(result).toHaveTextContent("TRB-R4RYSD");
    expect(within(result).queryByRole("link")).not.toBeInTheDocument();
  });

  it("needs a slot to draft rounds", async () => {
    url.set("/admin/trips?date=2026-10-24");
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    await panel();
    expect(screen.getByRole("button", { name: "Draft rounds" })).toBeDisabled();
    expect(screen.getByText("Choose a slot to draft its rounds.")).toBeInTheDocument();
  });

  it("says when the slots could not be loaded, instead of offering no slot, and loads them again", async () => {
    api.fetchSlotTemplateOptions.mockRejectedValueOnce(apiError(500, "SERVER_ERROR"));
    url.set("/admin/trips?date=2026-10-24");
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    await panel();
    expect(await screen.findByText("We couldn't load the slots, so none can be chosen.")).toBeInTheDocument();
    expect(screen.queryByText("Choose a slot to draft its rounds.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load the slots again" }));
    const slot = screen.getByRole("combobox", { name: "Slot" });
    expect(await within(slot).findByRole("option", { name: "Morning · 10:00–14:00" })).toBeInTheDocument();
    expect(api.fetchSlotTemplateOptions).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("We couldn't load the slots, so none can be chosen.")).not.toBeInTheDocument();
    expect(screen.getByText("Choose a slot to draft its rounds.")).toBeInTheDocument();
  });

  it("keeps the applied zone in the zone picker when the zone list can't be read (trips.manage only)", async () => {
    url.set("/admin/trips?date=2026-10-24&slot_template_id=1&zone_id=1");
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage"] });
    await panel();
    const zone = screen.getByRole("combobox", { name: "Zone" });
    // Named from the rounds shown (no zone pick-list for this role): never "All zones" while one zone is applied.
    expect(await within(zone).findByRole("option", { name: "Business Bay & Downtown" })).toBeInTheDocument();
    expect(zone).toHaveValue("1");
    expect(api.fetchRounds).toHaveBeenLastCalledWith({ date: "2026-10-24", slotTemplateId: 1, zoneId: 1 });

    const user = userEvent.setup();
    await user.selectOptions(zone, "");
    await waitFor(() => expect(url.get().toString()).toBe("date=2026-10-24&slot_template_id=1"));
    await waitFor(() => expect(api.fetchRounds).toHaveBeenLastCalledWith({ date: "2026-10-24", slotTemplateId: 1, zoneId: null }));
    expect(zone).toHaveValue("");
  });

  it("edits the van, driver and departure: only what changed, with the version as If-Match", async () => {
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Van, driver and time" }));
    const dialog = await screen.findByRole("dialog", { name: "Van, driver and time of DEMO-VAN-1" });
    // Vans out of service are not offered.
    await within(dialog).findByRole("option", { name: "DEMO-VAN-2 · 7 seats" });
    expect(within(dialog).queryByRole("option", { name: /DEMO-VAN-3/ })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Departure time/), { target: { value: "09:30" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateRound).toHaveBeenCalledWith(11, { planned_depart_at: "2026-10-24T09:30:00+04:00" }, 5));
    expect(await screen.findByText("The round of DEMO-VAN-1 is updated.")).toBeInTheDocument();
  });

  it("explains a refused edit and closes on a stale version", async () => {
    api.updateRound
      .mockRejectedValueOnce(apiError(422, "DRIVER_UNAVAILABLE", { driver_id: 2 }))
      .mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 6 }));
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Van, driver and time" }));
    const dialog = await screen.findByRole("dialog", { name: "Van, driver and time of DEMO-VAN-1" });
    await within(dialog).findByRole("option", { name: "Test Driver 2" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Driver" }), "2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("This driver isn't available: the driver or the staff account is inactive.")).toBeInTheDocument();
    expect(api.updateRound).toHaveBeenLastCalledWith(11, { driver_id: 2 }, 5);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/The round of DEMO-VAN-1 changed meanwhile/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers the drivers who can take a round to a trips manager without fleet.manage (driver pick-list)", async () => {
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage", "schedule.view"] });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Van, driver and time" }));
    const dialog = await screen.findByRole("dialog", { name: "Van, driver and time of DEMO-VAN-1" });
    const driver = within(dialog).getByRole("combobox", { name: "Driver" });
    await within(driver).findByRole("option", { name: "Test Driver 2" });
    expect(driver).toBeEnabled();
    expect(within(driver).getAllByRole("option").map((o) => o.textContent)).toEqual(["No driver yet", "Test Driver", "Test Driver 2"]);
    expect(driver).toHaveValue("1");
    expect(dialog).not.toHaveTextContent(/fleet permission/);

    await user.selectOptions(driver, "2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateRound).toHaveBeenCalledWith(11, { driver_id: 2 }, 5));
  });

  it("keeps a round's driver who can no longer take rounds, marked inactive", async () => {
    api.fetchRounds.mockResolvedValue([round({ driver: { id: 3, name: "Retired Driver", phone: null, status: "inactive" } })]);
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Van, driver and time" }));
    const dialog = await screen.findByRole("dialog", { name: "Van, driver and time of DEMO-VAN-1" });
    const driver = within(dialog).getByRole("combobox", { name: "Driver" });
    expect(await within(driver).findByRole("option", { name: "Retired Driver (inactive)" })).toBeInTheDocument();
    expect(driver).toHaveValue("3");
    expect(within(dialog).getByRole("combobox", { name: /Van/ })).toHaveValue("1");
  });

  it("offers the vans that can carry workers to a trips manager without fleet.manage (van pick-list), and changes the van", async () => {
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Van, driver and time" }));
    const dialog = await screen.findByRole("dialog", { name: "Van, driver and time of DEMO-VAN-1" });
    const van = within(dialog).getByRole("combobox", { name: /Van/ });
    await within(van).findByRole("option", { name: "DEMO-VAN-2 · 7 seats" });
    expect(api.fetchVehicleOptions).toHaveBeenCalled();
    // Out-of-service vans (is_active false) are not offered.
    expect(within(van).getAllByRole("option").map((o) => o.textContent)).toEqual(["DEMO-VAN-1 · 7 seats", "DEMO-VAN-2 · 7 seats"]);
    expect(van).toHaveAccessibleDescription("Only active vans can take a round.");
    expect(dialog).not.toHaveTextContent(/permission/);

    await user.selectOptions(van, "2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateRound).toHaveBeenCalledWith(11, { vehicle_id: 2 }, 5));
  });

  it("keeps a round's van that is out of service, marked with its status, so another change saves without moving it", async () => {
    api.fetchRounds.mockResolvedValue([round({ vehicle: { id: 3, plate_no: "DEMO-VAN-3", model: null, seats: 10, status: "maintenance" } })]);
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    const section = (await screen.findByRole("heading", { level: 3, name: "Drop-off · DEMO-VAN-3" })).closest("section")!;
    await user.click(within(section).getByRole("button", { name: "Van, driver and time" }));
    const dialog = await screen.findByRole("dialog", { name: "Van, driver and time of DEMO-VAN-3" });
    const van = within(dialog).getByRole("combobox", { name: /Van/ });
    await within(van).findByRole("option", { name: "DEMO-VAN-1 · 7 seats" });
    expect(within(van).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "DEMO-VAN-1 · 7 seats",
      "DEMO-VAN-2 · 7 seats",
      "DEMO-VAN-3 · 10 seats (In maintenance)",
    ]);
    expect(van).toHaveValue("3");

    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Driver" }), "2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateRound).toHaveBeenCalledWith(11, { driver_id: 2 }, 5));
  });

  it("says when the vans are loading or could not be loaded, and loads them again", async () => {
    let fail = true;
    let answer!: () => void;
    api.fetchVehicleOptions.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answer = () => (fail ? reject(apiError(500, "SERVER_ERROR")) : resolve(vehiclePickList()));
        }),
    );
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Van, driver and time" }));
    const dialog = await screen.findByRole("dialog", { name: "Van, driver and time of DEMO-VAN-1" });
    const van = within(dialog).getByRole("combobox", { name: /Van/ });
    expect(van).toHaveAccessibleDescription("Loading the vans…");

    act(() => answer());
    await waitFor(() => expect(van).toHaveAccessibleDescription("We couldn't load the vans, so only the round's own van is listed."));
    expect(within(van).getAllByRole("option").map((o) => o.textContent)).toEqual(["DEMO-VAN-1 · 7 seats"]);

    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Load the vans again" }));
    await waitFor(() => expect(api.fetchVehicleOptions).toHaveBeenCalledTimes(2));
    act(() => answer());
    expect(await within(van).findByRole("option", { name: "DEMO-VAN-2 · 7 seats" })).toBeInTheDocument();
    expect(van).toHaveAccessibleDescription("Only active vans can take a round.");
    expect(within(dialog).queryByRole("button", { name: "Load the vans again" })).not.toBeInTheDocument();
    expect(van).toHaveValue("1");
  });

  it("says when the drivers are loading or could not be loaded, and loads them again", async () => {
    let fail = true;
    let answer!: () => void;
    api.fetchDriverOptions.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answer = () => (fail ? reject(apiError(500, "SERVER_ERROR")) : resolve(driverPickList()));
        }),
    );
    renderWithProviders(<TripPlannerScreen />, { permissions: ["trips.manage"] });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Van, driver and time" }));
    const dialog = await screen.findByRole("dialog", { name: "Van, driver and time of DEMO-VAN-1" });
    const driver = within(dialog).getByRole("combobox", { name: "Driver" });
    expect(driver).toHaveAccessibleDescription("Loading the drivers…");

    act(() => answer());
    await waitFor(() => expect(driver).toHaveAccessibleDescription("We couldn't load the drivers, so only the round's own driver is listed."));
    expect(dialog).not.toHaveTextContent("Only active drivers can take a round.");
    expect(within(driver).getAllByRole("option").map((o) => o.textContent)).toEqual(["No driver yet", "Test Driver"]);

    fail = false;
    await user.click(within(dialog).getByRole("button", { name: "Load the drivers again" }));
    await waitFor(() => expect(api.fetchDriverOptions).toHaveBeenCalledTimes(2));
    act(() => answer());
    expect(await within(driver).findByRole("option", { name: "Test Driver 2" })).toBeInTheDocument();
    expect(driver).toHaveAccessibleDescription("Only active drivers can take a round.");
    expect(within(dialog).queryByRole("button", { name: "Load the drivers again" })).not.toBeInTheDocument();
    expect(driver).toHaveValue("1");
  });

  it("reorders the stops with the keyboard, keeping focus on the moved stop", async () => {
    const [a, b] = round().stops;
    let server = round();
    api.fetchRounds.mockImplementation(async () => [server]);
    api.reorderStops.mockImplementation(async () => {
      server = round({ version: 6, stops: [{ ...b, sequence: 1 }, { ...a, sequence: 2 }] });
      return server;
    });
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    const section = await panel();
    expect(within(section).getByRole("button", { name: "Move TRB-K2M9QX earlier" })).toBeDisabled();
    within(section).getByRole("button", { name: "Move TRB-P7Q1ZZ earlier" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.reorderStops).toHaveBeenCalledWith(11, [102, 101], 5));
    expect(within(section).getByText("TRB-P7Q1ZZ is now stop 1 of 2.")).toBeInTheDocument();
    // First now: "earlier" is disabled, so focus is on its "later" button.
    await waitFor(() => expect(within(section).getByRole("button", { name: "Move TRB-P7Q1ZZ later" })).toHaveFocus());
  });

  it("reorders the stops by dragging one onto another", async () => {
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const section = await panel();
    const first = within(section).getByRole("listitem", { name: "Stop 1 of 2: TRB-K2M9QX" });
    const second = within(section).getByRole("listitem", { name: "Stop 2 of 2: TRB-P7Q1ZZ" });
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(), dropEffect: "none", effectAllowed: "all" };
    fireEvent.dragStart(second, { dataTransfer });
    fireEvent.dragOver(first, { dataTransfer });
    fireEvent.drop(first, { dataTransfer });
    await waitFor(() => expect(api.reorderStops).toHaveBeenCalledWith(11, [102, 101], 5));
  });

  it("seats the riders by stop; a seat the van doesn't have is never overridable, team rules are with a reason", async () => {
    api.setPassengers
      .mockRejectedValueOnce(apiError(422, "SEAT_OUT_OF_RANGE", { seat_no: 8, seats: 7 }))
      .mockRejectedValueOnce(apiError(409, "OVERRIDE_REQUIRED", { violations: { team_split: [8] }, can_override: true }))
      .mockResolvedValueOnce(round({ version: 6 }));
    renderWithProviders(<TripPlannerScreen />, { permissions: [...PLANNER, "capacity.override"] });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Seats" }));
    const dialog = await screen.findByRole("dialog", { name: "Seats on DEMO-VAN-1" });
    expect(within(dialog).getByRole("combobox", { name: "Seat for Maria S." })).toHaveValue("1");
    expect(within(dialog).getByRole("combobox", { name: "Seat for Tigist B." })).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "Seat everyone in stop order" }));
    expect(within(dialog).getByRole("combobox", { name: "Seat for Tigist B." })).toHaveValue("3");

    await user.click(within(dialog).getByRole("button", { name: "Save seats" }));
    const seats = [
      { worker_id: 1, seat_no: 1 },
      { worker_id: 4, seat_no: 2 },
      { worker_id: 5, seat_no: 3 },
    ];
    await waitFor(() => expect(api.setPassengers).toHaveBeenCalledWith(11, seats, 5, {}));
    expect(await within(dialog).findByText("Seat 8 isn't on this van: it has 7 seats.")).toBeInTheDocument();
    expect(within(dialog).getByText("Seat limits can never be overridden.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "Save with an override" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Save seats" }));
    expect(await within(dialog).findByText("Team split between vans: TRB-P7Q1ZZ.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "Save with an override" }));
    await user.type(within(dialog).getByRole("textbox", { name: /Override reason/ }), "Tigist rides with the second van today");
    await user.click(within(dialog).getByRole("button", { name: "Save with override" }));
    await waitFor(() =>
      expect(api.setPassengers).toHaveBeenLastCalledWith(11, seats, 5, { override: true, reason: "Tigist rides with the second van today" }),
    );
    expect(await screen.findByText("The seats on DEMO-VAN-1 are saved.")).toBeInTheDocument();
  });

  it("refuses the same seat twice before sending", async () => {
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Seats" }));
    const dialog = await screen.findByRole("dialog", { name: "Seats on DEMO-VAN-1" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Seat for Tigist B." }), "1");
    await user.click(within(dialog).getByRole("button", { name: "Save seats" }));
    expect(within(dialog).getByText("Each seat takes one cleaner. Chosen more than once: 1.")).toBeInTheDocument();
    expect(api.setPassengers).not.toHaveBeenCalled();
  });

  it("publishes to the driver, and shows why the API refuses", async () => {
    api.publishRound
      .mockRejectedValueOnce(apiError(409, "DRIVER_UNAVAILABLE", { driver_id: 1, status: "inactive" }))
      .mockResolvedValueOnce(round({ version: 6, published: true, published_at: "2026-10-24T04:00:00+00:00" }));
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    await user.click(within(await panel()).getByRole("button", { name: "Publish to driver" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Publish the round of DEMO-VAN-1?" });
    expect(dialog).toHaveTextContent("Test Driver sees it in the driver app");
    expect(dialog).toHaveTextContent("2 warnings are still open on this round.");
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await within(dialog).findByText("This driver isn't available: the driver or the staff account is inactive.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.publishRound).toHaveBeenLastCalledWith(11, 5));
    expect(await screen.findByText("The round of DEMO-VAN-1 is sent to the driver's app.")).toBeInTheDocument();
  });

  it("adds a stop from the slot's visits, takes one off, and cancels the round with a reason", async () => {
    // The server's round: each change answers the next version, which the next dialog sends as If-Match.
    let server = round();
    const next = async () => {
      server = { ...server, version: server.version + 1 };
      return server;
    };
    api.fetchRounds.mockImplementation(async () => [server]);
    for (const fn of [api.addStop, api.removeStop, api.cancelRound]) fn.mockImplementation(next);
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    const user = userEvent.setup();
    const section = await panel();

    await user.click(within(section).getByRole("button", { name: "Add a stop" }));
    const add = await screen.findByRole("dialog", { name: "Add a stop to DEMO-VAN-1" });
    await user.click(await within(add).findByRole("radio", { name: /TRB-R4RYSD/ }));
    await user.click(within(add).getByRole("button", { name: "Add stop" }));
    await waitFor(() => expect(api.addStop).toHaveBeenCalledWith(11, 4, 5));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(section).getByRole("button", { name: "Take TRB-K2M9QX off this round" }));
    const remove = await screen.findByRole("alertdialog", { name: "Take TRB-K2M9QX off this round?" });
    await user.click(within(remove).getByRole("button", { name: "Take off" }));
    await waitFor(() => expect(api.removeStop).toHaveBeenCalledWith(11, 101, 6));

    await user.click(within(section).getByRole("button", { name: "Cancel round" }));
    const cancel = await screen.findByRole("alertdialog", { name: "Cancel the round of DEMO-VAN-1?" });
    await user.click(within(cancel).getByRole("button", { name: "Cancel round" }));
    expect(within(cancel).getByText("Write at least 3 characters.")).toBeInTheDocument();
    await user.type(within(cancel).getByRole("textbox", { name: /Reason/ }), "Van broke down");
    await user.click(within(cancel).getByRole("button", { name: "Cancel round" }));
    await waitFor(() => expect(api.cancelRound).toHaveBeenCalledWith(11, "Van broke down", 7));
  });

  it("is read-only for schedule viewers", async () => {
    renderWithProviders(<TripPlannerScreen />, { permissions: ["schedule.view"] });
    const section = await panel();
    expect(screen.queryByRole("button", { name: "Draft rounds" })).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /earlier|later|Seats|Publish/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Rounds per date and slot/)).toBeInTheDocument();
  });

  it("shows the empty state and denies the page without trips or schedule permissions", async () => {
    api.fetchRounds.mockResolvedValue([]);
    const { unmount } = renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    expect(await screen.findByText("No rounds for this date yet")).toBeInTheDocument();
    unmount();
    renderWithProviders(<TripPlannerScreen />, { permissions: ["bookings.view"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("reads in Arabic", async () => {
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER, locale: "ar" });
    expect(await screen.findByRole("heading", { level: 3, name: "توصيل · DEMO-VAN-1" })).toBeInTheDocument();
    expect(screen.getByText("2 من 7 مقاعد")).toBeInTheDocument();
    expect(screen.getByText("متأخرة 22 دقيقة")).toBeInTheDocument();
  });
});
