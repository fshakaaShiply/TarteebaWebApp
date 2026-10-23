import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapacityView, ManualBookingResult } from "@/lib/admin/types";
import { bookingDetail, serviceOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { ManualBookingWizard } from "./ManualBookingWizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/bookings/new",
}));

const api = {
  fetchBookings: vi.fn(),
  fetchBooking: vi.fn(),
  checkZone: vi.fn(),
  fetchCapacity: vi.fn(),
  createManualBooking: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBookings: (...a: unknown[]) => api.fetchBookings(...a),
  fetchBooking: (...a: unknown[]) => api.fetchBooking(...a),
  checkZone: (...a: unknown[]) => api.checkZone(...a),
  fetchCapacity: (...a: unknown[]) => api.fetchCapacity(...a),
  createManualBooking: (...a: unknown[]) => api.createManualBooking(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchPublicServices: async () => [{ code: "STANDARD_VISIT", min_workers: 1, max_workers: 4 }],
  fetchWorkers: async () => ({ data: [], meta: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
  fetchAddons: async () => ({ data: [], meta: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
}));

const PERMISSIONS = ["bookings.view", "bookings.create_manual", "schedule.view", "workers.view"];

const capacity = (date: string): CapacityView => ({
  date,
  zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay & Downtown" } },
  timezone: "Asia/Dubai",
  travel_buffer_minutes: 30,
  live_out_block_scope: "whole_day",
  slots: [
    {
      slot_template_id: 2,
      code: "EVENING",
      name: { ar: "المسائية", en: "Evening" },
      start: "15:00",
      end: "19:00",
      service_kind: "standard_visit",
      is_active: true,
      service: { id: 1, code: "STANDARD_VISIT" },
      status: "available",
      reason: null,
      available_workers: 5,
      reserved_workers: 0,
      reserved_competing: 0,
      remaining_workers: 5,
      vehicles: [],
      max_single_vehicle_free: 7,
      total_free_seats: 7,
      bookings_count: 0,
      max_bookings: null,
      rule: null,
      max_workers_fit: 5,
      holds: { active: 0, converted: 0 },
      zone_workers: 6,
      excluded: {},
    },
  ],
});

const result: ManualBookingResult = {
  booking: bookingDetail({ id: 9, reference: "TRB-NEW001", status: "held", created_by_staff_id: 2, customer: { id: "01C", name: "Sara", phone: "+971501234567" } }),
  payment: {
    id: "01P",
    status: "pending",
    amount_fils: 24000,
    payment_link: "https://pay.example.test/checkout/abc?x=1&y=2",
    expires_at: "2026-10-23T16:00:00+00:00",
  },
};

const consoleError = vi.spyOn(console, "error");

describe("A03 manual booking wizard", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchBookings.mockResolvedValue({ data: [], meta: { current_page: 1, per_page: 20, total: 0, last_page: 1 } });
    api.checkZone.mockResolvedValue({ in_service_area: true, zone: { code: "DEMO_BB", name: "Business Bay & Downtown" } });
    api.fetchCapacity.mockImplementation(async ({ date }: { date: string }) => capacity(date));
    api.createManualBooking.mockResolvedValue(result);
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("requires the source and a UAE mobile number before the next step", async () => {
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Choose where the request came from.")).toBeInTheDocument();
    expect(screen.getByText("Enter a UAE mobile number, e.g. 050 123 4567.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Customer" })).toBeInTheDocument();
  });

  it("refuses a short map link and an address outside the zones", async () => {
    api.checkZone.mockResolvedValue({ in_service_area: false, zone: null });
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Phone" }));
    await user.type(screen.getByRole("textbox", { name: /Customer mobile number/ }), "050 123 4567");
    await user.click(screen.getByRole("button", { name: "Next" }));

    const location = await screen.findByRole("textbox", { name: /Location/ });
    await user.type(location, "https://maps.app.goo.gl/abc");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Short map links can't be read/)).toBeInTheDocument();

    await user.clear(location);
    await user.type(location, "24.0, 54.0");
    await user.tab();
    expect(await screen.findByText("Outside our service areas")).toBeInTheDocument();
    expect(api.checkZone).toHaveBeenCalledWith(24, 54);
  });

  it("creates the booking and shows the payment link to copy or open in WhatsApp, sending nothing", async () => {
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    // After setup: user-event installs its own clipboard stub.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await user.click(screen.getByRole("radio", { name: "WhatsApp" }));
    await user.type(screen.getByRole("textbox", { name: /Customer mobile number/ }), "+971 50 123 4567");
    await user.type(screen.getByRole("textbox", { name: /Customer name/ }), "Sara");
    await user.selectOptions(screen.getByRole("combobox", { name: /Customer's language/ }), "en");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.type(await screen.findByRole("textbox", { name: /Address label/ }), "Home");
    await user.selectOptions(screen.getByRole("combobox", { name: /Property type/ }), "apartment");
    await user.type(screen.getByRole("textbox", { name: /Location/ }), "25.1865, 55.2730");
    await user.tab();
    expect(await screen.findByText("Inside the service area: Business Bay & Downtown.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.selectOptions(await screen.findByRole("combobox", { name: /Service/ }), "STANDARD_VISIT");
    const workers = screen.getByRole("spinbutton", { name: /Cleaners/ });
    await user.clear(workers);
    await user.type(workers, "2");
    const slot = screen.getByRole("combobox", { name: /Time/ });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(slot, "2");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText(/Evening 15:00–19:00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create booking" }));

    await waitFor(() => expect(api.createManualBooking).toHaveBeenCalledTimes(1));
    const [payload, key] = api.createManualBooking.mock.calls[0];
    expect(payload).toMatchObject({
      source: "whatsapp",
      customer: { phone: "+971501234567", name: "Sara", locale: "en" },
      address: { label: "Home", property_type: "apartment", lat: 25.1865, lng: 55.273 },
      service: "STANDARD_VISIT",
      slot_template_id: 2,
      workers_count: 2,
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);

    expect(await screen.findByText("Booking TRB-NEW001 created")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Payment link" })).toHaveValue("https://pay.example.test/checkout/abc?x=1&y=2");
    const whatsapp = screen.getByRole("link", { name: /Open WhatsApp/ });
    const href = whatsapp.getAttribute("href")!;
    expect(href.startsWith("https://wa.me/971501234567?text=")).toBe(true);
    const text = decodeURIComponent(href.split("text=")[1]);
    // The customer's language first, the link inside, no promise beyond "pending confirmation".
    expect(text.indexOf("Hello Sara")).toBe(0);
    expect(text).toContain("https://pay.example.test/checkout/abc?x=1&y=2");
    expect(text).toContain("مرحبًا Sara");
    expect(screen.getByText(/WhatsApp opens with the message ready and sends nothing until you press send/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://pay.example.test/checkout/abc?x=1&y=2");
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the booking" })).toHaveAttribute("href", "/admin/bookings/9");
  });

  it("finds an existing customer by phone and offers their saved addresses", async () => {
    api.fetchBookings.mockResolvedValue({
      data: [{ ...bookingDetail(), customer: { id: "01C", name: "Omar Khalid", phone: "+971500000002" } }],
      meta: { current_page: 1, per_page: 20, total: 1, last_page: 1 },
    });
    api.fetchBooking.mockResolvedValue(bookingDetail());
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Phone" }));
    await user.type(screen.getByRole("textbox", { name: /Customer mobile number/ }), "0500000002");
    await user.click(screen.getByRole("button", { name: "Find customer" }));
    expect(await screen.findByText("Existing customer: Omar Khalid · 1 saved address")).toBeInTheDocument();
    expect(api.fetchBookings).toHaveBeenCalledWith({ search: "+971500000002", perPage: 20 });
    await user.click(screen.getByRole("button", { name: "Use this name" }));
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue("Omar Khalid");

    await user.click(screen.getByRole("button", { name: "Next" }));
    const saved = await screen.findByRole("combobox", { name: /Saved address/ });
    expect(within(saved).getByRole("option", { name: "Home, Tower 1, 1203" })).toBeInTheDocument();
  });
});
