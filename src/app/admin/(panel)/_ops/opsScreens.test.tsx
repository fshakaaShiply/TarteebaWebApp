import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlackoutDate, Driver, SlotRule, SlotTemplate, Vehicle, Worker } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { BlackoutDatesScreen } from "../scheduling/blackout-dates/BlackoutDatesScreen";
import { SlotRulesScreen } from "../scheduling/rules/SlotRulesScreen";
import { SlotTemplatesScreen } from "../scheduling/slots/SlotTemplatesScreen";
import { DriversScreen } from "../fleet/drivers/DriversScreen";
import { VehiclesScreen } from "../fleet/vehicles/VehiclesScreen";
import { WorkersScreen } from "../workers/WorkersScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/workers",
}));

const zone = { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } };

// Demo data from DemoWorkforceSeeder, DemoFleetSeeder and SchedulingSeeder (R-14).
const maria: Worker = {
  id: 1,
  ulid: "01m5jm537rh4yrgc2hqg2e0s25",
  employee_no: "DEMO-W01",
  full_name: { ar: "ماريا سانتوس", en: "Maria Santos" },
  display_name: "Maria S.",
  nationality: "PH",
  languages: ["en"],
  employment_status: "on_leave",
  hired_at: null,
  home_zone_id: 1,
  home_zone: zone,
  can_live_out: true,
  weekly_rest_day: 5,
  skills: [{ id: 1, code: "IRONING", name: { ar: "الكيّ", en: "Ironing" }, is_active: true, version: 1 }],
  services: [{ id: 1, code: "STANDARD_VISIT", kind: "standard_visit", name: { ar: "زيارة تنظيف", en: "Cleaning visit" } }],
  on_leave_until: "2026-10-30",
  version: 1,
  created_at: null,
  updated_at: null,
};

const van: Vehicle = {
  id: 1,
  plate_no: "DEMO-VAN-1",
  model: "Toyota Hiace",
  seats: 7,
  insurance_expires_at: "2026-11-05",
  registration_expires_at: "2020-01-01",
  status: "active",
  zone_id: 1,
  zone,
  default_driver_id: 1,
  default_driver: { id: 1, name: "Test Driver", status: "active" },
  version: 1,
  created_at: null,
  updated_at: null,
};

const driver: Driver = {
  id: 1,
  staff_user_id: 6,
  staff_user: { id: 6, name: "Test Driver", email: "driver@tarteeba.test", status: "active" },
  license_no_last4: "0001",
  license_expires_at: "2028-10-22",
  phone: "+971500000009",
  status: "active",
  vehicle: { id: 1, plate_no: "DEMO-VAN-1" },
  version: 1,
  created_at: null,
  updated_at: null,
};

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

const overrideRule: SlotRule = {
  id: 3,
  slot_template_id: 1,
  slot: "MORNING",
  zone_id: 1,
  service_id: null,
  day_of_week: null,
  date_from: "2026-10-24",
  date_to: "2026-10-24",
  is_open: true,
  max_bookings: 6,
  source: "override",
  reason: "Phone booking",
  created_by: { id: 1, name: "Test Admin" },
  version: 1,
  created_at: null,
  updated_at: null,
};

const nationalDay: BlackoutDate = {
  id: 1,
  date: "2026-12-02",
  zone_id: null,
  reason: { ar: "اليوم الوطني", en: "National Day" },
  version: 1,
  created_at: null,
  updated_at: null,
};

const page = <T,>(data: T[]) => ({ data, meta: { current_page: 1, per_page: 25, total: data.length, last_page: 1 } });

const api = {
  fetchWorkers: vi.fn(),
  createWorker: vi.fn(),
  fetchVehicles: vi.fn(),
  fetchDrivers: vi.fn(),
  createDriver: vi.fn(),
  fetchSlotTemplates: vi.fn(),
  fetchSlotRules: vi.fn(),
  fetchBlackoutDates: vi.fn(),
  deleteSlotRule: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchWorkers: (...a: unknown[]) => api.fetchWorkers(...a),
  createWorker: (...a: unknown[]) => api.createWorker(...a),
  fetchVehicles: (...a: unknown[]) => api.fetchVehicles(...a),
  fetchDrivers: (...a: unknown[]) => api.fetchDrivers(...a),
  createDriver: (...a: unknown[]) => api.createDriver(...a),
  fetchSlotTemplates: (...a: unknown[]) => api.fetchSlotTemplates(...a),
  fetchSlotRules: (...a: unknown[]) => api.fetchSlotRules(...a),
  fetchBlackoutDates: (...a: unknown[]) => api.fetchBlackoutDates(...a),
  deleteSlotRule: (...a: unknown[]) => api.deleteSlotRule(...a),
  fetchAllZones: async () => [{ ...zone, is_active: true }],
  fetchAllServices: async () => [],
  fetchAllWorkers: async () => [maria],
  fetchAllVehicles: async () => [van],
  fetchAllDrivers: async () => [driver],
  fetchAllSlotTemplates: async () => [morning],
  fetchSkills: async () => maria.skills,
  fetchDriverAccounts: async () => [
    { id: 6, name: "Test Driver", email: "driver@tarteeba.test", status: "active" },
    { id: 9, name: "New Driver", email: "driver3@tarteeba.test", status: "active" },
  ],
}));

