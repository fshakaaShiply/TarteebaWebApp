import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "./ar.json";
import en from "./en.json";

type Messages = { [key: string]: string | Messages };

/**
 * Message pairs where "<x>Label" is the accessible name (aria-label) of a control whose visible text is the sibling
 * "<x>" (e.g. applyToAll / applyToAllLabel). WCAG 2.5.3 Label in Name: the name must contain the visible words, so
 * speech-input users can say what they see ("click Apply to all days").
 */
function labelPairs(node: Messages, path: string[] = []): { key: string; visible: string; label: string }[] {
  const out: { key: string; visible: string; label: string }[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (typeof value !== "string") {
      out.push(...labelPairs(value, [...path, key]));
      continue;
    }
    if (!key.endsWith("Label")) continue;
    const visible = node[key.slice(0, -"Label".length)];
    if (typeof visible === "string") out.push({ key: [...path, key].join("."), visible, label: value });
  }
  return out;
}

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("accessible copy (%s)", (_locale, messages) => {
  it("gives every labelled control an accessible name that contains its visible text", () => {
    const pairs = labelPairs(messages as Messages);
    // The pairs the review named, so a rename cannot silently drop them from this check.
    expect(pairs.map((p) => p.key)).toEqual(
      expect.arrayContaining([
        "admin.settings.weeklyHours.applyToAllLabel",
        "admin.settings.weeklyHours.openLabel",
        "admin.workers.schedule.copyLabel",
        "admin.workers.leaves.actions.cancelLabel",
      ]),
    );
    const misses = pairs.filter((p) => !p.label.toLocaleLowerCase().includes(p.visible.toLocaleLowerCase()));
    expect(misses).toEqual([]);
  });
});

describe("seat counts on capacity cards", () => {
  const seats = (locale: "ar" | "en", n: number, used = 0) =>
    createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.capacity" })("seatsUsed", {
      used,
      seats: n,
      free: n - used,
    });

  it("agrees the Arabic noun with the number of seats (vehicles have 1 to 20)", () => {
    expect(seats("ar", 1)).toBe("محجوز 0 من مقعد واحد · متاح 1");
    expect(seats("ar", 2, 1)).toBe("محجوز 1 من مقعدين · متاح 1");
    expect(seats("ar", 7, 5)).toBe("محجوز 5 من 7 مقاعد · متاح 2");
    expect(seats("ar", 10, 10)).toBe("محجوز 10 من 10 مقاعد · متاح 0");
    // 11 and up take the singular accusative ("14 مقعدًا"), not the plural "مقاعد".
    expect(seats("ar", 14, 12)).toBe("محجوز 12 من 14 مقعدًا · متاح 2");
    expect(seats("ar", 20, 3)).toBe("محجوز 3 من 20 مقعدًا · متاح 17");
    for (let n = 11; n <= 20; n++) expect(seats("ar", n)).not.toMatch(/مقاعد/);
  });

  it("uses one seat / seats in English", () => {
    expect(seats("en", 1)).toBe("0 of 1 seat booked · 1 free");
    expect(seats("en", 14, 12)).toBe("12 of 14 seats booked · 2 free");
  });
});
