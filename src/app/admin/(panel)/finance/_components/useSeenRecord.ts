"use client";

import { useState } from "react";
import { AdminApiError } from "@/lib/admin/client";

/**
 * Answers that mean the record is not what the dialog showed any more: someone (or a provider's answer) changed it
 * meanwhile. The API checks the record's state before its version, so a cleared flag or a refund the provider settled
 * answers with its own code rather than STALE_VERSION (A1a §5.2 outcome, reinstate, review/clear). PAYMENT_VERIFYING is
 * not one: it says to wait for the provider, and the API's words say so.
 */
export const RECORD_MOVED_CODES: readonly string[] = ["STALE_VERSION", "NOT_FLAGGED", "REFUND_NOT_OPEN", "REFUND_NOT_FAILED", "REFUND_OPEN"];

export function recordMoved(error: unknown): boolean {
  return error instanceof AdminApiError && RECORD_MOVED_CODES.includes(error.code);
}

type Phase = "shown" | "waiting" | "renewed";

/**
 * The copy of a record a dialog acts on: the facts on screen and the version it sends as If-Match. `live` is the record
 * as the page holds it now. The copy does not follow it while the person reads and confirms (what is sent is what was
 * shown); after the API said the record moved (`moved()`, see recordMoved) the dialog waits, and the page's next read
 * with another version replaces the copy and marks it `renewed`, so the dialog shows the new facts and asks again. A
 * dialog that kept its first copy would send the refused version on every new confirmation.
 */
export function useSeenRecord<T extends { version?: number | null }>(live: T) {
  const [record, setRecord] = useState(live);
  const [phase, setPhase] = useState<Phase>("shown");
  if (phase === "waiting" && (live.version ?? 0) !== (record.version ?? 0)) {
    setRecord(live);
    setPhase("renewed");
  }
  return {
    record,
    /** The API said the record moved; its new state has not been read yet. */
    waiting: phase === "waiting",
    /** The record was read again after it moved: the facts on screen are new. */
    renewed: phase === "renewed",
    moved: () => setPhase("waiting"),
    /** The person went on with the new facts. */
    seen: () => setPhase("shown"),
  };
}
