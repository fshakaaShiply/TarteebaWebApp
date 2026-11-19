import { describe, expect, it } from "vitest";
import { AdminApiError } from "../client";
import { walletAttemptStorage, walletKeysFor } from "./walletKeys";

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

const credit = { customer: "01C2", type: "credit", amount_fils: 15000, reason_code: "goodwill", note: "Late arrival on 14 Nov" };

describe("balance adjustment Idempotency-Key kept beyond the dialog (A1b §2.1 AdjustWallet)", () => {
  it("gives a store made again (the dialog opened again, the page reloaded) the key of an attempt with no answer", () => {
    const store = memoryStorage();
    const first = walletKeysFor("01C2", "credit", () => store);
    const key = first.keyFor(credit);
    first.settle(new AdminApiError(502, { code: "BAD_GATEWAY", message: "", details: {} }));
    const again = walletKeysFor("01C2", "credit", () => store);
    expect(again.heldBody()).toEqual(credit);
    // The same credit typed again, or another amount: the held key either way (the API refuses another body if the
    // first was booked).
    expect(again.keyFor(credit)).toBe(key);
    expect(again.keyFor({ ...credit, amount_fils: 20000 })).toBe(key);
  });

  it("forgets the attempt once the API answered with something it keeps", () => {
    const store = memoryStorage();
    const keys = walletKeysFor("01C2", "credit", () => store);
    const key = keys.keyFor(credit);
    keys.settle(AdminApiError.network());
    keys.settle();
    const next = walletKeysFor("01C2", "credit", () => store);
    expect(next.heldBody()).toBeNull();
    expect(next.keyFor(credit)).not.toBe(key);
  });

  it("keeps each customer's credits and corrections apart", () => {
    const store = memoryStorage();
    walletKeysFor("01C2", "credit", () => store).keyFor(credit);
    expect(walletKeysFor("01C2", "debit", () => store).heldBody()).toBeNull();
    expect(walletKeysFor("01C3", "credit", () => store).heldBody()).toBeNull();
    expect(walletKeysFor("01C2", "credit", () => store).heldBody()).toEqual(credit);
  });

  it("stores the attempt under the customer and type, and drops one older than a day", () => {
    const store = memoryStorage();
    let now = 1_000_000;
    walletAttemptStorage("01C2", "credit", () => store, () => now).save({ key: "k-1", body: JSON.stringify(credit) });
    expect(store.getItem("tarteeba.admin.walletAttempt.01C2.credit")).toContain("k-1");
    now += 24 * 60 * 60 * 1000 + 1;
    expect(walletAttemptStorage("01C2", "credit", () => store, () => now).load()).toBeNull();
    expect(store.length).toBe(0);
  });
});
