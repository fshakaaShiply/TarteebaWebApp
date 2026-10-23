import { z } from "zod";
import { parseAedToFils } from "@/lib/money";
import type { CancelInput, ProposeInput, RejectInput, RescheduleInput, VisitStatusTarget } from "../endpoints";
import { isIsoDate } from "../format";
import { FORCE_REASON_MAX, FORCE_REASON_MIN } from "../ops/capacity";
import { CANCEL_PARTIES, CANCEL_REASONS, REJECT_REASONS, reasonTextRequired } from "./actions";

/*
 * The A03 action dialogs' checks (react-hook-form + zod), with the API's limits (RejectBookingRequest,
 * CancelBookingRequest, ProposeAlternativesRequest, AdminRescheduleRequest, DecideRescheduleRequest,
 * DeclineCancelReviewRequest, BookingNoteRequest, the assignment requests and VisitStatusRequest). Error messages are
 * keys under admin.bookings.formErrors. The API validates everything again.
 */

export type BookingFormError =
  | "required"
  | "reasonRequired"
  | "textRequired"
  | "tooLong"
  | "reasonMin"
  | "overrideReasonMin"
  | "dateRequired"
  | "slotRequired"
  | "duplicateOption"
  | "refundRequired"
  | "refundInvalid"
  | "refundTooHigh"
  | "statusRequired"
  | "timeInvalid";

const issue = (ctx: z.RefinementCtx, path: (string | number)[], message: BookingFormError) => ctx.addIssue({ code: "custom", path, message });

/** A reason or note: required, between `min` and `max` characters once trimmed. */
function checkReason(ctx: z.RefinementCtx, path: string, value: string, min: number, max: number, minKey: BookingFormError = "reasonMin") {
  const v = value.trim();
  if (v === "") issue(ctx, [path], "reasonRequired");
  else if (v.length < min) issue(ctx, [path], minKey);
  else if (v.length > max) issue(ctx, [path], "tooLong");
}

// Reject -------------------------------------------------------------------------------------------------------------

export type RejectValues = { reason_code: string; reason_text: string };

export const rejectSchema = z
  .object({ reason_code: z.string(), reason_text: z.string() })
  .superRefine((v, ctx) => {
    if (!(REJECT_REASONS as readonly string[]).includes(v.reason_code)) issue(ctx, ["reason_code"], "required");
    if (reasonTextRequired(v.reason_code) && !v.reason_text.trim()) issue(ctx, ["reason_text"], "textRequired");
    if (v.reason_text.trim().length > 500) issue(ctx, ["reason_text"], "tooLong");
  })
  .transform((v): RejectInput => ({ reason_code: v.reason_code, reason_text: v.reason_text.trim() || null }));

// Cancel -------------------------------------------------------------------------------------------------------------

export type CancelValues = { party: string; reason_code: string; reason_text: string; refund: string };

/**
 * `refund`: "hidden" without refunds.create (the policy amount applies), "optional" to change the policy amount,
 * "required" when the policy cannot decide (review required, or the visit has started). `refundableFils` caps it.
 */
export function cancelSchema(refund: "hidden" | "optional" | "required", refundableFils: number | null) {
  return z
    .object({ party: z.string(), reason_code: z.string(), reason_text: z.string(), refund: z.string() })
    .superRefine((v, ctx) => {
      if (!(CANCEL_PARTIES as readonly string[]).includes(v.party)) issue(ctx, ["party"], "required");
      if (!(CANCEL_REASONS as readonly string[]).includes(v.reason_code)) issue(ctx, ["reason_code"], "required");
      if (reasonTextRequired(v.reason_code) && !v.reason_text.trim()) issue(ctx, ["reason_text"], "textRequired");
      if (v.reason_text.trim().length > 1000) issue(ctx, ["reason_text"], "tooLong");
      if (refund === "hidden") return;
      if (v.refund.trim() === "") {
        if (refund === "required") issue(ctx, ["refund"], "refundRequired");
        return;
      }
      const parsed = parseAedToFils(v.refund);
      if (!parsed.ok) issue(ctx, ["refund"], "refundInvalid");
      else if (refundableFils !== null && parsed.fils > refundableFils) issue(ctx, ["refund"], "refundTooHigh");
    })
    .transform((v): CancelInput => {
      const parsed = refund === "hidden" || v.refund.trim() === "" ? null : parseAedToFils(v.refund);
      return {
        party: v.party as CancelInput["party"],
        reason_code: v.reason_code,
        reason_text: v.reason_text.trim() || null,
        ...(parsed?.ok ? { refund_fils: parsed.fils } : {}),
      };
    });
}

// Propose alternatives ----------------------------------------------------------------------------------------------

export const MAX_ALTERNATIVES = 3;

export type ProposeValues = { options: { service_date: string; slot_template_id: string; note: string }[]; note: string };

