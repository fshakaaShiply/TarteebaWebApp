import type { BookingListQuery } from "../endpoints";
import { isIsoDate } from "../format";
import type { BookingSource, BookingStatus, PaymentStatus } from "../types";

/*
 * A03 list filters (spec §14.3, §17) kept in the page URL, so a KPI card or alert of the overview opens the list with
 * its filters applied and a filtered list can be bookmarked. The names are the API's own (GET /admin/bookings), so a
 * dashboard link's params map one to one. The zone is the shared top-bar zone filter (lib/admin/zone.tsx): a
 * `zone_id` in the URL is adopted into it on arrival.
 *
 * The API lists by status, payment status, service date range, zone, service, source, slot, the worker named on a
 * visit now, the driver of a live round stop, cancellations waiting for review, and a search by reference, phone,
 * customer name or booked address.
 */

export const BOOKING_STATUSES = [
  "held",
  "pending_confirmation",
  "alternative_proposed",
  "confirmed",
  "rescheduled",
  "completed",
  "rejected",
  "cancelled",
  "expired",
] as const satisfies readonly BookingStatus[];

export const PAYMENT_STATUSES = [
  "unpaid",
  "pending",
  "verifying",
  "authorized",
  "captured",
  "partially_refunded",
  "refunded",
  "failed",
  "voided",
] as const satisfies readonly PaymentStatus[];

export const BOOKING_SOURCES = ["app", "web", "phone", "whatsapp", "admin"] as const satisfies readonly BookingSource[];

export type BookingFilters = {
  status: BookingStatus | "";
  payment_status: PaymentStatus | "";
  from: string;
  to: string;
  /** Service code or numeric id. */
  service: string;
  source: BookingSource | "";
  /** Slot template id ("" = any). */
  slot_template_id: string;
  /** Worker id ("" = any): named on one of the booking's visits now. */
  worker_id: string;
  /** Driver profile id ("" = any): drives a live drop-off or pickup stop of one of the booking's visits. */
  driver_id: string;
  /** Reference, phone, customer name or booked address. */
  search: string;
  /** Cancellations waiting for staff review. */
  cancel_review: boolean;
  page: number;
};

export const NO_BOOKING_FILTERS: BookingFilters = {
  status: "",
  payment_status: "",
  from: "",
  to: "",
  service: "",
  source: "",
  slot_template_id: "",
  worker_id: "",
  driver_id: "",
  search: "",
  cancel_review: false,
  page: 1,
};

type ParamsLike = { get(name: string): string | null };

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | "" {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

/** A positive integer id as the URL writes it ("" otherwise; the API refuses 0 and non-integers with 422). */
function idParam(value: string | null): string {
  const text = (value ?? "").trim();
  return /^[1-9]\d{0,9}$/.test(text) ? text : "";
}

/** Filters from the page URL; unknown or malformed values are ignored. */
export function filtersFromParams(params: ParamsLike): BookingFilters {
  const date = (name: string) => {
    const value = params.get(name);
    return isIsoDate(value) ? value : "";
  };
  const page = Number(params.get("page"));
  const service = (params.get("service") ?? "").trim();
  return {
    status: oneOf(params.get("status"), BOOKING_STATUSES),
    payment_status: oneOf(params.get("payment_status"), PAYMENT_STATUSES),
    from: date("from"),
    to: date("to"),
    service: /^[A-Za-z0-9_]{1,40}$/.test(service) ? service : "",
    source: oneOf(params.get("source"), BOOKING_SOURCES),
    slot_template_id: idParam(params.get("slot_template_id")),
    worker_id: idParam(params.get("worker_id")),
    driver_id: idParam(params.get("driver_id")),
    search: (params.get("search") ?? "").slice(0, 100),
    cancel_review: params.get("cancel_review") === "1" || params.get("cancel_review") === "true",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The URL query for these filters (empty ones left out, page 1 implied). */
export function filtersToParams(filters: BookingFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (filters.status) out.set("status", filters.status);
  if (filters.payment_status) out.set("payment_status", filters.payment_status);
  if (filters.from) out.set("from", filters.from);
  if (filters.to) out.set("to", filters.to);
  if (filters.service) out.set("service", filters.service);
  if (filters.source) out.set("source", filters.source);
  if (filters.slot_template_id) out.set("slot_template_id", filters.slot_template_id);
  if (filters.worker_id) out.set("worker_id", filters.worker_id);
  if (filters.driver_id) out.set("driver_id", filters.driver_id);
  // As typed (a trailing space is kept while typing "055 987"); the API query trims it.
  if (filters.search.trim()) out.set("search", filters.search);
  if (filters.cancel_review) out.set("cancel_review", "1");
  if (filters.page > 1) out.set("page", String(filters.page));
  return out;
}

/** True when any filter (other than the page) is set. */
export function hasFilters(filters: BookingFilters): boolean {
  return filtersToParams({ ...filters, page: 1 }).toString() !== "";
}

/** "to" before "from" is refused by the API (422); the list waits until the range is valid. */
export function dateRangeValid(filters: Pick<BookingFilters, "from" | "to">): boolean {
  return !filters.from || !filters.to || filters.from <= filters.to;
}

const idOrNull = (value: string): number | null => (value ? Number(value) : null);

/** The API query for the list. */
export function filtersToQuery(filters: BookingFilters, zoneId: number | null, perPage: number): BookingListQuery {
  return {
    page: filters.page,
    perPage,
    status: filters.status,
    paymentStatus: filters.payment_status,
    from: filters.from || undefined,
    to: filters.to || undefined,
    zoneId,
    service: filters.service || undefined,
    source: filters.source,
    search: filters.search.trim() || undefined,
    cancelReview: filters.cancel_review || undefined,
    slotTemplateId: idOrNull(filters.slot_template_id),
    workerId: idOrNull(filters.worker_id),
    driverId: idOrNull(filters.driver_id),
  };
}
