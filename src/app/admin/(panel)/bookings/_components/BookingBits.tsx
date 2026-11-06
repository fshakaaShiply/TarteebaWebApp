"use client";

import clsx from "clsx";
import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback } from "react";
import { StatusBadge } from "@/components/admin";
import { minutesUntil } from "@/lib/admin/bookings/actions";
import { splitMinutes } from "@/lib/admin/dashboard";
import { useNow } from "@/lib/admin/hooks";
import { SUBSCRIPTIONS_READ, SUBSCRIPTIONS_PATH } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingRow, BookingStatus, PaymentStatus, Translatable } from "@/lib/admin/types";
import { bookingTone, paymentTone, useBookingText } from "./bookingText";

/** "2 hours 10 minutes" / "ساعتان و10 دقائق" for a duration in whole minutes. */
export function useDurationText() {
  const t = useTranslations("admin.time");
  return useCallback(
    (totalMinutes: number) => {
      const { hours, minutes } = splitMinutes(totalMinutes);
      if (hours === 0) return t("minutes", { minutes });
      if (minutes === 0) return t("hours", { hours });
      return t("hoursMinutes", { hours, minutes });
    },
    [t],
  );
}

/**
 * "Subscription TRS-7K2M9Q · visit 3 of 8" for a visit of a subscription (null for a single booking). The reference
 * links to the subscription in A08 for holders of a subscription permission (the API checks again).
 */
export function SeriesLabel({ booking, className }: { booking: Pick<BookingRow, "kind" | "subscription">; className?: string }) {
  const t = useTranslations("admin.bookings.series");
  const { canAny } = useAdminSession();
  const link = booking.subscription;
  if (!link) return null;
  const known = link.visit_no !== null && link.visits_total !== null;
  const key =
    booking.kind === "live_out_trial" ? "liveOutTrial" : link.type === "live_out" ? (known ? "liveOutDay" : "liveOut") : known ? "recurringVisit" : "recurring";
  const href = canAny([...SUBSCRIPTIONS_READ]) ? `${SUBSCRIPTIONS_PATH}/${link.id}` : null;
  return (
    <span className={clsx("text-sm text-ink-600", className)}>
      {t.rich(key, {
        reference: link.reference,
        no: link.visit_no ?? 0,
        total: link.visits_total ?? 0,
        ref: () =>
          href ? (
            <Link href={href} className="font-bold" aria-label={t("openLabel", { reference: link.reference })}>
              <Ltr className="whitespace-nowrap">{link.reference}</Ltr>
            </Link>
          ) : (
            <Ltr className="font-bold whitespace-nowrap">{link.reference}</Ltr>
          ),
      })}
    </span>
  );
}

/** Booking status and payment status side by side: two separate states (spec §7, §16), each with its text. */
export function BookingChips({
  status,
  statusLabel,
  payment,
  paymentLabel,
  className,
}: {
  status: BookingStatus;
  statusLabel?: Translatable | null;
  payment: PaymentStatus;
  paymentLabel?: Translatable | null;
  className?: string;
}) {
  const t = useTranslations("admin.bookings");
  const text = useBookingText();
  return (
    <span className={clsx("flex flex-wrap items-center gap-1.5", className)}>
      <StatusBadge tone={bookingTone[status] ?? "neutral"}>
        <span className="sr-only">{t("chips.status")} </span>
        {text.status(status, statusLabel)}
      </StatusBadge>
      <StatusBadge tone={paymentTone[payment] ?? "neutral"}>
        <span className="sr-only">{t("chips.payment")} </span>
        {text.payment(payment, paymentLabel)}
      </StatusBadge>
    </span>
  );
}

/**
 * Time left to confirm a request (bookings.confirmation_deadline_at), refreshed every 30 seconds. Past the deadline
 * the request is still pending until the SLA job cancels it, so it says how long ago the deadline passed.
 */
export function DeadlineCountdown({ deadline, className }: { deadline: string | null | undefined; className?: string }) {
  const t = useTranslations("admin.bookings.deadline");
  const duration = useDurationText();
  const now = useNow(30_000);
  const minutes = minutesUntil(deadline, now);
  if (minutes === null) return null;
  const passed = minutes < 0;
  return (
    <span className={clsx("inline-flex items-center gap-1 text-xs font-medium", passed ? "text-danger-700" : "text-warning-700", className)}>
      <Clock aria-hidden className="size-3.5" strokeWidth={1.75} />
      {passed ? t("passed", { time: duration(-minutes) }) : t("left", { time: duration(minutes) })}
    </span>
  );
}

/** "Morning · 10:00–14:00" (times stay left to right). */
export function SlotLabel({ name, start, end, className }: { name?: Translatable | null; start?: string | null; end?: string | null; className?: string }) {
  const text = useBookingText();
  const label = text.name(name);
  return (
    <span className={className}>
      {label}
      {label && start ? " · " : null}
      {start && (
        <bdi dir="ltr" className="font-latin">
          {start}
          {end ? `–${end}` : null}
        </bdi>
      )}
    </span>
  );
}

/** A booking reference or phone number in Latin digits, isolated so it keeps its order in Arabic text. */
export function Ltr({ children, className }: { children: string | number; className?: string }) {
  return (
    <bdi dir="ltr" className={clsx("font-latin", className)}>
      {children}
    </bdi>
  );
}
