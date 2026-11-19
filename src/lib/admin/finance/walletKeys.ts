import { IdempotencyKeys, newIdempotencyKey, type HeldKeyStorage } from "../idempotency";
import { heldAttemptStorage, sessionStore } from "./heldAttempts";
import type { WalletType } from "./wallet";

/*
 * The Idempotency-Key of a staff balance adjustment (POST /admin/customers/{ulid}/wallet/transactions, A1b §2.1
 * AdjustWallet). The route has no If-Match and no expected balance: the API replays a movement only for the same key
 * (`staff:{key}` on the customer's wallet) and books a new one for any other. So the key must outlive the dialog: one
 * store per customer and movement type, owned by the balance panel, held after an attempt whose outcome is unknown
 * (holdAfterUnknown: a changed amount or note keeps the key, and the API refuses it with 422 IDEMPOTENCY_KEY_REUSED if
 * the first one was booked) and kept in this tab's sessionStorage. Closing "Add credit" after a lost answer and opening
 * it again, leaving the profile or reloading never sends the same credit or correction under a new key.
 */

const PREFIX = "tarteeba.admin.walletAttempt.";

export function walletAttemptStorage(customerUlid: string, type: WalletType, storage: () => Storage | null = sessionStore, now: () => number = Date.now): HeldKeyStorage {
  return heldAttemptStorage(`${PREFIX}${customerUlid}.${type}`, storage, now);
}

/** A new key store for this customer's credits or corrections, picking up an attempt this tab left without an answer. */
export function walletKeysFor(customerUlid: string, type: WalletType, storage?: () => Storage | null): IdempotencyKeys {
  return new IdempotencyKeys(newIdempotencyKey, { holdAfterUnknown: true, persist: walletAttemptStorage(customerUlid, type, storage) });
}
