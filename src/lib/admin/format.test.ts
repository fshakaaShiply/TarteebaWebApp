import { describe, expect, it } from "vitest";
import { formatDateTime, formatLongDate } from "./format";

describe("admin date formatting", () => {
  // 2026-10-20 21:30 UTC is already 21 October 01:30 in Dubai (UTC+4).
  const lateEvening = "2026-10-20T21:30:00Z";

  it("uses the Dubai calendar day, whatever the browser time zone", () => {
    expect(formatLongDate(lateEvening, "en")).toContain("21 October 2026");
    expect(formatLongDate(lateEvening, "en")).toContain("Wednesday");
  });

  it("uses Latin digits in Arabic", () => {
    const ar = formatLongDate(lateEvening, "ar");
    expect(ar).toMatch(/21/);
    expect(ar).toMatch(/2026/);
    expect(ar).not.toMatch(/[٠-٩]/);
  });

  it("formats date and time in 24-hour Dubai time", () => {
    expect(formatDateTime(lateEvening, "en")).toMatch(/01:30/);
    expect(formatDateTime(lateEvening, "ar")).toMatch(/01:30/);
  });

  it("returns an empty string for missing or invalid values", () => {
    expect(formatDateTime(null, "en")).toBe("");
    expect(formatDateTime("not a date", "en")).toBe("");
  });
});
