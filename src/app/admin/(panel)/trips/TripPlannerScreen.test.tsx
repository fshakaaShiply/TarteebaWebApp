import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { serviceOptions, zoneOptions } from "@/test/bookingFixtures";
import { dayBoard, planResult, round } from "@/test/opsBoardFixtures";
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
  fetchSchedule: async () => dayBoard(),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchAllVehicles: async () => [
    { id: 1, plate_no: "DEMO-VAN-1", seats: 7, status: "active" },
    { id: 2, plate_no: "DEMO-VAN-2", seats: 7, status: "active" },
    { id: 3, plate_no: "DEMO-VAN-3", seats: 10, status: "maintenance" },
  ],
  fetchAllDrivers: async () => [
    { id: 1, staff_user: { id: 6, name: "Test Driver" }, status: "active" },
    { id: 2, staff_user: { id: 7, name: "Test Driver 2" }, status: "active" },
  ],
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
    const result = (await screen.findByRole("heading", { name: "Draft result" })).closest("section")!;
    expect(result).toHaveTextContent("New rounds: 1 · rounds extended: 0 · visits already planned: 0.");
    expect(result).toHaveTextContent("1 visit not planned");
    expect(within(result).getByRole("link", { name: "TRB-R4RYSD" })).toHaveAttribute("href", "/admin/bookings/4");
    expect(result).toHaveTextContent("The booking isn't confirmed yet.");
    expect(result).toHaveTextContent("Both rides");
  });

  it("adopts a linked zone into the shared zone filter and keeps the date and slot in the URL", async () => {
    url.set("/admin/trips?date=2026-10-24&slot_template_id=1&zone_id=1");
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    await panel();
    expect(api.fetchRounds).toHaveBeenCalledWith({ date: "2026-10-24", slotTemplateId: 1, zoneId: 1 });
    await waitFor(() => expect(url.get().toString()).toBe("date=2026-10-24&slot_template_id=1"));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(url.get().toString()).toBe("date=2026-10-25&slot_template_id=1");
    await waitFor(() => expect(api.fetchRounds).toHaveBeenLastCalledWith({ date: "2026-10-25", slotTemplateId: 1, zoneId: 1 }));
  });

  it("needs a slot to draft rounds", async () => {
    url.set("/admin/trips?date=2026-10-24");
    renderWithProviders(<TripPlannerScreen />, { permissions: PLANNER });
    await panel();
    expect(screen.getByRole("button", { name: "Draft rounds" })).toBeDisabled();
    expect(screen.getByText("Choose a slot to draft its rounds.")).toBeInTheDocument();
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
