import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { PAYMENT_STATUSES } from "@/lib/admin/bookings/filters";
import { BILLING_DOCUMENTS, INVOICE_STATUSES, PAYABLE_TYPES } from "@/lib/admin/finance/filters";
import { REFUND_FORM_ERRORS, REFUND_STATUSES } from "@/lib/admin/finance/refund";
import { EXPORT_FAILURES, EXPORT_REPORTS, EXPORT_STATUSES } from "@/lib/admin/exports";
import { FINANCE_ERROR_CODES, PAIR_REASONS } from "@/lib/admin/finance/errors";
import { OPS_FORM_ERRORS } from "@/lib/admin/finance/refundOps";
import { DOCUMENT_CHECKS, ITEM_REASONS, ITEM_STATUSES, LINE_TYPES, RESOLUTIONS, RESOLVE_FORM_ERRORS, RUN_STATUSES } from "@/lib/admin/finance/reconciliation";
import { WALLET_FORM_ERRORS, WALLET_SOURCES, WALLET_TYPES } from "@/lib/admin/finance/wallet";
import { AUDIENCES, CHANNELS, LOCALES, TEMPLATE_FORM_ERRORS, TEMPLATE_GROUPS } from "@/lib/admin/notifications/templates";
import ar from "./ar.json";
import en from "./en.json";

/*
 * A09 finance and A11 notification templates look message keys up at runtime (status chips, refused document
 * problems, channels, form errors). Every key must exist in both languages, so a missing one never shows as a
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
    // IssueInvoiceForPayment::refusePeriod(): a subscription period payment that cannot be invoiced (Phase 4).
    "no_period_basis",
    "period_not_paid",
  ],
  eventSource: ["call", "webhook"],
  requester: ["staff", "customer", "system"],
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

  it("leave the payment review and release reasons to the API's labels", () => {
    expect(get(messages, "admin.finance.enums.reviewReason")).toBeUndefined();
    expect(get(messages, "admin.finance.enums.voidReason")).toBeUndefined();
  });

  it("leave the refund reasons to the API's labels (refund rows, credit notes, GET /admin/refund-reasons)", () => {
    expect(get(messages, "admin.finance.enums.reason")).toBeUndefined();
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
  });

  it("states the summary's period with plural days and its counts", () => {
    const values = { from: "1 Oct", to: "19 Oct", zone: "Z" };
    expect(finance("en")("summary.subtitle", { ...values, days: 1 })).toBe("1 Oct – 19 Oct · 1 day · Z");
    expect(finance("en")("summary.subtitle", { ...values, days: 19 })).toBe("1 Oct – 19 Oct · 19 days · Z");
    expect(finance("ar")("summary.subtitle", { ...values, days: 2 })).toBe("1 Oct – 19 Oct · يومان · Z");
    expect(finance("ar")("summary.subtitle", { ...values, days: 19 })).toBe("1 Oct – 19 Oct · 19 يومًا · Z");
    expect(finance("en")("summary.cards.collectedDetail", { count: 201 })).toBe("201 payments taken");
    expect(finance("en")("summary.cards.vatCredited", { amount: "AED 62.86", count: 1 })).toBe("Credited: AED 62.86 (1 credit note)");
    expect(finance("ar")("summary.cards.refundsDetail", { count: 6 })).toBe("عدد الاستردادات التي أتمها المزود: 6");
  });

  it("states the refund amount and the provider's own status", () => {
    expect(finance("en")("refund.confirm", { amount: "AED 180" })).toBe("Refund AED 180");
    expect(finance("en")("refund.done", { amount: "AED 180", status: "Refund processing" })).toBe("Refund of AED 180 sent. Provider status: Refund processing.");
    expect(finance("ar")("refund.done", { amount: "180 د.إ", status: "الاسترداد قيد المعالجة" })).toBe("أُرسل استرداد بمبلغ 180 د.إ. حالة المزود: الاسترداد قيد المعالجة.");
    expect(finance("ar")("refund.errors.amount_over", { max: "240 د.إ" })).toBe("الحد الأقصى القابل للاسترداد 240 د.إ.");
  });
});

/*
 * Phase 5 (W1): reconciliation, exports, refund operations and the customer balance look their labels up by the API's
 * codes at run time. Every code must read in both languages, so a code the API adds later shows as a gap here, never as
 * a raw key on screen.
 */
const RECONCILIATION_ENUMS: Record<string, readonly string[]> = {
  runStatus: RUN_STATUSES,
  itemStatus: ITEM_STATUSES,
  reason: ITEM_REASONS,
  resolution: RESOLUTIONS,
  documentCheck: DOCUMENT_CHECKS,
  lineType: LINE_TYPES,
};

