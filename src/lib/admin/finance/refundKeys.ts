import { IdempotencyKeys, newIdempotencyKey, type HeldKeyStorage } from "../idempotency";

/*
 * The refund Idempotency-Key of one payment page (spec §10.4, §10.5). Refunds have no If-Match, so the key is the only
 * thing that stops a second refund after an attempt whose outcome is unknown (holdAfterUnknown). The attempt being
 * sent is also kept in this tab's sessionStorage, so a reload, or leaving the page and coming back, still offers
 * "Send the earlier refund again" with the same key instead of starting a new refund. It holds a UUID and the refund
 * request (amount, reason code, note): nothing secret, and only for this tab.
 */

const PREFIX = "tarteeba.admin.refundAttempt.";

/** The API keeps idempotency keys for 48 hours (P2-38); an attempt older than a day is not offered again. */
export const REFUND_ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Saved = { key: string; body: string; saved_at: number };

function isSaved(value: unknown): value is Saved {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.key === "string" && v.key !== "" && typeof v.body === "string" && typeof v.saved_at === "number";
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked (privacy settings): the key then lives as long as the page
  }
}

export function refundAttemptStorage(paymentId: number, storage: () => Storage | null = sessionStore, now: () => number = Date.now): HeldKeyStorage {
  const name = `${PREFIX}${paymentId}`;
  return {
    load() {
      try {
        const raw = storage()?.getItem(name);
        if (!raw) return null;
        const saved: unknown = JSON.parse(raw);
        if (isSaved(saved) && now() - saved.saved_at < REFUND_ATTEMPT_MAX_AGE_MS) return { key: saved.key, body: saved.body };
        storage()?.removeItem(name);
      } catch {
        // unreadable: treated as none
      }
      return null;
    },
    save(attempt) {
      try {
        const store = storage();
        if (!store) return;
        if (attempt) store.setItem(name, JSON.stringify({ key: attempt.key, body: attempt.body, saved_at: now() } satisfies Saved));
        else store.removeItem(name);
      } catch {
        // storage full or blocked: the in-memory key still guards this page
      }
    },
  };
}

/** A new key store for this payment's refunds, picking up an attempt this tab left without an answer. */
export function refundKeysFor(paymentId: number, storage?: () => Storage | null): IdempotencyKeys {
  return new IdempotencyKeys(newIdempotencyKey, { holdAfterUnknown: true, persist: refundAttemptStorage(paymentId, storage) });
}
