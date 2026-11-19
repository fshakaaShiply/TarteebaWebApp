import { IdempotencyKeys, newIdempotencyKey, type HeldKeyStorage } from "../idempotency";
import { HELD_ATTEMPT_MAX_AGE_MS, heldAttemptStorage, sessionStore } from "./heldAttempts";

/*
 * The refund Idempotency-Key of one payment page (spec §10.4, §10.5). Refunds have no If-Match, so the key is the only
 * thing that stops a second refund after an attempt whose outcome is unknown (holdAfterUnknown). The attempt being
 * sent is also kept in this tab's sessionStorage (heldAttempts.ts), so a reload, or leaving the page and coming back,
 * still offers "Send the earlier refund again" with the same key instead of starting a new refund. It holds a UUID and
 * the refund request (amount, reason code, note): nothing secret, and only for this tab.
 */

const PREFIX = "tarteeba.admin.refundAttempt.";

/** The API keeps idempotency keys for 48 hours (P2-38); an attempt older than a day is not offered again. */
export const REFUND_ATTEMPT_MAX_AGE_MS = HELD_ATTEMPT_MAX_AGE_MS;

export function refundAttemptStorage(paymentId: number, storage: () => Storage | null = sessionStore, now: () => number = Date.now): HeldKeyStorage {
  return heldAttemptStorage(`${PREFIX}${paymentId}`, storage, now);
}

/** A new key store for this payment's refunds, picking up an attempt this tab left without an answer. */
export function refundKeysFor(paymentId: number, storage?: () => Storage | null): IdempotencyKeys {
  return new IdempotencyKeys(newIdempotencyKey, { holdAfterUnknown: true, persist: refundAttemptStorage(paymentId, storage) });
}
