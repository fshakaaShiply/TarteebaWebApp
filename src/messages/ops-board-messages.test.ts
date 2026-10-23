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

  it("agrees the Arabic minutes of lateness, waiting and driver delays with the number", () => {
    const reports = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.driverReports" });
    const t = round("ar");
    expect(t("lateBy", { minutes: 1 })).toBe("متأخرة دقيقة واحدة");
    expect(t("lateBy", { minutes: 2 })).toBe("متأخرة دقيقتين");
    expect(t("lateBy", { minutes: 5 })).toBe("متأخرة 5 دقائق");
    expect(t("lateBy", { minutes: 10 })).toBe("متأخرة 10 دقائق");
    expect(t("lateBy", { minutes: 22 })).toBe("متأخرة 22 دقيقة");
    expect(t("afterStart", { minutes: 1 })).toBe("بعد البداية بدقيقة واحدة، ضمن التأخير المسموح");
    expect(t("afterStart", { minutes: 7 })).toBe("بعد البداية بـ7 دقائق، ضمن التأخير المسموح");
    expect(t("afterStart", { minutes: 15 })).toBe("بعد البداية بـ15 دقيقة، ضمن التأخير المسموح");
    expect(t("waitsTooLong", { minutes: 2 })).toBe("ينتظر الفريق دقيقتين");
    expect(t("waitsTooLong", { minutes: 40 })).toBe("ينتظر الفريق 40 دقيقة");
    expect(t("teamWaits", { minutes: 3 })).toBe("ينتظر الفريق 3 دقائق بعد الزيارة");
    expect(reports("ar")("delayValue", { minutes: 1 })).toBe("+دقيقة واحدة");
    expect(reports("ar")("delayValue", { minutes: 5 })).toBe("+5 دقائق");
    expect(reports("ar")("delayValue", { minutes: 10 })).toBe("+10 دقائق");
    expect(reports("ar")("delayValue", { minutes: 15 })).toBe("+15 دقيقة");
    // English keeps the short unit.
    expect(round("en")("lateBy", { minutes: 5 })).toBe("5 min late");
    expect(reports("en")("delayValue", { minutes: 5 })).toBe("+5 min");
  });
});
