import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingRow, serviceOptions, zoneOptions } from "@/test/bookingFixtures";
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

const api = { fetchBookings: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBookings: (...a: unknown[]) => api.fetchBookings(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
}));

const page = (rows = [bookingRow()]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });

describe("A03 bookings list", () => {
  let replaceState: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    api.fetchBookings.mockReset();
    api.fetchBookings.mockResolvedValue(page());
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
    });
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("pending_confirmation");
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
