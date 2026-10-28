import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { adminKeys } from "@/lib/admin/keys";
import type { AddonOption, CustomerLookup, ManualBookingPreview, ManualBookingResult } from "@/lib/admin/types";
import { bookingDetail, serviceOptions, slotTemplateOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { ManualBookingWizard } from "./ManualBookingWizard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/bookings/new",
}));

const api = {
  lookupCustomer: vi.fn(),
  previewManualBooking: vi.fn(),
  checkZone: vi.fn(),
  createManualBooking: vi.fn(),
  fetchAddonOptions: vi.fn(),
  fetchSlotTemplateOptions: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  lookupCustomer: (...a: unknown[]) => api.lookupCustomer(...a),
  previewManualBooking: (...a: unknown[]) => api.previewManualBooking(...a),
  checkZone: (...a: unknown[]) => api.checkZone(...a),
  createManualBooking: (...a: unknown[]) => api.createManualBooking(...a),
  fetchAddonOptions: (...a: unknown[]) => api.fetchAddonOptions(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchSlotTemplateOptions: (...a: unknown[]) => api.fetchSlotTemplateOptions(...a),
  fetchPublicServices: async () => [{ code: "STANDARD_VISIT", min_workers: 1, max_workers: 4 }],
  fetchWorkers: async () => ({ data: [], meta: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }),
}));

const PERMISSIONS = ["bookings.view", "bookings.create_manual", "workers.view"];

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

const zone = { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay & Downtown" } };

const preview = (over: Partial<ManualBookingPreview> = {}): ManualBookingPreview => ({
  customer_exists: false,
  address_is_new: true,
  zone,
  amounts: { subtotal_fils: 24000, addons_fils: 0, discount_fils: 0, net_fils: 22857, vat_rate_bp: 500, vat_fils: 1143, total_fils: 24000, currency: "AED" },
  lines: [
    {
      type: "service",
      code: "STANDARD_VISIT",
      description: { ar: "زيارة تنظيف", en: "Cleaning visit (price per worker)" },
      unit: "per_worker_visit",
      quantity: 2,
      unit_gross_fils: 12000,
      discount_fils: 0,
      net_fils: 22857,
      vat_fils: 1143,
      gross_fils: 24000,
    },
  ],
  availability: { status: "available", reason: null, bookable: true, remaining: 4 },
  payment_hold_minutes: 120,
  policy_summary: { ar: ["إلغاء مجاني حتى 24 ساعة قبل الزيارة."], en: ["Free cancellation until 24 hours before the visit."] },
  ...over,
});

const addonOptions: AddonOption[] = [
  { id: 1, code: "MATERIALS", name: { ar: "مواد التنظيف", en: "Cleaning materials" }, amount_fils: 1500, vat_inclusive: true, per: "visit", is_active: true, service_codes: ["STANDARD_VISIT"] },
  { id: 2, code: "FRIDGE", name: { ar: "الثلاجة", en: "Fridge cleaning" }, amount_fils: 2000, vat_inclusive: true, per: "visit", is_active: false, service_codes: ["STANDARD_VISIT"] },
  { id: 3, code: "IRONING", name: { ar: "الكي", en: "Ironing" }, amount_fils: 3000, vat_inclusive: true, per: "worker", is_active: true, service_codes: ["LIVE_OUT_MONTHLY"] },
];

const nobody = (phone: string): CustomerLookup => ({ data: [], meta: { phone } });

/** Omar: a default home address that can be booked, and an office address that is blocked. */
const omar = (over: Partial<CustomerLookup["data"][number]> = {}): CustomerLookup => ({
  data: [
    {
      id: "01C",
      name: "Omar Khalid",
      phone: "+971500000002",
      locale: "en",
      status: "active",
      bookable: true,
      addresses: [
        {
          id: "01A1",
          label: "Home",
          property_type: "apartment",
          building: "Tower 1",
          unit_number: "1203",
          street: null,
          area_text: "Business Bay",
          is_default: true,
          is_blocked: false,
          zone: { ...zone, is_active: true },
          bookable: true,
        },
        {
          id: "01A2",
          label: "Office",
          property_type: "office",
          building: "Bay Square 4",
          unit_number: null,
          street: null,
          area_text: null,
          is_default: false,
          is_blocked: true,
          zone: { ...zone, is_active: true },
          bookable: false,
        },
      ],
      ...over,
    },
  ],
  meta: { phone: "+971500000002" },
});

const consoleError = vi.spyOn(console, "error");

const apiError = (status: number, code: string, details: Record<string, unknown> = {}, message = "") => new AdminApiError(status, { code, message, details });

/** The service and an evening slot on the time step (only the service kind's active slots are offered). */
async function chooseServiceAndSlot(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByRole("combobox", { name: /Service/ }), "STANDARD_VISIT");
  const slot = screen.getByRole("combobox", { name: /Time/ });
  // The slot pick-list's active standard-visit slots: no live-out and no inactive slot.
  await waitFor(() =>
    expect(within(slot).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a time", "Morning · 10:00–14:00", "Evening · 15:00–19:00"]),
  );
  await user.selectOptions(slot, "2");
}

/** Source, phone and a new address in the zone: the wizard then shows the service and time step. */
async function fillToTime(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: "WhatsApp" }));
  await user.type(screen.getByRole("textbox", { name: /Customer mobile number/ }), "+971 50 123 4567");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(await screen.findByRole("textbox", { name: /Address label/ }), "Home");
  await user.selectOptions(screen.getByRole("combobox", { name: /Property type/ }), "apartment");
  await user.type(screen.getByRole("textbox", { name: /Location/ }), "25.1865, 55.2730");
  await user.tab();
  await screen.findByText("Inside the service area: Business Bay & Downtown.");
  await user.click(screen.getByRole("button", { name: "Next" }));
}

