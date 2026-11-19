import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Driver, Vehicle } from "@/lib/admin/types";
import { expiryState } from "@/lib/admin/ops/fleet";
import { renderWithProviders } from "@/test/render";
import { DriversScreen } from "./drivers/DriversScreen";
import { VehiclesScreen } from "./vehicles/VehiclesScreen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/fleet/vehicles",
}));

const api = { fetchVehicles: vi.fn(), fetchDrivers: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchVehicles: (...a: unknown[]) => api.fetchVehicles(...a),
  fetchDrivers: (...a: unknown[]) => api.fetchDrivers(...a),
  fetchAllDrivers: async () => [],
  fetchDriverCandidates: async () => [],
  fetchZoneOptions: async () => [{ id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay" }, is_active: true }],
  fetchServiceOptions: async () => [],
}));

// The tests' clock is 2026-10-23 in Dubai: the insurance ends in 10 days, the registration in 40, the licence in 20.
const van: Vehicle = {
  id: 1,
  plate_no: "DEMO-VAN-1",
  model: "Toyota Hiace",
  seats: 7,
  insurance_expires_at: "2026-11-02",
  registration_expires_at: "2026-12-02",
  status: "active",
  zone_id: 1,
  zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay" } },
  default_driver_id: null,
  version: 1,
  created_at: null,
  updated_at: null,
};
const driver: Driver = {
  id: 1,
  staff_user_id: 6,
  staff_user: { id: 6, name: "Test Driver", email: "driver@tarteeba.test", status: "active" },
  license_no_last4: "0001",
  license_expires_at: "2026-11-12",
  phone: null,
  status: "active",
  vehicle: null,
  version: 1,
  created_at: null,
  updated_at: null,
};
const page = <T,>(data: T[], alertDays?: number) => ({
  data,
  meta: { current_page: 1, per_page: 25, total: data.length, last_page: 1, ...(alertDays === undefined ? {} : { document_alert_days: alertDays }) },
});
const rowOf = (text: string) => screen.getAllByRole("row").find((r) => r.textContent?.includes(text))!;

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe("A06 document badges follow fleet.document_alert_days (meta.document_alert_days)", () => {
  it("marks a vehicle document as expiring soon only within the days the API names", async () => {
    api.fetchVehicles.mockResolvedValue(page([van], 14));
    const { unmount } = renderWithProviders(<VehiclesScreen />, { permissions: ["fleet.manage"] });
    await screen.findByText("DEMO-VAN-1");
    // 14 days: the insurance (10 days away) is soon, the registration (40 days) is not.
    expect(within(rowOf("DEMO-VAN-1")).getAllByText("Expires soon")).toHaveLength(1);
    unmount();

    api.fetchVehicles.mockResolvedValue(page([van], 45));
    renderWithProviders(<VehiclesScreen />, { permissions: ["fleet.manage"] });
    await screen.findByText("DEMO-VAN-1");
    expect(within(rowOf("DEMO-VAN-1")).getAllByText("Expires soon")).toHaveLength(2);
  });

  it("marks a driver's licence by the same window, and a shorter one hides the badge", async () => {
    api.fetchDrivers.mockResolvedValue(page([driver], 7));
    const { unmount } = renderWithProviders(<DriversScreen />, { permissions: ["fleet.manage"] });
    await screen.findByText("•••• 0001");
    expect(screen.queryByText("Expires soon")).not.toBeInTheDocument();
    unmount();

    api.fetchDrivers.mockResolvedValue(page([driver], 30));
    renderWithProviders(<DriversScreen />, { permissions: ["fleet.manage"] });
    await screen.findByText("•••• 0001");
    expect(screen.getByText("Expires soon")).toBeInTheDocument();
  });

  it("keeps the 30-day window while the answer carries no figure, and shows an expired document as expired whatever the window", async () => {
    api.fetchVehicles.mockResolvedValue(page([{ ...van, insurance_expires_at: "2026-10-20" }]));
    renderWithProviders(<VehiclesScreen />, { permissions: ["fleet.manage"] });
    await screen.findByText("DEMO-VAN-1");
    const row = rowOf("DEMO-VAN-1");
    expect(within(row).getByText("Expired")).toBeInTheDocument();
    // The registration is 40 days away: outside the default 30 days.
    expect(within(row).queryByText("Expires soon")).not.toBeInTheDocument();
  });

  it("computes the badge from the window it is given: valid through the expiry day, then expired", () => {
    expect(expiryState("2026-11-02", "2026-10-23", 10)).toBe("soon");
    expect(expiryState("2026-11-02", "2026-10-23", 9)).toBe("ok");
    expect(expiryState("2026-10-23", "2026-10-23", 0)).toBe("soon");
    expect(expiryState("2026-10-22", "2026-10-23", 365)).toBe("expired");
    expect(expiryState("2026-11-02", "2026-10-23")).toBe("soon");
  });
});
