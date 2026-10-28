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

  it("in Arabic, the assignment counts and the manual booking's hold agree with their number", () => {
    // The slot picker names the time only; whether it can take the team is the previews' answer.
    const slots = createTranslator({ locale: "ar", messages: ar, namespace: "admin.bookings.slots" });
    expect(slots("option", { name: "صباحي", start: "10:00", end: "14:00" })).toBe("صباحي · 10:00–14:00");
    const summary = createTranslator({ locale: "ar", messages: ar, namespace: "admin.manual.summary" });
    expect(summary("hold", { minutes: 2 })).toBe("يحجز رابط الدفع هذا الموعد لمدة دقيقتين.");
    expect(summary("hold", { minutes: 120 })).toBe("يحجز رابط الدفع هذا الموعد لمدة 120 دقيقة.");
    const assignment = createTranslator({ locale: "ar", messages: ar, namespace: "admin.bookings.assignment" });
    expect(assignment("chooseMore", { count: 1 })).toBe("اختر عاملة أخرى");
    expect(assignment("chooseMore", { count: 2 })).toBe("اختر عاملتين أخريين");
    expect(assignment("chooseMore", { count: 3 })).toBe("اختر 3 عاملات أخرى");
    const enSlots = createTranslator({ locale: "en", messages: en, namespace: "admin.bookings.slots" });
    expect(enSlots("option", { name: "Morning", start: "10:00", end: "14:00" })).toBe("Morning · 10:00–14:00");
  });

  it("announces new alerts with the right forms", () => {
    const ar_ = createTranslator({ locale: "ar", messages: ar, namespace: "admin.alerts" });
    expect(ar_("announceNew", { count: 1 })).toBe("وصل تنبيه جديد");
    expect(ar_("announceUrgent", { count: 2 })).toBe("وصل تنبيهان عاجلان جديدان");
    expect(ar_("announceMixed", { count: 4, urgent: 1 })).toBe("وصلت 4 تنبيهات جديدة، منها تنبيه عاجل");
    const en_ = createTranslator({ locale: "en", messages: en, namespace: "admin.alerts" });
    expect(en_("announceMixed", { count: 3, urgent: 2 })).toBe("3 new alerts, 2 urgent");
  });

  it("greets a customer without a name without an empty gap", () => {
    for (const [locale, messages] of [["ar", ar], ["en", en]] as const) {
      const t = createTranslator({ locale, messages, namespace: "admin.paymentLink" });
      const args = { reference: "TRB-1", date: "1", link: "https://x.test/p" };
      expect(t("whatsappAr", { ...args, name: "", hasName: "no" })).toMatch(/^مرحبًا، هذا رابط الدفع/);
      expect(t("whatsappAr", { ...args, name: "سارة", hasName: "yes" })).toMatch(/^مرحبًا سارة، هذا رابط الدفع/);
      expect(t("whatsappEn", { ...args, name: "", hasName: "no" })).toMatch(/^Hello, here is the payment link/);
      expect(t("whatsappEn", { ...args, name: "Sara", hasName: "yes" })).toMatch(/^Hello Sara, here is the payment link/);
    }
  });

  it("in Arabic, with dual and plural forms", () => {
    expect(time("ar")("minutes", { minutes: 2 })).toBe("دقيقتان");
    expect(time("ar")("minutes", { minutes: 10 })).toBe("10 دقائق");
    expect(time("ar")("hours", { hours: 1 })).toBe("ساعة واحدة");
    expect(time("ar")("hoursMinutes", { hours: 2, minutes: 10 })).toBe("ساعتان و10 دقائق");
    expect(time("ar")("hoursMinutes", { hours: 16, minutes: 48 })).toBe("16 ساعة و48 دقيقة");
  });
});
