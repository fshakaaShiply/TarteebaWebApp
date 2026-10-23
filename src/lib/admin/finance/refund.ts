import { z } from "zod";
import { filsToAedInput, parseAedToFils } from "@/lib/money";
import { AdminApiError } from "../client";
import type { AdminPaymentDetail, CreateRefundPayload, RefundStatus, StaffRefundReason } from "../types";

/*
 * A09 refunds (spec §10.4): the amount is typed in AED and sent as integer fils, never more than what is still
 * refundable (captured − refunded − refunds still open, the payment page's `refundable_fils`), with a reason from the
 * API's own list and a note for "other". The admin confirms the exact amount in a second step. The API checks it all
 * again (422 REFUND_AMOUNT_INVALID with details.refundable_fils, 409 INVALID_STATE).
 */

/** The reasons staff may pick, in the order A09 offers them: the API's list (CreateRefundRequest `reason_code`). */
export const STAFF_REFUND_REASONS = [
  "customer_cancellation",
  "company_cancellation",
  "booking_rejected",
  "complaint_compensation",
  "duplicate_payment",
  "service_not_delivered",
  "goodwill",
  "other",
] as const satisfies readonly StaffRefundReason[];

// Every reason the API accepts is offered: a reason added to the API's list fails this check after `pnpm gen:api` until
// it is listed (and labelled) here.
type UnlistedReason = Exclude<StaffRefundReason, (typeof STAFF_REFUND_REASONS)[number]>;
const everyReasonListed: [UnlistedReason] extends [never] ? true : never = true;
void everyReasonListed;

/** Reasons other modules record (Payment config system_refund_reason_codes): shown and filterable, never offered. */
export const SYSTEM_REFUND_REASONS = ["price_difference"] as const;

export const REFUND_REASONS = [...STAFF_REFUND_REASONS, ...SYSTEM_REFUND_REASONS] as const;

export const REFUND_STATUSES = ["requested", "processing", "succeeded", "failed"] as const satisfies readonly RefundStatus[];

export const REFUND_NOTE_MAX = 500;

export function isStaffRefundReason(value: string): value is StaffRefundReason {
  return (STAFF_REFUND_REASONS as readonly string[]).includes(value);
}

/**
 * Whether a new refund can be asked for: a captured or partly refunded payment with a provider reference and money
 * left to refund (RefundPayment's own conditions).
 */
export function canRefund(payment: Pick<AdminPaymentDetail, "status" | "refundable_fils" | "gateway_payment_ref">): boolean {
  return (
    (payment.status === "captured" || payment.status === "partially_refunded") &&
    payment.gateway_payment_ref !== null &&
    payment.refundable_fils > 0
  );
}

export type RefundFormValues = { amount: string; reason_code: string; reason_text: string };

export type RefundFormError =
  | "amount_required"
  | "amount_invalid"
  | "amount_precision"
  | "amount_zero"
  | "amount_over"
  | "reason_required"
  | "note_required"
  | "note_length";

export const REFUND_FORM_ERRORS: readonly RefundFormError[] = [
  "amount_required",
  "amount_invalid",
  "amount_precision",
  "amount_zero",
  "amount_over",
  "reason_required",
  "note_required",
  "note_length",
];

export type RefundCheck =
  | { ok: true; payload: CreateRefundPayload }
  | { ok: false; errors: Partial<Record<keyof RefundFormValues, RefundFormError>> };

/** Checks the form against what may still be refunded and builds the request body (amount in fils). */
export function checkRefund(values: RefundFormValues, refundableFils: number): RefundCheck {
  const errors: Partial<Record<keyof RefundFormValues, RefundFormError>> = {};

  const parsed = parseAedToFils(values.amount);
  let amountFils = 0;
  if (!parsed.ok) {
    errors.amount = parsed.error === "empty" ? "amount_required" : parsed.error === "precision" ? "amount_precision" : parsed.error === "too_large" ? "amount_over" : "amount_invalid";
  } else if (parsed.fils <= 0) {
    errors.amount = "amount_zero";
  } else if (parsed.fils > refundableFils) {
    errors.amount = "amount_over";
  } else {
    amountFils = parsed.fils;
  }

  const reason = isStaffRefundReason(values.reason_code) ? values.reason_code : null;
  if (reason === null) errors.reason_code = "reason_required";

  const note = values.reason_text.trim();
  if (note.length > REFUND_NOTE_MAX) errors.reason_text = "note_length";
  else if (reason === "other" && note === "") errors.reason_text = "note_required";

  if (reason === null || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, payload: { amount_fils: amountFils, reason_code: reason, reason_text: note === "" ? null : note } };
}

/** The form schema (react-hook-form + zod): each problem is reported on its field as a RefundFormError code. */
export function refundFormSchema(refundableFils: number) {
  return z
    .object({ amount: z.string(), reason_code: z.string(), reason_text: z.string() })
    .superRefine((values, ctx) => {
      const check = checkRefund(values, refundableFils);
      if (check.ok) return;
      for (const [field, code] of Object.entries(check.errors)) ctx.addIssue({ code: "custom", path: [field], message: code });
    });
}

/** The form's starting values: the whole refundable amount, no reason yet (the admin must choose one). */
export function initialRefundValues(refundableFils: number): RefundFormValues {
  return { amount: filsToAedInput(refundableFils), reason_code: "", reason_text: "" };
}

/** What stays refundable once this refund goes through. */
export function refundableAfter(refundableFils: number, amountFils: number): number {
  return Math.max(0, refundableFils - amountFils);
}

/** details.refundable_fils of a 422 REFUND_AMOUNT_INVALID: what the API says may still be refunded now. */
export function refundableFromError(error: unknown): number | null {
  if (!(error instanceof AdminApiError) || error.code !== "REFUND_AMOUNT_INVALID") return null;
  const value = error.details.refundable_fils;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