const consoleError = vi.spyOn(console, "error");

describe.each(["en", "ar"] as const)("operations screens (%s)", (locale) => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchWorkers.mockResolvedValue(page([maria]));
    api.fetchVehicles.mockResolvedValue(page([van]));
    api.fetchDrivers.mockResolvedValue(page([driver]));
    api.fetchSlotTemplates.mockResolvedValue(page([morning]));
    api.fetchSlotRules.mockResolvedValue(page([overrideRule]));
    api.fetchBlackoutDates.mockResolvedValue(page([nationalDay]));
  });
  afterEach(() => {
    // Every string these screens look up exists in this language.
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("lists workers with their status, leave and skills", async () => {
    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view", "workers.manage"], locale });
    expect(await screen.findByText("Maria S.")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText(locale === "en" ? "Ironing" : "الكيّ")).toBeInTheDocument();
    expect(within(table).getByText(locale === "en" ? "On leave" : "في إجازة")).toBeInTheDocument();
  });

  it("lists vehicles with expiry badges and drivers with the licence's last 4 only", async () => {
    renderWithProviders(<VehiclesScreen />, { permissions: ["fleet.manage"], locale });
    expect(await screen.findByText("DEMO-VAN-1")).toBeInTheDocument();
    expect(screen.getByText(locale === "en" ? "Expired" : "منتهية")).toBeInTheDocument();

    renderWithProviders(<DriversScreen />, { permissions: ["fleet.manage"], locale });
    expect(await screen.findByText("•••• 0001")).toBeInTheDocument();
  });

  it("lists slots, rules (overrides read-only) and blackout dates", async () => {
    renderWithProviders(<SlotTemplatesScreen />, { permissions: ["catalog.manage"], locale });
    expect(await screen.findByText("10:00–14:00")).toBeInTheDocument();

    renderWithProviders(<SlotRulesScreen />, { permissions: ["catalog.manage"], locale });
    expect(await screen.findByText(locale === "en" ? "Read only" : "للعرض فقط")).toBeInTheDocument();

    renderWithProviders(<BlackoutDatesScreen />, { permissions: ["catalog.manage"], locale });
    expect(await screen.findByText(locale === "en" ? "National Day" : "اليوم الوطني")).toBeInTheDocument();
  });
});

describe("operations permissions", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchWorkers.mockResolvedValue(page([maria]));
    api.fetchVehicles.mockResolvedValue(page([van]));
    api.fetchSlotRules.mockResolvedValue(page([overrideRule]));
  });

  it("hides create and edit from read-only roles", async () => {
    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view"] });
    expect(await screen.findByText("Maria S.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add cleaner" })).not.toBeInTheDocument();

    renderWithProviders(<VehiclesScreen />, { permissions: ["schedule.view"] });
    expect(await screen.findByText("DEMO-VAN-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add vehicle" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit DEMO-VAN-1" })).not.toBeInTheDocument();
  });

  it("shows the permission-denied state instead of data", () => {
    renderWithProviders(<DriversScreen />, { permissions: ["schedule.view"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchDrivers).not.toHaveBeenCalled();
  });

  it("lets only capacity.override delete an override rule", async () => {
    renderWithProviders(<SlotRulesScreen />, { permissions: ["catalog.manage"] });
    expect(await screen.findByText("Read only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete the rule/ })).not.toBeInTheDocument();
  });

  it("links a driver to a staff account with the driver role that isn't linked yet", async () => {
    api.fetchDrivers.mockResolvedValue(page([driver]));
    api.createDriver.mockResolvedValue({ ...driver, id: 2, staff_user_id: 9, staff_user: { id: 9, name: "New Driver", email: "driver3@tarteeba.test", status: "active" } });
    renderWithProviders(<DriversScreen />, { permissions: ["fleet.manage", "users.manage"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    const dialog = await screen.findByRole("dialog", { name: "New driver" });
    const account = within(dialog).getByRole("combobox", { name: /Staff account/ });
    await waitFor(() => expect(within(account).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose an account", "New Driver · driver3@tarteeba.test"]));
    await user.selectOptions(account, "9");
    await user.type(within(dialog).getByLabelText(/^Licence number/), "dl-778899");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(api.createDriver).toHaveBeenCalledWith({ staff_user_id: 9, license_no: "DL-778899", license_expires_at: null, phone: null, status: "active" }),
    );
  });
});
