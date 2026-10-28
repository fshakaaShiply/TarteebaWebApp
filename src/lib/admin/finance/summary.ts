import { AdminApiError } from "../client";

/*
 * A09 finance summary (GET /admin/finance/summary). The period is two local dates (Asia/Dubai), both included. An end
 * left empty takes the API's default: `to` today, `from` the first day of `to`'s month (month to date), so the page
 * opens on the design's "1–19 October". The API allows at most 366 days and says so in its own words (422
 * VALIDATION_FAILED on `to`, or on `from` when `to` was left out); the page shows that message on the field.
 */

/** "2026-10-19" → "2026-10-01". */
export function firstOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`;
}

/**
 * This browser's guess at the period the API will use for these filters: what the date fields show for an end left to
 * the default until the API's answer says which period it counted (its "today" is Dubai's, on every refetch).
 */
export function summaryPeriod(filters: { from: string; to: string }, today: string): { from: string; to: string } {
  const to = filters.to || today;
  return { from: filters.from || firstOfMonth(to), to };
}

export type SummaryFieldErrors = { from?: string; to?: string; zone_id?: string; other: string[] };

/** The API's own messages of a 422 VALIDATION_FAILED, by field (anything else in `other`). */
export function summaryFieldErrors(error: unknown): SummaryFieldErrors | null {
  if (!(error instanceof AdminApiError) || error.code !== "VALIDATION_FAILED") return null;
  const out: SummaryFieldErrors = { other: [] };
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const message = messages[0];
    if (!message) continue;
    if (field === "from" || field === "to" || field === "zone_id") out[field] = message;
    else out.other.push(message);
  }
  return out;
}
