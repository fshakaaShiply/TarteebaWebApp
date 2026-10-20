import { describe, expect, it } from "vitest";
import { formatAed } from "./money";

describe("formatAed", () => {
  it("formats whole dirhams without decimals", () => {
    expect(formatAed(12000, "ar")).toBe("120 د.إ");
    expect(formatAed(450000, "en")).toBe("AED 4,500");
  });

  it("keeps fils when present", () => {
    expect(formatAed(12050, "en")).toBe("AED 120.50");
  });
});
