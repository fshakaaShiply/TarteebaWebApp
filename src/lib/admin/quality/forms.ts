import { parseAedToFils } from "@/lib/money";
import type { CasePatch, CreateCaseBody, MessageBody, ResolveBody } from "./endpoints";
import type { AdminCaseDetail, Attachment, CaseCategory, CaseOutcome, CasePriority, CloseReason, CompensationType } from "./types";

/*
 * What the A10 forms send. Each builder checks what the API checks (A2 §8.2, A3 §5) so a form never makes a request the
 * API will refuse for a reason we can see, and returns the exact body, or the first field that is wrong. The API still
 * decides: its answers are shown through useQualityError.
 */

export const MESSAGE_MAX = 2000;
export const RESOLUTION_MAX = 2000;
export const NOTE_MAX = 500;
export const REASON_MIN = 3;
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 2000;
export const MAX_FILES = 5;
export const FILE_MAX_BYTES = 5 * 1024 * 1024;
/** What staff may upload (the API re-encodes images; HEIC is not taken from staff). */
export const FILE_ACCEPT = ["image/jpeg", "image/png", "image/webp", "application/pdf", ".jpg", ".jpeg", ".png", ".webp", ".pdf"] as const;

export type FormError =
  | "required"
  | "too_long"
  | "too_short"
  | "outcome_required"
  | "resolution_required"
  | "amount_required"
  | "amount_invalid"
  | "amount_precision"
  | "amount_zero"
  | "amount_over"
  | "type_unavailable"
  | "date_required"
  | "slot_required"
  | "category_required"
  | "reason_required"
  | "pdf_public";

export type Built<T, F extends string = string> = { ok: true; body: T } | { ok: false; field: F; error: FormError };

const fail = <F extends string>(field: F, error: FormError): { ok: false; field: F; error: FormError } => ({ ok: false, field, error });

/** An uploaded PDF may only be attached to an internal note (A2 §8.2, P5-Q94). */
export const isPdf = (attachment: Pick<Attachment, "mime">) => attachment.mime === "application/pdf";

// ---- reply -------------------------------------------------------------------------------------------------------------

export type ReplyValues = { body: string; internal: boolean; awaitCustomer: boolean };

/** "Wait for the customer" is offered, and sent, only with a public reply on a case the customer can see. */
export function canAwaitCustomer(c: Pick<AdminCaseDetail, "customer_visible" | "status">, internal: boolean): boolean {
  return !internal && c.customer_visible && (c.status === "open" || c.status === "in_review" || c.status === "awaiting_customer");
}

export function buildReply(values: ReplyValues, c: Pick<AdminCaseDetail, "customer_visible" | "status">, files: readonly Attachment[]): Built<MessageBody, "body" | "files"> {
  const body = values.body.trim();
  if (body === "") return fail("body", "required");
  if (body.length > MESSAGE_MAX) return fail("body", "too_long");
  if (!values.internal && files.some(isPdf)) return fail("files", "pdf_public");
  const message: MessageBody = { body, is_internal: values.internal };
  if (values.awaitCustomer && canAwaitCustomer(c, values.internal)) message.await_customer = true;
  if (files.length > 0) message.attachment_ids = files.map((f) => f.id);
  return { ok: true, body: message };
}

// ---- resolve -----------------------------------------------------------------------------------------------------------

export type ResolveValues = {
  outcome: string;
  resolution: string;
  compensation: CompensationType;
  amount: string;
  note: string;
  freeDate: string;
  freeSlot: string;
  freeWorkers: string;
};

export const emptyResolve: ResolveValues = { outcome: "", resolution: "", compensation: "none", amount: "", note: "", freeDate: "", freeSlot: "", freeWorkers: "" };

/** The kinds of case that need an outcome (A2: OUTCOME_REQUIRED for a complaint and a rating follow-up). */
export const needsOutcome = (c: Pick<AdminCaseDetail, "type">) => c.type !== "support";

export type ResolveField = "outcome" | "resolution" | "amount" | "note" | "compensation" | "freeDate" | "freeSlot";

export type ResolveSummary =
  | { kind: "none" }
  | { kind: "refund" | "credit"; amount_fils: number }
  | { kind: "free_visit"; date: string };

/**
 * The resolve request. A refund or a credit is only proposed (the accountant approves it), so the summary says which
 * of the two the second step must confirm. The amount is typed in AED and capped by the case's own options.
 */
