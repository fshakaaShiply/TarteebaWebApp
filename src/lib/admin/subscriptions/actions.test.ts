import { describe, expect, it } from "vitest";
import { occurrence, pendingDetail, subscriptionDetail } from "@/test/subscriptionFixtures";
import { AdminApiError } from "../client";
import { availableActions, capacityDatesOf, conflictEntries, dayNotEditableReason, maxRefundOf, notAssignableOf, pendingReview, seriesPriceHigherOf, termsChangedOf, visitActions } from "./actions";

const err = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const holds = (...permissions: string[]) => (p: string) => permissions.includes(p);

describe("A08 actions by state and permission", () => {
  it("offers a pending request Confirm and Reject, only to subscriptions.manage", () => {
    expect([...availableActions(pendingDetail(), holds("subscriptions.manage"))].sort()).toEqual(["assignBackup", "assignPrimary", "confirm", "reject"]);
    expect(availableActions(pendingDetail(), holds("subscriptions.view")).size).toBe(0);
  });

  it("offers a running subscription freeze, skip, assign, cancel and auto-renew off", () => {
    const set = availableActions(subscriptionDetail(), holds("subscriptions.manage"));
    expect([...set].sort()).toEqual(["assignBackup", "assignPrimary", "autoRenewOff", "cancel", "freeze", "skip"]);
  });

  it("does not offer auto-renew off once it is off or while a review is open", () => {
    expect(availableActions(subscriptionDetail({ auto_renew: false }), holds("subscriptions.manage")).has("autoRenewOff")).toBe(false);
  });

  it("offers Renew now to a failed renewal and Unfreeze while frozen", () => {
    const failed = subscriptionDetail({ status: "renewal_failed", actions: { ...subscriptionDetail().actions, renew: true, freeze: false } });
    expect(availableActions(failed, holds("subscriptions.manage")).has("renew")).toBe(true);
    const frozen = subscriptionDetail({ status: "paused", actions: { ...subscriptionDetail().actions, freeze: false, unfreeze: true } });
    expect(availableActions(frozen, holds("subscriptions.manage")).has("unfreeze")).toBe(true);
  });

  it("splits a review between Keep (manage) and Resolve (refunds.create plus a read permission)", () => {
    const review = subscriptionDetail({
      cancel_review: { requested_at: "2026-10-23T10:00:00+00:00", reason_code: "customer_request", party: "customer", decision: null } as never,
      actions: { ...subscriptionDetail().actions, resolve_review: true, freeze: false, skip: false, cancel: false, edit_following: false },
    });
    expect(pendingReview(review)).not.toBeNull();
    expect([...availableActions(review, holds("subscriptions.manage"))].sort()).toEqual(["assignBackup", "assignPrimary", "declineReview"]);
    expect([...availableActions(review, holds("subscriptions.view", "refunds.create"))]).toEqual(["resolveReview"]);
    expect(availableActions(review, holds("refunds.create")).size).toBe(0);
  });

  it("treats a decided review as closed", () => {
    const closed = subscriptionDetail({ cancel_review: { decision: "declined", resolved_at: "2026-10-24T10:00:00+00:00" } as never });
    expect(pendingReview(closed)).toBeNull();
  });
});

describe("A08 visit row actions", () => {
  const detail = subscriptionDetail();
  it("shows Edit this visit and Edit following visits as separate actions where the API allows them", () => {
    const set = visitActions(occurrence(), detail, holds("subscriptions.manage"));
    expect(set.has("move")).toBe(true);
    expect(set.has("editFollowing")).toBe(true);
    expect(set.has("skip")).toBe(true);
    expect(set.has("cancelByCompany")).toBe(true);
  });

  it("leaves out what a visit cannot take and everything without write permission", () => {
    const locked = occurrence({ editable: { this: false, following: false, skip: false, undo_skip: true }, visit: { id: 1, status: "arrived", is_exception: false, original_date: null } });
    const set = visitActions(locked, detail, holds("subscriptions.manage"));
    expect([...set]).toEqual(["undoSkip"]);
    expect(visitActions(occurrence(), detail, holds("subscriptions.view")).size).toBe(0);
  });

  it("offers the decision on a visit with a pending request", () => {
    const pending = occurrence({ reschedule_request: { id: 5, date: "2026-11-02", slot: null } });
    expect(visitActions(pending, detail, holds("subscriptions.manage")).has("decide")).toBe(true);
  });
});

describe("A08 error details", () => {
  it("reads TERMS_CHANGED as {preview, changed}", () => {
    const terms = termsChangedOf<{ amount_fils: number }>(err(409, "TERMS_CHANGED", { preview: { amount_fils: 99000 }, changed: ["amount_fils"] }));
    expect(terms).toEqual({ preview: { amount_fils: 99000 }, changed: ["amount_fils"] });
    expect(termsChangedOf(err(409, "TERMS_CHANGED", {}))).toBeNull();
    expect(termsChangedOf(err(409, "STALE_VERSION", { preview: {} }))).toBeNull();
  });

  it("reads the series price check, the refund cap, the unfit workers, the held dates and the day reason", () => {
    expect(seriesPriceHigherOf(err(422, "SERIES_PRICE_HIGHER", { date: "2026-11-09", old_unit_fils: 12000, new_unit_fils: 15000 }))).toEqual({
      date: "2026-11-09",
      oldUnitFils: 12000,
      newUnitFils: 15000,
    });
    expect(maxRefundOf(err(422, "REFUND_AMOUNT_INVALID", { max_fils: 4000 }))).toBe(4000);
    expect(notAssignableOf(err(422, "WORKER_NOT_ASSIGNABLE", { workers: [{ worker_id: 3, reason: "not_eligible", reasons: ["rest_day"] }] }))).toEqual([
      { workerId: 3, reason: "not_eligible", reasons: ["rest_day"] },
    ]);
    expect(capacityDatesOf(err(409, "CAPACITY_NOT_HELD", { dates: ["2026-11-01"] }))).toEqual(["2026-11-01"]);
    expect(dayNotEditableReason(err(422, "DAY_NOT_EDITABLE", { reason: "rest" }))).toBe("rest");
    expect(maxRefundOf(new Error("x"))).toBeNull();
  });

  it("orders conflict dates", () => {
    expect(conflictEntries({ "2026-11-08": "BLACKOUT", "2026-11-01": "SLOT_FULL" }).map((c) => c.date)).toEqual(["2026-11-01", "2026-11-08"]);
    expect(conflictEntries(undefined)).toEqual([]);
  });
});
