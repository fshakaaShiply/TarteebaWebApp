import type { StatusTone } from "@/components/admin";
import type { FilterSpec } from "../finance/filters";
import type { NotifyBlockedReason, WaitlistEntry, WaitlistStatus } from "./types";

/*
 * A04 waitlist (waitlist §7.1, contract A6 §5.2): the page's URL filters, the status choices and what one row says and
 * offers. The API decides everything (`actions.notify`, `notify_blocked_reason`, `offer.state`); the page only words it.
 * "Notify again" over a live offer asks first and sends `force: true` (P5-L32); nothing else ever sends it.
 */

/** The shortcut chips and the status select; "" and "open" are the API's default (waiting and offered). */
export const WAITLIST_STATUS_CHOICES = ["open", "waiting", "notified", "converted", "expired", "cancelled", "all"] as const;
export type WaitlistStatusChoice = (typeof WAITLIST_STATUS_CHOICES)[number];

export const WAITLIST_FILTERS = {
  date_from: { kind: "date" },
  date_to: { kind: "date" },
  zone_id: { kind: "id" },
  slot_template_id: { kind: "id" },
  status: { kind: "enum", values: WAITLIST_STATUS_CHOICES },
  q: { kind: "text", max: 60 },
} as const satisfies FilterSpec;

const ALL_STATUSES: readonly WaitlistStatus[] = ["waiting", "notified", "converted", "expired", "cancelled"];

/** The `status[]` values to send for a choice: the default is "open", "all" names every status. */
export function statusParams(choice: string): string[] {
  if (choice === "all") return [...ALL_STATUSES];
  return [choice === "" ? "open" : choice];
}

export const waitlistTone: Record<WaitlistStatus, StatusTone> = {
  waiting: "pending",
  notified: "progress",
  converted: "success",
  expired: "neutral",
  cancelled: "neutral",
};

/** What a row says about the request, from the API's status, offer and close reason. */
export type EntryPhase = "waiting" | "live" | "lapsed" | "booked" | "ended" | "left" | "closed";

export function entryPhase(entry: Pick<WaitlistEntry, "status" | "offer" | "closed_reason">): EntryPhase {
  switch (entry.status) {
    case "converted":
      return "booked";
    case "expired":
      return "ended";
    case "cancelled":
      return entry.closed_reason === "customer_left" ? "left" : "closed";
    default:
      if (entry.offer.state === "live") return "live";
      return entry.offer.state === "lapsed" ? "lapsed" : "waiting";
  }
}

export function isOpen(entry: Pick<WaitlistEntry, "status">): boolean {
  return entry.status === "waiting" || entry.status === "notified";
}

/** The account states a row names in words (`admin.waitlist.customerState`); any other value reads "not active". */
export const CUSTOMER_STATES = ["blocked", "pending_deletion", "other"] as const;
export type CustomerStateKey = (typeof CUSTOMER_STATES)[number];

/**
 * What the customer column says about the account: nothing for an active one (or a deleted one, which has its own
 * words), a label for a blocked account or one being closed, and "not active" for a status this page does not know.
 * The API's status token is never printed.
 */
export function customerStateKey(status: string): CustomerStateKey | null {
  if (status === "active" || status === "deleted") return null;
  return status === "blocked" || status === "pending_deletion" ? status : "other";
}

export const NOTIFY_BLOCKED_REASONS = ["closed", "slot_closed", "customer_inactive", "address_unavailable", "slot_full", "offer_limit"] as const satisfies readonly NotifyBlockedReason[];

export type NotifyMode = "notify" | "again";

/**
 * The row's action. An open request offers "Notify now", or "Notify again" while an offer is live (confirmed, then
 * forced); a closed one offers nothing. `blocked` is the API's reason when `actions.notify` is false.
 */
export function notifyAction(entry: Pick<WaitlistEntry, "status" | "offer" | "actions">): { mode: NotifyMode; blocked: NotifyBlockedReason | null; enabled: boolean } | null {
  if (!isOpen(entry)) return null;
  return {
    mode: entry.offer.state === "live" ? "again" : "notify",
    blocked: entry.actions.notify ? null : entry.actions.notify_blocked_reason,
    enabled: entry.actions.notify,
  };
}

/** A staff offer's request body: `force` only when an offer is live and the person confirmed sending another. */
export function notifyBody(mode: NotifyMode): { force: boolean } {
  return { force: mode === "again" };
}

/** The query of a link from the capacity view: that slot's open requests on that day (waitlist §7.1). */
export function waitlistHref(day: string, zoneId: number, slotTemplateId: number): string {
  const q = new URLSearchParams({ date_from: day, date_to: day, zone_id: String(zoneId), slot_template_id: String(slotTemplateId), status: "open" });
  return `/admin/waitlist?${q.toString()}`;
}
