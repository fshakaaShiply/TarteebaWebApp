import { describe, expect, it } from "vitest";
import type { AdminRefund } from "../types";
import { buildOutcome, buildReinstate, canClearRefundFlag, canRecordOutcome, canReinstate, checkNote } from "./refundOps";

const refund = (over: Partial<AdminRefund> = {}): AdminRefund =>
  ({
    id: 3,
    ulid: "01R3",
    amount_fils: 18000,
    currency: "AED",
    status: "processing",
    gateway: "fake",
    destination: "card",
    gateway_refund_ref: null,
    needs_review: true,
    review: { reason: "still_open", reason_label: null, cleared_at: null, cleared_by: null, note: null },
    ...over,
  }) as AdminRefund;

describe("what staff may do about a flagged refund", () => {
  it("records the provider's answer only for a flagged refund that is still open", () => {
    expect(canRecordOutcome(refund())).toBe(true);
    expect(canRecordOutcome(refund({ status: "requested" }))).toBe(true);
    expect(canRecordOutcome(refund({ needs_review: false }))).toBe(false);
    expect(canRecordOutcome(refund({ status: "succeeded" }))).toBe(false);
  });

  it("offers 'provider paid after all' only for a failed refund flagged as reported paid after failing", () => {
    const failed = refund({ status: "failed", review: { reason: "refund_succeeded_reported_after_failed", reason_label: null, cleared_at: null, cleared_by: null, note: null } });
    expect(canReinstate(failed)).toBe(true);
    expect(canReinstate({ ...failed, review: { ...failed.review!, reason: "still_open" } })).toBe(false);
    expect(canReinstate({ ...failed, status: "succeeded" })).toBe(false);
  });

  it("clears the flag of a final refund only", () => {
    expect(canClearRefundFlag(refund({ status: "succeeded" }))).toBe(true);
    expect(canClearRefundFlag(refund({ status: "failed" }))).toBe(true);
    expect(canClearRefundFlag(refund({ status: "processing" }))).toBe(false);
    expect(canClearRefundFlag(refund({ status: "succeeded", needs_review: false }))).toBe(false);
  });

  it("offers none of the three for a refund to the customer's balance: it is automatic", () => {
    const wallet = refund({ destination: "wallet", gateway: "wallet" });
    expect(canRecordOutcome(wallet)).toBe(false);
    expect(canReinstate({ ...wallet, status: "failed", review: { reason: "refund_succeeded_reported_after_failed", reason_label: null, cleared_at: null, cleared_by: null, note: null } })).toBe(false);
  });
});

describe("the provider's answer", () => {
  const form = (over = {}) => ({ status: "succeeded" as const, provider_refund_ref: "", failure_code: "", note: "Seen on the statement", ...over });

  it("needs the provider's reference for a paid refund that has none, and not when it already has one", () => {
    expect(buildOutcome(form(), refund())).toEqual({ ok: false, field: "provider_refund_ref", error: "ref_required" });
    expect(buildOutcome(form(), refund({ gateway_refund_ref: "fref_1" }))).toEqual({ ok: true, body: { status: "succeeded", note: "Seen on the statement" } });
    expect(buildOutcome(form({ provider_refund_ref: " fref_9 " }), refund())).toEqual({ ok: true, body: { status: "succeeded", provider_refund_ref: "fref_9", note: "Seen on the statement" } });
    expect(buildOutcome(form({ provider_refund_ref: "x".repeat(121) }), refund())).toMatchObject({ ok: false, error: "ref_long" });
  });

  it("needs the provider's failure code for a declined refund, in the API's character set", () => {
    const failed = (code: string) => buildOutcome(form({ status: "failed", failure_code: code }), refund());
    expect(failed("")).toEqual({ ok: false, field: "failure_code", error: "code_required" });
    expect(failed("bad code!")).toMatchObject({ ok: false, error: "code_invalid" });
    expect(failed("x".repeat(65))).toMatchObject({ ok: false, error: "code_long" });
    expect(failed("card_declined")).toEqual({ ok: true, body: { status: "failed", failure_code: "card_declined", note: "Seen on the statement" } });
  });

  it("needs a note of 3 to 500 characters", () => {
    expect(checkNote("")).toBe("note_required");
    expect(checkNote("ab")).toBe("note_short");
    expect(checkNote("x".repeat(501))).toBe("note_long");
    expect(checkNote("abc")).toBeNull();
    expect(buildOutcome(form({ note: "" }), refund())).toEqual({ ok: false, field: "note", error: "note_required" });
  });
});

describe("provider paid after all", () => {
  it("confirms the refund's own amount, with an optional reference", () => {
    expect(buildReinstate({ provider_refund_ref: "", note: "Provider statement 14 Nov" }, 18000)).toEqual({
      ok: true,
      body: { expected_amount_fils: 18000, note: "Provider statement 14 Nov" },
    });
    expect(buildReinstate({ provider_refund_ref: "fref_7", note: "Provider statement 14 Nov" }, 18000)).toMatchObject({ ok: true, body: { provider_refund_ref: "fref_7" } });
    expect(buildReinstate({ provider_refund_ref: "", note: "no" }, 18000)).toMatchObject({ ok: false, field: "note" });
  });
});
