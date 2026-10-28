import { describe, expect, it } from "vitest";
import { NO_BOOKING_FILTERS, dateRangeValid, filtersFromParams, filtersToParams, filtersToQuery, hasFilters } from "./filters";

describe("A03 list filters in the URL", () => {
  it("reads the filters a dashboard link sets", () => {
    const filters = filtersFromParams(new URLSearchParams("status=pending_confirmation&from=2026-10-23&to=2026-10-23&page=2"));
    expect(filters).toMatchObject({ status: "pending_confirmation", from: "2026-10-23", to: "2026-10-23", page: 2 });
  });

  it("reads the slot, worker and driver by the API's own names", () => {
    const filters = filtersFromParams(new URLSearchParams("slot_template_id=2&worker_id=14&driver_id=3"));
    expect(filters).toMatchObject({ slot_template_id: "2", worker_id: "14", driver_id: "3" });
  });

  it("ignores unknown or malformed values", () => {
    const filters = filtersFromParams(
      new URLSearchParams(
        "status=lost&payment_status=paid&from=2026-02-30&source=fax&service=a%20b&page=-3&cancel_review=yes&slot_template_id=0&worker_id=abc&driver_id=-2",
      ),
    );
    expect(filters).toEqual(NO_BOOKING_FILTERS);
  });

  it("writes only what is set, page 1 implied", () => {
    const params = filtersToParams({ ...NO_BOOKING_FILTERS, payment_status: "verifying", search: "055 ", cancel_review: true });
    // The search stays as typed (the trailing space of "055 987" while typing); only blanks are dropped.
    expect(params.toString()).toBe("payment_status=verifying&search=055+&cancel_review=1");
    expect(filtersToParams({ ...NO_BOOKING_FILTERS, search: "   " }).toString()).toBe("");
    expect(filtersToParams({ ...NO_BOOKING_FILTERS, slot_template_id: "2", worker_id: "14", driver_id: "3" }).toString()).toBe(
      "slot_template_id=2&worker_id=14&driver_id=3",
    );
    expect(hasFilters(NO_BOOKING_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_BOOKING_FILTERS, page: 4 })).toBe(false);
    expect(hasFilters({ ...NO_BOOKING_FILTERS, source: "whatsapp" })).toBe(true);
    expect(hasFilters({ ...NO_BOOKING_FILTERS, driver_id: "3" })).toBe(true);
  });

  it("turns the filters and the shared zone into the API query", () => {
    const query = filtersToQuery(
      { ...NO_BOOKING_FILTERS, status: "confirmed", service: "STANDARD_VISIT", source: "phone", from: "2026-10-01", page: 3, worker_id: "14" },
      2,
      25,
    );
    expect(query).toEqual({
      page: 3,
      perPage: 25,
      status: "confirmed",
      paymentStatus: "",
      from: "2026-10-01",
      to: undefined,
      zoneId: 2,
      service: "STANDARD_VISIT",
      source: "phone",
      search: undefined,
      cancelReview: undefined,
      slotTemplateId: null,
      workerId: 14,
      driverId: null,
    });
  });

  it("waits for a valid date range", () => {
    expect(dateRangeValid({ from: "2026-10-24", to: "2026-10-23" })).toBe(false);
    expect(dateRangeValid({ from: "2026-10-23", to: "" })).toBe(true);
  });
});
