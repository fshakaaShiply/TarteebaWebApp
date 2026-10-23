import { describe, expect, it } from "vitest";
import { AdminApiError } from "./client";
import { IdempotencyKeys, keepsIdempotencyKey, newIdempotencyKey } from "./idempotency";

const apiError = (status: number, code: string) => new AdminApiError(status, { code, message: "", details: {} });

describe("Idempotency-Key per intent (spec §4.5, §10.5)", () => {
  it("makes UUID v4 keys", () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("reuses the key for the same request until an answer settles it", () => {
    let n = 0;
    const keys = new IdempotencyKeys(() => `key-${++n}`);
    expect(keys.keyFor({ confirm: 7 })).toBe("key-1");
    expect(keys.keyFor({ confirm: 7 })).toBe("key-1");
    // 502 PAYMENT_RESULT_UNKNOWN: the API kept no answer, the retry is the same intent.
    keys.settle(apiError(502, "PAYMENT_RESULT_UNKNOWN"));
    expect(keys.keyFor({ confirm: 7 })).toBe("key-1");
    // A lost answer (network) too.
    keys.settle(AdminApiError.network());
    expect(keys.keyFor({ confirm: 7 })).toBe("key-1");
  });

  it("starts a new intent after an answer the API stored (2xx or 4xx)", () => {
    let n = 0;
    const keys = new IdempotencyKeys(() => `key-${++n}`);
    keys.keyFor({ cancel: 7 });
    keys.settle(apiError(409, "STALE_VERSION"));
    expect(keys.keyFor({ cancel: 7 })).toBe("key-2");
    keys.settle();
    expect(keys.keyFor({ cancel: 7 })).toBe("key-3");
  });

  it("gives a changed request body a new key (the API refuses a reused key with another body)", () => {
    let n = 0;
    const keys = new IdempotencyKeys(() => `key-${++n}`);
    expect(keys.keyFor({ reason_code: "no_capacity" })).toBe("key-1");
    expect(keys.keyFor({ reason_code: "duplicate" })).toBe("key-2");
  });

  it("holdAfterUnknown: after an unknown outcome the key stays with the first body, even when the form changes", () => {
    let n = 0;
    const keys = new IdempotencyKeys(() => `key-${++n}`, { holdAfterUnknown: true });
    expect(keys.keyFor({ phone: "+971501234567", slot: 1 })).toBe("key-1");
    expect(keys.heldBody()).toBeNull();
    // The proxy gave up after 60 s (502) while the API may still have created the booking.
    keys.settle(apiError(502, "BAD_GATEWAY"));
    expect(keys.heldBody()).toEqual({ phone: "+971501234567", slot: 1 });
    // The coordinator edits a field and sends again: same key, so the API refuses a second booking.
    expect(keys.keyFor({ phone: "+971501234567", slot: 2 })).toBe("key-1");
    keys.settle(apiError(422, "IDEMPOTENCY_KEY_REUSED"));
    expect(keys.keyFor({ phone: "+971501234567", slot: 2 })).toBe("key-1");
    // Sending the held body replays the stored answer; after it the next booking is a new intent.
    expect(keys.keyFor(keys.heldBody())).toBe("key-1");
    keys.settle();
    expect(keys.heldBody()).toBeNull();
    expect(keys.keyFor({ phone: "+971501234567", slot: 2 })).toBe("key-2");
  });

  it("without holdAfterUnknown a changed body after an unknown outcome is a new intent (If-Match guards those routes)", () => {
    let n = 0;
    const keys = new IdempotencyKeys(() => `key-${++n}`);
    keys.keyFor({ reschedule: 7, slot: 1 });
    keys.settle(apiError(503, "SERVICE_UNAVAILABLE"));
    expect(keys.keyFor({ reschedule: 7, slot: 2 })).toBe("key-2");
  });

  it("keeps the key after answers the API does not store", () => {
    expect(keepsIdempotencyKey(apiError(429, "RATE_LIMITED"))).toBe(true);
    expect(keepsIdempotencyKey(apiError(409, "IDEMPOTENCY_IN_PROGRESS"))).toBe(true);
    expect(keepsIdempotencyKey(apiError(422, "VALIDATION_FAILED"))).toBe(false);
    expect(keepsIdempotencyKey(new Error("x"))).toBe(false);
  });
});
