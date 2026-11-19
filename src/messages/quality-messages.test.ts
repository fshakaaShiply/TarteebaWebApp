import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { QUALITY_ERROR_CODES, NOT_ALLOWED_REASONS, UNAVAILABLE_REASONS } from "@/lib/admin/quality/errors";
import { RATING_KINDS } from "@/lib/admin/quality/filters";
import {
  CASE_CATEGORIES,
  CASE_OUTCOMES,
  CASE_PRIORITIES,
  CASE_SOURCES,
  CASE_STATUSES,
  CASE_TYPES,
  CLOSE_REASONS,
  COMPENSATION_STATUSES,
  COMPENSATION_TYPES,
  SLA_STATES,
} from "@/lib/admin/quality/types";
import { ADMIN_NAV } from "@/lib/admin/nav";
import ar from "./ar.json";
import en from "./en.json";

/*
 * A10 looks message keys up at runtime (status chips, the SLA words, the timeline, error codes, form errors). Every key
 * must exist in both languages, so a missing one never shows as a raw key, and the plural and placeholder messages
 * must format. The enum lists are the contracts' (A2 §8.2, A3 §4).
 */

function get(messages: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), messages);
}

const ENUMS: Record<string, readonly string[]> = {
  status: CASE_STATUSES,
  priority: CASE_PRIORITIES,
  category: CASE_CATEGORIES,
  type: CASE_TYPES,
  outcome: CASE_OUTCOMES,
  compensationType: COMPENSATION_TYPES,
  compensationStatus: COMPENSATION_STATUSES,
  closeReason: CLOSE_REASONS,
  source: CASE_SOURCES,
  slaState: SLA_STATES,
  bookingKind: RATING_KINDS,
};

/** Timeline types the API writes (A2 §8.2 and A3 §3) that this page words. */
const EVENTS = [
  "created",
  "status_changed",
  "reopened",
  "assigned",
  "priority_changed",
  "category_changed",
  "workers_changed",
  "driver_changed",
  "message_posted",
  "sla_breached",
  "merged",
  "rating_received",
  "compensation_proposed",
  "compensation_executed",
  "compensation_rejected",
  "compensation_cancelled",
  "compensation_failed",
  "compensation_reinstated",
  "refund_succeeded",
  "refund_failed",
  "recovery_completed",
];

const FORM_ERRORS: Record<string, readonly string[]> = {
  "reply.errors": ["required", "too_long", "pdf_public"],
  "resolve.errors": ["required", "outcome_required", "resolution_required", "too_long", "type_unavailable", "amount_required", "amount_invalid", "amount_precision", "amount_zero", "amount_over", "date_required", "slot_required"],
  "reject.errors": ["reason_required", "too_short", "too_long"],
  "exclude.errors": ["reason_required", "too_short", "too_long"],
  "reopen.errors": ["reason_required", "too_long"],
  "close.errors": ["reason", "note"],
  "openComplaint.errors": ["category_required", "required", "too_short", "too_long"],
};

const COMPENSATION_FAILURES = ["refund_failed", "refund_failed_manual", "visit_cancelled", "visit_missed"];

