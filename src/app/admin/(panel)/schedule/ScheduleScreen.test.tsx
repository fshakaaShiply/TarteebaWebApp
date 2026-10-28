import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { ScheduleQuery } from "@/lib/admin/endpoints";
import type { MoveCheckResult, ScheduleGrid, VisitSummary } from "@/lib/admin/types";
import { bookingDetail, serviceOptions, visitCandidates, zoneOptions } from "@/test/bookingFixtures";
import { capacityView, confirmedCard, dayBoard, monthBoard, slotPickList, weekBoard } from "@/test/opsBoardFixtures";
import { renderWithProviders } from "@/test/render";
import { ScheduleScreen } from "./ScheduleScreen";

// The page URL: useSearchParams follows history.replaceState like Next's own integration does.
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
    usePathname: () => "/admin/schedule",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = {
  fetchSchedule: vi.fn(),
  validateMove: vi.fn(),
  moveVisit: vi.fn(),
  fetchBooking: vi.fn(),
  fetchCapacity: vi.fn(),
  rescheduleBooking: vi.fn(),
  previewReschedule: vi.fn(),
  fetchVisitCandidates: vi.fn(),
  confirmBooking: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchSchedule: (...a: unknown[]) => api.fetchSchedule(...a),
  validateMove: (...a: unknown[]) => api.validateMove(...a),
  moveVisit: (...a: unknown[]) => api.moveVisit(...a),
  fetchBooking: (...a: unknown[]) => api.fetchBooking(...a),
  fetchCapacity: (...a: unknown[]) => api.fetchCapacity(...a),
  rescheduleBooking: (...a: unknown[]) => api.rescheduleBooking(...a),
  previewReschedule: (...a: unknown[]) => api.previewReschedule(...a),
  fetchVisitCandidates: (...a: unknown[]) => api.fetchVisitCandidates(...a),
  confirmBooking: (...a: unknown[]) => api.confirmBooking(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchSlotTemplateOptions: async () => slotPickList(),
  fetchAllWorkers: async () => [],
  fetchAllVehicles: async () => [{ id: 1, plate_no: "DEMO-VAN-1", seats: 7, status: "active" }],
}));

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const MANAGER = ["schedule.view", "assignments.manage", "bookings.view", "bookings.reschedule", "workers.view"];
/** POST /admin/bookings/{id}/reschedule/preview: a staff move at the same price. */
const reschedulePreview = {
  allowed: true,
  blockers: [],
  requires_approval: false,
  fee_fils: 0,
  price_diff_fils: 0,
  new_total_fils: 24000,
  refund_fils: 0,
  paid_fils: 24000,
  kept_fees_fils: 0,
  currency: "AED",
  availability: { status: "available", reason: null },
  rule_applied: "staff",
  explanation: "",
};
const consoleError = vi.spyOn(console, "error");
const dataTransfer = () => ({ setData: vi.fn(), getData: vi.fn(), dropEffect: "none", effectAllowed: "all" });

const rowOf = (name: string) => screen.getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;
const cardIn = (row: HTMLElement, reference: string) => within(row).getByText(reference).closest<HTMLElement>("[data-visit-card]")!;
const cell = (workerId: number | "lane", date: string, slot: number | "any") =>
  document.querySelector<HTMLElement>(`[data-drop-target="${workerId}:${date}:${slot}"]`)!;
/** validate-move's "fine" answer: `details` is always an object, {} here. */
const OK: MoveCheckResult = { result: "ok", conflicts: [], rules: [], can_override: false, details: {} };

/** TRB-K2M9QX after Tigist replaced Maria: shown in Tigist's and Nirmala's rows, no longer in Maria's (version 4). */
function boardAfterMove(): ScheduleGrid {
  const board = dayBoard();
  const moved: VisitSummary = {
    ...confirmedCard(),
    version: 4,
    workers: [{ id: 5, display_name: "Tigist B.", full_name: { ar: "Tigist", en: "Tigist" }, assigned_at: "2026-10-24T08:00:00+00:00" }, confirmedCard().workers[1]],
  };
  board.rows = board.rows.map((r) => ({
    ...r,
    days: r.days.map((d) => ({ ...d, cards: r.worker.id === 1 ? [] : r.worker.id === 5 || r.worker.id === 4 ? [moved] : d.cards })),
  }));
  return board;
}