export const proposeSchema = z
  .object({
    options: z.array(z.object({ service_date: z.string(), slot_template_id: z.string(), note: z.string() })),
    note: z.string(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.options.forEach((o, i) => {
      if (!isIsoDate(o.service_date)) issue(ctx, ["options", i, "service_date"], "dateRequired");
      if (!o.slot_template_id) issue(ctx, ["options", i, "slot_template_id"], "slotRequired");
      if (o.note.trim().length > 200) issue(ctx, ["options", i, "note"], "tooLong");
      const key = `${o.service_date}#${o.slot_template_id}`;
      if (o.service_date && o.slot_template_id && seen.has(key)) issue(ctx, ["options", i, "slot_template_id"], "duplicateOption");
      seen.add(key);
    });
    if (v.note.trim().length > 500) issue(ctx, ["note"], "tooLong");
  })
  .transform(
    (v): ProposeInput => ({
      options: v.options.map((o) => ({
        service_date: o.service_date,
        slot_template_id: Number(o.slot_template_id),
        note: o.note.trim() || null,
      })),
      note: v.note.trim() || null,
    }),
  );

// Reschedule (staff) -------------------------------------------------------------------------------------------------

export type RescheduleValues = { service_date: string; slot_template_id: string; reason: string; override: boolean };

export const rescheduleSchema = z
  .object({ service_date: z.string(), slot_template_id: z.string(), reason: z.string(), override: z.boolean() })
  .superRefine((v, ctx) => {
    if (!isIsoDate(v.service_date)) issue(ctx, ["service_date"], "dateRequired");
    if (!v.slot_template_id) issue(ctx, ["slot_template_id"], "slotRequired");
    if (v.override) checkReason(ctx, "reason", v.reason, FORCE_REASON_MIN, 1000, "overrideReasonMin");
    else checkReason(ctx, "reason", v.reason, 3, 1000);
  })
  .transform(
    (v): RescheduleInput => ({
      service_date: v.service_date,
      slot_template_id: Number(v.slot_template_id),
      reason: v.reason.trim(),
      ...(v.override ? { override: true } : {}),
    }),
  );

// Customer reschedule requests, cancellation review, notes ------------------------------------------------------------

export type ApproveValues = { note: string; override: boolean; reason: string };

export const approveRequestSchema = z
  .object({ note: z.string(), override: z.boolean(), reason: z.string() })
  .superRefine((v, ctx) => {
    if (v.note.trim().length > 1000) issue(ctx, ["note"], "tooLong");
    if (v.override) checkReason(ctx, "reason", v.reason, FORCE_REASON_MIN, 1000, "overrideReasonMin");
  })
  .transform((v) => ({ note: v.note.trim() || null, ...(v.override ? { override: true, reason: v.reason.trim() } : {}) }));

/** A note the customer is told (rejecting a reschedule request, keeping the booking after a cancellation request). */
export const customerNoteSchema = z
  .object({ note: z.string() })
  .superRefine((v, ctx) => checkReason(ctx, "note", v.note, 1, 1000))
  .transform((v) => v.note.trim());

export const NOTE_MAX = 2000;

export const internalNoteSchema = z
  .object({ body: z.string() })
  .superRefine((v, ctx) => checkReason(ctx, "body", v.body, 1, NOTE_MAX))
  .transform((v) => v.body.trim());

// Assignment ---------------------------------------------------------------------------------------------------------

/** An unassign / replace reason (3–500 characters; at least 10 with an override, spec §8.6). */
export function assignmentReasonSchema(override: boolean) {
  return z
    .object({ reason: z.string() })
    .superRefine((v, ctx) =>
      override ? checkReason(ctx, "reason", v.reason, FORCE_REASON_MIN, FORCE_REASON_MAX, "overrideReasonMin") : checkReason(ctx, "reason", v.reason, 3, 500),
    )
    .transform((v) => v.reason.trim());
}

export const VISIT_STATUS_TARGETS = ["arrived", "in_progress", "completed", "no_show_customer", "missed_by_company"] as const satisfies readonly VisitStatusTarget[];

export type VisitStatusValues = { status: string; reason: string; date: string; time: string };

/** A Dubai wall-clock date and time as an instant with its offset (Asia/Dubai is UTC+4, no daylight saving). */
export function dubaiInstant(date: string, time: string): string | null {
  if (!isIsoDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return `${date}T${time}:00+04:00`;
}

export const visitStatusSchema = z
  .object({ status: z.string(), reason: z.string(), date: z.string(), time: z.string() })
  .superRefine((v, ctx) => {
    if (!(VISIT_STATUS_TARGETS as readonly string[]).includes(v.status)) issue(ctx, ["status"], "statusRequired");
    checkReason(ctx, "reason", v.reason, 3, 500);
    if ((v.date || v.time) && !dubaiInstant(v.date, v.time)) issue(ctx, ["time"], "timeInvalid");
  })
  .transform((v) => ({
    status: v.status as VisitStatusTarget,
    reason: v.reason.trim(),
    at: v.date || v.time ? dubaiInstant(v.date, v.time) : null,
  }));
