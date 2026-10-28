import { describe, expect, it } from "vitest";
import {
  MANUAL_DEFAULTS,
  bilingualMessage,
  companyMaterialsOffered,
  manualFormSchema,
  manualPayload,
  manualPreviewBody,
  normalizeUaePhone,
  parseCoordinates,
  stepOfField,
  whatsappLink,
  type ManualFormValues,
} from "./manual";

describe("new address position without a map (typed or pasted)", () => {
  it("reads “lat, lng” with a comma, an Arabic comma or a space, and Arabic digits", () => {
    expect(parseCoordinates("25.1865, 55.2730")).toEqual({ ok: true, lat: 25.1865, lng: 55.273 });
    expect(parseCoordinates("25.1865 55.2730")).toEqual({ ok: true, lat: 25.1865, lng: 55.273 });
    expect(parseCoordinates("٢٥٫١٨٦٥، ٥٥٫٢٧٣")).toEqual({ ok: true, lat: 25.1865, lng: 55.273 });
  });

  it("reads Google Maps links: the place pin first, then q=/query=, then the map centre", () => {
    const place = "https://www.google.com/maps/place/Bay+Square/@25.1872,55.2744,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.1873!4d55.2745";
    expect(parseCoordinates(place)).toEqual({ ok: true, lat: 25.1873, lng: 55.2745 });
    expect(parseCoordinates("https://maps.google.com/?q=25.2,55.3")).toEqual({ ok: true, lat: 25.2, lng: 55.3 });
    expect(parseCoordinates("https://www.google.com/maps/search/?api=1&query=25.2%2C55.3")).toEqual({ ok: true, lat: 25.2, lng: 55.3 });
    expect(parseCoordinates("https://www.google.ae/maps/@25.1,55.2,15z")).toEqual({ ok: true, lat: 25.1, lng: 55.2 });
  });

  it("explains what it cannot read", () => {
    expect(parseCoordinates("")).toEqual({ ok: false, error: "empty" });
    expect(parseCoordinates("https://maps.app.goo.gl/abc123")).toEqual({ ok: false, error: "shortLink" });
    expect(parseCoordinates("95, 55")).toEqual({ ok: false, error: "range" });
    expect(parseCoordinates("Business Bay")).toEqual({ ok: false, error: "invalid" });
    expect(parseCoordinates("https://www.google.com/maps/place/Bay+Square")).toEqual({ ok: false, error: "invalid" });
  });
});

describe("customer phone and WhatsApp", () => {
  it("writes UAE mobile numbers as E.164", () => {
    expect(normalizeUaePhone("050 123 4567")).toBe("+971501234567");
    expect(normalizeUaePhone("+971 50 123 4567")).toBe("+971501234567");
    expect(normalizeUaePhone("00971501234567")).toBe("+971501234567");
    expect(normalizeUaePhone("٠٥٠١٢٣٤٥٦٧")).toBe("+971501234567");
    expect(normalizeUaePhone("04 123 4567")).toBeNull();
    expect(normalizeUaePhone("hello")).toBeNull();
    // A UAE number is complete only at its full length; another country's may still be half typed (8–15 digits).
    expect(normalizeUaePhone("+971 50 123 456")).toBeNull();
    expect(normalizeUaePhone("+966 50 123")).toBe("+96650123");
  });

  it("opens WhatsApp with the message filled in, never sending it", () => {
    const link = whatsappLink("+971501234567", "Hello & welcome\nلينك");
    expect(link).toBe(`https://wa.me/971501234567?text=${encodeURIComponent("Hello & welcome\nلينك")}`);
    expect(whatsappLink("abc", "x")).toBeNull();
  });

  it("puts the customer's language first", () => {
    expect(bilingualMessage("en", { ar: "مرحبًا", en: "Hello" })).toBe("Hello\n\nمرحبًا");
    expect(bilingualMessage("ar", { ar: "مرحبًا", en: "Hello" })).toBe("مرحبًا\n\nHello");
  });
});

const filled: ManualFormValues = {
  ...MANUAL_DEFAULTS,
  source: "whatsapp",
  phone: "050 123 4567",
  name: "Sara",
  label: "Home",
  propertyType: "apartment",
  building: "Tower 1",
  coordinates: "25.1865, 55.2730",
  hasPets: true,
  petsNote: "A friendly cat",
  service: "STANDARD_VISIT",
  workersCount: "2",
  serviceDate: "2026-10-26",
  slotTemplateId: "1",
  priorities: ["kitchen", "nope"],
};

