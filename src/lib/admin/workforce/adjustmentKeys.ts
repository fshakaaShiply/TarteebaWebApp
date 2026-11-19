import { heldAttemptStorage, sessionStore } from "../finance/heldAttempts";
import { IdempotencyKeys, newIdempotencyKey, type HeldKeyStorage } from "../idempotency";
import type { AdjustmentInput } from "./endpoints";

/*
 * The Idempotency-Key of a new incentive adjustment (POST /admin/incentives/adjustments, A5). The route has no If-Match
 * and no unique key of its own, and every open adjustment is ticked in the next post: a second copy of a -500.00 line
 * takes the money back twice. So the key must outlive a changed form and the dialog itself, like the staff balance
 * adjustment (walletKeys.ts): one store for the incentives page, held after an attempt whose outcome is unknown (a lost
 * answer, a 5xx, the proxy's 502 while PHP may still finish: holdAfterUnknown keeps the key with that first body, and a
 * changed reason or amount under it is refused with 422 IDEMPOTENCY_KEY_REUSED if the first one was stored), kept in
 * this tab's sessionStorage so closing the dialog or reloading never sends the same adjustment under a new key.
 */

export const ADJUSTMENT_ATTEMPT_KEY = "tarteeba.admin.incentiveAdjustmentAttempt";

export function adjustmentAttemptStorage(storage: () => Storage | null = sessionStore, now: () => number = Date.now): HeldKeyStorage {
  return heldAttemptStorage(ADJUSTMENT_ATTEMPT_KEY, storage, now);
}

/** The page's key store for new adjustments, picking up an attempt this tab left without an answer. */
export function adjustmentKeys(storage?: () => Storage | null): IdempotencyKeys {
  return new IdempotencyKeys(newIdempotencyKey, { holdAfterUnknown: true, persist: adjustmentAttemptStorage(storage) });
}

/**
 * The adjustment the held key belongs to (sent, no answer seen): sending exactly it again replays the API's stored answer
 * if it was saved, and creates it once if it was not. Null when nothing is held or the saved body is not one.
 */
export function heldAdjustment(keys: IdempotencyKeys): AdjustmentInput | null {
  const body = keys.heldBody<Record<string, unknown>>();
  if (!body || typeof body !== "object") return null;
  const { worker_id, period, amount_fils, reason, corrects_posting_id } = body;
  if (typeof worker_id !== "number" || typeof period !== "string" || typeof amount_fils !== "number" || typeof reason !== "string") return null;
  if (corrects_posting_id !== undefined && typeof corrects_posting_id !== "number") return null;
  // The parsed body itself, in the order it was first sent: the API ties the key to that exact request.
  return body as AdjustmentInput;
}
