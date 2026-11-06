"use client";

import clsx from "clsx";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/admin";
import { dashboardHref } from "@/lib/admin/dashboard";
import type { DashboardSummary } from "@/lib/admin/types";
import { Ltr, useDurationText } from "../bookings/_components/BookingBits";
import { useBookingText } from "../bookings/_components/bookingText";

/**
 * A02: subscription requests waiting for confirmation (Phase 4; the summary's `cards.subscription_requests`): how many
 * wait, how many are past their deadline, the nearest deadline and the request waiting longest, each linking to its
 * subscription in A08, and the filtered list (`link`: A08 with status=pending_confirmation and the zone). The API sends
 * the card only to holders of subscriptions.view or subscriptions.manage; null hides it. It refreshes with the summary.
 */
export function SubscriptionRequestsCard({ card }: { card: DashboardSummary["cards"]["subscription_requests"] }) {
  const t = useTranslations("admin.overview.subscriptionRequests");
  const text = useBookingText();
  const duration = useDurationText();
  if (!card) return null;
  const listHref = dashboardHref(card.link);
  const next = card.value > 0 ? card.next_deadline : null;
  const nextHref = next ? dashboardHref(next.link) : null;
  const oldest = card.value > 0 ? card.oldest_request : null;
  const oldestHref = oldest ? dashboardHref(oldest.link) : null;

  const reference = (value: string, href: string | null) =>
    href ? (
      <Link href={href} className="font-bold" aria-label={t("openSubscription", { reference: value })}>
        <Ltr className="whitespace-nowrap">{value}</Ltr>
      </Link>
    ) : (
      <Ltr className="font-bold whitespace-nowrap">{value}</Ltr>
    );

  return (
    <Card
      title={text.name(card.label)}
      actions={
        listHref ? (
          <Link href={listHref} className="text-sm font-bold">
            {t("all", { count: card.value })}
          </Link>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className={clsx("font-latin text-[32px]/10 font-bold", card.overdue > 0 ? "text-danger-700" : card.value > 0 ? "text-warning-700" : "text-ink-900")}>
          {card.value}
        </span>
        <div className="flex flex-col gap-0.5 text-sm text-ink-600">
          {card.value === 0 && <span>{t("empty")}</span>}
          {next && (
            <span>
              {next.minutes_left < 0
                ? t.rich("deadlinePassed", { reference: next.reference, time: duration(-next.minutes_left), ref: () => reference(next.reference, nextHref) })
                : t.rich("deadline", { reference: next.reference, time: duration(next.minutes_left), ref: () => reference(next.reference, nextHref) })}
            </span>
          )}
          {oldest && (
            <span>
              {t.rich("oldest", { reference: oldest.reference, time: duration(oldest.waiting_minutes), ref: () => reference(oldest.reference, oldestHref) })}
            </span>
          )}
          {card.overdue > 0 && <span className="font-medium text-danger-700">{t("overdue", { count: card.overdue })}</span>}
        </div>
      </div>
    </Card>
  );
}
