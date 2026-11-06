/*
 * The short summary of a history row (GET …/events): its payload's plain facts as label / value pairs, so a row says what
 * happened without a raw JSON dump. Only scalars and short lists of scalars are shown, in the payload's own order; money
 * keys (`*_fils`) are marked so the screen formats them as AED, date keys (`*_date`, `from`, `to`, `date`, …) as dates.
 * What the API's `type_label` names is the headline; this is the detail line.
 */

export type PayloadFact = { key: string; kind: "money" | "date" | "text" | "list"; value: string | number | string[] };

const HIDDEN = new Set(["id", "ulid", "payment_id", "occurrence_id", "visit_id", "booking_id", "request_id", "price_ids", "policy_versions", "hold_id"]);
const MAX_FACTS = 7;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isScalar = (v: unknown): v is string | number => typeof v === "string" || typeof v === "number";

export function payloadFacts(payload: Record<string, unknown> | null | undefined): PayloadFact[] {
  const out: PayloadFact[] = [];
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (out.length >= MAX_FACTS) break;
    if (HIDDEN.has(key) || value === null || value === undefined || value === "") continue;
    if (typeof value === "boolean") {
      out.push({ key, kind: "text", value: value ? "yes" : "no" });
    } else if (typeof value === "number" && key.endsWith("_fils")) {
      out.push({ key, kind: "money", value });
    } else if (isScalar(value)) {
      out.push({ key, kind: typeof value === "string" && DATE_RE.test(value) ? "date" : "text", value });
    } else if (Array.isArray(value) && value.length > 0 && value.every(isScalar)) {
      out.push({ key, kind: "list", value: value.slice(0, 6).map(String) });
    } else if (Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === "object" && isScalar((v as { date?: unknown }).date))) {
      out.push({ key, kind: "list", value: value.slice(0, 6).map((v) => String((v as { date: string }).date)) });
    }
  }
  return out;
}
