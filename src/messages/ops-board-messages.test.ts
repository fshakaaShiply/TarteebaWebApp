import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { SCHEDULE_MARKERS, SCHEDULE_VIEWS, VISIT_STATUSES } from "@/lib/admin/schedule/board";
import {
  DRIVER_REPORT_STATUSES,
  DRIVER_REPORT_TYPES,
  ROUND_KINDS,
  ROUND_STATUSES,
  STOP_STATUSES,
  UNPLANNED_REASONS,
} from "@/lib/admin/trips/rounds";
import ar from "./ar.json";
import en from "./en.json";

/*
 * The A04 schedule board and the A06 trip planner look message keys up at runtime (views, markers, round and stop
 * statuses, unplanned reasons, report types): every one must exist in both languages.
 */

function get(messages: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), messages);
}

const RUNTIME: Record<string, readonly string[]> = {
  "admin.schedule.views": SCHEDULE_VIEWS,
  "admin.schedule.previous": SCHEDULE_VIEWS,
  "admin.schedule.next": SCHEDULE_VIEWS,
  "admin.schedule.markers": SCHEDULE_MARKERS,
  "admin.bookings.enums.visit": VISIT_STATUSES,
  "admin.trips.enums.kind": ROUND_KINDS,
  "admin.trips.enums.roundStatus": ROUND_STATUSES,
  "admin.trips.enums.stopStatus": STOP_STATUSES,
  "admin.trips.enums.reportType": DRIVER_REPORT_TYPES,
  "admin.trips.enums.reportStatus": DRIVER_REPORT_STATUSES,
  "admin.trips.unplanned": UNPLANNED_REASONS,
  "admin.trips.round.driverAction": ["depart", "arrive", "dropoff", "pickup"],
  "admin.nav": ["schedule", "trips", "driverReports"],
};

describe.each([
  ["ar", ar],
  ["en", en],
] as const)("schedule and trip planner messages (%s)", (_, messages) => {
  it("label every value the screens look up", () => {
    for (const [group, values] of Object.entries(RUNTIME)) {
      for (const value of values) expect(get(messages, `${group}.${value}`), `${group}.${value}`).toEqual(expect.any(String));
    }
  });
});

describe("counts read naturally", () => {
  const round = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.trips.round" });
  const month = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.schedule.month" });
  const card = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.schedule.card" });

  it("agrees the Arabic nouns with the number", () => {
    expect(round("ar")("seatsUsed", { used: 2, total: 7 })).toBe("2 من 7 مقاعد");
    expect(round("ar")("seatsUsed", { used: 9, total: 14 })).toBe("9 من 14 مقعدًا");
    expect(round("ar")("stopsTitle", { count: 2 })).toBe("محطتان بترتيب القيادة");
    expect(month("ar")("bookings", { count: 0 })).toBe("لا حجوزات");
    expect(month("ar")("bookings", { count: 1 })).toBe("حجز واحد");
    expect(month("ar")("bookings", { count: 3 })).toBe("3 حجوزات");
    expect(card("ar")("team", { assigned: 1, count: 2 })).toBe("1 من عاملتين");
  });

  it("uses one / other in English", () => {
    expect(round("en")("seatsUsed", { used: 1, total: 1 })).toBe("1 of 1 seat");
    expect(card("en")("team", { assigned: 0, count: 2 })).toBe("0 of 2 cleaners");
  });
});
