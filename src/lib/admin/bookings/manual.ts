import { z } from "zod";
import { normalizeDigits } from "@/lib/money";
import type { ManualBookingPayload } from "../endpoints";
import { isIsoDate } from "../format";
import { FORCE_REASON_MAX, checkForceReason } from "../ops/capacity";
import type { CleaningArea, PropertyType } from "../types";

/*
 * A03 manual booking wizard (spec §6.2, §14.3, §17; POST /admin/bookings, bookings.create_manual). A coordinator books
 * for a customer who called or wrote: the source is required, the customer is found or created by phone, the address
 * is one the customer already has or a new one, and the booking then waits for the customer to pay the link. The web
 * sends nothing itself: the coordinator copies the link or opens WhatsApp with the message ready.
 *
 * DECISION: no map key yet, so a new address's position is typed as "lat, lng" or pasted from a Google Maps link and
 * checked against the service zones (POST /public/zones/check) before the booking is sent.
 */

export const MANUAL_SOURCES = ["phone", "whatsapp", "admin"] as const;
export const PROPERTY_TYPES = ["apartment", "villa", "townhouse", "office"] as const satisfies readonly PropertyType[];
export const CLEANING_AREAS = ["kitchen", "bathrooms", "bedrooms", "living_areas", "balcony", "windows"] as const satisfies readonly CleaningArea[];

/** Limits of CreateManualBookingRequest. */
export const MANUAL_LIMITS = {
  name: 120,
  label: 40,
  building: 120,
  unit: 40,
  street: 160,
  area: 160,
  access: 500,
  petsNote: 255,
  instructions: 1000,
  note: 2000,
  addons: 10,
} as const;

// ---- Phone ----------------------------------------------------------------------------------------------------------

/**
 * A UAE mobile number written any usual way ("050 123 4567", "+971 50 123 4567", "00971501234567", Arabic digits) as
 * E.164, or null when it does not look like one. The API normalizes again (libphonenumber) and has the last word.
 */
export function normalizeUaePhone(input: string): string | null {
  const raw = normalizeDigits(input).trim().replace(/[\s\-().]/g, "");
  if (raw === "") return null;
  let digits: string;
  if (raw.startsWith("+")) digits = raw.slice(1);
  else if (raw.startsWith("00")) digits = raw.slice(2);
  else if (raw.startsWith("971")) digits = raw;
  else if (raw.startsWith("0")) digits = `971${raw.slice(1)}`;
  else digits = `971${raw}`;
  if (!/^\d+$/.test(digits)) return null;
  // UAE mobile numbers: +971 5X XXX XXXX. Other countries are left to the API (supported country codes).
  if (digits.startsWith("971")) return /^9715\d{8}$/.test(digits) ? `+${digits}` : null;
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}

// ---- Coordinates -----------------------------------------------------------------------------------------------------

export type CoordinatesError = "empty" | "invalid" | "range" | "shortLink";
export type CoordinatesResult = { ok: true; lat: number; lng: number } | { ok: false; error: CoordinatesError };

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

function pair(lat: string, lng: string): CoordinatesResult {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, error: "invalid" };
  if (a < -90 || a > 90 || b < -180 || b > 180) return { ok: false, error: "range" };
  const round = (n: number) => Math.round(n * 1e7) / 1e7;
  return { ok: true, lat: round(a), lng: round(b) };
}

/**
 * "25.1865, 55.2730" (comma, Arabic comma or space; Arabic digits allowed) or a Google Maps link: the place pin
 * (!3d…!4d…), a q= / query= / ll= value, or the map centre (@lat,lng). Short links (maps.app.goo.gl) cannot be read
 * without opening them: the coordinator opens it and copies the full link or the numbers.
 */
export function parseCoordinates(input: string): CoordinatesResult {
  const text = normalizeDigits(input).trim().replace(/،/g, ",");
  if (text === "") return { ok: false, error: "empty" };

  if (/^(https?:\/\/)?(www\.)?(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text)) return { ok: false, error: "shortLink" };

  if (/^(https?:\/\/)?[\w.-]*google\.[a-z.]+\/maps|^(https?:\/\/)?maps\.google\./i.test(text)) {
    let decoded = text;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      // keep the raw text
    }
    const pin = new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`).exec(decoded);
    if (pin) return pair(pin[1], pin[2]);
    const query = new RegExp(String.raw`[?&](?:q|query|ll|destination)=(${NUMBER})\s*,\s*(${NUMBER})`).exec(decoded);
    if (query) return pair(query[1], query[2]);
    const centre = new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`).exec(decoded);
    if (centre) return pair(centre[1], centre[2]);
    return { ok: false, error: "invalid" };
  }

  const plain = new RegExp(String.raw`^(${NUMBER})\s*[,\s]\s*(${NUMBER})$`).exec(text);
  if (plain) return pair(plain[1], plain[2]);
  return { ok: false, error: "invalid" };
}

