import type { StatusTone } from "@/components/admin";
import type { BookingStatus } from "../types";
import { OPEN_STATUSES as SUBSCRIPTION_OPEN } from "../subscriptions/status";
import type { CustomerListItem, CustomerStatus, PrivacyStatus } from "./types";

/** Chip colours of a customer's status (design §7.1): active success, blocked danger, a deletion waiting pending, gone neutral. */
export const customerTone: Record<CustomerStatus, StatusTone> = {
  active: "success",
  blocked: "danger",
  pending_deletion: "pending",
  deleted: "neutral",
};

export const privacyTone: Record<PrivacyStatus, StatusTone> = {
  received: "pending",
  scheduled: "pending",
  processing: "progress",
  completed: "success",
  expired: "neutral",
  cancelled: "neutral",
  failed: "danger",
};

export function customerToneOf(status: string): StatusTone {
  return (customerTone as Record<string, StatusTone>)[status] ?? "neutral";
}

export function privacyToneOf(status: string): StatusTone {
  return (privacyTone as Record<string, StatusTone>)[status] ?? "neutral";
}

/** A deleted account is read-only and holds no personal data: its row is grey and says so. */
export function isDeletedCustomer(customer: Pick<CustomerListItem, "status">): boolean {
  return customer.status === "deleted";
}

/** Statuses of a booking staff still decide on (the API's open set, a checkout hold is not one). */
export const OPEN_BOOKING_STATUSES: readonly BookingStatus[] = ["pending_confirmation", "alternative_proposed", "confirmed", "rescheduled"];
export const isOpenBooking = (status: string): boolean => (OPEN_BOOKING_STATUSES as readonly string[]).includes(status);
/** A subscription is open once it is past checkout (`pending_payment` is not counted, P5-C92). */
export const isOpenSubscription = (status: string): boolean => status !== "pending_payment" && SUBSCRIPTION_OPEN.includes(status);

/** The profile page of a customer (the ULID the API names), or null for an id that is not one. */
export const customerHref = (ulid: string): string => `/admin/customers/${ulid}`;
export const PRIVACY_QUEUE_PATH = "/admin/customers/privacy-requests";
