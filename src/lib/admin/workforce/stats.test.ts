import { describe, expect, it } from "vitest";
import { MAX_STATS_DAYS, percentText, presetRange, rangeProblem } from "./stats";

describe("performance period (workforce §5.5)", () => {
  it("gives the three presets on a day in the middle of a month", () => {
    expect(presetRange("thisMonth", "2026-11-19")).toEqual({ from: "2026-11-01", to: "2026-11-19" });
    expect(presetRange("lastMonth", "2026-11-19")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("last3Months", "2026-11-19")).toEqual({ from: "2026-09-01", to: "2026-11-19" });
    expect(presetRange("custom", "2026-11-19")).toBeNull();
  });

  it("crosses the year and the short months", () => {
    expect(presetRange("lastMonth", "2027-01-05")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(presetRange("last3Months", "2027-01-05")).toEqual({ from: "2026-11-01", to: "2027-01-05" });
    expect(presetRange("lastMonth", "2026-03-01")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("refuses what the API refuses before asking: unreadable, backwards, after today, over 366 days", () => {
    const today = "2026-11-19";
    expect(rangeProblem({ from: "", to: today }, today)).toBe("invalid");
    expect(rangeProblem({ from: "2026-02-30", to: today }, today)).toBe("invalid");
    expect(rangeProblem({ from: "2026-11-10", to: "2026-11-09" }, today)).toBe("order");
    expect(rangeProblem({ from: "2026-11-10", to: "2026-11-20" }, today)).toBe("future");
    expect(rangeProblem({ from: "2025-11-18", to: today }, today)).toBe("tooLong");
    // 366 days counted from the first day to the last, both included, is still allowed.
    expect(rangeProblem({ from: "2025-11-19", to: today }, today)).toBeNull();
    expect(MAX_STATS_DAYS).toBe(366);
    expect(rangeProblem({ from: today, to: today }, today)).toBeNull();
  });

  it("shows a ratio as a whole percent, a dash with nothing to divide", () => {
    expect(percentText(25, 26)).toBe("96");
    expect(percentText(0, 26)).toBe("0");
    expect(percentText(1, 0)).toBe("—");
  });
});
