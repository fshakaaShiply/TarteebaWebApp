import { describe, expect, it } from "vitest";
import { endAfterName, formatDateTime, formatLongDate, isolate, textDir, zonedDateTimeIso } from "./format";

describe("text set into a sentence of the other direction", () => {
  it("reads a text's direction from its first letter outside isolates, as the bidi algorithm's rule P2 does", () => {
    // dir="auto" in a browser takes the "O" of the isolated name and lays the Arabic sentence out left to right.
    expect(textDir(`${isolate("Omar Khalid")} · اشتراك شهري يبدأ الأحد.`)).toBe("rtl");
    expect(textDir(`${isolate("سارة")} asked for a subscription.`)).toBe("ltr");
    expect(textDir(`${isolate("+971500000003", "ltr")} طلب اشتراكًا`)).toBe("rtl");
    // Nested isolates, digits and punctuation are passed over; a mark counts as a letter.
    expect(textDir(`⁨${isolate("Maria")} S.⁩ 12:00 · طلب`)).toBe("rtl");
    expect(textDir("‏TRL-4YN6AB")).toBe("rtl");
    expect(textDir("TRL-4YN6AB طلب")).toBe("ltr");
    expect(textDir(`12:00 ${isolate("Siti R.")}`)).toBe("auto");
    expect(textDir("")).toBe("auto");
    expect(textDir(null)).toBe("auto");
  });

  it("keeps one final mark after an isolated name that ends with its own", () => {
    expect(endAfterName(`serving: ${isolate("Siti R.")}.`)).toBe(`serving: ${isolate("Siti R.")}`);
    expect(endAfterName(`تخدمه: ${isolate("Siti R.")}.`)).toBe(`تخدمه: ${isolate("Siti R.")}`);
    expect(endAfterName(`serving: ${isolate("Rosa")}.`)).toBe(`serving: ${isolate("Rosa")}.`);
    // Only after a name: a sentence's own ellipsis is left alone.
    expect(endAfterName("Wait...")).toBe("Wait...");
    expect(endAfterName("Siti R..")).toBe("Siti R..");
  });
});

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

describe("wall-clock time to an instant (spec §4.1: always convert via the zone)", () => {
  it("reads the business zone's offset for that date", () => {
    expect(zonedDateTimeIso("2026-10-24", "09:20")).toBe("2026-10-24T09:20:00+04:00");
    expect(zonedDateTimeIso("2026-01-03", "00:00")).toBe("2026-01-03T00:00:00+04:00");
    expect(Date.parse(zonedDateTimeIso("2026-10-24", "09:20") ?? "")).toBe(Date.parse("2026-10-24T05:20:00Z"));
  });

  it("follows a zone's own rules, daylight saving and half hours included, instead of a fixed offset", () => {
    expect(zonedDateTimeIso("2026-07-01", "09:00", "Europe/London")).toBe("2026-07-01T09:00:00+01:00");
    expect(zonedDateTimeIso("2026-12-01", "09:00", "Europe/London")).toBe("2026-12-01T09:00:00+00:00");
    expect(zonedDateTimeIso("2026-07-01", "23:30", "America/New_York")).toBe("2026-07-01T23:30:00-04:00");
    expect(zonedDateTimeIso("2026-12-01", "23:30", "America/New_York")).toBe("2026-12-01T23:30:00-05:00");
    expect(zonedDateTimeIso("2026-10-24", "10:00", "Asia/Kolkata")).toBe("2026-10-24T10:00:00+05:30");
  });

  it("refuses a malformed date or time", () => {
    expect(zonedDateTimeIso("2026-02-30", "09:00")).toBeNull();
    expect(zonedDateTimeIso("2026-10-24", "9:00")).toBeNull();
    expect(zonedDateTimeIso("2026-10-24", "24:00")).toBeNull();
  });
});
