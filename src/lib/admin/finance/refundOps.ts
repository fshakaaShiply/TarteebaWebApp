import type { AdminRefund } from "../types";
import type { RefundOutcomeBody, ReinstateBody } from "./endpoints";

/*
 * What staff may do about a refund the provider's answers left flagged (finance §3.3, A1a §5.2):
 *  - record the provider's answer for a flagged refund that is still open (outcome succeeded or failed);
 *  - "Provider paid after all": a refund that failed and was later reported paid (flag refund_succeeded_reported_after_failed);
 *  - clear the review flag of a refund that is final.
 * A refund to the customer's balance is automatic: the API refuses all three (409 WALLET_REFUND_AUTOMATIC), so the page
 * does not offer them. The API checks every condition again.
 */

export const REINSTATE_FLAG = "refund_succeeded_reported_after_failed";
export const REFUND_NOTE_MIN = 3;
export const REFUND_OPS_NOTE_MAX = 500;
export const PROVIDER_REF_MAX = 120;
export const FAILURE_CODE_MAX = 64;
const FAILURE_CODE = /^[A-Za-z0-9_.:-]+$/;

export function isWalletRefund(refund: Pick<AdminRefund, "gateway" | "destination">): boolean {
  return refund.destination === "wallet" || refund.gateway === "wallet";
}

export function canRecordOutcome(refund: Pick<AdminRefund, "status" | "needs_review" | "gateway" | "destination">): boolean {
  return refund.needs_review && (refund.status === "requested" || refund.status === "processing") && !isWalletRefund(refund);
}

export function canReinstate(refund: Pick<AdminRefund, "status" | "needs_review" | "gateway" | "destination" | "review">): boolean {
  return refund.needs_review && refund.status === "failed" && refund.review?.reason === REINSTATE_FLAG && !isWalletRefund(refund);
}

export function canClearRefundFlag(refund: Pick<AdminRefund, "status" | "needs_review">): boolean {
  return refund.needs_review && (refund.status === "succeeded" || refund.status === "failed");
}

export type OpsFormError =
  | "note_required"
  | "note_short"
  | "note_long"
  | "ref_required"
  | "ref_long"
  | "code_required"
  | "code_long"
  | "code_invalid";
export const OPS_FORM_ERRORS: readonly OpsFormError[] = ["note_required", "note_short", "note_long", "ref_required", "ref_long", "code_required", "code_long", "code_invalid"];

export function checkNote(value: string): OpsFormError | null {
  const note = value.trim();
  if (note === "") return "note_required";
  if (note.length < REFUND_NOTE_MIN) return "note_short";
  if (note.length > REFUND_OPS_NOTE_MAX) return "note_long";
  return null;
}

export type OutcomeValues = { status: "succeeded" | "failed"; provider_refund_ref: string; failure_code: string; note: string };

/** The outcome request, or the first field that is wrong (a paid refund needs the provider's reference when it has none). */
export function buildOutcome(values: OutcomeValues, refund: Pick<AdminRefund, "gateway_refund_ref">): { ok: true; body: RefundOutcomeBody } | { ok: false; field: "note" | "provider_refund_ref" | "failure_code"; error: OpsFormError } {
  const note = checkNote(values.note);
  if (note) return { ok: false, field: "note", error: note };
  if (values.status === "succeeded") {
    const ref = values.provider_refund_ref.trim();
    if (ref.length > PROVIDER_REF_MAX) return { ok: false, field: "provider_refund_ref", error: "ref_long" };
    if (ref === "" && !refund.gateway_refund_ref) return { ok: false, field: "provider_refund_ref", error: "ref_required" };
    return { ok: true, body: { status: "succeeded", ...(ref === "" ? {} : { provider_refund_ref: ref }), note: values.note.trim() } };
  }
  const code = values.failure_code.trim();
  if (code === "") return { ok: false, field: "failure_code", error: "code_required" };
  if (code.length > FAILURE_CODE_MAX) return { ok: false, field: "failure_code", error: "code_long" };
  if (!FAILURE_CODE.test(code)) return { ok: false, field: "failure_code", error: "code_invalid" };
  return { ok: true, body: { status: "failed", failure_code: code, note: values.note.trim() } };
}

export type ReinstateValues = { provider_refund_ref: string; note: string };

/** "Provider paid after all": the amount confirmed is the refund's own. */
export function buildReinstate(values: ReinstateValues, amountFils: number): { ok: true; body: ReinstateBody } | { ok: false; field: "note" | "provider_refund_ref"; error: OpsFormError } {
  const note = checkNote(values.note);
  if (note) return { ok: false, field: "note", error: note };
  const ref = values.provider_refund_ref.trim();
  if (ref.length > PROVIDER_REF_MAX) return { ok: false, field: "provider_refund_ref", error: "ref_long" };
  return { ok: true, body: { expected_amount_fils: amountFils, ...(ref === "" ? {} : { provider_refund_ref: ref }), note: values.note.trim() } };
}
