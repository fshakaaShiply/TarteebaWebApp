import type { FilterSpec } from "../finance/filters";
import type { CustomerListQuery, PrivacyListQuery } from "./endpoints";
import { CUSTOMER_SORTS, CUSTOMER_STATUSES, PRIVACY_STATUSES, PRIVACY_TYPES } from "./types";

/*
 * A07 list filters kept in the page URL (the A09 engine in lib/admin/finance/filters.ts): a filtered list can be bookmarked
 * and a link from another page opens it already filtered. The names are the API's own query parameters. "" is not set.
 */

export const CUSTOMER_FILTERS = {
  /** Phone, name, e-mail, address, a booking or subscription reference (never `phone`: the API refuses it here). */
  q: { kind: "text", max: 100 },
  status: { kind: "enum", values: CUSTOMER_STATUSES },
  sort: { kind: "enum", values: CUSTOMER_SORTS },
} as const satisfies FilterSpec;

/** "" is the queue's default, the open requests; "all" lists every status. */
export const PRIVACY_STATUS_CHOICES = ["open", ...PRIVACY_STATUSES, "all"] as const;

export const PRIVACY_FILTERS = {
  q: { kind: "text", max: 100 },
  type: { kind: "enum", values: PRIVACY_TYPES },
  status: { kind: "enum", values: PRIVACY_STATUS_CHOICES },
} as const satisfies FilterSpec;

type Filters = Readonly<Record<string, string | number>>;
const str = (value: string | number | undefined): string => (value === undefined ? "" : String(value));

export function customerQuery(filters: Filters, q: string, perPage: number): CustomerListQuery {
  return {
    page: Number(filters.page) || 1,
    perPage,
    q: q || undefined,
    status: str(filters.status) || undefined,
    sort: str(filters.sort) || undefined,
  };
}

export function privacyQuery(filters: Filters, q: string, perPage: number): PrivacyListQuery {
  const status = str(filters.status);
  return {
    page: Number(filters.page) || 1,
    perPage,
    q: q || undefined,
    type: str(filters.type) || undefined,
    // The queue opens on what still needs someone; "all" asks for no status at all.
    status: status === "all" ? undefined : status || "open",
  };
}
