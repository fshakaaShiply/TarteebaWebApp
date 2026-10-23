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
 *
 * `holdAfterUnknown` (the manual booking, which has no If-Match to catch a repeat): after an attempt whose outcome is
 * unknown (5xx, lost answer, the /backend proxy's own 502 while PHP may still finish), the key stays with that first
 * body even when the form changes. A repeat then either goes through (the first attempt stored nothing) or answers
 * 422 IDEMPOTENCY_KEY_REUSED (the first attempt was stored, e.g. a booking was created): the key stays held, and
 * sending the held body again replays the stored answer instead of creating a second booking.
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

/**
 * Where a holdAfterUnknown key outlives the page (a reload, leaving and coming back): the attempt being sent, saved
 * before it goes out and removed once the API answered with something it keeps. An attempt found there had no answer
 * the page saw, so it is held.
 */
export type HeldKeyStorage = {
  load(): { key: string; body: string } | null;
  save(attempt: { key: string; body: string } | null): void;
};

export type IdempotencyOptions = { holdAfterUnknown?: boolean; persist?: HeldKeyStorage };

export class IdempotencyKeys {
  /** `held`: an attempt with this key ended without a known outcome (holdAfterUnknown only). */
  private current: { key: string; body: string; held: boolean } | null = null;

  constructor(
    private readonly make: () => string = newIdempotencyKey,
    private readonly options: IdempotencyOptions = {},
  ) {
    const saved = options.holdAfterUnknown ? options.persist?.load() : null;
    if (saved) this.current = { key: saved.key, body: saved.body, held: true };
  }

  /**
   * The key for this request body: unchanged while the body is the same and no answer settled the intent, and (with
   * holdAfterUnknown) unchanged for any body while an earlier attempt's outcome is unknown.
   */
  keyFor(body: unknown): string {
    const canonical = JSON.stringify(body ?? null);
    if (!this.current || (this.current.body !== canonical && !this.current.held)) this.current = { key: this.make(), body: canonical, held: false };
    // keyFor runs as the request goes out: until an answer settles it, a reload must find this attempt.
    if (this.options.holdAfterUnknown) this.options.persist?.save({ key: this.current.key, body: this.current.body });
    return this.current.key;
  }

  /** After an answer: keep the key only when the attempt may be retried as the same intent. */
  settle(error?: unknown): void {
    if (error !== undefined && keepsIdempotencyKey(error)) {
      if (this.options.holdAfterUnknown && this.current) this.current.held = true;
      return;
    }
    // The held key already has a stored answer for its first body: keep it, so a changed form never makes a second one.
    if (this.current?.held && error instanceof AdminApiError && error.code === "IDEMPOTENCY_KEY_REUSED") return;
    this.current = null;
    if (this.options.holdAfterUnknown) this.options.persist?.save(null);
  }

  /** The request body the held key belongs to (sending it again replays the API's stored answer), else null. */
  heldBody<T = unknown>(): T | null {
    return this.current?.held ? (JSON.parse(this.current.body) as T) : null;
  }
}

/** One key store per dialog or form (kept across renders). */
export function useIdempotencyKeys(options: IdempotencyOptions = {}): IdempotencyKeys {
  const [keys] = useState(() => new IdempotencyKeys(newIdempotencyKey, options));
  return keys;
}