describe.each([
  ["ar", ar],
  ["en", en],
] as const)("Phase 5 finance messages (%s)", (_, messages) => {
  it("label every reconciliation run status, item status, reason, resolution, document check and line type", () => {
    for (const [group, values] of Object.entries(RECONCILIATION_ENUMS)) {
      for (const value of values) expect(get(messages, `admin.finance.reconciliation.enums.${group}.${value}`), `${group}.${value}`).toEqual(expect.any(String));
    }
  });

  it("label every export status, failure, format and report", () => {
    for (const status of EXPORT_STATUSES) expect(get(messages, `admin.finance.exports.status.${status}`), status).toEqual(expect.any(String));
    for (const failure of EXPORT_FAILURES) expect(get(messages, `admin.finance.exports.failure.${failure}`), failure).toEqual(expect.any(String));
    for (const format of ["xlsx", "csv", "pdf"]) expect(get(messages, `admin.finance.exports.formats.${format}`), format).toEqual(expect.any(String));
    expect(Object.keys(EXPORT_REPORTS)).toHaveLength(9);
  });

  it("label every customer balance source and movement", () => {
    for (const source of WALLET_SOURCES) expect(get(messages, `admin.finance.wallet.sources.${source}`), source).toEqual(expect.any(String));
    for (const type of WALLET_TYPES) {
      expect(get(messages, `admin.finance.wallet.types.${type}`), type).toEqual(expect.any(String));
      expect(get(messages, `admin.finance.wallet.signs.${type}`), type).toEqual(expect.any(String));
    }
    for (const actor of ["staff", "customer", "system"]) expect(get(messages, `admin.finance.wallet.actors.${actor}`), actor).toEqual(expect.any(String));
  });

  it("explain every error code of the Phase 5 finance routes", () => {
    for (const code of FINANCE_ERROR_CODES) expect(get(messages, `admin.finance.errors.${code}`), code).toEqual(expect.any(String));
    for (const reason of PAIR_REASONS) expect(get(messages, `admin.finance.errors.PAIRED_ITEM_INVALID_${reason}`), reason).toEqual(expect.any(String));
    for (const status of REFUND_STATUSES) expect(get(messages, `admin.finance.errors.refundStatus.${status}`), status).toEqual(expect.any(String));
  });

  it("explain every form error of the resolve, refund operation, clear-flag and balance forms", () => {
    for (const code of RESOLVE_FORM_ERRORS) expect(get(messages, `admin.finance.reconciliation.resolve.errors.${code}`), code).toEqual(expect.any(String));
    for (const code of OPS_FORM_ERRORS) expect(get(messages, `admin.finance.refundOps.errors.${code}`), code).toEqual(expect.any(String));
    for (const code of ["note_required", "note_short", "note_long"]) expect(get(messages, `admin.finance.clearReview.errors.${code}`), code).toEqual(expect.any(String));
    for (const code of WALLET_FORM_ERRORS) expect(get(messages, `admin.finance.wallet.adjust.errors.${code}`), code).toEqual(expect.any(String));
  });
});

describe("Phase 5 finance copy formats", () => {
  const reconciliation = (locale: "ar" | "en") => createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.finance.reconciliation" });

  it("counts the differences that need action and the lines of a report with plural forms", () => {
    expect(reconciliation("en")("subtitleUnresolved", { count: 1 })).toBe("1 difference needs action across all runs.");
    expect(reconciliation("en")("subtitleUnresolved", { count: 5 })).toBe("5 differences need action across all runs.");
    expect(reconciliation("ar")("subtitleUnresolved", { count: 2 })).toContain("فرقان");
    expect(reconciliation("ar")("runSubtitle", { gateway: "fake", lines: 10 })).toBe("fake · 10 أسطر في التقرير");
    expect(reconciliation("ar")("runSubtitle", { gateway: "fake", lines: 11 })).toBe("fake · 11 سطرًا في التقرير");
  });

  it("names what a recheck did", () => {
    expect(reconciliation("en")("rechecked", { rechecked: 1, resolved: 0 })).toBe("Rechecked 1 item; 0 were resolved by the new facts.");
    expect(reconciliation("en")("rechecked", { rechecked: 4, resolved: 1 })).toBe("Rechecked 4 items; 1 was resolved by the new facts.");
  });

  it("states a money resolution with its amount", () => {
    expect(reconciliation("en")("resolve.confirmButton", { amount: "AED 120.00" })).toBe("Book AED 120.00");
    expect(reconciliation("en")("resolve.termsChanged", { from: "AED 120.00", to: "AED 130.00" })).toBe("The line's amount is now AED 130.00 (it was AED 120.00). Check it, then confirm again.");
  });
});
