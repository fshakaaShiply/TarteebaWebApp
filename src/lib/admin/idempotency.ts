"use client";

import { useState } from "react";
import { AdminApiError } from "./client";

/*
 * Idempotency-Key for the routes that may move money or capacity (spec §4.5, §10.5): confirm, reject, reschedule,
 * cancel, approving a reschedule request and the manual booking.
 *
 * The API (Payment EnforceIdempotency) stores 2xx and 4xx answers under the key and replays them for the same request;
 * 5xx, 408, 425 and 429 answers (and lost answers) are not stored, so the same intent is sent again with the same key.
 * The key is also tied to the request body: the same key with another body is 422 IDEMPOTENCY_KEY_REUSED. So:
 *   - one UUID per intent (one request body), reused while the attempt may be retried;
 *   - a changed body (another reason, another slot) is a new intent with a new key;
 *   - after an answer the API kept (success or a 4xx such as STALE_VERSION), the next attempt is a new intent.
 */

/** A random UUID v4 (crypto.randomUUID needs a secure context; getRandomValues does not). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const NOT_STORED = new Set([408, 425, 429]);

/** True when a failed attempt may be sent again as the same intent (the API did not keep an answer for its key). */
export function keepsIdempotencyKey(error: unknown): boolean {
  if (!(error instanceof AdminApiError)) return false;
  if (error.code === "IDEMPOTENCY_IN_PROGRESS") return true;
  return error.status === 0 || error.status >= 500 || NOT_STORED.has(error.status);
}

export class IdempotencyKeys {
  private current: { key: string; body: string } | null = null;

  constructor(private readonly make: () => string = newIdempotencyKey) {}

  /** The key for this request body: unchanged while the body is the same and no answer settled the intent. */
  keyFor(body: unknown): string {
    const canonical = JSON.stringify(body ?? null);
    if (!this.current || this.current.body !== canonical) this.current = { key: this.make(), body: canonical };
    return this.current.key;
  }

  /** After an answer: keep the key only when the attempt may be retried as the same intent. */
  settle(error?: unknown): void {
    if (error === undefined || !keepsIdempotencyKey(error)) this.current = null;
  }
}

/** One key store per dialog or form (kept across renders). */
export function useIdempotencyKeys(): IdempotencyKeys {
  const [keys] = useState(() => new IdempotencyKeys());
  return keys;
}
