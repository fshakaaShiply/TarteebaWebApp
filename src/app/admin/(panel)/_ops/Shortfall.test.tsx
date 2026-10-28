import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceOption, Shortfall, SlotTemplateOption, Vehicle, ZoneOption } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { ShortfallTable } from "./Shortfall";

const api = {
  fetchAllVehicles: vi.fn(),
  fetchSlotTemplateOptions: vi.fn(),
  fetchServiceOptions: vi.fn(),
  fetchZoneOptions: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchAllVehicles: (...a: unknown[]) => api.fetchAllVehicles(...a),
  fetchSlotTemplateOptions: (...a: unknown[]) => api.fetchSlotTemplateOptions(...a),
  fetchServiceOptions: (...a: unknown[]) => api.fetchServiceOptions(...a),
  fetchZoneOptions: (...a: unknown[]) => api.fetchZoneOptions(...a),
}));

// SchedulingSeeder slots (GET /admin/slot-templates/options), DemoFleetSeeder van and the catalogue's services (R-14).
const slots: SlotTemplateOption[] = [
  { id: 1, code: "MORNING", name: { ar: "الفترة الصباحية", en: "Morning" }, start_time: "10:00", end_time: "14:00", service_kind: "standard_visit", is_active: true },
  { id: 2, code: "EVENING", name: { ar: "الفترة المسائية", en: "Evening" }, start_time: "16:00", end_time: "20:00", service_kind: "standard_visit", is_active: true },
];
const van = { id: 1, plate_no: "DEMO-VAN-1", seats: 7 } as Vehicle;
const services: ServiceOption[] = [
  { id: 1, code: "STANDARD_VISIT", kind: "standard_visit", name: { ar: "زيارة تنظيف", en: "Cleaning visit" }, is_active: true },
  { id: 3, code: "DEEP_CLEAN", kind: "standard_visit", name: { ar: "تنظيف عميق", en: "Deep cleaning" }, is_active: true },
];
const zones: ZoneOption[] = [{ id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" }, is_active: true }];

// CapacityImpactGuard: one workers row per pool and service, one seats row per vehicle, slot = the template code.
const shortfalls: Shortfall[] = [
  { date: "2026-11-03", zone_id: 1, slot_template_id: 1, slot: "MORNING", kind: "workers", service_id: 1, reserved: 5, available: 4 },
  { date: "2026-11-03", zone_id: 1, slot_template_id: 1, slot: "MORNING", kind: "workers", service_id: 3, reserved: 2, available: 1 },
  { date: "2026-11-03", zone_id: 1, slot_template_id: 2, slot: "EVENING", kind: "seats", vehicle_id: 1, reserved: 8, available: 7 },
];

const cells = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((c) => c.textContent));

const consoleError = vi.spyOn(console, "error");

describe("capacity shortfall table", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchAllVehicles.mockResolvedValue([van]);
    api.fetchSlotTemplateOptions.mockResolvedValue(slots);
    api.fetchServiceOptions.mockResolvedValue(services);
    api.fetchZoneOptions.mockResolvedValue(zones);
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("names the slot, the service of each workers row and the vehicle's plate for operations staff", async () => {
    renderWithProviders(<ShortfallTable shortfalls={shortfalls} />, { permissions: ["schedule.view", "fleet.manage", "leave.manage"] });
    await waitFor(() =>
      expect(cells().map((r) => r.slice(1, 4))).toEqual([
        ["Business Bay & Downtown", "Morning10:00–14:00", "WorkersCleaning visit"],
        ["Business Bay & Downtown", "Morning10:00–14:00", "WorkersDeep cleaning"],
        ["Business Bay & Downtown", "Evening16:00–20:00", "SeatsDEMO-VAN-1"],
      ]),
    );
    // The slot names come from the slot pick-list, one light request whatever the dates and zones.
    expect(api.fetchSlotTemplateOptions).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/#1|no\. 1/)).not.toBeInTheDocument();
  });

  it("names the slots for any role that reads the slot pick-list (here bookings staff)", async () => {
    renderWithProviders(<ShortfallTable shortfalls={shortfalls} />, { permissions: ["bookings.view"] });
    await waitFor(() => expect(cells()[2][2]).toBe("Evening16:00–20:00"));
    // No van list without fleet.manage or schedule.view: the plate stays a number.
    expect(cells()[2][3]).toBe("SeatsVehicle no. 1");
    expect(api.fetchAllVehicles).not.toHaveBeenCalled();
  });

  it("names them in Arabic", async () => {
    renderWithProviders(<ShortfallTable shortfalls={shortfalls} />, { permissions: ["schedule.view", "fleet.manage"], locale: "ar" });
    await waitFor(() => expect(cells()[0].slice(2, 4)).toEqual(["الفترة الصباحية10:00–14:00", "العاملاتزيارة تنظيف"]));
  });

  it("falls back to the slot code and numbers when the lists are out of reach", async () => {
    renderWithProviders(<ShortfallTable shortfalls={shortfalls} />, { permissions: ["settings.manage"] });
    expect(cells().map((r) => r.slice(2, 4))).toEqual([
      ["MORNING", "WorkersService no. 1"],
      ["MORNING", "WorkersService no. 3"],
      ["EVENING", "SeatsVehicle no. 1"],
    ]);
    expect(api.fetchSlotTemplateOptions).not.toHaveBeenCalled();
    expect(api.fetchAllVehicles).not.toHaveBeenCalled();
  });
});
