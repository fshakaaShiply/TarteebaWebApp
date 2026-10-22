import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BlackoutDate,
  Driver,
  DriverCandidate,
  ServiceOption,
  SlotRule,
  SlotTemplate,
  Vehicle,
  Worker,
  ZoneOption,
} from "@/lib/admin/types";
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
  fetchAllDrivers: vi.fn(),
  fetchZoneOptions: vi.fn(),
  fetchServiceOptions: vi.fn(),
  fetchDriverCandidates: vi.fn(),
  createSlotRule: vi.fn(),
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
  createSlotRule: (...a: unknown[]) => api.createSlotRule(...a),
  fetchZoneOptions: (...a: unknown[]) => api.fetchZoneOptions(...a),
  fetchServiceOptions: (...a: unknown[]) => api.fetchServiceOptions(...a),
  fetchDriverCandidates: (...a: unknown[]) => api.fetchDriverCandidates(...a),
  fetchAllDrivers: (...a: unknown[]) => api.fetchAllDrivers(...a),
  fetchAllSlotTemplates: async () => [morning],
  fetchSkills: async () => maria.skills,
}));

// GET /admin/zones/options and /admin/services/options: every zone and service in the API's order, inactive included.
const zoneOptions: ZoneOption[] = [
  { ...zone, is_active: true },
  { id: 2, code: "OLD_TOWN", name: { ar: "البلدة القديمة", en: "Old Town" }, is_active: false },
];
const serviceOptions: ServiceOption[] = [
  { id: 1, code: "STANDARD_VISIT", kind: "standard_visit", name: { ar: "زيارة تنظيف", en: "Cleaning visit" }, is_active: true },
  { id: 2, code: "LIVE_OUT", kind: "live_out", name: { ar: "Live-out", en: "Live-out" }, is_active: true },
  { id: 3, code: "DEEP_CLEAN", kind: "standard_visit", name: { ar: "تنظيف عميق", en: "Deep cleaning" }, is_active: false },
];
// GET /admin/drivers/candidates: active driver-role accounts no driver links yet.
const candidates: DriverCandidate[] = [{ id: 9, name: "New Driver", email: "driver3@tarteeba.test", phone: "+971500000010" }];

