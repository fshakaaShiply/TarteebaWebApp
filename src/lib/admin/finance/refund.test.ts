import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import { canRefund, checkRefund, initialRefundValues, refundFormSchema, refundableAfter, refundableFromError, type RefundFormValues } from "./refund";

const values = (over: Partial<RefundFormValues>): RefundFormValues => ({ amount: "180", reason_code: "complaint_compensation", reason_text: "", ...over });

describe("refund amount math (spec §10.4)", () => {
  it("turns the AED the admin typed into integer fils, without float math", () => {
    expect(checkRefund(values({ amount: "180" }), 24000)).toEqual({
      ok: true,
      payload: { amount_fils: 18000, reason_code: "complaint_compensation", reason_text: null },
    });
    // 0.1 + 0.2 style amounts stay exact.
    expect(checkRefund(values({ amount: "0.30" }), 24000)).toMatchObject({ ok: true, payload: { amount_fils: 30 } });
    expect(checkRefund(values({ amount: "1,200.75" }), 200000)).toMatchObject({ ok: true, payload: { amount_fils: 120075 } });
    // Arabic-Indic digits from an Arabic keyboard.
    expect(checkRefund(values({ amount: "١٢٠٫٥" }), 24000)).toMatchObject({ ok: true, payload: { amount_fils: 12050 } });
  });

  it("allows exactly what is left to refund and nothing more", () => {
    expect(checkRefund(values({ amount: "240.00" }), 24000)).toMatchObject({ ok: true, payload: { amount_fils: 24000 } });
    expect(checkRefund(values({ amount: "240.01" }), 24000)).toEqual({ ok: false, errors: { amount: "amount_over" } });
    // A refund still processing already reduced what is refundable.
    expect(checkRefund(values({ amount: "200" }), 6000)).toEqual({ ok: false, errors: { amount: "amount_over" } });
  });

  it("refuses empty, zero, negative, malformed and over-precise amounts", () => {
    expect(checkRefund(values({ amount: "" }), 24000)).toEqual({ ok: false, errors: { amount: "amount_required" } });
    expect(checkRefund(values({ amount: "0" }), 24000)).toEqual({ ok: false, errors: { amount: "amount_zero" } });
    expect(checkRefund(values({ amount: "-5" }), 24000)).toEqual({ ok: false, errors: { amount: "amount_invalid" } });
    expect(checkRefund(values({ amount: "12a" }), 24000)).toEqual({ ok: false, errors: { amount: "amount_invalid" } });
    expect(checkRefund(values({ amount: "10.555" }), 24000)).toEqual({ ok: false, errors: { amount: "amount_precision" } });
  });

  it("needs a staff reason from the API's list, and a note for other", () => {
    expect(checkRefund(values({ reason_code: "" }), 24000)).toEqual({ ok: false, errors: { reason_code: "reason_required" } });
    // System reasons (price_difference) are recorded by other modules, never offered to staff.
    expect(checkRefund(values({ reason_code: "price_difference" }), 24000)).toEqual({ ok: false, errors: { reason_code: "reason_required" } });
    expect(checkRefund(values({ reason_code: "other", reason_text: "  " }), 24000)).toEqual({ ok: false, errors: { reason_text: "note_required" } });
    expect(checkRefund(values({ reason_code: "other", reason_text: " Late team, agreed by phone " }), 24000)).toEqual({
      ok: true,
      payload: { amount_fils: 18000, reason_code: "other", reason_text: "Late team, agreed by phone" },
    });
    expect(checkRefund(values({ reason_text: "x".repeat(501) }), 24000)).toEqual({ ok: false, errors: { reason_text: "note_length" } });
  });

  it("reports every problem on its own field in the form schema", () => {
    const result = refundFormSchema(1000).safeParse(values({ amount: "20", reason_code: "" }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([
      ["amount", "amount_over"],
      ["reason_code", "reason_required"],
    ]);
  });

  it("starts from the whole refundable amount and says what is left afterwards", () => {
    expect(initialRefundValues(24000)).toEqual({ amount: "240.00", reason_code: "", reason_text: "" });
    expect(refundableAfter(24000, 18000)).toBe(6000);
    expect(refundableAfter(24000, 24000)).toBe(0);
  });

  it("reads what the API says may still be refunded from REFUND_AMOUNT_INVALID", () => {
    const refused = new AdminApiError(422, { code: "REFUND_AMOUNT_INVALID", message: "", details: { refundable_fils: 6000 } });
    expect(refundableFromError(refused)).toBe(6000);
    expect(refundableFromError(new AdminApiError(409, { code: "INVALID_STATE", message: "", details: {} }))).toBeNull();
  });

  it("offers a refund only for a taken payment with a provider reference and money left", () => {
    const p = { status: "captured" as const, refundable_fils: 24000, gateway_payment_ref: "fpay_1" };
    expect(canRefund(p)).toBe(true);
    expect(canRefund({ ...p, status: "partially_refunded" })).toBe(true);
    expect(canRefund({ ...p, status: "authorized" })).toBe(false);
    expect(canRefund({ ...p, refundable_fils: 0 })).toBe(false);
    expect(canRefund({ ...p, gateway_payment_ref: null })).toBe(false);
  });
});
