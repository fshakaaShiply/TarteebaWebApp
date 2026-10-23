import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import { REFUND_ATTEMPT_MAX_AGE_MS, refundAttemptStorage, refundKeysFor } from "./refundKeys";

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

const body = { payment: 9, amount_fils: 18000, reason_code: "goodwill", reason_text: null };

describe("refund Idempotency-Key kept for the tab (spec §10.4, §10.5)", () => {
  it("finds an attempt that never got an answer after a reload, with the same key and request", () => {
    const store = memoryStorage();
    const page = refundKeysFor(9, () => store);
    const key = page.keyFor(body);
    // The tab reloads while the refund is on its way (or after the answer was lost).
    const reloaded = refundKeysFor(9, () => store);
    expect(reloaded.heldBody()).toEqual(body);
    expect(reloaded.keyFor({ ...body, amount_fils: 5000 })).toBe(key);
    expect(reloaded.keyFor(reloaded.heldBody())).toBe(key);
  });

  it("forgets the attempt once the API answered with something it keeps", () => {
    const store = memoryStorage();
    const page = refundKeysFor(9, () => store);
    page.keyFor(body);
    page.settle(AdminApiError.network());
    expect(refundKeysFor(9, () => store).heldBody()).toEqual(body);
    // The refund went through on "Send again".
    page.keyFor(page.heldBody());
    page.settle();
    expect(refundKeysFor(9, () => store).heldBody()).toBeNull();
  });

  it("keeps the held attempt when the API says the key was used for another request", () => {
    const store = memoryStorage();
    const page = refundKeysFor(9, () => store);
    page.keyFor(body);
    page.settle(new AdminApiError(502, { code: "BAD_GATEWAY", message: "", details: {} }));
    page.keyFor({ ...body, amount_fils: 100 });
    page.settle(new AdminApiError(422, { code: "IDEMPOTENCY_KEY_REUSED", message: "", details: {} }));
    expect(refundKeysFor(9, () => store).heldBody()).toEqual(body);
  });

  it("keeps each payment's attempt apart", () => {
    const store = memoryStorage();
    refundKeysFor(9, () => store).keyFor(body);
    expect(refundKeysFor(10, () => store).heldBody()).toBeNull();
  });

  it("drops an attempt older than a day, and unreadable entries", () => {
    const store = memoryStorage();
    let now = 1_000_000;
    refundAttemptStorage(9, () => store, () => now).save({ key: "k-1", body: JSON.stringify(body) });
    now += REFUND_ATTEMPT_MAX_AGE_MS + 1;
    expect(refundAttemptStorage(9, () => store, () => now).load()).toBeNull();
    expect(store.length).toBe(0);

    store.setItem("tarteeba.admin.refundAttempt.9", "{not json");
    expect(refundAttemptStorage(9, () => store).load()).toBeNull();
    store.setItem("tarteeba.admin.refundAttempt.9", JSON.stringify({ key: 5, body: "{}" }));
    expect(refundAttemptStorage(9, () => store).load()).toBeNull();
  });

  it("still guards the page when storage is blocked", () => {
    const blocked = () => {
      throw new Error("SecurityError");
    };
    const page = refundKeysFor(9, blocked);
    const key = page.keyFor(body);
    page.settle(AdminApiError.network());
    expect(page.keyFor({ ...body, amount_fils: 1 })).toBe(key);
    expect(page.heldBody()).toEqual(body);
  });
});
