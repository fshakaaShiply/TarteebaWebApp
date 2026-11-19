import type { CaseSla } from "./types";

/*
 * The SLA chip of A10 (spec §17 A10, quality §3.3). The API decides the state (on track, due soon, breached, paused,
 * met, none) and which deadline counts; the chip only words the distance to `due_at` as the page's clock ticks, so a
 * list left open keeps counting down between two background reads. A case past its deadline reads "2 h overdue" in the
 * danger tone, a case waiting for the customer "paused", and one with no open deadline "—".
 */

export type SlaUnit = "minutes" | "hours" | "days";

export type SlaChipModel =
  | { kind: "none" }
  | { kind: "paused" }
  | { kind: "left"; unit: SlaUnit; value: number; due: boolean }
  /** `unit` is null for a marked breach whose deadline moved ahead again (priority change): "overdue" without a time. */
  | { kind: "overdue"; unit: SlaUnit | null; value: number };

/**
 * A distance in minutes (negative once past, fractions allowed) as a short count: under an hour in minutes (a time still
 * ahead rounds up, one past rounds down, so a case is never "0 min" and never "overdue" before it is), under two days in
 * hours, longer in days, the larger units to the nearest one; at least 1 of the unit.
 */
export function slaDistance(minutes: number): { unit: SlaUnit; value: number } {
  const abs = Math.abs(minutes);
  if (abs < 60) return { unit: "minutes", value: Math.max(1, minutes < 0 ? Math.floor(abs) : Math.ceil(abs)) };
  if (abs < 48 * 60) return { unit: "hours", value: Math.max(1, Math.round(abs / 60)) };
  return { unit: "days", value: Math.max(1, Math.round(abs / (24 * 60))) };
}

/** Minutes (fractions kept) from `now` to the deadline, negative once past: from the instant when there is one, else the API's figure. */
export function minutesLeft(sla: Pick<CaseSla, "due_at" | "remaining_minutes">, now: number): number | null {
  if (sla.due_at) {
    const due = Date.parse(sla.due_at);
    if (Number.isFinite(due)) return (due - now) / 60_000;
  }
  return sla.remaining_minutes;
}

export function slaChip(sla: CaseSla, now: number): SlaChipModel {
  if (sla.state === "paused") return { kind: "paused" };
  if (sla.state === "none" || sla.state === "met") return { kind: "none" };
  const minutes = minutesLeft(sla, now);
  if (sla.state === "breached") {
    if (minutes === null || minutes >= 0) return { kind: "overdue", unit: null, value: 0 };
    return { kind: "overdue", ...slaDistance(minutes) };
  }
  if (minutes === null) return { kind: "none" };
  // The tick may have passed the deadline before the next read said "breached": already overdue.
  if (minutes < 0) return { kind: "overdue", ...slaDistance(minutes) };
  return { kind: "left", ...slaDistance(minutes), due: sla.state === "due_soon" };
}

/** Which deadline the chip counts, for its tooltip: the first reply or the resolution. */
export function slaKindOf(sla: CaseSla): "first_response" | "resolution" | null {
  return sla.state === "none" || sla.state === "met" ? null : sla.kind;
}
