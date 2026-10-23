import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { bookingDetail, serviceOptions, visitCandidates, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { AssignmentPanel } from "./AssignmentPanel";

const api = { fetchVisitCandidates: vi.fn(), assignWorkers: vi.fn(), replaceWorker: vi.fn(), unassignWorker: vi.fn(), setVisitStatus: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchVisitCandidates: (...a: unknown[]) => api.fetchVisitCandidates(...a),
  assignWorkers: (...a: unknown[]) => api.assignWorkers(...a),
  replaceWorker: (...a: unknown[]) => api.replaceWorker(...a),
  unassignWorker: (...a: unknown[]) => api.unassignWorker(...a),
  setVisitStatus: (...a: unknown[]) => api.setVisitStatus(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchAllVehicles: async () => [],
  fetchAllSlotTemplates: async () => [],
  fetchCapacity: async () => ({ slots: [] }),
}));

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const MANAGER = ["bookings.view", "assignments.manage", "schedule.view"];
const consoleError = vi.spyOn(console, "error");

describe("assignment panel (§8.5–§8.7)", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates(2));
    api.assignWorkers.mockResolvedValue(visitCandidates(0).visit);
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("names exactly the missing number of cleaners, ranked with their reasons", async () => {
    renderWithProviders(<AssignmentPanel booking={bookingDetail()} />, { permissions: MANAGER });
    const user = userEvent.setup();
    const assign = await screen.findByRole("button", { name: "Assign 2 cleaners" });
    expect(assign).toBeDisabled();
    expect(screen.getAllByText("Based in the visit's zone.")).toHaveLength(3);

    await user.click(screen.getByRole("checkbox", { name: "Assign Maria S." }));
    expect(assign).toBeDisabled();
    expect(screen.getByText("Choose 1 more")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Assign Nirmala P." }));
    expect(assign).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Assign Tigist B." })).toBeDisabled();

    await user.click(assign);
    await waitFor(() => expect(api.assignWorkers).toHaveBeenCalledWith(4, [1, 4], 1, {}));
    expect(await screen.findByText("2 cleaners assigned.")).toBeInTheDocument();
  });

  it("relaxes a soft rule (another zone) only with capacity.override and a reason of 10 characters", async () => {
    renderWithProviders(<AssignmentPanel booking={bookingDetail()} />, { permissions: [...MANAGER, "capacity.override"] });
    const user = userEvent.setup();
    await user.click(await screen.findByText("Not suggested (2)"));
    // On leave is a hard rule: never selectable.
    expect(screen.queryByRole("checkbox", { name: "Assign Rosa M. with an override" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Assign Joy R. with an override" }));
    await user.click(screen.getByRole("checkbox", { name: "Assign Maria S." }));
    await user.click(screen.getByRole("button", { name: "Assign 2 cleaners" }));

    const dialog = screen.getByRole("alertdialog", { name: "Override needed" });
    expect(dialog).toHaveTextContent("Joy R.: Based in another zone");
    expect(api.assignWorkers).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole("textbox", { name: /Override reason/ }), "short");
    await user.click(within(dialog).getByRole("button", { name: "Assign with override" }));
    expect(within(dialog).getByText("An override needs a reason of at least 10 characters.")).toBeInTheDocument();

    await user.type(within(dialog).getByRole("textbox", { name: /Override reason/ }), " – Maria's cousin covers Arabian Ranches");
    await user.click(within(dialog).getByRole("button", { name: "Assign with override" }));
    await waitFor(() =>
      expect(api.assignWorkers).toHaveBeenCalledWith(4, [7, 1], 1, { override: true, reason: "short – Maria's cousin covers Arabian Ranches" }),
    );
  });

  it("says who can override when the API answers OVERRIDE_REQUIRED, and that a busy cleaner never can", async () => {
    api.assignWorkers
      .mockRejectedValueOnce(apiError(409, "OVERRIDE_REQUIRED", { workers: [{ worker_id: 1, rules: ["travel_buffer"] }], can_override: false }))
      .mockRejectedValueOnce(apiError(409, "RESOURCE_CONFLICT", { resource_type: "worker", holder_type: "visit", holder_id: 9, date: "2026-10-24" }));
    renderWithProviders(<AssignmentPanel booking={bookingDetail()} />, { permissions: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Assign Maria S." }));
    await user.click(screen.getByRole("checkbox", { name: "Assign Nirmala P." }));
    await user.click(screen.getByRole("button", { name: "Assign 2 cleaners" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Override needed" });
    expect(dialog).toHaveTextContent("Maria S.: Not enough travel time between visits");
    expect(dialog).toHaveTextContent("only someone with the capacity override permission can relax");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Assign 2 cleaners" }));
    expect(await screen.findByText("This can't be overridden: a cleaner can never be in two places at once.")).toBeInTheDocument();
  });

  it("replaces a named cleaner with a reason", async () => {
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates(1));
    api.replaceWorker.mockResolvedValue(visitCandidates(1).visit);
    renderWithProviders(<AssignmentPanel booking={bookingDetail()} />, { permissions: MANAGER });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Replace Lakshmi N." }));
    const dialog = screen.getByRole("alertdialog", { name: "Replace Lakshmi N." });
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    expect(within(dialog).getByText("Choose a value.")).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByRole("combobox", { name: /New cleaner/ }), "1");
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Sick today");
    await user.click(within(dialog).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(api.replaceWorker).toHaveBeenCalledWith(4, { worker_id: 3, new_worker_id: 1, reason: "Sick today" }, 1));
  });

  it("removes a cleaner past a pool shortfall only with an override", async () => {
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates(1));
    api.unassignWorker
      .mockRejectedValueOnce(
        apiError(409, "CAPACITY_SHORTFALL", {
          shortfalls: [{ date: "2026-10-24", zone_id: 1, slot_template_id: 1, slot: "MORNING", kind: "workers", reserved: 3, available: 2 }],
          can_override: true,
        }),
      )
      .mockResolvedValueOnce(visitCandidates(2).visit);
    renderWithProviders(<AssignmentPanel booking={bookingDetail()} />, { permissions: [...MANAGER, "capacity.override"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Lakshmi N. from the visit" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove Lakshmi N. from this visit?" });
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Sick");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.unassignWorker).toHaveBeenCalledWith(4, 3, "Sick", 1, false));

    await user.click(await within(dialog).findByRole("checkbox", { name: "Remove anyway (override)" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove anyway" }));
    expect(within(dialog).getByText("An override needs a reason of at least 10 characters.")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), " and no cover");
    await user.click(within(dialog).getByRole("button", { name: "Remove anyway" }));
    await waitFor(() => expect(api.unassignWorker).toHaveBeenLastCalledWith(4, 3, "Sick and no cover", 1, true));
  });

  it("shows the team without candidates to a role that cannot assign or read them", async () => {
    renderWithProviders(<AssignmentPanel booking={bookingDetail({ status: "confirmed" })} />, { permissions: ["bookings.view"] });
    expect(screen.getByText("No cleaner is assigned yet.")).toBeInTheDocument();
    expect(api.fetchVisitCandidates).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Assign/ })).not.toBeInTheDocument();
  });
});
