import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import { ADJUSTMENT_ATTEMPT_KEY, adjustmentKeys, heldAdjustment } from "./adjustmentKeys";

/** A tab's sessionStorage. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

const minus500 = { worker_id: 3, period: "2026-09", amount_fils: -50000, reason: "Overpaid in Agust" };
const lost = () => AdminApiError.network();

describe("incentive adjustment Idempotency-Key (no If-Match: the key is the only guard against a second line)", () => {
  it("keeps the key of an attempt with no answer when the form changes, so a fixed typo is never a second adjustment", () => {
    const keys = adjustmentKeys(() => memoryStorage());
    const key = keys.keyFor(minus500);
    keys.settle(lost());
    // HR fixes the typo in the reason and saves again: the same key, which the API refuses (422 IDEMPOTENCY_KEY_REUSED)
    // if the first one was stored.
    expect(keys.keyFor({ ...minus500, reason: "Overpaid in August" })).toBe(key);
    keys.settle(new AdminApiError(422, { code: "IDEMPOTENCY_KEY_REUSED", message: "", details: {} }));
    expect(heldAdjustment(keys)).toEqual(minus500);
    expect(keys.keyFor(minus500)).toBe(key);
  });

  it("holds after a 5xx and the proxy's 502 too, and lets go once the API answered with something it keeps", () => {
    const keys = adjustmentKeys(() => memoryStorage());
    const key = keys.keyFor(minus500);
    keys.settle(new AdminApiError(502, { code: "BAD_GATEWAY", message: "", details: {} }));
    expect(keys.keyFor({ ...minus500, amount_fils: -40000 })).toBe(key);
    keys.settle();
    expect(heldAdjustment(keys)).toBeNull();
    expect(keys.keyFor(minus500)).not.toBe(key);
  });

  it("outlives the dialog and a reload: a store made again finds the held attempt in this tab", () => {
    const store = memoryStorage();
    const first = adjustmentKeys(() => store);
    const key = first.keyFor(minus500);
    first.settle(lost());
    expect(store.getItem(ADJUSTMENT_ATTEMPT_KEY)).not.toBeNull();
    const again = adjustmentKeys(() => store);
    expect(heldAdjustment(again)).toEqual(minus500);
    expect(again.keyFor({ ...minus500, worker_id: 4 })).toBe(key);
  });

  it("reads a held body only when it is an adjustment, in the order it was first sent", () => {
    const store = memoryStorage();
    store.setItem(ADJUSTMENT_ATTEMPT_KEY, JSON.stringify({ key: "k", body: JSON.stringify({ worker_id: "3" }), saved_at: Date.now() }));
    expect(heldAdjustment(adjustmentKeys(() => store))).toBeNull();
    const withPosting = { ...minus500, corrects_posting_id: 2 };
    store.setItem(ADJUSTMENT_ATTEMPT_KEY, JSON.stringify({ key: "k", body: JSON.stringify(withPosting), saved_at: Date.now() }));
    expect(Object.keys(heldAdjustment(adjustmentKeys(() => store))!)).toEqual(["worker_id", "period", "amount_fils", "reason", "corrects_posting_id"]);
  });
});
