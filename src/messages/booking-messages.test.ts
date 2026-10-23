import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CANCEL_PARTIES, CANCEL_REASONS, REJECT_REASONS } from "@/lib/admin/bookings/actions";
import { BOOKING_SOURCES, BOOKING_STATUSES, PAYMENT_STATUSES } from "@/lib/admin/bookings/filters";
import { VISIT_STATUS_TARGETS } from "@/lib/admin/bookings/forms";
import { CLEANING_AREAS, MANUAL_STEPS, PROPERTY_TYPES } from "@/lib/admin/bookings/manual";
import { CODE_MESSAGES } from "@/lib/admin/errors";
import ar from "./ar.json";
import en from "./en.json";

/*
 * Phase 3 screens look message keys up at runtime (status chips, reason codes, error codes, assignment rules). Every
 * key must exist in both languages, so a missing one never shows as a raw key.
 */

function get(messages: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), messages);
}

const ENUMS: Record<string, readonly string[]> = {
  status: [...BOOKING_STATUSES, "draft"],
  payment: PAYMENT_STATUSES,
  source: BOOKING_SOURCES,
  visit: ["scheduled", "worker_assigned", "en_route", "arrived", "in_progress", "completed", "no_show_customer", "missed_by_company", "cancelled"],
  proposal: ["pending", "accepted", "declined", "expired"],
  request: ["pending", "approved", "rejected", "auto_approved"],
  rejectReason: REJECT_REASONS,
  cancelReason: [...CANCEL_REASONS, ...REJECT_REASONS],
  party: [...CANCEL_PARTIES, "system"],
  area: CLEANING_AREAS,
  propertyType: PROPERTY_TYPES,
  materials: ["customer", "company"],
};

const RULES = ["other_zone", "travel_buffer", "not_active", "not_eligible", "already_assigned", "rest_day", "not_on_shift", "leave", "live_out", "busy", "unknown"];

describe.each([
  ["ar", ar],
  ["en", en],
] as const)("Phase 3 messages (%s)", (_, messages) => {
  it("translate every API error code the admin maps", () => {
    for (const key of Object.values(CODE_MESSAGES)) expect(get(messages, `admin.errors.${key}`), key).toEqual(expect.any(String));
  });

  it("label every booking enum value", () => {
    for (const [group, values] of Object.entries(ENUMS)) {
      for (const value of values) expect(get(messages, `admin.bookings.enums.${group}.${value}`), `${group}.${value}`).toEqual(expect.any(String));
    }
  });

  it("explain every assignment rule, visit status target and wizard step", () => {
    for (const rule of RULES) expect(get(messages, `admin.bookings.assignment.rules.${rule}`), rule).toEqual(expect.any(String));
    for (const status of VISIT_STATUS_TARGETS) expect(get(messages, `admin.bookings.enums.visit.${status}`), status).toEqual(expect.any(String));
    expect(MANUAL_STEPS).toHaveLength(4);
  });
});

describe("durations and counts read naturally", () => {
  const time = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.time" });

  it("in English", () => {
    expect(time("en")("minutes", { minutes: 1 })).toBe("1 minute");
    expect(time("en")("hoursMinutes", { hours: 2, minutes: 10 })).toBe("2 hours 10 minutes");
  });

  it("in Arabic, with dual and plural forms", () => {
    expect(time("ar")("minutes", { minutes: 2 })).toBe("دقيقتان");
    expect(time("ar")("minutes", { minutes: 10 })).toBe("10 دقائق");
    expect(time("ar")("hours", { hours: 1 })).toBe("ساعة واحدة");
    expect(time("ar")("hoursMinutes", { hours: 2, minutes: 10 })).toBe("ساعتان و10 دقائق");
    expect(time("ar")("hoursMinutes", { hours: 16, minutes: 48 })).toBe("16 ساعة و48 دقيقة");
  });
});