// ---- WhatsApp -------------------------------------------------------------------------------------------------------

/**
 * "Open WhatsApp" with the message filled in (wa.me click-to-chat). Nothing is sent: WhatsApp opens on the
 * coordinator's device with the text ready, and the coordinator sends it.
 */
export function whatsappLink(phoneE164: string, message: string): string | null {
  const digits = phoneE164.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** The customer's language first, then the other one. */
export function bilingualMessage(locale: "ar" | "en", texts: { ar: string; en: string }): string {
  return locale === "en" ? `${texts.en}\n\n${texts.ar}` : `${texts.ar}\n\n${texts.en}`;
}

// ---- Form -----------------------------------------------------------------------------------------------------------

export type ManualFormValues = {
  source: string;
  phone: string;
  name: string;
  locale: "ar" | "en";
  addressMode: "existing" | "new";
  addressId: string;
  label: string;
  propertyType: string;
  building: string;
  unitNumber: string;
  street: string;
  areaText: string;
  coordinates: string;
  accessInstructions: string;
  hasPets: boolean;
  petsNote: string;
  parkingAvailable: boolean;
  entryPermitRequired: boolean;
  cleaningMaterialsAvailable: boolean;
  service: string;
  workersCount: string;
  serviceDate: string;
  slotTemplateId: string;
  addons: string[];
  priorities: string[];
  instructions: string;
  materialsBy: "" | "customer" | "company";
  preferredWorkerId: string;
  internalNote: string;
  override: boolean;
  reason: string;
};

export const MANUAL_DEFAULTS: ManualFormValues = {
  source: "",
  phone: "",
  name: "",
  locale: "ar",
  addressMode: "new",
  addressId: "",
  label: "",
  propertyType: "",
  building: "",
  unitNumber: "",
  street: "",
  areaText: "",
  coordinates: "",
  accessInstructions: "",
  hasPets: false,
  petsNote: "",
  parkingAvailable: false,
  entryPermitRequired: false,
  cleaningMaterialsAvailable: false,
  service: "",
  workersCount: "1",
  serviceDate: "",
  slotTemplateId: "",
  addons: [],
  priorities: [],
  instructions: "",
  materialsBy: "",
  preferredWorkerId: "",
  internalNote: "",
  override: false,
  reason: "",
};

/** Message keys under admin.manual.errors. */
export type ManualErrorKey =
  | "required"
  | "sourceRequired"
  | "phoneInvalid"
  | "tooLong"
  | "addressRequired"
  | "propertyTypeRequired"
  | "labelRequired"
  | "coordinatesEmpty"
  | "coordinatesInvalid"
  | "coordinatesRange"
  | "coordinatesShortLink"
  | "serviceRequired"
  | "workersRange"
  | "dateRequired"
  | "slotRequired"
  | "tooManyAddons"
  | "reasonMin"
  | "reasonMax";

const COORDINATE_ERRORS: Record<CoordinatesError, ManualErrorKey> = {
  empty: "coordinatesEmpty",
  invalid: "coordinatesInvalid",
  range: "coordinatesRange",
  shortLink: "coordinatesShortLink",
};

/** The fields each step checks before the next one opens. */
export const MANUAL_STEPS = [
  ["source", "phone", "name", "locale"],
  ["addressId", "label", "propertyType", "building", "unitNumber", "street", "areaText", "coordinates", "accessInstructions", "petsNote"],
  ["service", "workersCount", "serviceDate", "slotTemplateId"],
  ["addons", "priorities", "instructions", "preferredWorkerId", "internalNote", "reason"],
] as const satisfies readonly (readonly (keyof ManualFormValues)[])[];

type Bounds = { minWorkers: number; maxWorkers: number };

/** The wizard's checks (the API validates everything again). `bounds` is the chosen service's team size range. */
export function manualFormSchema(bounds: Bounds = { minWorkers: 1, maxWorkers: 20 }) {
  return z
    .custom<ManualFormValues>()
    .superRefine((v, ctx) => {
      const issue = (path: keyof ManualFormValues, message: ManualErrorKey) => ctx.addIssue({ code: "custom", path: [path], message });
      const tooLong = (path: keyof ManualFormValues, max: number) => {
        if (String(v[path] ?? "").trim().length > max) issue(path, "tooLong");
      };

      if (!(MANUAL_SOURCES as readonly string[]).includes(v.source)) issue("source", "sourceRequired");
      if (!normalizeUaePhone(v.phone)) issue("phone", "phoneInvalid");
      tooLong("name", MANUAL_LIMITS.name);

      if (v.addressMode === "existing") {
        if (!v.addressId) issue("addressId", "addressRequired");
      } else {
        if (!v.label.trim()) issue("label", "labelRequired");
        tooLong("label", MANUAL_LIMITS.label);
        if (!(PROPERTY_TYPES as readonly string[]).includes(v.propertyType)) issue("propertyType", "propertyTypeRequired");
        tooLong("building", MANUAL_LIMITS.building);
        tooLong("unitNumber", MANUAL_LIMITS.unit);
        tooLong("street", MANUAL_LIMITS.street);
        tooLong("areaText", MANUAL_LIMITS.area);
        tooLong("accessInstructions", MANUAL_LIMITS.access);
        tooLong("petsNote", MANUAL_LIMITS.petsNote);
        const coordinates = parseCoordinates(v.coordinates);
        if (!coordinates.ok) issue("coordinates", COORDINATE_ERRORS[coordinates.error]);
      }

      if (!v.service) issue("service", "serviceRequired");
      const workers = Number(v.workersCount);
      if (!Number.isInteger(workers) || workers < bounds.minWorkers || workers > bounds.maxWorkers) issue("workersCount", "workersRange");
      if (!isIsoDate(v.serviceDate)) issue("serviceDate", "dateRequired");
      if (!v.slotTemplateId) issue("slotTemplateId", "slotRequired");

      if (v.addons.length > MANUAL_LIMITS.addons) issue("addons", "tooManyAddons");
      tooLong("instructions", MANUAL_LIMITS.instructions);
      tooLong("internalNote", MANUAL_LIMITS.note);
      if (v.override) {
        const problem = checkForceReason(v.reason);
        if (problem === "forceReasonMin") issue("reason", "reasonMin");
        else if (problem) issue("reason", "reasonMax");
      } else if (v.reason.trim().length > FORCE_REASON_MAX) {
        issue("reason", "reasonMax");
      }
    });
}

const text = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** The POST /admin/bookings body from valid form values. */
export function manualPayload(v: ManualFormValues): ManualBookingPayload {
  const coordinates = parseCoordinates(v.coordinates);
  const address: ManualBookingPayload["address"] =
    v.addressMode === "existing"
      ? { id: v.addressId }
      : {
          label: v.label.trim(),
          property_type: v.propertyType as PropertyType,
          building: text(v.building),
          unit_number: text(v.unitNumber),
          street: text(v.street),
          area_text: text(v.areaText),
          lat: coordinates.ok ? coordinates.lat : NaN,
          lng: coordinates.ok ? coordinates.lng : NaN,
          access_instructions: text(v.accessInstructions),
          has_pets: v.hasPets,
          pets_note: v.hasPets ? text(v.petsNote) : null,
          parking_available: v.parkingAvailable,
          entry_permit_required: v.entryPermitRequired,
          cleaning_materials_available: v.cleaningMaterialsAvailable,
        };
  return {
    source: v.source as ManualBookingPayload["source"],
    customer: { phone: normalizeUaePhone(v.phone) ?? v.phone.trim(), name: text(v.name), locale: v.locale },
    address,
    service: v.service,
    service_date: v.serviceDate,
    slot_template_id: Number(v.slotTemplateId),
    workers_count: Number(v.workersCount),
    addons: v.addons,
    priorities: v.priorities.filter((p): p is CleaningArea => (CLEANING_AREAS as readonly string[]).includes(p)),
    instructions: text(v.instructions),
    materials_by: v.materialsBy === "" ? null : v.materialsBy,
    preferred_worker_id: v.preferredWorkerId ? Number(v.preferredWorkerId) : null,
    internal_note: text(v.internalNote),
    ...(v.override ? { override: true, reason: v.reason.trim() } : {}),
  };
}

/** API field names (VALIDATION_FAILED) → wizard fields. */
export const MANUAL_FIELD_MAP: Record<string, keyof ManualFormValues> = {
  source: "source",
  "customer.phone": "phone",
  "customer.name": "name",
  "customer.locale": "locale",
  "address.id": "addressId",
  "address.label": "label",
  "address.property_type": "propertyType",
  "address.building": "building",
  "address.unit_number": "unitNumber",
  "address.street": "street",
  "address.area_text": "areaText",
  "address.lat": "coordinates",
  "address.lng": "coordinates",
  "address.access_instructions": "accessInstructions",
  "address.pets_note": "petsNote",
  service: "service",
  service_date: "serviceDate",
  slot_template_id: "slotTemplateId",
  workers_count: "workersCount",
  addons: "addons",
  priorities: "priorities",
  instructions: "instructions",
  materials_by: "materialsBy",
  preferred_worker_id: "preferredWorkerId",
  internal_note: "internalNote",
  reason: "reason",
};

/** The wizard step that holds a field (to go back to the first step with an error). */
export function stepOfField(field: keyof ManualFormValues): number {
  const index = MANUAL_STEPS.findIndex((fields) => (fields as readonly string[]).includes(field));
  return index < 0 ? MANUAL_STEPS.length - 1 : index;
}
