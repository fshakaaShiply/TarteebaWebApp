import type { HeldKeyStorage } from "../idempotency";

/*
 * Where a money request's Idempotency-Key outlives the dialog that sent it (holdAfterUnknown): the attempt being sent is
 * kept in this tab's sessionStorage under a name of the caller's choice, so a reload, or closing the dialog and opening
 * it again, still finds the key and the request it belongs to. It holds a UUID and the request body (amounts, reason
 * codes, staff notes): nothing secret, and only for this tab.
 */

/** The API keeps idempotency keys for 48 hours (P2-38); an attempt older than a day is not offered again. */
export const HELD_ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type Saved = { key: string; body: string; saved_at: number };

function isSaved(value: unknown): value is Saved {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.key === "string" && v.key !== "" && typeof v.body === "string" && typeof v.saved_at === "number";
}

export function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked (privacy settings): the key then lives as long as the page
  }
}

export function heldAttemptStorage(name: string, storage: () => Storage | null = sessionStore, now: () => number = Date.now): HeldKeyStorage {
  return {
    load() {
      try {
        const raw = storage()?.getItem(name);
        if (!raw) return null;
        const saved: unknown = JSON.parse(raw);
        if (isSaved(saved) && now() - saved.saved_at < HELD_ATTEMPT_MAX_AGE_MS) return { key: saved.key, body: saved.body };
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
