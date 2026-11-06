import type { StatusTone } from "@/components/admin";
import type { CalendarDayType, PaymentHealth, SubscriptionStatus } from "./types";

/*
 * Chip colours of A08 (design §9.1, spec §27.5). Every chip carries its text, never colour alone. The status text is
 * the API's own `status_label`; the colour follows the status:
 *   active → success, pending_confirmation → pending, paused → neutral ("Frozen until {date}"), renewal_failed and
 *   suspended → danger; payment health: paid → success, verifying → neutral, renewal_failed and suspended → danger.
 */

export const statusTone: Record<SubscriptionStatus, StatusTone> = {
  pending_payment: "pending",
  pending_confirmation: "pending",
  active: "success",
  paused: "neutral",
  expiring: "pending",
  renewal_failed: "danger",
  suspended: "danger",
  ended: "neutral",
  cancelled: "danger",
  expired: "neutral",
  rejected: "danger",
};

export const healthTone: Record<PaymentHealth, StatusTone> = {
  paid: "success",
  pending: "pending",
  verifying: "neutral",
  renewal_failed: "danger",
  suspended: "danger",
  refunded: "neutral",
  none: "neutral",
};

export const periodTone: Record<string, StatusTone> = {
  upcoming: "neutral",
  pending_payment: "pending",
  paid: "success",
  failed: "danger",
  refunded_partial: "neutral",
  refunded: "neutral",
  closed: "neutral",
  void: "neutral",
};

export const occurrenceTone: Record<string, StatusTone> = {
  planned: "neutral",
  held: "pending",
  materialized: "confirmed",
  skipped: "neutral",
  frozen: "neutral",
  credited: "success",
  holiday: "neutral",
  replaced: "neutral",
  dropped: "neutral",
  cancelled: "danger",
};

export const CALENDAR_TYPES = ["service", "rest", "public_holiday", "absence", "dropped"] as const satisfies readonly CalendarDayType[];

export function tone<T extends string>(map: Record<string, StatusTone>, key: T, fallback: StatusTone = "neutral"): StatusTone {
  return map[key] ?? fallback;
}

/** A status the API may add later still shows (with its own label) in a neutral chip. */
export function statusToneOf(status: string): StatusTone {
  return (statusTone as Record<string, StatusTone>)[status] ?? "neutral";
}

export function healthToneOf(health: string): StatusTone {
  return (healthTone as Record<string, StatusTone>)[health] ?? "neutral";
}

/** Statuses a subscription is still open in (the API's SubscriptionStatus::open()): a request, running, or failing. */
export const OPEN_STATUSES: readonly string[] = ["pending_payment", "pending_confirmation", "active", "paused", "expiring", "renewal_failed", "suspended"];
/** Running statuses: visits are planned and the series operations apply. */
export const RUNNING_STATUSES: readonly string[] = ["active", "paused", "expiring"];
