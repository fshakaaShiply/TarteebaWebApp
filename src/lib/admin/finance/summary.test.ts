import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import { firstOfMonth, summaryFieldErrors, summaryPeriod } from "./summary";

describe("A09 finance summary period", () => {
  it("defaults to month to date, the way the API does", () => {
    expect(firstOfMonth("2026-10-19")).toBe("2026-10-01");
    expect(summaryPeriod({ from: "", to: "" }, "2026-10-23")).toEqual({ from: "2026-10-01", to: "2026-10-23" });
    // Only the end chosen: the start is the first day of that month.
    expect(summaryPeriod({ from: "", to: "2026-09-15" }, "2026-10-23")).toEqual({ from: "2026-09-01", to: "2026-09-15" });
    // Only the start chosen: until today.
    expect(summaryPeriod({ from: "2026-01-01", to: "" }, "2026-10-23")).toEqual({ from: "2026-01-01", to: "2026-10-23" });
    expect(summaryPeriod({ from: "2026-02-01", to: "2026-02-28" }, "2026-10-23")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("reads the API's own period and zone messages from a 422", () => {
    const refused = new AdminApiError(422, {
      code: "VALIDATION_FAILED",
      message: "The given data was invalid.",
      details: { fields: { to: ["Choose a period of at most 366 days."], zone_id: ["The selected zone is invalid."], page: ["Nope"] } },
    });
    expect(summaryFieldErrors(refused)).toEqual({
      to: "Choose a period of at most 366 days.",
      zone_id: "The selected zone is invalid.",
      other: ["Nope"],
    });
    expect(summaryFieldErrors(new AdminApiError(500, { code: "SERVER_ERROR", message: "", details: {} }))).toBeNull();
    expect(summaryFieldErrors(AdminApiError.network())).toBeNull();
  });
});
