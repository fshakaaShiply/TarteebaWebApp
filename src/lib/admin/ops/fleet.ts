import { z } from "zod";
import { idSelect, parseWholeNumber } from "../catalog/fields";
import { daysBetween } from "../format";
import type { Driver, DriverStatus, Vehicle, VehicleStatus } from "../types";
import { addIssue, optionalDate, optionalText } from "./fields";

/*
 * A06 vehicles and drivers: form schemas mirroring app/Modules/Fleet/Http/Requests (StoreVehicleRequest,
 * UpdateVehicleRequest, StoreDriverRequest, UpdateDriverRequest) and the document-expiry badge.
 */

export const VEHICLE_STATUSES = ["active", "maintenance", "inactive"] as const satisfies readonly VehicleStatus[];
export const DRIVER_STATUSES = ["active", "inactive"] as const satisfies readonly DriverStatus[];

/** Vehicle::MAX_SEATS. */
export const MAX_SEATS = 20;
/** Documents expiring within this many days get the "expires soon" badge. */
export const EXPIRY_WARNING_DAYS = 30;

const PLATE = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;

export type ExpiryState = "expired" | "soon" | "ok";

/** expired before today, "soon" within 30 days (today included), otherwise ok; null without a date. */
export function expiryState(date: string | null | undefined, today: string, warningDays = EXPIRY_WARNING_DAYS): ExpiryState | null {
  if (!date) return null;
  const days = daysBetween(today, date);
  if (Number.isNaN(days)) return null;
  if (days < 0) return "expired";
  return days <= warningDays ? "soon" : "ok";
}

// ---- Vehicles --------------------------------------------------------------------------------------------------

export type VehicleFormValues = {
  plate_no: string;
  model: string;
  seats: string;
  status: VehicleStatus;
  zone_id: string;
  default_driver_id: string;
  insurance_expires_at: string;
  registration_expires_at: string;
};

export type VehiclePayload = {
  plate_no: string;
  model: string | null;
  seats: number;
  status: VehicleStatus;
  zone_id: number | null;
  default_driver_id?: number | null;
  insurance_expires_at: string | null;
  registration_expires_at: string | null;
};

/** Plate numbers are stored upper-case (FleetFields::vehicle). */
const plateInput = z.string().transform((raw, ctx): string => {
  const v = raw.trim().toUpperCase();
  if (v === "") addIssue(ctx, "required");
  else if (v.length > 20) addIssue(ctx, "plateLength");
  else if (!PLATE.test(v)) addIssue(ctx, "plateFormat");
  return v;
});

const seatsInput = z.string().transform((raw, ctx): number => {
  const v = parseWholeNumber(raw);
  if (v === null || v < 1 || v > MAX_SEATS) addIssue(ctx, "seats");
  return v ?? 0;
});

/** `withDriver` is false when the user cannot list drivers (no fleet.manage): the usual driver is then not sent. */
export function vehicleFormSchema(options: { withDriver: boolean } = { withDriver: true }) {
  return z
    .object({
      plate_no: plateInput,
      model: optionalText(80, "modelLength"),
      seats: seatsInput,
      status: z.enum(VEHICLE_STATUSES),
      zone_id: idSelect,
      default_driver_id: idSelect,
      insurance_expires_at: optionalDate,
      registration_expires_at: optionalDate,
    })
    .transform(
      (v): VehiclePayload => ({
        plate_no: v.plate_no,
        model: v.model,
        seats: v.seats,
        status: v.status,
        zone_id: v.zone_id,
        ...(options.withDriver ? { default_driver_id: v.default_driver_id } : {}),
        insurance_expires_at: v.insurance_expires_at,
        registration_expires_at: v.registration_expires_at,
      }),
    );
}

export function vehicleToFormValues(v: Vehicle | null): VehicleFormValues {
  return {
    plate_no: v?.plate_no ?? "",
    model: v?.model ?? "",
    seats: v ? String(v.seats) : "7",
    status: v?.status ?? "active",
    zone_id: v?.zone_id == null ? "" : String(v.zone_id),
    default_driver_id: v?.default_driver_id == null ? "" : String(v.default_driver_id),
    insurance_expires_at: v?.insurance_expires_at ?? "",
    registration_expires_at: v?.registration_expires_at ?? "",
  };
}

// ---- Drivers ---------------------------------------------------------------------------------------------------

export type DriverFormValues = {
  staff_user_id: string;
  license_no: string;
  license_expires_at: string;
  phone: string;
  status: DriverStatus;
};

export type DriverPayload = {
  staff_user_id?: number;
  license_no?: string;
  license_expires_at: string | null;
  phone: string | null;
  status: DriverStatus;
};

/**
 * Create links a staff account (required) and needs the licence number; edit never shows the stored number (the API
 * returns only its last characters), so an empty licence field keeps it and the staff account cannot change.
 */
export function driverFormSchema(mode: "create" | "edit") {
  return z
    .object({
      staff_user_id: z.string().transform((raw, ctx): number | undefined => {
        if (mode === "edit") return undefined;
        const n = parseWholeNumber(raw);
        if (n === null || n < 1) addIssue(ctx, "staffUserRequired");
        return n ?? undefined;
      }),
      license_no: z.string().transform((raw, ctx): string => {
        const v = raw.trim().toUpperCase();
        if (v === "" && mode === "create") addIssue(ctx, "required");
        else if (v !== "" && (v.length < 4 || v.length > 40)) addIssue(ctx, "licenseLength");
        return v;
      }),
      license_expires_at: optionalDate,
      phone: optionalText(30, "phoneLength"),
      status: z.enum(DRIVER_STATUSES),
    })
    .transform(
      (v): DriverPayload => ({
        ...(v.staff_user_id !== undefined ? { staff_user_id: v.staff_user_id } : {}),
        ...(v.license_no !== "" ? { license_no: v.license_no } : {}),
        license_expires_at: v.license_expires_at,
        phone: v.phone,
        status: v.status,
      }),
    );
}

export function driverToFormValues(d: Driver | null): DriverFormValues {
  return {
    staff_user_id: d ? String(d.staff_user_id) : "",
    license_no: "",
    license_expires_at: d?.license_expires_at ?? "",
    phone: d?.phone ?? "",
    status: d?.status ?? "active",
  };
}
