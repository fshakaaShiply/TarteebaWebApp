import { describe, expect, it } from "vitest";
import ar from "./ar.json";
import en from "./en.json";

// AC7 groundwork: every string exists in Arabic and English (spec §0.1 rule 7, §24.2).
function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("translations", () => {
  it("have the same keys in ar and en", () => {
    expect(keys(en).sort()).toEqual(keys(ar).sort());
  });

  it("have no empty strings", () => {
    for (const messages of [ar, en]) {
      const empty = keys(messages).filter((k) =>
        k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], messages) === "",
      );
      expect(empty).toEqual([]);
    }
  });
});
