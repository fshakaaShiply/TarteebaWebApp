import { describe, expect, it } from "vitest";
import { NO_SUBSCRIPTION_FILTERS, filtersFromParams, filtersToParams, filtersToQuery, hasFilters, renewalRangeValid, toggleStatus } from "./filters";

const params = (query: string) => filtersFromParams(new URLSearchParams(query));

describe("A08 list filters", () => {
  it("reads the overview's links: pending requests, the cancellation review queue with its zone", () => {
    expect(params("status=pending_confirmation")).toMatchObject({ status: ["pending_confirmation"], cancel_review: false });
    expect(params("cancel_review=1&zone_id=2")).toMatchObject({ cancel_review: true, zone_id: "2" });
  });

  it("keeps several statuses as the API's comma list and drops unknown ones", () => {
    const filters = params("status=active,paused,bogus,active");
    expect(filters.status).toEqual(["active", "paused"]);
    expect(filtersToParams(filters).get("status")).toBe("active,paused");
  });

  it("ignores malformed values", () => {
    const filters = params("type=weekly&payment_health=oops&renewal_from=2026-02-30&zone_id=0&worker_id=abc&page=-3");
    expect(filters).toEqual(NO_SUBSCRIPTION_FILTERS);
  });

  it("round-trips every filter through the URL with the API's own names", () => {
    const filters = {
      type: "live_out" as const,
      status: ["active" as const],
      payment_health: "renewal_failed" as const,
      renewal_from: "2026-11-01",
      renewal_to: "2026-11-30",
      zone_id: "1",
      worker_id: "14",
      conflicts: true,
      cancel_review: true,
      search: "TRS-7K2",
      page: 3,
    };
    const out = filtersToParams(filters);
    expect(Object.fromEntries(out)).toEqual({
      type: "live_out",
      status: "active",
      payment_health: "renewal_failed",
      renewal_from: "2026-11-01",
      renewal_to: "2026-11-30",
      zone_id: "1",
      worker_id: "14",
      conflicts: "1",
      cancel_review: "1",
      q: "TRS-7K2",
      page: "3",
    });
    expect(filtersFromParams(out)).toEqual(filters);
  });

  it("knows when a filter is set and when the renewal range is backwards", () => {
    expect(hasFilters(NO_SUBSCRIPTION_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_SUBSCRIPTION_FILTERS, page: 4 })).toBe(false);
    expect(hasFilters({ ...NO_SUBSCRIPTION_FILTERS, conflicts: true })).toBe(true);
    expect(renewalRangeValid({ renewal_from: "2026-11-30", renewal_to: "2026-11-01" })).toBe(false);
    expect(renewalRangeValid({ renewal_from: "2026-11-01", renewal_to: "" })).toBe(true);
  });

  it("toggles a status chip on and off and goes back to page 1", () => {
    const on = toggleStatus({ ...NO_SUBSCRIPTION_FILTERS, page: 3 }, "paused");
    expect(on).toMatchObject({ status: ["paused"], page: 1 });
    expect(toggleStatus(on, "paused").status).toEqual([]);
  });

  it("builds the API query", () => {
    const query = filtersToQuery({ ...NO_SUBSCRIPTION_FILTERS, status: ["active", "paused"], zone_id: "2", worker_id: "", search: " Sara ", cancel_review: true }, 25);
    expect(query).toMatchObject({ page: 1, perPage: 25, status: ["active", "paused"], zoneId: 2, workerId: null, cancelReview: true, search: "Sara" });
  });
});
