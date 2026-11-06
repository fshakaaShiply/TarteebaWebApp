import { AdminApiError } from "../client";
import { SUBSCRIPTIONS_READ } from "../nav";
import type { CancelReviewBlock, SubscriptionDetail, SubscriptionOccurrence } from "./types";

/*
 * A08 actions (design §9.1, §8.4): which buttons a subscription offers. The API's own `actions` flags say what its state
 * allows; the permission says who may: every write needs subscriptions.manage, resolving a cancellation review needs
 * refunds.create on top of a read permission (P4-57), a custom cancel refund needs refunds.create. Hiding is for clarity
 * only: the API checks the state, the version and the permission again (409 INVALID_STATE / STALE_VERSION, 403).
 */

export const MANAGE = "subscriptions.manage";
export const REFUND_PERMISSION = "refunds.create";
export const CAPACITY_OVERRIDE = "capacity.override";

export type SubscriptionAction =
  | "confirm"
  | "reject"
  | "freeze"
  | "unfreeze"
  | "skip"
  | "undoSkip"
  | "renew"
  | "autoRenewOff"
  | "cancel"
  | "cancelAsCompany"
  | "resolveReview"
  | "declineReview"
  | "assignPrimary"
  | "assignBackup";

/** Header order of the buttons. */
export const ACTION_ORDER: readonly SubscriptionAction[] = [
  "confirm",
  "reject",
  "renew",
  "resolveReview",
  "declineReview",
  "freeze",
  "unfreeze",
  "skip",
  "undoSkip",
  "assignPrimary",
  "assignBackup",
  "autoRenewOff",
  "cancel",
  "cancelAsCompany",
];

/**
 * Where staff may switch auto-renew off (ToggleAutoRenew): active and paused (the next period is released and the term
 * runs out), and renewal_failed and suspended (the failed renewal is given up: no more attempts charge the card, and
 * the subscription runs to the end of its paid term, or ends at once when that is past).
 */
export const AUTO_RENEW_OFF_STATUSES: readonly string[] = ["active", "paused", "renewal_failed", "suspended"];
export const FAILING_RENEWAL_STATUSES: readonly string[] = ["renewal_failed", "suspended"];

/** The cancellation review that waits for a decision, or null. */
export function pendingReview(detail: Pick<SubscriptionDetail, "cancel_review">): CancelReviewBlock | null {
  const review = detail.cancel_review;
  if (!review) return null;
  return review.decision || review.resolved_at ? null : review;
}

/**
 * A renewal attempt is under way on the renewal period (P4-251, `renewal.attempt_under_way`): a charge awaits its
 * answer or is about to be claimed, so Renew now would answer 409 RENEWAL_IN_PROGRESS. `actions.renew` stays a status
 * rule, so the button is offered but disabled until the attempt has its answer.
 */
export function renewalBusy(detail: Pick<SubscriptionDetail, "renewal">): boolean {
  return detail.renewal.attempt_under_way;
}

export function availableActions(detail: SubscriptionDetail, can: (permission: string) => boolean): Set<SubscriptionAction> {
  const out = new Set<SubscriptionAction>();
  const a = detail.actions;
  const manage = can(MANAGE);
  const review = pendingReview(detail);
  if (manage) {
    if (a.confirm) out.add("confirm");
    if (a.reject) out.add("reject");
    if (a.renew) out.add("renew");
    if (a.freeze) out.add("freeze");
    if (a.unfreeze) out.add("unfreeze");
    if (a.skip) out.add("skip");
    if (a.undo_skip) out.add("undoSkip");
    if (a.assign) {
      out.add("assignPrimary");
      out.add("assignBackup");
    }
    if (a.cancel) out.add("cancel");
    if (review && a.resolve_review) {
      out.add("declineReview");
      // §4.7: while a review waits, coordinators may instead cancel as the company (the API closes the review as
      // superseded); `actions.cancel` is false then because the customer's own cancellation is what waits.
      out.add("cancelAsCompany");
    }
    if (detail.auto_renew && !review && AUTO_RENEW_OFF_STATUSES.includes(detail.status)) out.add("autoRenewOff");
  }
  // Finance resolves a review with a refund: a read permission and refunds.create (the API checks both).
  if (review && a.resolve_review && can(REFUND_PERMISSION) && (can(MANAGE) || can("subscriptions.view"))) out.add("resolveReview");
  return out;
}

/** True for staff who may read A08 (the pages themselves wrap in RequirePermission with SUBSCRIPTIONS_READ). */
export const READ_PERMISSIONS = SUBSCRIPTIONS_READ;

/** Row-level buttons of the Visits tab. */
export type VisitAction = "move" | "editFollowing" | "skip" | "undoSkip" | "cancelByCompany" | "decide";

