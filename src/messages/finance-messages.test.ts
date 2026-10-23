import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { PAYMENT_STATUSES } from "@/lib/admin/bookings/filters";
import { BILLING_DOCUMENTS, INVOICE_STATUSES, PAYABLE_TYPES } from "@/lib/admin/finance/filters";
import { REFUND_FORM_ERRORS, REFUND_REASONS, REFUND_STATUSES, STAFF_REFUND_REASONS } from "@/lib/admin/finance/refund";
import { AUDIENCES, CHANNELS, LOCALES, TEMPLATE_FORM_ERRORS, TEMPLATE_GROUPS } from "@/lib/admin/notifications/templates";
import ar from "./ar.json";
import en from "./en.json";

/*
 * A09 finance and A11 notification templates look message keys up at runtime (status chips, refund reasons, refused
 * document problems, channels, form errors). Every key must exist in both languages, so a missing one never shows as a
 * raw key, and the plural and placeholder messages must format.
 */

function get(messages: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), messages);
}

const FINANCE_ENUMS: Record<string, readonly string[]> = {
  payment: PAYMENT_STATUSES,
  refund: REFUND_STATUSES,
  invoice: INVOICE_STATUSES,
  payable: PAYABLE_TYPES,
  reason: REFUND_REASONS,
  document: BILLING_DOCUMENTS,
  // Billing InvoiceDraft problems and IssueCreditNoteForRefund refusals.
  problem: [
    "price_lines_missing",
    "price_lines_malformed",
    "lines_do_not_match_booking_totals",
    "captured_amount_mismatch",
    "currency_mismatch",
    "nothing_to_invoice",
    "no_invoice",
    "amount_exceeds_open_invoice",
  ],
  eventSource: ["call", "webhook"],
  requester: ["staff", "customer", "system"],
  // Payment review_reason codes (FlagPaymentForReview callers; success_reported_for_<status>_payment is one pattern).
  reviewReason: [
    "verifying_timeout",
    "success_reported_for_status",
    "success_reported_for_another_charge",
    "success_on_earlier_checkout_attempt",
    "unknown_result_on_earlier_checkout_attempt",
    "amount_mismatch",
    "currency_mismatch",
    "booking_listener_failed",
    "booking_void_failed",
    "booking_closed_void_failed",
    "invoice_amounts_mismatch",
    "credit_note_not_issued",
    "other",
  ],
  // VoidPayment reasons from the booking flows.
  voidReason: ["booking_rejected", "booking_cancelled", "booking_expired", "booking_sla_expired", "booking_late_payment", "booking_stray_payment", "other"],
};

// Payment PaymentEvent outcomes.
const EVENT_OUTCOMES = [
  "applied",
  "duplicate",
  "ignored_precedence",
  "stale_attempt",
  "unmatched",
  "informational",
  "review_flagged",
  "rejected_signature",
  "rejected_payload",
  "gateway_error",
  "amount_mismatch",
  "result_unknown",
];

const TEMPLATE_ENUMS: Record<string, readonly string[]> = {
  audience: AUDIENCES,
  channel: CHANNELS,
  group: [...TEMPLATE_GROUPS, "other"],
  language: LOCALES,
};

describe.each([
  ["ar", ar],
  ["en", en],
] as const)("finance and template messages (%s)", (_, messages) => {
  it("label every finance enum value", () => {
    for (const [group, values] of Object.entries(FINANCE_ENUMS)) {
      for (const value of values) expect(get(messages, `admin.finance.enums.${group}.${value}`), `${group}.${value}`).toEqual(expect.any(String));
    }
    for (const outcome of EVENT_OUTCOMES) expect(get(messages, `admin.finance.payment.events.outcomes.${outcome}`), outcome).toEqual(expect.any(String));
  });

  it("explain every refund and template form error", () => {
    for (const code of REFUND_FORM_ERRORS) expect(get(messages, `admin.finance.refund.errors.${code}`), code).toEqual(expect.any(String));
    for (const code of TEMPLATE_FORM_ERRORS) expect(get(messages, `admin.notificationTemplates.editor.errors.${code}`), code).toEqual(expect.any(String));
  });

  it("label every template audience, channel, group and language", () => {
    for (const [group, values] of Object.entries(TEMPLATE_ENUMS)) {
      for (const value of values) expect(get(messages, `admin.notificationTemplates.enums.${group}.${value}`), `${group}.${value}`).toEqual(expect.any(String));
    }
  });

  it("name every staff refund reason the API accepts", () => {
    expect([...STAFF_REFUND_REASONS].sort()).toEqual(
      ["booking_rejected", "company_cancellation", "complaint_compensation", "customer_cancellation", "duplicate_payment", "goodwill", "other", "service_not_delivered"],
    );
  });
});

describe("finance copy formats", () => {
  const finance = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.finance" });

  it("counts refused-document attempts with plural forms", () => {
    expect(finance("en")("refusals.attempts", { count: 1 })).toBe("1 attempt");
    expect(finance("en")("refusals.attempts", { count: 3 })).toBe("3 attempts");
    expect(finance("ar")("refusals.attempts", { count: 1 })).toBe("محاولة واحدة");
    expect(finance("ar")("refusals.attempts", { count: 2 })).toBe("محاولتان");
    expect(finance("ar")("refusals.attempts", { count: 5 })).toBe("5 محاولات");
    expect(finance("ar")("refusals.attempts", { count: 14 })).toBe("14 محاولة");
  });

  it("names the audience in a template's Edit link", () => {
    const templates = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.notificationTemplates" });
    const values = { event: "E", audience: "A", channel: "C", language: "L" };
    expect(templates("en")("editLabel", values)).toBe("Edit E, A, C, L");
    expect(templates("ar")("editLabel", values)).toBe("تعديل E، A، C، L");
  });

  it("explains a refund the provider declined, with its status", () => {
    expect(finance("en")("refund.declinedTitle", { amount: "AED 180.00" })).toBe("The provider declined the refund of AED 180.00");
    expect(finance("ar")("refund.declinedBody", { status: "تعذر الاسترداد" })).toBe("لم يُسترد أي مبلغ. حالة المزود: تعذر الاسترداد.");
    expect(finance("en")("enums.reviewReason.success_reported_for_status", { status: "Payment cancelled" })).toBe(
      "The provider reported a success after this payment had become “Payment cancelled”.",
    );
  });

  it("states the refund amount and the provider's own status", () => {
    expect(finance("en")("refund.confirm", { amount: "AED 180" })).toBe("Refund AED 180");
    expect(finance("en")("refund.done", { amount: "AED 180", status: "Refund processing" })).toBe("Refund of AED 180 sent. Provider status: Refund processing.");
    expect(finance("ar")("refund.done", { amount: "180 د.إ", status: "الاسترداد قيد المعالجة" })).toBe("أُرسل استرداد بمبلغ 180 د.إ. حالة المزود: الاسترداد قيد المعالجة.");
    expect(finance("ar")("refund.errors.amount_over", { max: "240 د.إ" })).toBe("الحد الأقصى القابل للاسترداد 240 د.إ.");
  });
});
