import type { FilterSpec } from "../finance/filters";
import { idOrUndefined } from "../finance/filters";
import type { CaseListQuery, CompensationListQuery, RatingListQuery } from "./endpoints";
import { CASE_CATEGORIES, CASE_PRIORITIES, CASE_STATUSES, CASE_TYPES, COMPENSATION_STATUSES, COMPENSATION_TYPES, SLA_STATES } from "./types";

/*
 * A10 list filters kept in the page URL, like A09 (lib/admin/finance/filters.ts holds the engine): a filtered inbox can
 * be bookmarked and a link from another page (a customer's cases, a cleaner's cases) opens it already filtered. The
 * names are the API's own query parameters. "" is not set; flags are "1"; malformed values in a URL are ignored.
 */

/** "all" asks for every status; "" is the API's default, the active ones. */
export const CASE_STATUS_CHOICES = [...CASE_STATUSES, "all"] as const;
export const CASE_SORTS = ["sla", "created", "priority"] as const;
export const CASE_SLA_FILTERS = ["breached", "due_soon", "paused"] as const satisfies readonly (typeof SLA_STATES)[number][];
export const RATING_KINDS = ["single", "subscription_visit", "live_out_day", "live_out_trial", "recovery"] as const;

export const CASE_FILTERS = {
  q: { kind: "text", max: 100 },
  type: { kind: "enum", values: CASE_TYPES },
  status: { kind: "enum", values: CASE_STATUS_CHOICES },
  priority: { kind: "enum", values: CASE_PRIORITIES },
  category: { kind: "enum", values: CASE_CATEGORIES },
  /** "me", "unassigned" or a staff id (checked by `assigneeParam`). */
  assignee: { kind: "text", max: 12 },
  sla: { kind: "enum", values: CASE_SLA_FILTERS },
  awaiting_approval: { kind: "flag" },
  customer_replied: { kind: "flag" },
  sort: { kind: "enum", values: CASE_SORTS },
  from: { kind: "date" },
  to: { kind: "date" },
  // Links from other pages: a cleaner's cases (A05), a zone, one customer (A07).
  worker_id: { kind: "id" },
  zone_id: { kind: "id" },
  customer_id: { kind: "text", max: 26 },
} as const satisfies FilterSpec;

export const COMPENSATION_STATUS_CHOICES = [...COMPENSATION_STATUSES, "all"] as const;

export const COMPENSATION_FILTERS = {
  /** "" is the API's default: waiting for approval. */
  status: { kind: "enum", values: COMPENSATION_STATUS_CHOICES },
  type: { kind: "enum", values: COMPENSATION_TYPES.filter((t) => t !== "none") },
  customer_id: { kind: "text", max: 26 },
} as const satisfies FilterSpec;

export const RATING_FILTERS = {
  q: { kind: "text", max: 40 },
  low: { kind: "flag" },
  excluded: { kind: "flag" },
  has_comment: { kind: "flag" },
  kind: { kind: "enum", values: RATING_KINDS },
  from: { kind: "date" },
  to: { kind: "date" },
  worker_id: { kind: "id" },
  zone_id: { kind: "id" },
  customer_id: { kind: "text", max: 26 },
} as const satisfies FilterSpec;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/** A customer ULID the API accepts, else undefined (a malformed one in a URL is not sent). */
export function customerParam(value: string): string | undefined {
  return ULID.test(value.trim()) ? value.trim().toUpperCase() : undefined;
}

/** "me", "unassigned" or a staff id; anything else is dropped. */
export function assigneeParam(value: string): string | undefined {
  const v = value.trim();
  return v === "me" || v === "unassigned" || /^[1-9]\d{0,9}$/.test(v) ? v : undefined;
}

/** The statuses to ask for: none (the API's active default), one, or all five. */
export function statusParam(value: string): readonly string[] | undefined {
  if (value === "") return undefined;
  if (value === "all") return CASE_STATUSES;
  return CASE_STATUSES.includes(value as (typeof CASE_STATUSES)[number]) ? [value] : undefined;
}

/** The URL filters as the hook gives them: every filter a string, the page a number. */
type Filters = Readonly<Record<string, string | number>>;
const str = (value: string | number | undefined): string => (value === undefined ? "" : String(value));

/** The inbox's API query from its URL filters; `q` is the debounced search text. */
export function caseQuery(filters: Filters, q: string, perPage: number): CaseListQuery {
  return {
    page: Number(filters.page) || 1,
    perPage,
    q: q || undefined,
    type: str(filters.type) || undefined,
    status: statusParam(str(filters.status)),
    priority: str(filters.priority) || undefined,
    category: str(filters.category) || undefined,
    assignee: assigneeParam(str(filters.assignee)),
    sla: str(filters.sla) || undefined,
    awaitingApproval: str(filters.awaiting_approval) === "1",
    customerReplied: str(filters.customer_replied) === "1",
    sort: str(filters.sort) || undefined,
    from: str(filters.from) || undefined,
    to: str(filters.to) || undefined,
    workerId: idOrUndefined(str(filters.worker_id)),
    zoneId: idOrUndefined(str(filters.zone_id)),
    customerId: customerParam(str(filters.customer_id)),
  };
}

export function compensationQuery(filters: Filters, perPage: number): CompensationListQuery {
  return {
    page: Number(filters.page) || 1,
    perPage,
    // "" is the API's own default (waiting for approval); "all" lists every state, newest first.
    status: str(filters.status) === "all" ? COMPENSATION_STATUSES : str(filters.status) ? [str(filters.status)] : undefined,
    type: str(filters.type) || undefined,
    customerId: customerParam(str(filters.customer_id)),
  };
}

export function ratingQuery(filters: Filters, q: string, perPage: number): RatingListQuery {
  return {
    page: Number(filters.page) || 1,
    perPage,
    q: q || undefined,
    low: str(filters.low) === "1",
    excluded: str(filters.excluded) === "1",
    hasComment: str(filters.has_comment) === "1",
    kind: str(filters.kind) || undefined,
    from: str(filters.from) || undefined,
    to: str(filters.to) || undefined,
    workerId: idOrUndefined(str(filters.worker_id)),
    zoneId: idOrUndefined(str(filters.zone_id)),
    customerId: customerParam(str(filters.customer_id)),
  };
}
