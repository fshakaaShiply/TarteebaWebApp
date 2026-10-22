import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Driver, Vehicle } from "../types";
import { driverFormSchema, driverToFormValues, expiryState, usualDriverChoices, vehicleFormSchema, vehicleToFormValues } from "./fleet";

function issues(result: z.ZodSafeParseResult<unknown>): Record<string, string[]> {
  if (result.success) return {};
  const out: Record<string, string[]> = {};
  for (const issue of result.error.issues) (out[issue.path.join(".")] ??= []).push(issue.message);
  return out;
}

// DemoFleetSeeder (R-14): two vans × 7 seats, one driver each.
const van: Vehicle = {
  id: 1,
  plate_no: "DEMO-VAN-1",
  model: "Toyota Hiace",
  seats: 7,
  insurance_expires_at: "2027-10-22",
  registration_expires_at: "2027-10-22",
  status: "active",
  zone_id: 1,
  default_driver_id: 1,
  version: 1,
  created_at: null,
  updated_at: null,
};

const driver: Driver = {
  id: 1,
  staff_user_id: 6,
  license_no_last4: "0001",
  license_expires_at: "2028-10-22",
  phone: "+971500000009",
  status: "active",
  version: 1,
  created_at: null,
  updated_at: null,
};

describe("document expiry badge", () => {
  it("marks dates within 30 days as expiring soon and past dates as expired", () => {
    const today = "2026-10-22";
    expect(expiryState("2026-10-21", today)).toBe("expired");
    expect(expiryState("2026-10-22", today)).toBe("soon");
    expect(expiryState("2026-11-21", today)).toBe("soon");
    expect(expiryState("2026-11-22", today)).toBe("ok");
    expect(expiryState(null, today)).toBeNull();
  });
});

describe("usual driver picker (P2-08: one vehicle per driver)", () => {
  it("leaves out drivers of other vehicles and keeps the edited vehicle's own driver", () => {
    const drivesVan1 = { ...driver, vehicle: { id: 1, plate_no: "DEMO-VAN-1" } };
    const drivesVan2 = { ...driver, id: 2, vehicle: { id: 2, plate_no: "DEMO-VAN-2" } };
    const free = { ...driver, id: 3, vehicle: null };
    const noRelation = { ...driver, id: 4 };
    const all = [drivesVan1, drivesVan2, free, noRelation];
    expect(usualDriverChoices(all, null).map((d) => d.id)).toEqual([3, 4]);
    expect(usualDriverChoices(all, 1).map((d) => d.id)).toEqual([1, 3, 4]);
  });
});

describe("vehicle form (StoreVehicleRequest / UpdateVehicleRequest)", () => {
  it("round-trips a seeded van", () => {
    expect(vehicleFormSchema().parse(vehicleToFormValues(van))).toEqual({
      plate_no: "DEMO-VAN-1",
      model: "Toyota Hiace",
      seats: 7,
      status: "active",
      zone_id: 1,
      default_driver_id: 1,
      insurance_expires_at: "2027-10-22",
      registration_expires_at: "2027-10-22",
    });
  });

  it("checks plate, seats (1–20) and dates like the API, all at once", () => {
    const values = { ...vehicleToFormValues(null), plate_no: "#1", seats: "21", insurance_expires_at: "2026-13-01" };
    expect(issues(vehicleFormSchema().safeParse(values))).toEqual({
      plate_no: ["plateFormat"],
      seats: ["seats"],
      insurance_expires_at: ["date"],
    });
    expect(issues(vehicleFormSchema().safeParse({ ...values, plate_no: "", seats: "0", insurance_expires_at: "" }))).toEqual({
      plate_no: ["required"],
      seats: ["seats"],
    });
  });

  it("upper-cases the plate, empties become null, and leaves the driver out when it can't be listed", () => {
    const result = vehicleFormSchema({ withDriver: false }).parse({
      ...vehicleToFormValues(null),
      plate_no: " dxb 12345 ",
      model: " ",
      zone_id: "",
    });
    expect(result).toEqual({
      plate_no: "DXB 12345",
      model: null,
      seats: 7,
      status: "active",
      zone_id: null,
      insurance_expires_at: null,
      registration_expires_at: null,
    });
  });
});

describe("driver form (StoreDriverRequest / UpdateDriverRequest)", () => {
  it("needs a staff account and a licence of 4–40 characters to create", () => {
    expect(issues(driverFormSchema("create").safeParse(driverToFormValues(null)))).toEqual({
      staff_user_id: ["staffUserRequired"],
      license_no: ["required"],
    });
    expect(issues(driverFormSchema("create").safeParse({ ...driverToFormValues(null), staff_user_id: "6", license_no: "abc" }))).toEqual({
      license_no: ["licenseLength"],
    });
    expect(driverFormSchema("create").parse({ ...driverToFormValues(null), staff_user_id: "6", license_no: " dl-0001 " })).toEqual({
      staff_user_id: 6,
      license_no: "DL-0001",
      license_expires_at: null,
      phone: null,
      status: "active",
    });
  });

  it("never sends the account on edit, and keeps the licence when the field stays empty", () => {
    const values = driverToFormValues(driver);
    expect(values.license_no).toBe("");
    expect(driverFormSchema("edit").parse(values)).toEqual({
      license_expires_at: "2028-10-22",
      phone: "+971500000009",
      status: "active",
    });
    expect(driverFormSchema("edit").parse({ ...values, license_no: "NEW-12345" })).toMatchObject({ license_no: "NEW-12345" });
  });
});