describe.each([
  ["ar", ar],
  ["en", en],
] as const)("A10 messages (%s)", (_, messages) => {
  it("label every enum value", () => {
    for (const [group, values] of Object.entries(ENUMS)) {
      for (const value of values) expect(get(messages, `admin.quality.enums.${group}.${value}`), `${group}.${value}`).toEqual(expect.any(String));
    }
  });

  it("word every timeline event and every compensation failure", () => {
    for (const type of EVENTS) {
      const direct = get(messages, `admin.quality.thread.events.${type}`);
      const merged = type === "merged" ? get(messages, "admin.quality.thread.events.mergedInto") : direct;
      expect(merged, type).toEqual(expect.any(String));
    }
    for (const code of COMPENSATION_FAILURES) {
      expect(get(messages, `admin.quality.compensation.failure.${code}`), code).toEqual(expect.any(String));
      expect(get(messages, `admin.quality.compensations.failure.${code}`), code).toEqual(expect.any(String));
    }
  });

  it("explain every error code, with and without the API's figures", () => {
    for (const code of QUALITY_ERROR_CODES) expect(get(messages, `admin.quality.errors.${code}`), code).toEqual(expect.any(String));
    for (const code of ["COMPENSATION_AMOUNT_INVALID", "REFUND_AMOUNT_INVALID", "WORKERS_OUT_OF_RANGE", "COMPLAINT_ALREADY_OPEN", "TOO_MANY_PENDING_UPLOADS", "TOO_MANY_OPEN_CASES"]) {
      expect(get(messages, `admin.quality.errors.${code}_plain`), code).toEqual(expect.any(String));
    }
    expect(get(messages, "admin.quality.errors.ATTACHMENT_INVALID_internal")).toEqual(expect.any(String));
    for (const reason of UNAVAILABLE_REASONS) expect(get(messages, `admin.quality.errors.unavailable.${reason}`), reason).toEqual(expect.any(String));
    for (const reason of NOT_ALLOWED_REASONS) expect(get(messages, `admin.quality.errors.notAllowed.${reason}`), reason).toEqual(expect.any(String));
  });

  it("say why a compensation cannot be chosen in the resolve dialog", () => {
    for (const reason of [...UNAVAILABLE_REASONS, "no_permission"]) expect(get(messages, `admin.quality.resolve.unavailable.${reason}`), reason).toEqual(expect.any(String));
    for (const type of COMPENSATION_TYPES) expect(get(messages, `admin.quality.resolve.typeHint.${type}`), type).toEqual(expect.any(String));
  });

  it("explain every form error", () => {
    for (const [path, codes] of Object.entries(FORM_ERRORS)) {
      for (const code of codes) expect(get(messages, `admin.quality.${path}.${code}`), `${path}.${code}`).toEqual(expect.any(String));
    }
  });

  it("name every A10 page in the navigation", () => {
    const quality = ADMIN_NAV.find((m) => m.id === "quality");
    expect(quality?.built).toBe(true);
    for (const child of quality?.children ?? []) expect(get(messages, `admin.nav.${child.labelKey}`), child.labelKey).toEqual(expect.any(String));
  });
});

describe("A10 copy formats", () => {
  type Say = (key: string, values?: Record<string, unknown>) => string;
  const quality = (locale: "ar" | "en", namespace = "admin.quality") => createTranslator({ locale, messages: (locale === "ar" ? ar : en) as never, namespace: namespace as never }) as unknown as Say;

  it("spells the SLA distance out for a screen reader, with Arabic plural forms", () => {
    expect(quality("en", "admin.quality.sla")("leftFull.hours", { count: 1 })).toBe("1 hour left");
    expect(quality("en", "admin.quality.sla")("leftFull.hours", { count: 3 })).toBe("3 hours left");
    expect(quality("en", "admin.quality.sla")("overdueFull.minutes", { count: 30 })).toBe("30 minutes overdue");
    expect(quality("ar", "admin.quality.sla")("leftFull.hours", { count: 1 })).toBe("متبقي ساعة واحدة");
    expect(quality("ar", "admin.quality.sla")("leftFull.hours", { count: 2 })).toBe("متبقي ساعتان");
    expect(quality("ar", "admin.quality.sla")("leftFull.hours", { count: 3 })).toBe("متبقي 3 ساعات");
    expect(quality("ar", "admin.quality.sla")("leftFull.hours", { count: 14 })).toBe("متبقي 14 ساعة");
    expect(quality("ar", "admin.quality.sla")("left.hours", { count: 3 })).toBe("متبقي 3 س");
    expect(quality("ar", "admin.quality.sla")("overdue.hours", { count: 2 })).toBe("متأخرة 2 س");
  });

  it("counts photos, ratings and reopenings with plural forms", () => {
    expect(quality("en")("ratings.photos", { count: 1 })).toBe("1 photo");
    expect(quality("ar")("ratings.photos", { count: 2 })).toBe("صورتان");
    expect(quality("ar")("ratings.photos", { count: 5 })).toBe("5 صور");
    expect(quality("en")("case.reopened", { count: 1 })).toBe("Reopened once");
    expect(quality("ar")("case.reopened", { count: 3 })).toBe("أُعيد فتحها 3 مرات");
  });

  it("states the compensation the accountant is asked for", () => {
    expect(quality("en")("resolve.confirmPropose", { what: "Refund AED 30.00" })).toBe("Send for approval: Refund AED 30.00");
    expect(quality("ar")("approve.confirm.refund", { amount: "30.00 د.إ" })).toBe("اعتماد واسترداد 30.00 د.إ");
    expect(quality("en")("approve.termsChanged", { from: "AED 30.00", to: "AED 20.00" })).toBe("It was AED 30.00 and is now AED 20.00. Check the new amount before you confirm.");
  });
});
