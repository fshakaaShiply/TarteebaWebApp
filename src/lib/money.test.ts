import { describe, expect, it } from "vitest";
import { filsToAedInput, formatAed, parseAedToFils } from "./money";

describe("formatAed", () => {
  it("formats whole dirhams without decimals", () => {
    expect(formatAed(12000, "ar")).toBe("120 د.إ");
    expect(formatAed(450000, "en")).toBe("AED 4,500");
  });

  it("keeps fils when present", () => {
    expect(formatAed(12050, "en")).toBe("AED 120.50");
    expect(formatAed(5, "en")).toBe("AED 0.05");
  });

  it("formats negative amounts", () => {
    expect(formatAed(-12050, "en")).toBe("AED -120.50");
  });
});

describe("filsToAedInput", () => {
  it("always shows two decimals for inputs", () => {
    expect(filsToAedInput(12000)).toBe("120.00");
    expect(filsToAedInput(12050)).toBe("120.50");
    expect(filsToAedInput(7)).toBe("0.07");
    expect(filsToAedInput(0)).toBe("0.00");
  });

  it("returns an empty string for missing values", () => {
    expect(filsToAedInput(null)).toBe("");
    expect(filsToAedInput(undefined)).toBe("");
  });

  it("round-trips through parseAedToFils", () => {
    for (const fils of [0, 1, 99, 100, 12050, 450000, 123456789]) {
      expect(parseAedToFils(filsToAedInput(fils))).toEqual({ ok: true, fils });
    }
  });
});

describe("parseAedToFils", () => {
  it("parses whole and decimal amounts with integer math", () => {
    expect(parseAedToFils("120")).toEqual({ ok: true, fils: 12000 });
    expect(parseAedToFils("120.5")).toEqual({ ok: true, fils: 12050 });
    expect(parseAedToFils("120.05")).toEqual({ ok: true, fils: 12005 });
    expect(parseAedToFils(".5")).toEqual({ ok: true, fils: 50 });
    expect(parseAedToFils("120.")).toEqual({ ok: true, fils: 12000 });
    // 0.1 + 0.2 style float errors never appear: 0.29 AED is exactly 29 fils.
    expect(parseAedToFils("0.29")).toEqual({ ok: true, fils: 29 });
    expect(parseAedToFils("1.15")).toEqual({ ok: true, fils: 115 });
  });

  it("accepts thousands separators and surrounding spaces", () => {
    expect(parseAedToFils(" 4,500 ")).toEqual({ ok: true, fils: 450000 });
    expect(parseAedToFils("1,234,567.89")).toEqual({ ok: true, fils: 123456789 });
  });

  it("accepts Arabic-Indic digits and the Arabic decimal separator", () => {
    expect(parseAedToFils("٤٥٠٠")).toEqual({ ok: true, fils: 450000 });
    expect(parseAedToFils("١٢٠٫٥٠")).toEqual({ ok: true, fils: 12050 });
    expect(parseAedToFils("۱۲۰")).toEqual({ ok: true, fils: 12000 });
  });

  it("rejects empty, malformed and over-precise input", () => {
    expect(parseAedToFils("")).toEqual({ ok: false, error: "empty" });
    expect(parseAedToFils("   ")).toEqual({ ok: false, error: "empty" });
    expect(parseAedToFils("abc")).toEqual({ ok: false, error: "invalid" });
    expect(parseAedToFils("12,00")).toEqual({ ok: false, error: "invalid" });
    expect(parseAedToFils("1.2.3")).toEqual({ ok: false, error: "invalid" });
    expect(parseAedToFils(".")).toEqual({ ok: false, error: "invalid" });
    expect(parseAedToFils("1e3")).toEqual({ ok: false, error: "invalid" });
    expect(parseAedToFils("120.505")).toEqual({ ok: false, error: "precision" });
  });

  it("refuses negative amounts unless allowed", () => {
    expect(parseAedToFils("-5")).toEqual({ ok: false, error: "negative" });
    expect(parseAedToFils("-5.25", { allowNegative: true })).toEqual({ ok: true, fils: -525 });
  });

  it("refuses amounts that would not be safe integers", () => {
    expect(parseAedToFils("99999999999999999")).toEqual({ ok: false, error: "too_large" });
  });
});
