import { PAYMENT_STATUSES } from "../bookings/filters";
import { isIsoDate } from "../format";
import { REFUND_STATUSES } from "./refund";

/*
 * A09 list filters kept in the page URL (like A03), so a filtered list can be bookmarked and a link from another page
 * (a booking's payment, an invoice's payment) opens the list already filtered. The names are the API's own query
 * parameters. Every filter is a string here ("" = not set; flags are "1"); unknown or malformed values in a URL are
 * ignored rather than sent to the API (which would answer 422).
 */

export type FilterField =
  | { kind: "enum"; values: readonly string[] }
  | { kind: "date" }
  | { kind: "text"; max: number }
  /** A checkbox: "1" or "". */
  | { kind: "flag" }
  /** A positive record id. */
  | { kind: "id" }
  /**
   * A code from a list the API serves at run time (e.g. refund reasons): any value shaped like one of its codes
   * (AdminRefundsRequest `reason_code`: a-z, digits and "_", 2 to 40 characters).
   */
  | { kind: "code" };

const CODE = /^[a-z][a-z0-9_]{1,39}$/;

export type FilterSpec = Readonly<Record<string, FilterField>>;

export type ListFilters<S extends FilterSpec> = { [K in keyof S]: string } & { page: number };

type ParamsLike = { get(name: string): string | null };

function readField(field: FilterField, raw: string | null): string {
  if (raw === null) return "";
  switch (field.kind) {
    case "enum":
      return field.values.includes(raw) ? raw : "";
    case "date":
      return isIsoDate(raw) ? raw : "";
    case "text":
      return raw.slice(0, field.max);
    case "flag":
      return raw === "1" || raw === "true" ? "1" : "";
    case "id":
      return /^[1-9]\d{0,9}$/.test(raw) ? raw : "";
    case "code":
      return CODE.test(raw) ? raw : "";
  }
}

export function emptyFilters<S extends FilterSpec>(spec: S): ListFilters<S> {
  const out: Record<string, string | number> = { page: 1 };
  for (const key of Object.keys(spec)) out[key] = "";
  return out as ListFilters<S>;
}

/** Filters from the page URL. */
export function filtersFromParams<S extends FilterSpec>(spec: S, params: ParamsLike): ListFilters<S> {
  const out: Record<string, string | number> = {};
  for (const [key, field] of Object.entries(spec)) out[key] = readField(field, params.get(key));
  const page = Number(params.get("page"));
  out.page = Number.isInteger(page) && page > 1 ? page : 1;
  return out as ListFilters<S>;
}

/** The URL query for these filters (empty ones left out, page 1 implied). Text is kept as typed; the API query trims it. */
export function filtersToParams<S extends FilterSpec>(spec: S, filters: ListFilters<S>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, field] of Object.entries(spec)) {
    const value = (filters as Record<string, string>)[key] ?? "";
    if (field.kind === "text" ? value.trim() !== "" : value !== "") out.set(key, value);
  }
  if (filters.page > 1) out.set("page", String(filters.page));
  return out;
}

/** True when any filter (other than the page) is set. */
export function hasFilters<S extends FilterSpec>(spec: S, filters: ListFilters<S>): boolean {
  return filtersToParams(spec, { ...filters, page: 1 }).toString() !== "";
}

/** "to" before "from" is refused by the API (422): the list waits until the range is valid. */
export function dateRangeValid(filters: { from?: string; to?: string }): boolean {
  return !filters.from || !filters.to || filters.from <= filters.to;
}

/**
 * A phone search the API accepts: digits and phone punctuation, at least 4 digits (fewer matches nothing). Anything
 * else is not sent, and the page says why.
 */
export function phoneSearchValid(value: string): boolean {
  const text = value.trim();
  if (text === "") return true;
  return /^[\d\s+\-().]{1,30}$/.test(text) && text.replace(/\D/g, "").replace(/^0+/, "").length >= 4;
}

export const PAYABLE_TYPES = ["booking", "subscription_period", "wallet_topup"] as const;

export const INVOICE_STATUSES = ["issued", "credited_partial", "credited_full"] as const;

export const BILLING_DOCUMENTS = ["invoice", "credit_note"] as const;

export const PAYMENT_FILTERS = {
  status: { kind: "enum", values: PAYMENT_STATUSES },
  from: { kind: "date" },
  to: { kind: "date" },
  phone: { kind: "text", max: 30 },
  payable_type: { kind: "enum", values: PAYABLE_TYPES },
  needs_review: { kind: "flag" },
  reference: { kind: "text", max: 120 },
} as const satisfies FilterSpec;

export const REFUND_FILTERS = {
  status: { kind: "enum", values: REFUND_STATUSES },
  from: { kind: "date" },
  to: { kind: "date" },
  // The reasons come from GET /admin/refund-reasons.
  reason_code: { kind: "code" },
  needs_review: { kind: "flag" },
  phone: { kind: "text", max: 30 },
  payment_id: { kind: "id" },
} as const satisfies FilterSpec;

export const INVOICE_FILTERS = {
  status: { kind: "enum", values: INVOICE_STATUSES },
  from: { kind: "date" },
  to: { kind: "date" },
  search: { kind: "text", max: 100 },
  /** One payment's invoices (the payment page links here). */
  payment_id: { kind: "id" },
} as const satisfies FilterSpec;

/** The A09 summary's period; empty ends take the API's default (month to date). */
export const SUMMARY_FILTERS = {
  from: { kind: "date" },
  to: { kind: "date" },
} as const satisfies FilterSpec;

export const CREDIT_NOTE_FILTERS = {
  from: { kind: "date" },
  to: { kind: "date" },
  search: { kind: "text", max: 100 },
  invoice_id: { kind: "id" },
} as const satisfies FilterSpec;

export const REFUSAL_FILTERS = {
  document: { kind: "enum", values: BILLING_DOCUMENTS },
  payment_id: { kind: "id" },
} as const satisfies FilterSpec;

/** `"12"` → 12, `""` → undefined (for the API query). */
export function idOrUndefined(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

/** The query-key part of a list: every filter but the free-text ones (debounced separately), and the page. */
export function filterKey<S extends FilterSpec>(spec: S, filters: ListFilters<S>, debounced: Record<string, string>): Record<string, string | number> {
  const out: Record<string, string | number> = { page: filters.page };
  for (const [key, field] of Object.entries(spec)) out[key] = field.kind === "text" ? (debounced[key] ?? "") : (filters as Record<string, string>)[key];
  return out;
}