const issues = (values: ManualFormValues, bounds?: { minWorkers: number; maxWorkers: number }) => {
  const result = manualFormSchema(bounds).safeParse(values);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("manual booking wizard checks", () => {
  it("accepts a complete booking", () => {
    expect(issues(filled)).toEqual({});
  });

  it("requires the source, a mobile number, the address essentials, the service, team, date and time", () => {
    expect(issues({ ...MANUAL_DEFAULTS, workersCount: "0" })).toEqual({
      source: "sourceRequired",
      phone: "phoneInvalid",
      label: "labelRequired",
      propertyType: "propertyTypeRequired",
      coordinates: "coordinatesEmpty",
      service: "serviceRequired",
      workersCount: "workersRange",
      serviceDate: "dateRequired",
      slotTemplateId: "slotRequired",
    });
  });

  it("checks the team size against the service and an override's reason", () => {
    expect(issues({ ...filled, workersCount: "5" }, { minWorkers: 1, maxWorkers: 4 })).toEqual({ workersCount: "workersRange" });
    expect(issues({ ...filled, override: true, reason: "full" })).toEqual({ reason: "reasonMin" });
    expect(issues({ ...filled, override: true, reason: "Customer is a VIP, ops agreed" })).toEqual({});
  });

  it("needs only the address id for a saved address", () => {
    expect(issues({ ...filled, addressMode: "existing", addressId: "", label: "", coordinates: "" })).toEqual({ addressId: "addressRequired" });
  });

  it("builds the POST /admin/bookings body", () => {
    expect(manualPayload(filled)).toEqual({
      source: "whatsapp",
      customer: { phone: "+971501234567", name: "Sara", locale: "ar" },
      address: {
        label: "Home",
        property_type: "apartment",
        building: "Tower 1",
        unit_number: null,
        street: null,
        area_text: null,
        lat: 25.1865,
        lng: 55.273,
        access_instructions: null,
        has_pets: true,
        pets_note: "A friendly cat",
        parking_available: false,
        entry_permit_required: false,
        cleaning_materials_available: false,
      },
      service: "STANDARD_VISIT",
      service_date: "2026-10-26",
      slot_template_id: 1,
      workers_count: 2,
      addons: [],
      priorities: ["kitchen"],
      instructions: null,
      materials_by: null,
      preferred_worker_id: null,
      internal_note: null,
    });
    const saved = manualPayload({ ...filled, addressMode: "existing", addressId: "01m5jws7gh651r5cbkf1d91kyk", override: true, reason: "  agreed with ops  " });
    expect(saved.address).toEqual({ id: "01m5jws7gh651r5cbkf1d91kyk" });
    expect(saved).toMatchObject({ override: true, reason: "agreed with ops" });
  });

  it("sends the number the customer lookup normalized, and only the add-ons the service offers", () => {
    // meta.phone wins over our own reading of the field (here they differ on purpose).
    const body = manualPayload({ ...filled, phone: "0501234567", addons: ["MATERIALS", "IRONING"] }, { phone: "+971501234599", addons: new Set(["MATERIALS"]) });
    expect(body.customer.phone).toBe("+971501234599");
    expect(body.addons).toEqual(["MATERIALS"]);
    // libphonenumber drops a national trunk 0 our reading keeps: the lookup's number is what goes out.
    expect(manualPayload({ ...filled, phone: "+44 07700 900123" }, { phone: "+447700900123" }).customer.phone).toBe("+447700900123");
    expect(manualPayload({ ...filled, phone: "+44 07700 900123" }).customer.phone).toBe("+4407700900123");
    // Before the add-ons are known, the chosen codes go as they are (the API checks them).
    expect(manualPayload({ ...filled, addons: ["MATERIALS"] }).addons).toEqual(["MATERIALS"]);
  });

  it("previews the body without notes or the override (they change neither the price nor the slot check)", () => {
    const body = JSON.parse(
      manualPreviewBody(manualPayload({ ...filled, instructions: "Ring twice", internalNote: "VIP", override: true, reason: "Customer is a VIP, ops agreed" })),
    );
    expect(body).toMatchObject({ service: "STANDARD_VISIT", slot_template_id: 1, workers_count: 2, instructions: null, internal_note: null, priorities: [] });
    expect(body).not.toHaveProperty("override");
    expect(body).not.toHaveProperty("reason");
    // Typing a note keeps the same preview body (no new request).
    expect(manualPreviewBody(manualPayload({ ...filled, instructions: "a" }))).toBe(manualPreviewBody(manualPayload({ ...filled, instructions: "ab" })));
  });

  it("knows which step holds a field", () => {
    expect(stepOfField("phone")).toBe(0);
    expect(stepOfField("coordinates")).toBe(1);
    expect(stepOfField("slotTemplateId")).toBe(2);
    expect(stepOfField("internalNote")).toBe(3);
    expect(stepOfField("materialsBy")).toBe(3);
  });

  it("offers the company's materials only with included materials or the MATERIALS add-on offered (D-02b)", () => {
    expect(companyMaterialsOffered("company_included", null)).toBe(true);
    expect(companyMaterialsOffered("company_addon", new Set(["MATERIALS", "FRIDGE"]))).toBe(true);
    // The add-on inactive or not priced with the service: the pick-list leaves it out.
    expect(companyMaterialsOffered("company_addon", new Set(["FRIDGE"]))).toBe(false);
    expect(companyMaterialsOffered("customer", new Set())).toBe(false);
    // Not known yet (add-ons or the service still loading).
    expect(companyMaterialsOffered(undefined, null)).toBe(false);
  });
});
