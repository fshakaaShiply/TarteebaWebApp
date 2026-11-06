"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { AdminApiError } from "@/lib/admin/client";
import { overrideRequiredOf } from "@/lib/admin/bookings/actions";
import { moveVisit, validateMove } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { moveInputFor, type DragSource, type DropTarget } from "@/lib/admin/schedule/board";
import type { VisitSummary } from "@/lib/admin/types";
import { useBookingRefresh } from "../bookings/_components/refresh";

/*
 * A04 move (spec §14.3, §17 A04: "on drop → validate-move dry run → show result → save only on success"): the dry run
 * first; a clean answer is saved at once with the visit's version as If-Match; soft rules (another zone, the travel
 * buffer) ask for an override with a reason; anything else is refused and nothing is saved. Another date or slot is a
 * reschedule (422 USE_RESCHEDULE), which the booking's reschedule dialog takes over; a subscription's visit is moved
 * from its subscription (the error names it in details.subscription).
 */

/** The subscription a series visit belongs to (USE_RESCHEDULE details.subscription): A08 moves it (P4-48). */
export type SeriesLink = { id: number; reference: string | null };

export type MoveOutcome =
  | { kind: "saved"; visit: VisitSummary }
  | { kind: "conflicts"; conflicts: { code: string; message: string }[] }
  | { kind: "override"; rules: string[]; canOverride: boolean }
  | { kind: "reschedule"; date: string; slotId: number | null; subscription: SeriesLink | null }
  | { kind: "error"; error: unknown };

const codeOf = (error: unknown) => (error instanceof AdminApiError ? error.code : null);

/** details.subscription of a 422 USE_RESCHEDULE: set when the visit is a subscription's (MoveVisitWorker), else null. */
export function seriesLinkOf(error: unknown): SeriesLink | null {
  if (!(error instanceof AdminApiError) || error.code !== "USE_RESCHEDULE") return null;
  const s = error.details.subscription;
  if (!s || typeof s !== "object") return null;
  const { id, reference } = s as { id?: unknown; reference?: unknown };
  return typeof id === "number" && Number.isInteger(id) ? { id, reference: typeof reference === "string" ? reference : null } : null;
}

function failed(error: unknown, target: DropTarget): MoveOutcome {
  if (codeOf(error) === "USE_RESCHEDULE") return { kind: "reschedule", date: target.date, slotId: target.slotId, subscription: seriesLinkOf(error) };
  const required = overrideRequiredOf(error);
  if (required) return { kind: "override", rules: [...new Set(required.workers.flatMap((w) => w.rules))], canOverride: required.canOverride };
  return { kind: "error", error };
}

/** One attempt: the dry run (skipped when an override is given: the dry run already allowed it), then the move. */
export async function attemptMove(source: DragSource, target: DropTarget, override?: { reason: string }): Promise<MoveOutcome> {
  const input = moveInputFor(source, target);
  if (!override) {
    try {
      const check = await validateMove(input);
      if (check.result === "conflicts") return { kind: "conflicts", conflicts: check.conflicts };
      if (check.result === "override_possible") return { kind: "override", rules: check.rules, canOverride: check.can_override };
    } catch (error) {
      return failed(error, target);
    }
  }
  try {
    const visit = await moveVisit(input, source.card.version, override ? { override: true, reason: override.reason } : {});
    return { kind: "saved", visit };
  } catch (error) {
    return failed(error, target);
  }
}

/** After a move (or a refused one that may have raced): the board, the booking, its candidates and the figures. */
export function useAfterMove() {
  const queryClient = useQueryClient();
  const refresh = useBookingRefresh();
  return useCallback(
    (card: VisitSummary) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.visitCandidates(card.id) });
      void queryClient.invalidateQueries({ queryKey: adminKeys.booking(card.booking.id) });
      refresh();
    },
    [queryClient, refresh],
  );
}

export function isStale(error: unknown): boolean {
  return codeOf(error) === "STALE_VERSION";
}