export function visitActions(
  occurrence: SubscriptionOccurrence,
  detail: Pick<SubscriptionDetail, "actions" | "type">,
  can: (permission: string) => boolean,
): Set<VisitAction> {
  const out = new Set<VisitAction>();
  if (!can(MANAGE)) return out;
  const e = occurrence.editable;
  if (e.this) out.add("move");
  if (e.following && detail.actions.edit_following) out.add("editFollowing");
  if (e.skip) out.add("skip");
  if (e.undo_skip) out.add("undoSkip");
  // The company's miss: a materialized visit that has not been served, while the series runs.
  if (detail.actions.edit_following && occurrence.state === "materialized" && occurrence.booking !== null && ["scheduled", "worker_assigned", "en_route"].includes(occurrence.visit?.status ?? "")) {
    out.add("cancelByCompany");
  }
  if (occurrence.reschedule_request) out.add("decide");
  return out;
}

// ---- What an error says ---------------------------------------------------------------------------------------------

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : []);

/** 409 TERMS_CHANGED of a subscription route: `{preview, changed}`, the new terms replacing the shown ones. */
export type TermsChanged<T> = { preview: T; changed: string[] };

export function termsChangedOf<T>(error: unknown): TermsChanged<T> | null {
  if (!(error instanceof AdminApiError) || error.code !== "TERMS_CHANGED") return null;
  const preview = error.details.preview;
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) return null;
  return { preview: preview as T, changed: stringList(error.details.changed) };
}

/** 422 SERIES_PRICE_HIGHER: the first new date that would cost more than the one it replaces. */
export function seriesPriceHigherOf(error: unknown): { date: string; oldUnitFils: number; newUnitFils: number } | null {
  if (!(error instanceof AdminApiError) || error.code !== "SERIES_PRICE_HIGHER") return null;
  const d = error.details;
  if (typeof d.date !== "string" || !isNumber(d.old_unit_fils) || !isNumber(d.new_unit_fils)) return null;
  return { date: d.date, oldUnitFils: d.old_unit_fils, newUnitFils: d.new_unit_fils };
}

/** 422 REFUND_AMOUNT_INVALID: the most that can be refunded. */
export function maxRefundOf(error: unknown): number | null {
  if (!(error instanceof AdminApiError) || error.code !== "REFUND_AMOUNT_INVALID") return null;
  const max = error.details.max_fils;
  return isNumber(max) && max >= 0 ? max : null;
}

export type RefusedRole = "primary" | "backup" | "substitute";
export type RefusedWorker = { workerId: number; name: string | null; role: RefusedRole | null; reason: string; reasons: string[] };

const REFUSED_ROLES: readonly string[] = ["primary", "backup", "substitute"];

/**
 * 422 WORKER_NOT_ASSIGNABLE (confirm, assign, a Live-out substitute): who cannot take which role and why. Since P4-242
 * the API names each worker and her role (`details.workers[]: {worker_id, name, role, reason, reasons[]}`).
 */
export function notAssignableOf(error: unknown): RefusedWorker[] {
  if (!(error instanceof AdminApiError) || error.code !== "WORKER_NOT_ASSIGNABLE") return [];
  const list = Array.isArray(error.details.workers) ? error.details.workers : [];
  return list
    .filter((w): w is { worker_id: number; name?: unknown; role?: unknown; reason?: unknown; reasons?: unknown } => !!w && typeof w === "object" && isNumber((w as { worker_id?: unknown }).worker_id))
    .map((w) => ({
      workerId: w.worker_id,
      name: typeof w.name === "string" && w.name !== "" ? w.name : null,
      role: typeof w.role === "string" && REFUSED_ROLES.includes(w.role) ? (w.role as RefusedRole) : null,
      reason: typeof w.reason === "string" ? w.reason : "",
      reasons: stringList(w.reasons),
    }));
}

/** 409 CAPACITY_NOT_HELD: the dates whose capacity is no longer held. */
export function capacityDatesOf(error: unknown): string[] {
  return error instanceof AdminApiError && error.code === "CAPACITY_NOT_HELD" ? stringList(error.details.dates) : [];
}

/** 422 DAY_NOT_EDITABLE: why a Live-out day cannot change (not_in_contract, rest, dropped, past, started …). */
export function dayNotEditableReason(error: unknown): string | null {
  if (!(error instanceof AdminApiError) || error.code !== "DAY_NOT_EDITABLE") return null;
  return typeof error.details.reason === "string" ? error.details.reason : "";
}

/** The conflict dates of an answer (`conflicts: {date: reason}`, a reason of the closed list P4-245), ordered. */
export function conflictEntries<R extends string>(conflicts: Record<string, R> | null | undefined): { date: string; reason: R }[] {
  return Object.entries(conflicts ?? {})
    .map(([date, reason]) => ({ date, reason: reason as R }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The Scheduling reason an occurrence conflict carries (`conflict.details.reason`), or null. */
export function conflictReasonOf(occurrence: Pick<SubscriptionOccurrence, "conflict">): string | null {
  const reason = occurrence.conflict?.details?.reason;
  return typeof reason === "string" && reason !== "" ? reason : null;
}

/** True when an error means "the subscription changed under the dialog": reload instead of retrying. */
export function isStale(error: unknown): boolean {
  return error instanceof AdminApiError && error.code === "STALE_VERSION";
}

export function codeOf(error: unknown): string | null {
  return error instanceof AdminApiError ? error.code : null;
}
