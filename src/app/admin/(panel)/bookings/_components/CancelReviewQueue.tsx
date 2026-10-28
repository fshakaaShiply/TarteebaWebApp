"use client";

import clsx from "clsx";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card } from "@/components/admin";
import { dashboardHref } from "@/lib/admin/dashboard";
import { useAdminSession } from "@/lib/admin/session";
import type { DashboardSummary } from "@/lib/admin/types";
import { Ltr, useDurationText } from "./BookingBits";
import { useBookingText } from "./bookingText";

/**
 * The A02 overview's review queue: customer cancellations waiting for staff (spec §10.4), from the summary's
 * `cards.cancellation_reviews`: how many wait now (any service date), the one waiting longest with a link to it, and the
 * whole filtered list (`link`: the A03 list with cancel_review=1 and the zone). The API sends it only to readers of
 * bookings who act on reviews (the accountant resolves them with a refund, coordinators keep or cancel them); null
 * hides it. It refreshes with the summary.
 */
export function CancelReviewQueue({ card }: { card: DashboardSummary["cards"]["cancellation_reviews"] }) {
  const t = useTranslations("admin.bookings.reviewQueue");
  const text = useBookingText();
  const duration = useDurationText();
  const { can } = useAdminSession();
  if (!card) return null;
  const listHref = dashboardHref(card.link);
  const oldest = card.value > 0 ? card.oldest_request : null;
  const oldestHref = oldest ? dashboardHref(oldest.link) : null;

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
        <span className={clsx("font-latin text-[32px]/10 font-bold", card.value > 0 ? "text-warning-700" : "text-ink-900")}>{card.value}</span>
        <span className="text-sm text-ink-600">
          {!oldest
            ? t("empty")
            : t.rich("oldest", {
                reference: oldest.reference,
                time: duration(oldest.waiting_minutes),
                // The tag wraps the reference: shown left to right, linking to the booking through the API's link.
                ref: () =>
                  oldestHref ? (
                    <Link href={oldestHref} className="font-bold" aria-label={t("openBooking", { reference: oldest.reference })}>
                      <Ltr className="whitespace-nowrap">{oldest.reference}</Ltr>
                    </Link>
                  ) : (
                    <Ltr className="whitespace-nowrap font-bold">{oldest.reference}</Ltr>
                  ),
              })}
        </span>
      </div>
      <p className="text-xs text-ink-600">{can("bookings.cancel") ? t("hintCoordinator") : t("hintFinance")}</p>
    </Card>
  );
}
