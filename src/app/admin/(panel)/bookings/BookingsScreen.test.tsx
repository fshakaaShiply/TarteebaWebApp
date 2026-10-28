import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/admin/types";
import { bookingRow, serviceOptions, slotTemplateOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { BookingsScreen } from "./BookingsScreen";

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
    usePathname: () => "/admin/bookings",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = { fetchBookings: vi.fn(), fetchAllWorkers: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBookings: (...a: unknown[]) => api.fetchBookings(...a),
  fetchAllWorkers: (...a: unknown[]) => api.fetchAllWorkers(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchSlotTemplateOptions: async () => slotTemplateOptions,
  fetchDriverOptions: async () => [
    { id: 3, name: "Omar Driver", status: "active", is_active: true, vehicle: { id: 2, plate_no: "DXB-A-1234" } },
    { id: 5, name: "Old Driver", status: "inactive", is_active: false, vehicle: null },
  ],
}));

const page = (rows = [bookingRow()]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });
const worker = (id: number, name: string, status: Worker["employment_status"] = "active") => ({ id, display_name: name, employment_status: status }) as Worker;

describe("A03 bookings list", () => {
  let replaceState: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    api.fetchBookings.mockReset();
    api.fetchBookings.mockResolvedValue(page());
    api.fetchAllWorkers.mockReset();
    api.fetchAllWorkers.mockResolvedValue([worker(14, "Maria S."), worker(7, "Joy R.", "terminated")]);
    replaceState = vi.spyOn(window.history, "replaceState").mockImplementation((_data, _unused, next) => url.set(String(next)));
  });
  afterEach(() => {
    replaceState.mockRestore();
    url.set("/admin/bookings");
  });

  it("applies the filters a KPI card links with", async () => {
    url.set("/admin/bookings?status=pending_confirmation&from=2026-10-23&to=2026-10-23");
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    expect(await screen.findByRole("link", { name: "TRB-R4RYSD" })).toHaveAttribute("href", "/admin/bookings/4");
    expect(api.fetchBookings).toHaveBeenCalledWith({
      page: 1,
      perPage: 25,
      status: "pending_confirmation",
      paymentStatus: "",
      from: "2026-10-23",
      to: "2026-10-23",
      zoneId: null,
      service: undefined,
      source: "",
      search: undefined,
      cancelReview: undefined,
      slotTemplateId: null,
      workerId: null,
      driverId: null,
    });
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("pending_confirmation");
  });

  it("filters by slot, worker and driver, kept in the URL with the API's names", async () => {
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view", "workers.view"] });
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "TRB-R4RYSD" });

    const slot = screen.getByRole("combobox", { name: "Time" });
    // Every slot of the pick-list, inactive ones marked.
    await waitFor(() => expect(within(slot).getByRole("option", { name: "Evening · 15:00–19:00" })).toBeInTheDocument());
    expect(within(slot).getByRole("option", { name: "Night · 20:00–23:00 (inactive)" })).toBeInTheDocument();
    const cleaner = screen.getByRole("combobox", { name: "Cleaner" });
    await waitFor(() => expect(within(cleaner).getByRole("option", { name: "Maria S." })).toBeInTheDocument());
    // A cleaner who left is marked as such (feminine in Arabic, like every other cleaner label).
    expect(within(cleaner).getByRole("option", { name: "Joy R. (left the company)" })).toBeInTheDocument();
    const driver = screen.getByRole("combobox", { name: "Driver" });
    await waitFor(() => expect(within(driver).getByRole("option", { name: "Omar Driver" })).toBeInTheDocument());

    await user.selectOptions(slot, "2");
    await user.selectOptions(cleaner, "14");
    await user.selectOptions(driver, "3");
    await waitFor(() => expect(url.get().toString()).toBe("slot_template_id=2&worker_id=14&driver_id=3"));
    await waitFor(() =>
      expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ slotTemplateId: 2, workerId: 14, driverId: 3, page: 1 })),
    );
  });

  it("hides the worker filter without workers.view and keeps a linked driver it doesn't list", async () => {
    url.set("/admin/bookings?driver_id=99");
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    await screen.findByRole("link", { name: "TRB-R4RYSD" });
    expect(screen.queryByRole("combobox", { name: "Cleaner" })).not.toBeInTheDocument();
    expect(api.fetchAllWorkers).not.toHaveBeenCalled();
    expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ driverId: 99 }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Driver" })).toHaveValue("99"));
    expect(within(screen.getByRole("combobox", { name: "Driver" })).getByRole("option", { name: "#99" })).toBeInTheDocument();
  });

  it("ignores a linked cleaner filter for users who can't see the Cleaner filter (the list never looks unfiltered)", async () => {
    url.set("/admin/bookings?worker_id=7");
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    await screen.findByRole("link", { name: "TRB-R4RYSD" });
    expect(screen.queryByRole("combobox", { name: "Cleaner" })).not.toBeInTheDocument();
    expect(api.fetchBookings).toHaveBeenCalledTimes(1);
    expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ workerId: null }));
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    // The link keeps it for whoever can see it.
    expect(url.get().get("worker_id")).toBe("7");
  });

  it("applies and shows a linked cleaner filter to users with workers.view, also one it doesn't list", async () => {
    url.set("/admin/bookings?worker_id=8");
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view", "workers.view"] });
    await screen.findByRole("link", { name: "TRB-R4RYSD" });
    expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ workerId: 8 }));
    const cleaner = screen.getByRole("combobox", { name: "Cleaner" });
    await waitFor(() => expect(cleaner).toHaveValue("8"));
    expect(within(cleaner).getByRole("option", { name: "#8" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("searches names and addresses too: the box says so", async () => {
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    const user = userEvent.setup();
    const search = await screen.findByRole("searchbox", { name: "Search" });
    expect(search).toHaveAttribute("placeholder", "Reference, phone, customer name or address");
    await user.type(search, "Sara");
    await waitFor(() => expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Sara" })));
  });

  it("writes each filter to the URL and sends it to the API", async () => {
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "TRB-R4RYSD" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment" }), "verifying");
    await user.selectOptions(screen.getByRole("combobox", { name: "Source" }), "whatsapp");
    await user.click(screen.getByRole("checkbox", { name: "Cancellation reviews only" }));
    await waitFor(() => expect(url.get().toString()).toBe("payment_status=verifying&source=whatsapp&cancel_review=1"));
    await waitFor(() =>
      expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ paymentStatus: "verifying", source: "whatsapp", cancelReview: true })),
    );

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "055 987");
    await waitFor(() => expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ search: "055 987" })));
    expect(url.get().get("search")).toBe("055 987");
  });

  it("adopts the zone of a link as the shared zone filter and keeps it out of the URL", async () => {
    url.set("/admin/bookings?status=held&zone_id=2");
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    await waitFor(() => expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ status: "held", zoneId: 2 })));
    await waitFor(() => expect(url.get().toString()).toBe("status=held"));
    expect(await screen.findByRole("combobox", { name: "Zone" })).toHaveValue("2");
  });

  it("starts another zone on page 1, like every other filter (page 3 of one zone may not exist in the next)", async () => {
    url.set("/admin/bookings?status=confirmed&page=3");
    api.fetchBookings.mockImplementation(async (q: { page: number }) => ({
      data: [bookingRow()],
      meta: { current_page: q.page, per_page: 25, total: 60, last_page: 3 },
    }));
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "TRB-R4RYSD" });
    expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, zoneId: null }));

    api.fetchBookings.mockClear();
    await user.selectOptions(screen.getByRole("combobox", { name: "Zone" }), "2");
    await waitFor(() => expect(url.get().toString()).toBe("status=confirmed"));
    // The new zone is never asked for the old page.
    expect(api.fetchBookings).toHaveBeenCalled();
    for (const [q] of api.fetchBookings.mock.calls) expect(q).toMatchObject({ page: 1, zoneId: 2 });
  });

  it("goes back to the last page when the asked page is past it, instead of saying there are no bookings", async () => {
    url.set("/admin/bookings?page=4");
    api.fetchBookings.mockImplementation(async (q: { page: number }) => ({
      data: q.page > 2 ? [] : [bookingRow()],
      meta: { current_page: q.page, per_page: 25, total: 30, last_page: 2 },
    }));
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    await waitFor(() => expect(url.get().toString()).toBe("page=2"));
    expect(await screen.findByRole("link", { name: "TRB-R4RYSD" })).toBeInTheDocument();
    expect(api.fetchBookings).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it("shows status and payment as two chips, with the confirmation countdown", async () => {
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    const row = (await screen.findByRole("link", { name: "TRB-R4RYSD" })).closest("tr")!;
    expect(within(row).getByText("Pending confirmation")).toBeInTheDocument();
    expect(within(row).getByText("Payment authorized")).toBeInTheDocument();
    expect(within(row).getByText(/^Confirm within/)).toBeInTheDocument();
  });

  it("refuses an end date before the start date without asking the API", async () => {
    url.set("/admin/bookings?from=2026-10-24&to=2026-10-20");
    renderWithProviders(<BookingsScreen />, { permissions: ["bookings.view"] });
    expect((await screen.findAllByText("The end date is before the start date.")).length).toBeGreaterThan(0);
    expect(api.fetchBookings).not.toHaveBeenCalled();
  });

  it("denies users without bookings.view", () => {
    renderWithProviders(<BookingsScreen />, { permissions: ["catalog.manage"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchBookings).not.toHaveBeenCalled();
  });
});