const optionTexts = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

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
    api.fetchAllDrivers.mockResolvedValue([driver]);
    api.fetchZoneOptions.mockResolvedValue(zoneOptions);
    api.fetchServiceOptions.mockResolvedValue(serviceOptions);
    api.fetchDriverCandidates.mockResolvedValue(candidates);
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
    // The dots are hidden from screen readers, which read a sentence instead (aria-label is ignored on <bdi>).
    expect(await screen.findByText("•••• 0001")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(locale === "en" ? "Licence ending 0001" : "الرخصة المنتهية بـ 0001")).toHaveClass("sr-only");
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
    api.fetchAllDrivers.mockResolvedValue([driver]);
    api.fetchZoneOptions.mockResolvedValue(zoneOptions);
    api.fetchServiceOptions.mockResolvedValue(serviceOptions);
    api.fetchDriverCandidates.mockResolvedValue(candidates);
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

  it("lets only capacity.override delete an override rule, and says why in visible text", async () => {
    renderWithProviders(<SlotRulesScreen />, { permissions: ["catalog.manage"] });
    const readOnly = await screen.findByText("Read only");
    expect(screen.queryByRole("button", { name: /^Delete the rule/ })).not.toBeInTheDocument();
    expect(screen.getByText("Created by a capacity override. Only staff who may override capacity can remove it.")).toBeVisible();
    expect(readOnly.closest("[title]")).toBeNull();
  });

  it("tells staff with capacity.override how to remove an override rule", async () => {
    renderWithProviders(<SlotRulesScreen />, { permissions: ["catalog.manage", "capacity.override"] });
    expect(await screen.findByText("Created by a capacity override. Delete it, or create a new override for that date.")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Delete the rule/ })).toBeInTheDocument();
  });

  it("offers as usual driver only drivers who don't drive another vehicle", async () => {
    const other: Driver = { ...driver, id: 2, staff_user: { id: 7, name: "Free Driver", email: "driver2@tarteeba.test", status: "active" }, vehicle: null };
    api.fetchAllDrivers.mockResolvedValue([driver, other]);
    renderWithProviders(<VehiclesScreen />, { permissions: ["fleet.manage"] });
    const user = userEvent.setup();
    const options = (dialog: HTMLElement) =>
      within(within(dialog).getByRole("combobox", { name: /^Usual driver/ }))
        .getAllByRole("option")
        .map((o) => o.textContent);

    await user.click(await screen.findByRole("button", { name: "Add vehicle" }));
    const create = await screen.findByRole("dialog");
    await waitFor(() => expect(options(create)).toEqual(["No usual driver", "Free Driver"]));
    expect(within(create).getByText(/drivers of other vehicles are not listed/)).toBeInTheDocument();
  });

  it("keeps a vehicle's own usual driver in its picker", async () => {
    const other: Driver = { ...driver, id: 2, staff_user: { id: 7, name: "Free Driver", email: "driver2@tarteeba.test", status: "active" }, vehicle: null };
    api.fetchAllDrivers.mockResolvedValue([driver, other]);
    renderWithProviders(<VehiclesScreen />, { permissions: ["fleet.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit DEMO-VAN-1" }));
    const edit = await screen.findByRole("dialog");
    const picker = within(edit).getByRole("combobox", { name: /^Usual driver/ });
    await waitFor(() => expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["No usual driver", "Test Driver", "Free Driver"]));
    expect(picker).toHaveValue("1");
  });

  it("links a driver to a candidate account by name and e-mail, without users.manage", async () => {
    api.fetchDrivers.mockResolvedValue(page([driver]));
    api.createDriver.mockResolvedValue({ ...driver, id: 2, staff_user_id: 9, staff_user: { id: 9, name: "New Driver", email: "driver3@tarteeba.test", status: "active" } });
    renderWithProviders(<DriversScreen />, { permissions: ["fleet.manage"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    const dialog = await screen.findByRole("dialog", { name: "New driver" });
    const account = within(dialog).getByRole("combobox", { name: /Staff account/ });
    await waitFor(() => expect(optionTexts(account)).toEqual(["Choose an account", "New Driver · driver3@tarteeba.test"]));
    // No account number to type any more.
    expect(within(dialog).queryByLabelText(/Staff account number/)).not.toBeInTheDocument();

    // The account's phone fills the empty phone field.
    await user.selectOptions(account, "9");
    expect(within(dialog).getByLabelText(/^Phone/)).toHaveValue("+971500000010");
    await user.type(within(dialog).getByLabelText(/^Licence number/), "dl-778899");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(api.createDriver).toHaveBeenCalledWith({
        staff_user_id: 9,
        license_no: "DL-778899",
        license_expires_at: null,
        phone: "+971500000010",
        status: "active",
      }),
    );
  });

  it("asks for an account to be picked, and keeps a phone already typed", async () => {
    renderWithProviders(<DriversScreen />, { permissions: ["fleet.manage"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    const dialog = await screen.findByRole("dialog", { name: "New driver" });
    const account = within(dialog).getByRole("combobox", { name: /Staff account/ });
    await waitFor(() => expect(account).toBeEnabled());

    await user.type(within(dialog).getByLabelText(/^Licence number/), "DL-1234");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(account).toHaveAccessibleDescription(/Choose the driver's staff account\./));
    expect(api.createDriver).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/^Phone/), "+971501112222");
    await user.selectOptions(account, "9");
    expect(within(dialog).getByLabelText(/^Phone/)).toHaveValue("+971501112222");
  });

  it("explains that a driver-role account must be invited first when there is none to link", async () => {
    api.fetchDriverCandidates.mockResolvedValue([]);
    renderWithProviders(<DriversScreen />, { permissions: ["fleet.manage", "users.manage"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    const dialog = await screen.findByRole("dialog", { name: "New driver" });

    expect(await within(dialog).findByText("No staff account to link")).toBeInTheDocument();
    expect(within(dialog).getByText(/Invite one in Users & roles first/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open Users & roles" })).toHaveAttribute("href", "/admin/users");
    expect(within(dialog).queryByRole("combobox", { name: /Staff account/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("offers no Users link to fleet staff who cannot manage users", async () => {
    api.fetchDriverCandidates.mockResolvedValue([]);
    renderWithProviders(<DriversScreen />, { permissions: ["fleet.manage"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add driver" }));
    const dialog = await screen.findByRole("dialog", { name: "New driver" });
    expect(await within(dialog).findByText("No staff account to link")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Open Users & roles" })).not.toBeInTheDocument();
  });
});

describe("zone and service pickers from the pick-lists", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchWorkers.mockResolvedValue(page([maria]));
    api.fetchVehicles.mockResolvedValue(page([van]));
    api.fetchSlotRules.mockResolvedValue(page([]));
    api.fetchBlackoutDates.mockResolvedValue(page([]));
    api.fetchAllDrivers.mockResolvedValue([driver]);
    api.fetchZoneOptions.mockResolvedValue(zoneOptions);
    api.fetchServiceOptions.mockResolvedValue(serviceOptions);
  });

  it("filters workers by any zone or service by name for HR without catalog.manage", async () => {
    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view"] });
    const user = userEvent.setup();
    expect(await screen.findByText("Maria S.")).toBeInTheDocument();

    const zone = screen.getByRole("combobox", { name: "Home zone" });
    const service = screen.getByRole("combobox", { name: "Service" });
    await waitFor(() => expect(optionTexts(zone)).toEqual(["All zones", "Business Bay & Downtown", "Old Town (inactive)"]));
    // Services nobody is eligible for yet are listed too, not only those already given to a cleaner.
    await waitFor(() =>
      expect(optionTexts(service)).toEqual(["All services", "Cleaning visit", "Live-out", "Deep cleaning (inactive)"]),
    );

    await user.selectOptions(zone, "2");
    await user.selectOptions(service, "3");
    await waitFor(() => expect(api.fetchWorkers).toHaveBeenLastCalledWith(expect.objectContaining({ zoneId: 2, serviceId: 3 })));
    expect(api.fetchZoneOptions).toHaveBeenCalledTimes(1);
  });

  it("shows zone names in Arabic and marks inactive ones", async () => {
    renderWithProviders(<VehiclesScreen />, { permissions: ["schedule.view"], locale: "ar" });
    const zone = await screen.findByRole("combobox", { name: "المنطقة" });
    await waitFor(() => expect(optionTexts(zone)).toEqual(["كل المناطق", "الخليج التجاري وداون تاون", "البلدة القديمة (غير نشطة)"]));
  });

  it("picks a vehicle's zone from every zone", async () => {
    renderWithProviders(<VehiclesScreen />, { permissions: ["fleet.manage"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add vehicle" }));
    const dialog = await screen.findByRole("dialog");
    const zone = within(dialog).getByRole("combobox", { name: /^Zone/ });
    await waitFor(() => expect(optionTexts(zone)).toEqual(["No zone", "Business Bay & Downtown", "Old Town (inactive)"]));
  });

  it("scopes a new slot rule to a zone and a service picked by name", async () => {
    api.createSlotRule.mockResolvedValue({ ...overrideRule, id: 4, source: "admin" });
    renderWithProviders(<SlotRulesScreen />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add rule" }));
    const dialog = await screen.findByRole("dialog");
    const zone = within(dialog).getByRole("combobox", { name: /^Zone/ });
    const service = within(dialog).getByRole("combobox", { name: /^Service/ });
    await waitFor(() => expect(optionTexts(service)).toEqual(["All services", "Cleaning visit", "Live-out", "Deep cleaning (inactive)"]));
    expect(optionTexts(zone)).toEqual(["All zones", "Business Bay & Downtown", "Old Town (inactive)"]);

    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: /^Slot/ })).toBeEnabled());
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /^Slot/ }), "1");
    await user.selectOptions(zone, "1");
    await user.selectOptions(service, "1");
    await user.type(within(dialog).getByLabelText(/^Reason/), "Ramadan evenings");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.createSlotRule).toHaveBeenCalledWith(expect.objectContaining({ slot_template_id: 1, zone_id: 1, service_id: 1 })));
  });

  it("names a blackout's zone from the pick-list", async () => {
    api.fetchBlackoutDates.mockResolvedValue(page([{ ...nationalDay, zone_id: 2 }]));
    renderWithProviders(<BlackoutDatesScreen />, { permissions: ["catalog.manage"] });
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Old Town (inactive)")).toBeInTheDocument();
  });
});