/** Drags `from` onto `to` the way a browser fires it. */
function dragTo(from: HTMLElement, to: HTMLElement) {
  const transfer = dataTransfer();
  fireEvent.dragStart(from, { dataTransfer: transfer });
  fireEvent.dragOver(to, { dataTransfer: transfer });
  fireEvent.drop(to, { dataTransfer: transfer });
  fireEvent.dragEnd(from, { dataTransfer: transfer });
}

describe("A04 operations schedule", () => {
  let replaceState: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // The board leaves today's date out of the URL; the expectations rely on "today" (Dubai) being the day before the
    // fixtures' 24 October, which the clock pin in vitest.setup.ts provides whatever the real date.
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchSchedule.mockImplementation(async (q: ScheduleQuery) => (q.view === "month" ? monthBoard() : q.view === "week" ? weekBoard() : dayBoard()));
    api.moveVisit.mockResolvedValue(confirmedCard());
    api.previewReschedule.mockResolvedValue(reschedulePreview);
    api.fetchCapacity.mockImplementation(async ({ date }: { date: string }) => capacityView(date));
    replaceState = vi.spyOn(window.history, "replaceState").mockImplementation((_data, _unused, next) => url.set(String(next)));
    url.set("/admin/schedule?date=2026-10-24");
  });
  afterEach(() => {
    replaceState.mockRestore();
    url.set("/admin/schedule");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("shows the day: slot columns, cleaner rows with their cards and markers, and the unassigned lane", async () => {
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    expect(await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Evening · 15:00–19:00" })).toBeInTheDocument();
    expect(api.fetchSchedule).toHaveBeenCalledWith({
      view: "day",
      date: "2026-10-24",
      zoneId: null,
      serviceId: null,
      slotTemplateId: null,
      workerId: null,
      statuses: [],
    });

    const lane = rowOf("Visits missing cleaners");
    const pending = cardIn(lane, "TRB-R4RYSD");
    expect(pending).toHaveTextContent("Pending confirmation");
    expect(pending).toHaveTextContent("0 of 2 cleaners · 2 missing");
    await waitFor(() => expect(pending).toHaveTextContent("Van DEMO-VAN-1"));
    expect(cardIn(rowOf("Maria S."), "TRB-K2M9QX")).toHaveTextContent("Cleaners assigned");
    expect(cardIn(rowOf("Nirmala P."), "TRB-K2M9QX")).toHaveTextContent("Maria S., Nirmala P.");
    expect(within(rowOf("Siti R.")).getAllByText("Rest day")).toHaveLength(2);
    expect(within(rowOf("Grace N.")).getAllByText("Live-out day")).toHaveLength(2);
    expect(within(rowOf("Tigist B.")).getAllByText("Free")).toHaveLength(2);
  });

  it("switches to the week (date columns) and the month (counts per day), keeping the view in the URL", async () => {
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    await user.click(screen.getByRole("tab", { name: "Week" }));
    expect(url.get().get("view")).toBe("week");
    expect(await screen.findByRole("columnheader", { name: "Mon, 19 Oct 2026" })).toBeInTheDocument();
    expect(cardIn(rowOf("Maria S."), "TRB-K2M9QX")).toHaveTextContent("15:00–19:00");
    expect(screen.getByText("Mon, 19 Oct 2026 – Sun, 25 Oct 2026")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Month" }));
    expect(url.get().get("view")).toBe("month");
    const day = await screen.findByRole("button", { name: "Open Saturday, 24 October 2026 in the day view" });
    const cellOf24 = day.closest("td")!;
    expect(cellOf24).toHaveTextContent("2 bookings");
    expect(cellOf24).toHaveTextContent("1 visit missing cleaners");
    expect(cellOf24).toHaveTextContent("Morning: 40% booked");
    expect(cellOf24).toHaveTextContent("Evening: nothing to sell");

    await user.click(day);
    expect(url.get().get("view")).toBeNull();
    expect(url.get().get("date")).toBe("2026-10-24");
  });

  it("keeps the filters in the URL and sends them to the API", async () => {
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Visit status" }), "worker_assigned");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Service" }), "1");
    expect(url.get().toString()).toBe("date=2026-10-24&service_id=1&status=worker_assigned");
    await waitFor(() => expect(api.fetchSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ serviceId: 1, statuses: ["worker_assigned"] })));

    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(url.get().get("date")).toBe("2026-10-25");
  });

  it("filters by slot from the slot pick-list: active slots only, without loading a day board for them", async () => {
    url.set("/admin/schedule?date=2026-10-24&view=week");
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    const slot = screen.getByRole("combobox", { name: "Slot" });
    await within(slot).findByRole("option", { name: "Evening · 15:00–19:00" });
    expect(within(slot).getAllByRole("option").map((o) => o.textContent)).toEqual(["All slots", "Morning · 10:00–14:00", "Evening · 15:00–19:00"]);
    await user.selectOptions(slot, "2");
    expect(url.get().get("slot_template_id")).toBe("2");
    await waitFor(() => expect(api.fetchSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ view: "week", slotTemplateId: 2 })));
    expect(api.fetchSchedule.mock.calls.every(([q]) => q.view === "week")).toBe(true);
  });

  it("names the month's slots from the slot pick-list", async () => {
    url.set("/admin/schedule?date=2026-10-24&view=month");
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const day = await screen.findByRole("button", { name: "Open Saturday, 24 October 2026 in the day view" });
    await waitFor(() => expect(day.closest("td")).toHaveTextContent("Morning: 40% booked"));
    expect(api.fetchSchedule.mock.calls.every(([q]) => q.view === "month")).toBe(true);
  });

  it("checks a drop first, then saves the move with the visit's version", async () => {
    api.validateMove.mockResolvedValue(OK);
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    dragTo(cardIn(rowOf("Maria S."), "TRB-K2M9QX"), cell(5, "2026-10-24", 2));
    const move = { visit_id: 7, from_worker_id: 1, to_worker_id: 5, date: "2026-10-24", slot_template_id: 2 };
    await waitFor(() => expect(api.validateMove).toHaveBeenCalledWith(move));
    await waitFor(() => expect(api.moveVisit).toHaveBeenCalledWith(move, 3, {}));
    expect(await screen.findByText("Tigist B. replaces Maria S. on TRB-K2M9QX.")).toBeInTheDocument();
  });

  it("shows why a drop is refused and saves nothing", async () => {
    api.validateMove.mockResolvedValue({
      result: "conflicts",
      conflicts: [{ code: "rest_day", message: "This is the worker's weekly rest day." }],
      rules: [],
      can_override: false,
      details: {},
    });
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    dragTo(cardIn(rowOf("Visits missing cleaners"), "TRB-R4RYSD"), cell(2, "2026-10-24", 1));
    const alert = (await screen.findByText("TRB-R4RYSD can't go to Siti R.")).closest<HTMLElement>('[role="alert"]')!;
    expect(alert).toHaveTextContent("Rest day");
    expect(alert).toHaveTextContent("Nothing was saved.");
    expect(api.validateMove).toHaveBeenCalledWith({ visit_id: 4, from_worker_id: null, to_worker_id: 2, date: "2026-10-24", slot_template_id: 1 });
    expect(api.moveVisit).not.toHaveBeenCalled();
  });

  it("does not offer the card's own cell or its team's at the visit's time as a drop target", async () => {
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });
    dragTo(cardIn(rowOf("Maria S."), "TRB-K2M9QX"), cell(4, "2026-10-24", 2));
    dragTo(cardIn(rowOf("Maria S."), "TRB-K2M9QX"), cell(1, "2026-10-24", 2));
    expect(api.validateMove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reschedules a card dropped on another slot of its own row, without a team change", async () => {
    const booking = bookingDetail({ id: 9, reference: "TRB-K2M9QX", status: "confirmed", visits: [{ ...bookingDetail().visits[0], id: 7, status: "worker_assigned" }] });
    api.fetchBooking.mockResolvedValue(booking);
    api.rescheduleBooking.mockResolvedValue({ reschedule_request: {}, booking });
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    // Maria's own row, the morning instead of the evening: before, her own row was never a drop target.
    dragTo(cardIn(rowOf("Maria S."), "TRB-K2M9QX"), cell(1, "2026-10-24", 1));
    const dialog = await screen.findByRole("dialog", { name: "Reschedule TRB-K2M9QX" });
    // The time change is the booking's (USE_RESCHEDULE): no team move is checked or sent.
    expect(api.validateMove).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(/New date/)).toHaveValue("2026-10-24");
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: /New time/ })).toHaveValue("1"));
    expect(dialog).not.toHaveTextContent("isn't added to the team");

    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Customer asked for the morning");
    // The booking's reschedule dialog checks the dropped time first and sends its terms back (expected_*).
    expect(await within(dialog).findByText("What changes")).toBeInTheDocument();
    expect(api.previewReschedule).toHaveBeenCalledWith(9, { service_date: "2026-10-24", slot_template_id: 1 });
    await user.click(within(dialog).getByRole("button", { name: "Reschedule" }));
    await waitFor(() =>
      expect(api.rescheduleBooking).toHaveBeenCalledWith(
        9,
        { service_date: "2026-10-24", slot_template_id: 1, reason: "Customer asked for the morning", expected_fee_fils: 0, expected_new_total_fils: 24000 },
        3,
        expect.any(String),
      ),
    );
    expect(api.moveVisit).not.toHaveBeenCalled();
  });

  it("says a drop on another cleaner at another time moves only the time", async () => {
    api.fetchBooking.mockResolvedValue(
      bookingDetail({ id: 9, reference: "TRB-K2M9QX", status: "confirmed", visits: [{ ...bookingDetail().visits[0], id: 7, status: "worker_assigned" }] }),
    );
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    dragTo(cardIn(rowOf("Maria S."), "TRB-K2M9QX"), cell(5, "2026-10-24", 1));
    const dialog = await screen.findByRole("dialog", { name: "Reschedule TRB-K2M9QX" });
    expect(dialog).toHaveTextContent("Only the day and time change here: Tigist B. isn't added to the team.");
    expect(api.validateMove).not.toHaveBeenCalled();
  });

  it("takes a lane card dropped on another slot of the lane to the reschedule hand-off", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail());
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    dragTo(cardIn(rowOf("Visits missing cleaners"), "TRB-R4RYSD"), cell("lane", "2026-10-24", 2));
    const handoff = await screen.findByRole("dialog", { name: "Move TRB-R4RYSD to another day or time" });
    expect(await within(handoff).findByText(/Only a confirmed booking whose visit hasn't started can be rescheduled/)).toBeInTheDocument();
    expect(api.validateMove).not.toHaveBeenCalled();
  });

  it("asks for an override reason when only soft rules stand in the way", async () => {
    api.validateMove.mockResolvedValue({ result: "override_possible", conflicts: [], rules: ["other_zone"], can_override: true, details: {} });
    renderWithProviders(<ScheduleScreen />, { permissions: [...MANAGER, "capacity.override"] });
    const user = userEvent.setup();
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    dragTo(cardIn(rowOf("Maria S."), "TRB-K2M9QX"), cell(5, "2026-10-24", 2));
    const dialog = await screen.findByRole("dialog", { name: "Move TRB-K2M9QX" });
    expect(dialog).toHaveTextContent("Override needed");
    expect(dialog).toHaveTextContent("Based in another zone");
    expect(within(dialog).getByRole("combobox", { name: /New cleaner/ })).toHaveValue("5");

    await user.type(within(dialog).getByRole("textbox", { name: /Override reason/ }), "short");
    await user.click(within(dialog).getByRole("button", { name: "Move with override" }));
    expect(within(dialog).getByText("An override needs a reason of at least 10 characters.")).toBeInTheDocument();
    expect(api.moveVisit).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole("textbox", { name: /Override reason/ }), " – Tigist covers Downtown today");
    await user.click(within(dialog).getByRole("button", { name: "Move with override" }));
    await waitFor(() =>
      expect(api.moveVisit).toHaveBeenCalledWith(
        { visit_id: 7, from_worker_id: 1, to_worker_id: 5, date: "2026-10-24", slot_template_id: 2 },
        3,
        { override: true, reason: "short – Tigist covers Downtown today" },
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("moves a card without a mouse: Move, choose a cleaner, check and move", async () => {
    api.validateMove.mockResolvedValue(OK);
    api.moveVisit.mockResolvedValue({ ...dayBoard().unassigned[0], assigned_count: 1, missing: 1 });
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Move TRB-R4RYSD" });
    button.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", { name: "Move TRB-R4RYSD" });
    expect(dialog).toHaveTextContent("the visit still needs 2 cleaners");
    await user.click(within(dialog).getByRole("button", { name: "Check and move" }));
    expect(within(dialog).getByText("Choose a cleaner.")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: /Cleaner/ })).toHaveFocus();

    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Cleaner/ }), "Tigist B.");
    await user.tab();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Check and move" })).toHaveFocus();
    await user.keyboard("{Enter}");
    const move = { visit_id: 4, from_worker_id: null, to_worker_id: 5, date: "2026-10-24", slot_template_id: 1 };
    await waitFor(() => expect(api.moveVisit).toHaveBeenCalledWith(move, 1, {}));
    expect(api.validateMove).toHaveBeenCalledWith(move);
    expect(await screen.findByText("Tigist B. is added to TRB-R4RYSD.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a refused keyboard move in the dialog, where another cleaner can be chosen", async () => {
    api.validateMove.mockResolvedValue({
      result: "conflicts",
      conflicts: [{ code: "live_out", message: "On a Live-out day." }],
      rules: [],
      can_override: false,
      details: {},
    });
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Move TRB-R4RYSD" }));
    const dialog = await screen.findByRole("dialog", { name: "Move TRB-R4RYSD" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Cleaner/ }), "Grace N.");
    await user.click(within(dialog).getByRole("button", { name: "Check and move" }));
    expect(await within(dialog).findByText("On a Live-out day")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("This move isn't allowed");
    expect(api.moveVisit).not.toHaveBeenCalled();
  });

  it("still hands over to the reschedule dialog when the API answers USE_RESCHEDULE (the card was out of date)", async () => {
    api.validateMove.mockRejectedValue(apiError(422, "USE_RESCHEDULE", { visit_id: 7, booking_id: 9, service_date: "2026-10-25", slot_template_id: 2 }));
    api.fetchBooking.mockResolvedValue(
      bookingDetail({ id: 9, reference: "TRB-K2M9QX", status: "confirmed", visits: [{ ...bookingDetail().visits[0], id: 7, status: "worker_assigned" }] }),
    );
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    dragTo(cardIn(rowOf("Maria S."), "TRB-K2M9QX"), cell(5, "2026-10-24", 2));
    const dialog = await screen.findByRole("dialog", { name: "Reschedule TRB-K2M9QX" });
    expect(api.validateMove).toHaveBeenCalledWith({ visit_id: 7, from_worker_id: 1, to_worker_id: 5, date: "2026-10-24", slot_template_id: 2 });
    expect(api.fetchBooking).toHaveBeenCalledWith(9);
    expect(within(dialog).getByLabelText(/New date/)).toHaveValue("2026-10-24");
    expect(api.moveVisit).not.toHaveBeenCalled();
  });

  it("explains why a request still pending confirmation can't be moved to another time", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail());
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Move TRB-R4RYSD" }));
    const dialog = await screen.findByRole("dialog", { name: "Move TRB-R4RYSD" });
    await user.click(within(dialog).getByRole("radio", { name: /Another day or time/ }));
    await user.click(within(dialog).getByRole("button", { name: "Continue to reschedule" }));

    const handoff = await screen.findByRole("dialog", { name: "Move TRB-R4RYSD to another day or time" });
    expect(await within(handoff).findByText(/Only a confirmed booking whose visit hasn't started can be rescheduled/)).toBeInTheDocument();
    expect(within(handoff).getByRole("link", { name: "Open the booking" })).toHaveAttribute("href", "/admin/bookings/4");
    expect(api.validateMove).not.toHaveBeenCalled();
  });

  it("is read-only without assignments.manage, and links to bookings only with bookings.view (HR reads the board)", async () => {
    renderWithProviders(<ScheduleScreen />, { permissions: ["schedule.view"] });
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });
    expect(screen.getByText(/Moving cleaners between visits needs the assignments permission/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    expect(cardIn(rowOf("Maria S."), "TRB-K2M9QX")).toHaveAttribute("draggable", "false");
    dragTo(cardIn(rowOf("Maria S."), "TRB-K2M9QX"), cell(5, "2026-10-24", 2));
    expect(api.validateMove).not.toHaveBeenCalled();
    // The reference is plain text: the booking page (and the review panel) would only deny this role.
    expect(within(cardIn(rowOf("Maria S."), "TRB-K2M9QX")).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /TRB-/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Review / })).not.toBeInTheDocument();
  });

  it("colours the day markers as the design does, never with a booking or visit status tone", async () => {
    const board = dayBoard();
    board.rows = board.rows.map((r) =>
      r.worker.id === 5 ? { ...r, days: r.days.map((d) => ({ ...d, markers: [{ code: "leave", label: { ar: "إجازة", en: "On leave" }, leave_type: "annual" as const }] })) } : r,
    );
    api.fetchSchedule.mockResolvedValue(board);
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });
    const liveOut = within(rowOf("Grace N.")).getAllByText("Live-out day")[0];
    expect(liveOut).toHaveClass("bg-sage-100");
    const leave = within(rowOf("Tigist B.")).getAllByText(/On leave/)[0];
    expect(leave).toHaveClass("bg-neutral-100");
    for (const badge of [liveOut, leave, within(rowOf("Siti R.")).getAllByText("Rest day")[0]]) {
      expect(badge).not.toHaveClass("bg-apricot-100");
      expect(badge).not.toHaveClass("bg-petrol-50");
    }
  });

  it("keeps the zone in the URL beside the filters, adopting a linked one and writing back a new choice", async () => {
    url.set("/admin/schedule?date=2026-10-24&zone_id=2");
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });
    expect(api.fetchSchedule).toHaveBeenCalledWith(expect.objectContaining({ zoneId: 2 }));
    expect(api.fetchSchedule).not.toHaveBeenCalledWith(expect.objectContaining({ zoneId: null }));
    expect(url.get().get("zone_id")).toBe("2");

    // Another filter keeps the zone in the link.
    await user.selectOptions(screen.getByRole("combobox", { name: "Visit status" }), "worker_assigned");
    expect(url.get().toString()).toBe("date=2026-10-24&zone_id=2&status=worker_assigned");

    const zone = await screen.findByRole("combobox", { name: "Zone" });
    await within(zone).findByRole("option", { name: "Business Bay & Downtown" });
    await user.selectOptions(zone, "1");
    await waitFor(() => expect(url.get().get("zone_id")).toBe("1"));
    await waitFor(() => expect(api.fetchSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ zoneId: 1 })));
    await user.selectOptions(zone, "");
    await waitFor(() => expect(url.get().has("zone_id")).toBe(false));
    expect(url.get().toString()).toBe("date=2026-10-24&status=worker_assigned");
  });

  it("reloads the board on a stale keyboard move, so the next try sends the visit's new version", async () => {
    let server = dayBoard();
    api.fetchSchedule.mockImplementation(async () => server);
    api.validateMove.mockResolvedValue(OK);
    api.moveVisit.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 4 })).mockResolvedValueOnce(confirmedCard());
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });
    // Meanwhile someone else changed the visit: the server has version 4.
    server = dayBoard();
    server.rows = server.rows.map((r) => ({ ...r, days: r.days.map((d) => ({ ...d, cards: d.cards.map((c) => ({ ...c, version: 4 })) })) }));
    const calls = api.fetchSchedule.mock.calls.length;

    await user.click(within(rowOf("Maria S.")).getByRole("button", { name: "Move TRB-K2M9QX" }));
    let dialog = await screen.findByRole("dialog", { name: "Move TRB-K2M9QX" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /New cleaner/ }), "Tigist B.");
    await user.click(within(dialog).getByRole("button", { name: "Check and move" }));
    await waitFor(() => expect(api.moveVisit).toHaveBeenCalledWith(expect.objectContaining({ to_worker_id: 5 }), 3, {}));
    // The dialog closes, the board says so and reloads (before, the dialog stayed with the old version).
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("The visit changed meanwhile. The schedule is reloaded; try again.")).toBeInTheDocument();
    await waitFor(() => expect(api.fetchSchedule.mock.calls.length).toBeGreaterThan(calls));

    await user.click(within(rowOf("Maria S.")).getByRole("button", { name: "Move TRB-K2M9QX" }));
    dialog = await screen.findByRole("dialog", { name: "Move TRB-K2M9QX" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /New cleaner/ }), "Tigist B.");
    await user.click(within(dialog).getByRole("button", { name: "Check and move" }));
    await waitFor(() => expect(api.moveVisit).toHaveBeenLastCalledWith(expect.objectContaining({ to_worker_id: 5 }), 4, {}));
  });

  it("keeps keyboard focus on the moved card: its Move button in the new row once the board reloads", async () => {
    let server = dayBoard();
    api.fetchSchedule.mockImplementation(async () => server);
    api.validateMove.mockResolvedValue(OK);
    api.moveVisit.mockImplementation(async () => {
      server = boardAfterMove();
      return { ...confirmedCard(), version: 4 };
    });
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" });

    within(rowOf("Maria S.")).getByRole("button", { name: "Move TRB-K2M9QX" }).focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Move TRB-K2M9QX" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /New cleaner/ }), "Tigist B.");
    await user.click(within(dialog).getByRole("button", { name: "Check and move" }));
    await waitFor(() => expect(within(rowOf("Tigist B.")).getByRole("button", { name: "Move TRB-K2M9QX" })).toBeInTheDocument());
    expect(within(rowOf("Maria S.")).queryByText("TRB-K2M9QX")).not.toBeInTheDocument();
    await waitFor(() => expect(within(rowOf("Tigist B.")).getByRole("button", { name: "Move TRB-K2M9QX" })).toHaveFocus());
  });

  it("gives focus back to the card's Move button after the reschedule hand-off", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail());
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    const move = await screen.findByRole("button", { name: "Move TRB-R4RYSD" });
    move.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Move TRB-R4RYSD" });
    await user.click(within(dialog).getByRole("radio", { name: /Another day or time/ }));
    await user.click(within(dialog).getByRole("button", { name: "Continue to reschedule" }));
    const handoff = await screen.findByRole("dialog", { name: "Move TRB-R4RYSD to another day or time" });
    await within(handoff).findByText(/Only a confirmed booking/);
    await user.click(within(handoff).getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Move TRB-R4RYSD" })).toHaveFocus());
  });

  it("reviews a card's booking beside the board: the request, the availability check, notes and the actions", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail({ preferred_worker: { id: 5, display_name: "Tigist B." } }));
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates(2));
    api.confirmBooking.mockResolvedValue(bookingDetail({ status: "confirmed", version: 4 }));
    renderWithProviders(<ScheduleScreen />, { permissions: [...MANAGER, "bookings.confirm", "bookings.reject", "bookings.propose_alternative"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Review TRB-R4RYSD" }));

    const drawer = await screen.findByRole("dialog", { name: "Review booking" });
    expect(await within(drawer).findByRole("heading", { level: 3, name: /TRB-R4RYSD/ })).toBeInTheDocument();
    expect(api.fetchBooking).toHaveBeenCalledWith(4);
    expect(drawer).toHaveTextContent("Pending confirmation");
    expect(drawer).toHaveTextContent("Sara Ahmed · Unit 1203");
    // A preference, never a promise (spec §16).
    expect(drawer).toHaveTextContent("Tigist B.");
    expect(drawer).toHaveTextContent("Asked for, not promised");
    expect(drawer).toHaveTextContent("Payment authorized");
    expect(drawer).toHaveTextContent("App");
    // The availability check: the visit's ranked candidates.
    expect(within(drawer).getByRole("heading", { name: "Cleaners" })).toBeInTheDocument();
    expect(await within(drawer).findByText("Nirmala P.")).toBeInTheDocument();
    expect(within(drawer).getByRole("heading", { name: "Internal notes" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Suggest other times" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Open the full booking page" })).toHaveAttribute("href", "/admin/bookings/4");

    await user.click(within(drawer).getByRole("button", { name: "Confirm" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Confirm TRB-R4RYSD?" });
    await user.click(within(confirm).getByRole("button", { name: "Confirm and take payment" }));
    await waitFor(() => expect(api.confirmBooking).toHaveBeenCalledWith(4, 3, expect.any(String)));
    expect(await screen.findByText("TRB-R4RYSD is confirmed.")).toBeInTheDocument();
  });

  it("denies the page without schedule.view and shows a failed load with a retry", async () => {
    const { unmount } = renderWithProviders(<ScheduleScreen />, { permissions: ["bookings.view"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchSchedule).not.toHaveBeenCalled();
    unmount();

    api.fetchSchedule.mockRejectedValueOnce(apiError(500, "SERVER_ERROR"));
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("columnheader", { name: "Morning · 10:00–14:00" })).toBeInTheDocument();
  });

  it("reads in Arabic, right to left", async () => {
    renderWithProviders(<ScheduleScreen />, { permissions: MANAGER, locale: "ar" });
    expect(await screen.findByRole("heading", { level: 1, name: "جدول التشغيل" })).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "الفترة الصباحية · 10:00–14:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "نقل TRB-R4RYSD" })).toBeInTheDocument();
    expect(within(rowOf("Siti R.")).getAllByText("يوم راحة")).toHaveLength(2);
  });
});