/** Source, phone, a new address in the zone, the service and slot: the wizard then shows its last step. */
async function fillToDetails(user: ReturnType<typeof userEvent.setup>) {
  await fillToTime(user);
  await chooseServiceAndSlot(user);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText(/Evening · 15:00–19:00/);
}

describe("A03 manual booking wizard", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.lookupCustomer.mockImplementation(async (phone: string) => nobody(phone));
    api.previewManualBooking.mockResolvedValue(preview());
    api.checkZone.mockResolvedValue({ in_service_area: true, zone: { code: "DEMO_BB", name: "Business Bay & Downtown" } });
    api.createManualBooking.mockResolvedValue(result);
    api.fetchAddonOptions.mockResolvedValue(addonOptions);
    api.fetchSlotTemplateOptions.mockResolvedValue(slotTemplateOptions);
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

  it("creates the booking after the server's price and slot check, and shows the payment link, sending nothing", async () => {
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    // After setup: user-event installs its own clipboard stub.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await user.click(screen.getByRole("radio", { name: "WhatsApp" }));
    await user.type(screen.getByRole("textbox", { name: /Customer mobile number/ }), "+971 50 123 4567");
    // A full number is looked up: nobody has it, so the name and language are asked for.
    expect(await screen.findByText("No customer has this number yet. A new customer is created with it.")).toBeInTheDocument();
    expect(api.lookupCustomer).toHaveBeenCalledTimes(1);
    expect(api.lookupCustomer).toHaveBeenCalledWith("+971501234567");
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
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(slot, "2");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText(/Evening · 15:00–19:00/)).toBeInTheDocument();
    const summary = await screen.findByRole("region", { name: "Price and availability" });
    expect(await within(summary).findByText("This time can take the booking.")).toBeInTheDocument();
    expect(summary).toHaveTextContent("Cleaning visit (price per worker)");
    expect(summary).toHaveTextContent("TotalAED 240");
    expect(summary).toHaveTextContent("The payment link holds this time for 120 minutes.");
    expect(summary).toHaveTextContent("A new customer is created with this number.");
    expect(within(summary).getByText("Free cancellation until 24 hours before the visit.")).toBeInTheDocument();
    // The answer is announced through the summary's one live region (it stayed mounted while the check ran).
    expect(within(summary).getByText("Total AED 240 · This time can take the booking.")).toHaveAttribute("role", "status");
    // The dry run gets the booking's body without the notes (they change neither the price nor the slot).
    expect(api.previewManualBooking).toHaveBeenCalledTimes(1);
    const [previewBody] = api.previewManualBooking.mock.calls[0];
    expect(previewBody).toMatchObject({ source: "whatsapp", service: "STANDARD_VISIT", slot_template_id: 2, workers_count: 2, instructions: null, internal_note: null });
    expect(previewBody).not.toHaveProperty("override");

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
    // The refresh after the booking leaves the rate-limited dry run and lookup alone (no second request for either).
    expect(api.previewManualBooking).toHaveBeenCalledTimes(1);
    expect(api.lookupCustomer).toHaveBeenCalledTimes(1);
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

  it("moves focus to the first invalid field when it refuses to go on", async () => {
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("radio", { name: "Phone" })).toHaveFocus();
  });

  it("goes back to the step of a field the API refused and focuses it", async () => {
    api.createManualBooking.mockRejectedValue(apiError(422, "VALIDATION_FAILED", { fields: { "customer.phone": ["This number can't receive messages."] } }));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToDetails(user);
    await user.click(screen.getByRole("button", { name: "Create booking" }));
    const phone = await screen.findByRole("textbox", { name: /Customer mobile number/ });
    expect(screen.getByText("This number can't receive messages.")).toBeInTheDocument();
    await waitFor(() => expect(phone).toHaveFocus());
  });

  it("after an unknown outcome keeps the same Idempotency-Key even when details change, and can show the booking already made", async () => {
    api.createManualBooking
      // The /backend proxy gave up after 60 s while the API may have finished.
      .mockRejectedValueOnce(apiError(502, "BAD_GATEWAY"))
      // The edited form: the key already holds the first attempt's booking.
      .mockRejectedValueOnce(apiError(422, "IDEMPOTENCY_KEY_REUSED"))
      // The first body again: the API replays the booking it made.
      .mockResolvedValueOnce(result);
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToDetails(user);
    await user.click(screen.getByRole("button", { name: "Create booking" }));
    expect(await screen.findByText("We don't know yet whether the booking was made")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    const [firstPayload, firstKey] = api.createManualBooking.mock.calls[0];

    await user.type(screen.getByRole("textbox", { name: /Instructions/ }), "Ring twice");
    await user.click(screen.getByRole("button", { name: "Create booking" }));
    await waitFor(() => expect(api.createManualBooking).toHaveBeenCalledTimes(2));
    const [secondPayload, secondKey] = api.createManualBooking.mock.calls[1];
    expect(secondPayload.instructions).toBe("Ring twice");
    expect(secondKey).toBe(firstKey);

    expect(await screen.findByText("A booking may already exist from the first try")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bookings for this phone" })).toHaveAttribute("href", "/admin/bookings?search=%2B971501234567");
    await user.click(screen.getByRole("button", { name: "Show the booking from the first try" }));
    await waitFor(() => expect(api.createManualBooking).toHaveBeenCalledTimes(3));
    expect(api.createManualBooking.mock.calls[2]).toEqual([firstPayload, firstKey]);
    expect(await screen.findByText("Booking TRB-NEW001 created")).toBeInTheDocument();
  });

  it("finds an existing customer once the number is complete and books one of their bookable saved addresses", async () => {
    // The API normalizes the number its own way (libphonenumber): meta.phone is what the booking sends.
    api.lookupCustomer.mockImplementation(async (phone: string) => (phone === "+971500000002" ? { ...omar(), meta: { phone: "+971500000099" } } : nobody(phone)));
    api.previewManualBooking.mockResolvedValue(preview({ customer_exists: true, address_is_new: false }));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Phone" }));
    await user.type(screen.getByRole("textbox", { name: /Customer mobile number/ }), "0500000002");
    expect(await screen.findByText("Existing customer: Omar Khalid · 2 saved addresses")).toBeInTheDocument();
    // Only the full number was looked up (a partial one would be 422 PHONE_INVALID, not "no customer").
    expect(api.lookupCustomer.mock.calls).toEqual([["+971500000002"]]);
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue("Omar Khalid");
    expect(screen.getByRole("combobox", { name: /Customer's language/ })).toHaveValue("en");

    await user.click(screen.getByRole("button", { name: "Next" }));
    const home = await screen.findByRole("radio", { name: /^Home/ });
    const office = screen.getByRole("radio", { name: /^Office/ });
    expect(home).toBeEnabled();
    expect(office).toBeDisabled();
    expect(screen.getByText("Blocked: can't be booked.")).toBeInTheDocument();
    // Saved addresses come first: no new-address form until "A new address" is picked.
    expect(screen.queryByRole("textbox", { name: /Address label/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Choose an address.")).toBeInTheDocument();

    await user.click(home);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Zone: Business Bay & Downtown")).toBeInTheDocument();
    await chooseServiceAndSlot(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("This time can take the booking.");
    expect(screen.queryByText("A new customer is created with this number.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create booking" }));
    await waitFor(() => expect(api.createManualBooking).toHaveBeenCalledTimes(1));
    const [payload] = api.createManualBooking.mock.calls[0];
    // The saved address by its id, and the number as the lookup normalized it (meta.phone), not our own reading.
    expect(payload).toMatchObject({ customer: { phone: "+971500000099", name: "Omar Khalid", locale: "en" }, address: { id: "01A1" } });
  });

  it("forgets a customer lookup once the phone is corrected (never another customer's name or address)", async () => {
    api.lookupCustomer.mockImplementation(async (phone: string) => (phone === "+971500000002" ? omar() : nobody(phone)));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Phone" }));
    const phone = screen.getByRole("textbox", { name: /Customer mobile number/ });
    await user.type(phone, "0500000002");
    expect(await screen.findByText("Existing customer: Omar Khalid · 2 saved addresses")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue("Omar Khalid");

    await user.clear(phone);
    await user.type(phone, "0500000003");
    expect(screen.queryByText(/Existing customer/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue("");
    expect(await screen.findByText("No customer has this number yet. A new customer is created with it.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("textbox", { name: /Address label/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /^Home/ })).not.toBeInTheDocument();
  });

  it("stops at an account that can't book, and at a number the API refuses", async () => {
    api.lookupCustomer.mockImplementation(async (phone: string) => {
      if (phone === "+971500000002") return omar({ bookable: false, status: "blocked", addresses: [] });
      throw apiError(422, "PHONE_COUNTRY_NOT_SUPPORTED", { country_code: "44", supported_country_codes: ["+971"] });
    });
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Phone" }));
    const phone = screen.getByRole("textbox", { name: /Customer mobile number/ });
    await user.type(phone, "0500000002");
    expect(await screen.findByText("This customer's account can't make bookings.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Customer" })).toBeInTheDocument();
    expect(phone).toHaveAccessibleDescription(/This customer's account can't make bookings\./);

    await user.clear(phone);
    await user.type(phone, "+44 7700 900123");
    // A number from outside the UAE is looked up once the field is left.
    await user.tab();
    // Each code isolated left-to-right ("+971" never reads "971+" in Arabic).
    const refused = await screen.findAllByText("We can't take numbers from this country yet. Numbers we take start with: ⁦+971⁩.");
    expect(refused.length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Customer" })).toBeInTheDocument();
    expect(phone).toHaveFocus();
  });

  it("waits out a rate-limited lookup and tries again after the seconds the API names", async () => {
    api.lookupCustomer.mockRejectedValueOnce(apiError(429, "RATE_LIMITED", { retry_after_seconds: 1 })).mockResolvedValueOnce(omar());
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /Customer mobile number/ }), "0500000002");
    expect(await screen.findByText("Too many lookups: trying again in 1 second.")).toBeInTheDocument();
    expect(await screen.findByText("Existing customer: Omar Khalid · 2 saved addresses", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(api.lookupCustomer).toHaveBeenCalledTimes(2);
  });

  it("says so when the lookup stays rate limited after its retries, offers to look up again and holds Next meanwhile", async () => {
    api.lookupCustomer.mockRejectedValue(apiError(429, "RATE_LIMITED", { retry_after_seconds: 1 }));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Phone" }));
    const phone = screen.getByRole("textbox", { name: /Customer mobile number/ });
    await user.type(phone, "0500000002");
    // The first try and two retries after the seconds the API names, then the wizard says the lookup gave up.
    const again = await screen.findByRole("button", { name: "Look up again" }, { timeout: 5000 });
    expect(api.lookupCustomer).toHaveBeenCalledTimes(3);
    expect(
      screen.getByText("Too many lookups right now, so we can't tell yet whether this customer exists. Wait 1 second, then look the number up again."),
    ).toBeInTheDocument();

    // Not taken for a new customer (whose saved addresses would be typed again): Next stays on this step.
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Customer" })).toBeInTheDocument();
    expect(phone).toHaveAccessibleDescription(/We couldn't check yet whether this customer exists/);

    api.lookupCustomer.mockResolvedValue(omar());
    await user.click(again);
    expect(await screen.findByText("Existing customer: Omar Khalid · 2 saved addresses")).toBeInTheDocument();
    expect(api.lookupCustomer).toHaveBeenCalledTimes(4);
    expect(phone).not.toHaveAccessibleDescription(/We couldn't check yet/);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("radio", { name: /^Home/ })).toBeInTheDocument();
  }, 10_000);

  it("looks up a number from outside the UAE once the field is left, never while it is still typed", async () => {
    api.lookupCustomer.mockImplementation(async (phone: string) => {
      if (phone === "+966501234567") return nobody(phone);
      throw apiError(422, "PHONE_INVALID");
    });
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    const phone = screen.getByRole("textbox", { name: /Customer mobile number/ });
    await user.type(phone, "+966 50 123");
    // A pause longer than the UAE lookup's wait, half way through the number: nothing is sent (it would be refused as
    // PHONE_INVALID and count against the lookups allowed a minute).
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(api.lookupCustomer).not.toHaveBeenCalled();
    expect(screen.getByText("Numbers from outside the UAE are looked up once you leave this field.")).toBeInTheDocument();
    expect(screen.queryByText("Looking for the customer…")).not.toBeInTheDocument();

    await user.type(phone, " 4567");
    await user.tab();
    expect(await screen.findByText("No customer has this number yet. A new customer is created with it.")).toBeInTheDocument();
    expect(api.lookupCustomer.mock.calls).toEqual([["+966501234567"]]);
  });

  it("isolates the country codes left-to-right in the Arabic refusal", async () => {
    api.lookupCustomer.mockRejectedValue(apiError(422, "PHONE_COUNTRY_NOT_SUPPORTED", { country_code: "44", supported_country_codes: ["+971"] }));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS, locale: "ar" });
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /رقم جوال العميل/ }), "+44 7700 900123");
    await user.tab();
    expect(await screen.findByText("لا نقبل أرقامًا من هذه الدولة بعد. الأرقام المقبولة تبدأ بـ: ⁦+971⁩.")).toBeInTheDocument();
  });

  it("offers only the time slots of the service's kind and the active add-ons of the chosen service", async () => {
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToDetails(user);
    await screen.findByText("This time can take the booking.");
    // The time step listed Morning and Evening only (no live-out or inactive slot): checked in chooseServiceAndSlot.
    const addons = screen.getByRole("group", { name: "Add-ons" });
    expect(within(addons).getAllByRole("checkbox")).toHaveLength(1);
    const materials = within(addons).getByRole("checkbox", { name: /Cleaning materials/ });
    expect(addons).toHaveTextContent("AED 15 per visit");

    api.previewManualBooking.mockResolvedValue(
      preview({ amounts: { subtotal_fils: 24000, addons_fils: 1500, discount_fils: 0, net_fils: 24286, vat_rate_bp: 500, vat_fils: 1214, total_fils: 25500, currency: "AED" } }),
    );
    await user.click(materials);
    // A change that matters asks again (debounced) and shows the new figures.
    await waitFor(() => expect(api.previewManualBooking).toHaveBeenCalledTimes(2));
    expect(api.previewManualBooking.mock.calls[1][0]).toMatchObject({ addons: ["MATERIALS"] });
    expect(await screen.findByText("AED 255")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create booking" }));
    await waitFor(() => expect(api.createManualBooking).toHaveBeenCalledTimes(1));
    expect(api.createManualBooking.mock.calls[0][0]).toMatchObject({ addons: ["MATERIALS"] });
  });

  it("offers the company's materials only while the service offers the materials add-on (D-02b)", async () => {
    // Today's catalog: MATERIALS is inactive and priced with no service, so the company can't bring materials.
    const noMaterials: AddonOption[] = [{ ...addonOptions[0], is_active: false, service_codes: [] }];
    api.fetchAddonOptions.mockResolvedValue(noMaterials);
    const { queryClient } = renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToDetails(user);
    expect(await screen.findByText("No add-ons for this service.")).toBeInTheDocument();
    const materials = screen.getByRole("combobox", { name: "Cleaning materials" });
    expect(within(materials).getAllByRole("option").map((o) => o.textContent)).toEqual(["As the service sets it", "Customer's own materials"]);

    // Once the add-on is offered with the service, so is the company's choice.
    act(() => {
      queryClient.setQueryData(adminKeys.addonPickList(), addonOptions);
    });
    await waitFor(() =>
      expect(within(materials).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "As the service sets it",
        "Customer's own materials",
        "Company brings the materials",
      ]),
    );
    await user.selectOptions(materials, "company");

    // The add-on goes away again: the choice goes back to the service's default (never a value the API refuses).
    act(() => {
      queryClient.setQueryData(adminKeys.addonPickList(), noMaterials);
    });
    await waitFor(() => expect(materials).toHaveValue(""));
    expect(within(materials).queryByRole("option", { name: "Company brings the materials" })).not.toBeInTheDocument();
  });

  it("marks a materials refusal of the price check on the materials field, and clears it once the choice changes", async () => {
    const needAddon = "Add the company cleaning materials option to have the company bring the materials.";
    api.previewManualBooking.mockImplementation(async (body: { materials_by: string | null; addons: string[] }) => {
      if (body.materials_by === "company" && !body.addons.includes("MATERIALS")) {
        throw apiError(422, "VALIDATION_FAILED", { fields: { materials_by: [needAddon] } });
      }
      return preview();
    });
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToDetails(user);
    await screen.findByText("This time can take the booking.");
    const materials = screen.getByRole("combobox", { name: "Cleaning materials" });
    expect(materials).not.toHaveAttribute("aria-invalid");

    await user.selectOptions(materials, "company");
    // The summary says to check the marked fields, and the field is marked with the API's message.
    await waitFor(() => expect(materials).toHaveAttribute("aria-invalid", "true"));
    expect(materials).toHaveAccessibleDescription(needAddon);
    const summary = screen.getByRole("region", { name: "Price and availability" });
    expect(summary).toHaveTextContent(needAddon);

    // Ordering the add-on makes the choice valid: the mark goes and the figures come back.
    await user.click(screen.getByRole("checkbox", { name: /Cleaning materials/ }));
    await waitFor(() => expect(materials).not.toHaveAttribute("aria-invalid"));
    expect(await within(summary).findByText("This time can take the booking.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create booking" }));
    await waitFor(() => expect(api.createManualBooking).toHaveBeenCalledTimes(1));
    expect(api.createManualBooking.mock.calls[0][0]).toMatchObject({ materials_by: "company", addons: ["MATERIALS"] });
  });

  it("says a full slot needs an override, and keeps the last figures while a rate-limited check waits", async () => {
    api.previewManualBooking.mockResolvedValue(preview({ availability: { status: "full", reason: "no_workers", bookable: false, remaining: 0 } }));
    renderWithProviders(<ManualBookingWizard />, { permissions: [...PERMISSIONS, "capacity.override"] });
    const user = userEvent.setup();
    await fillToDetails(user);
    expect(await screen.findByText("This time is full for this team")).toBeInTheDocument();
    expect(screen.getByText("Creating the booking needs an override: tick it above and give a reason, or choose another time.")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Book past the soft limits/ }));
    expect(screen.getByText("The override is ticked: the booking is created past the soft limits.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Override reason/ }), "Customer is a VIP and agreed");
    // The override and its reason change neither the price nor the check: no new preview.
    expect(api.previewManualBooking).toHaveBeenCalledTimes(1);

    api.previewManualBooking
      .mockRejectedValueOnce(apiError(429, "RATE_LIMITED", { retry_after_seconds: 1 }))
      .mockResolvedValueOnce(preview({ amounts: { subtotal_fils: 24000, addons_fils: 1500, discount_fils: 0, net_fils: 24286, vat_rate_bp: 500, vat_fils: 1214, total_fils: 25500, currency: "AED" } }));
    await user.click(screen.getByRole("checkbox", { name: /Cleaning materials/ }));
    expect(await screen.findByText(/Too many price checks: trying again in 1 second/)).toBeInTheDocument();
    // The last answer stays on screen meanwhile.
    expect(screen.getByRole("region", { name: "Price and availability" })).toHaveTextContent("TotalAED 240");
    expect(await screen.findByText("AED 255", undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("says when the add-ons could not be loaded, and loads them again on request", async () => {
    api.fetchAddonOptions.mockRejectedValueOnce(apiError(500, "SERVER_ERROR"));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToDetails(user);
    expect(await screen.findByText("We couldn't load the add-ons, so none can be added to this booking yet.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Add-ons" })).not.toBeInTheDocument();
    expect(screen.queryByText("No add-ons for this service.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load the add-ons again" }));
    const addons = await screen.findByRole("group", { name: "Add-ons" });
    expect(within(addons).getByRole("checkbox", { name: /Cleaning materials/ })).toBeInTheDocument();
    expect(api.fetchAddonOptions).toHaveBeenCalledTimes(2);
  });

  it("says the add-ons are loading", async () => {
    api.fetchAddonOptions.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToDetails(user);
    expect(screen.getByText("Loading the add-ons…")).toHaveAttribute("role", "status");
  });

  it("offers to load the times again when the slot list fails, keeping what was entered", async () => {
    // On opening the wizard and again when the time step mounts the picker (a failed query is tried once more on mount).
    api.fetchSlotTemplateOptions.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockRejectedValueOnce(apiError(500, "SERVER_ERROR"));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToTime(user);
    await user.selectOptions(await screen.findByRole("combobox", { name: /Service/ }), "STANDARD_VISIT");
    const slot = screen.getByRole("combobox", { name: /Time/ });
    await waitFor(() => expect(slot).toHaveAccessibleDescription(/^We couldn't load the times\./));
    // Nothing to close here: the times load again in place.
    expect(screen.queryByText(/Close this and open it again/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(slot).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a time", "Morning · 10:00–14:00", "Evening · 15:00–19:00"]));
    expect(screen.getByRole("combobox", { name: /Service/ })).toHaveValue("STANDARD_VISIT");
    await user.selectOptions(slot, "2");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Evening · 15:00–19:00/)).toBeInTheDocument();
  });

  it("shows a refusal of the price check like the creation's", async () => {
    api.previewManualBooking.mockRejectedValue(apiError(422, "ADDRESS_OUT_OF_SERVICE_AREA"));
    renderWithProviders(<ManualBookingWizard />, { permissions: PERMISSIONS });
    const user = userEvent.setup();
    await fillToDetails(user);
    const summary = screen.getByRole("region", { name: "Price and availability" });
    expect(await within(summary).findByText("This address is outside our service areas.")).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });
});