export function buildResolve(values: ResolveValues, c: AdminCaseDetail): Built<ResolveBody, ResolveField> & { summary?: ResolveSummary } {
  const outcome = values.outcome as CaseOutcome | "";
  if (needsOutcome(c) && outcome === "") return fail("outcome", "outcome_required");
  const resolution = values.resolution.trim();
  if (resolution.length > RESOLUTION_MAX) return fail("resolution", "too_long");
  // The customer reads the resolution: a case they can see, or any compensation, needs the text.
  if ((c.customer_visible || values.compensation !== "none") && resolution === "") return fail("resolution", "resolution_required");

  const body: ResolveBody = {};
  if (outcome) body.outcome = outcome;
  if (resolution) body.resolution = resolution;
  const options = c.compensation_options;
  const note = values.note.trim();
  if (note.length > NOTE_MAX) return fail("note", "too_long");

  if (values.compensation === "refund" || values.compensation === "credit") {
    const option = options?.[values.compensation];
    if (!option?.available) return fail("compensation", "type_unavailable");
    const parsed = parseAedToFils(values.amount);
    if (!parsed.ok) {
      return fail("amount", parsed.error === "empty" ? "amount_required" : parsed.error === "precision" ? "amount_precision" : "amount_invalid");
    }
    if (parsed.fils < 1) return fail("amount", "amount_zero");
    if (parsed.fils > option.max_fils) return fail("amount", "amount_over");
    body.compensation = { type: values.compensation, amount_fils: parsed.fils, ...(note ? { note } : {}) };
    return { ok: true, body, summary: { kind: values.compensation, amount_fils: parsed.fils } };
  }
  if (values.compensation === "free_visit") {
    if (!options?.free_visit.available) return fail("compensation", "type_unavailable");
    if (values.freeDate === "") return fail("freeDate", "date_required");
    const slot = Number(values.freeSlot);
    if (!Number.isInteger(slot) || slot < 1) return fail("freeSlot", "slot_required");
    const workers = Number(values.freeWorkers);
    body.compensation = {
      type: "free_visit",
      ...(note ? { note } : {}),
      free_visit: { date: values.freeDate, slot_template_id: slot, ...(Number.isInteger(workers) && workers >= 1 ? { workers_count: workers } : {}) },
    };
    return { ok: true, body, summary: { kind: "free_visit", date: values.freeDate } };
  }
  return { ok: true, body, summary: { kind: "none" } };
}

// ---- close, reopen, take --------------------------------------------------------------------------------------------

/** The reasons staff may close with: an active case as a duplicate, merged or not actionable; a resolved one as resolved. */
export function closeReasonsFor(status: AdminCaseDetail["status"]): CloseReason[] {
  return status === "resolved" ? ["resolved"] : ["duplicate", "merged", "not_actionable"];
}

export function buildClose(reason: string, status: AdminCaseDetail["status"], note: string): Built<CasePatch, "reason" | "note"> {
  if (!(closeReasonsFor(status) as string[]).includes(reason)) return fail("reason", "required");
  const text = note.trim();
  if (text.length > NOTE_MAX) return fail("note", "too_long");
  return { ok: true, body: { status: "closed", close_reason: reason as CloseReason, ...(text ? { reason: text } : {}) } };
}

/** Reopening a resolved case needs a reason (API: REOPEN_REASON_REQUIRED). */
export function buildReopen(reason: string): Built<CasePatch, "reason"> {
  const text = reason.trim();
  if (text === "") return fail("reason", "reason_required");
  if (text.length > NOTE_MAX) return fail("reason", "too_long");
  return { ok: true, body: { status: "in_review", reason: text } };
}

/** A reason of 3 to 500 characters (rejecting a compensation, excluding a rating). */
export function buildReason(value: string): Built<{ reason: string }, "reason"> {
  const reason = value.trim();
  if (reason.length < REASON_MIN) return fail("reason", reason === "" ? "reason_required" : "too_short");
  if (reason.length > NOTE_MAX) return fail("reason", "too_long");
  return { ok: true, body: { reason } };
}

// ---- a case staff log (A03 "open complaint") -----------------------------------------------------------------------

export type NewCaseValues = { category: string; description: string; priority: string; source: string; overrideReason: string };

export const CASE_SOURCES_STAFF = ["phone", "whatsapp", "admin"] as const;

export type NewCaseField = "category" | "description" | "source" | "overrideReason";

export function buildNewCase(values: NewCaseValues, target: { customerUlid: string; bookingId: number }): Built<CreateCaseBody, NewCaseField> {
  if (values.category === "") return fail("category", "category_required");
  const description = values.description.trim();
  if (description.length < DESCRIPTION_MIN) return fail("description", description === "" ? "required" : "too_short");
  if (description.length > DESCRIPTION_MAX) return fail("description", "too_long");
  if (!(CASE_SOURCES_STAFF as readonly string[]).includes(values.source)) return fail("source", "required");
  const override = values.overrideReason.trim();
  if (override !== "" && override.length < REASON_MIN) return fail("overrideReason", "too_short");
  if (override.length > NOTE_MAX) return fail("overrideReason", "too_long");
  return {
    ok: true,
    body: {
      customer_id: target.customerUlid,
      booking_id: target.bookingId,
      type: "complaint",
      category: values.category as CaseCategory,
      description,
      source: values.source as "phone" | "whatsapp" | "admin",
      ...(values.priority ? { priority: values.priority as CasePriority } : {}),
      ...(override ? { window_override_reason: override } : {}),
    },
  };
}
