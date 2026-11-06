import { isIsoDate } from "../format";
import type { SubscriptionListQuery } from "./endpoints";
import { PAYMENT_HEALTHS, SUBSCRIPTION_STATUSES, type PaymentHealth, type SubscriptionStatus, type SubscriptionType } from "./types";

/*
 * A08 list filters (spec §17) kept in the page URL, so the overview's links (`status=pending_confirmation`,
 * `cancel_review=1&zone_id=`) and a copied link open the same list. The names are the API's own (GET
 * /admin/subscriptions); `status` is a comma list like the API reads it, and a search is `q` there and here.
 */

export const SUBSCRIPTION_TYPES = ["recurring", "live_out"] as const satisfies readonly SubscriptionType[];

export type SubscriptionFilters = {
  type: SubscriptionType | "";
  status: SubscriptionStatus[];
  payment_health: PaymentHealth | "";
  renewal_from: string;
  renewal_to: string;
  /** Zone id ("" = any). */
  zone_id: string;
  /** Worker id ("" = any): the primary or the backup. */
  worker_id: string;
  conflicts: boolean;
  cancel_review: boolean;
  /** Reference, customer name or phone. */
  search: string;
  page: number;
};

export const NO_SUBSCRIPTION_FILTERS: SubscriptionFilters = {
  type: "",
  status: [],
  payment_health: "",
  renewal_from: "",
  renewal_to: "",
  zone_id: "",
  worker_id: "",
  conflicts: false,
  cancel_review: false,
  search: "",
  page: 1,
};

type ParamsLike = { get(name: string): string | null };

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | "" {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

function idParam(value: string | null): string {
  const text = (value ?? "").trim();
  return /^[1-9]\d{0,9}$/.test(text) ? text : "";
}

const flag = (value: string | null) => value === "1" || value === "true";

/** Filters from the page URL; unknown or malformed values are ignored. */
export function filtersFromParams(params: ParamsLike): SubscriptionFilters {
  const date = (name: string) => {
    const value = params.get(name);
    return isIsoDate(value) ? value : "";
  };
  const page = Number(params.get("page"));
  const statuses = (params.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SubscriptionStatus => (SUBSCRIPTION_STATUSES as readonly string[]).includes(s));
  return {
    type: oneOf(params.get("type"), SUBSCRIPTION_TYPES),
    status: [...new Set(statuses)],
    payment_health: oneOf(params.get("payment_health"), PAYMENT_HEALTHS),
    renewal_from: date("renewal_from"),
    renewal_to: date("renewal_to"),
    zone_id: idParam(params.get("zone_id")),
    worker_id: idParam(params.get("worker_id")),
    conflicts: flag(params.get("conflicts")),
    cancel_review: flag(params.get("cancel_review")),
    search: (params.get("q") ?? params.get("search") ?? "").slice(0, 100),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The URL query for these filters (empty ones left out, page 1 implied). */
export function filtersToParams(filters: SubscriptionFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (filters.type) out.set("type", filters.type);
  if (filters.status.length > 0) out.set("status", filters.status.join(","));
  if (filters.payment_health) out.set("payment_health", filters.payment_health);
  if (filters.renewal_from) out.set("renewal_from", filters.renewal_from);
  if (filters.renewal_to) out.set("renewal_to", filters.renewal_to);
  if (filters.zone_id) out.set("zone_id", filters.zone_id);
  if (filters.worker_id) out.set("worker_id", filters.worker_id);
  if (filters.conflicts) out.set("conflicts", "1");
  if (filters.cancel_review) out.set("cancel_review", "1");
  if (filters.search.trim()) out.set("q", filters.search);
  if (filters.page > 1) out.set("page", String(filters.page));
  return out;
}

export function hasFilters(filters: SubscriptionFilters): boolean {
  return filtersToParams({ ...filters, page: 1 }).toString() !== "";
}

/** "to" before "from" is refused by the API (422); the list waits until the range is valid. */
export function renewalRangeValid(filters: Pick<SubscriptionFilters, "renewal_from" | "renewal_to">): boolean {
  return !filters.renewal_from || !filters.renewal_to || filters.renewal_from <= filters.renewal_to;
}

/** One status chip toggled on or off (the chips under the filters). */
export function toggleStatus(filters: SubscriptionFilters, status: SubscriptionStatus): SubscriptionFilters {
  const has = filters.status.includes(status);
  return { ...filters, page: 1, status: has ? filters.status.filter((s) => s !== status) : [...filters.status, status] };
}

const idOrNull = (value: string): number | null => (value ? Number(value) : null);

export function filtersToQuery(filters: SubscriptionFilters, perPage: number): SubscriptionListQuery {
  return {
    page: filters.page,
    perPage,
    type: filters.type || undefined,
    status: filters.status,
    paymentHealth: filters.payment_health || undefined,
    renewalFrom: filters.renewal_from || undefined,
    renewalTo: filters.renewal_to || undefined,
    zoneId: idOrNull(filters.zone_id),
    workerId: idOrNull(filters.worker_id),
    conflicts: filters.conflicts || undefined,
    cancelReview: filters.cancel_review || undefined,
    search: filters.search.trim() || undefined,
  };
}
