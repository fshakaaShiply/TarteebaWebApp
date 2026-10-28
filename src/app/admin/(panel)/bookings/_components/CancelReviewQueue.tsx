"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, EmptyState, ErrorState, LoadingBlock } from "@/components/admin";
import { BOOKINGS_PATH, withQuery } from "@/lib/admin/dashboard";
import { fetchBookings } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import { Ltr } from "./BookingBits";
import { useBookingText } from "./bookingText";

/** Who acts on a waiting cancellation review: coordinators (keep or cancel) and finance (resolve with a refund). */
export const REVIEW_QUEUE_PERMISSIONS = ["bookings.cancel", "refunds.create"] as const;

/** The A03 list of customer cancellations waiting for review (GET /admin/bookings?cancel_review=1), in a zone or all. */
export function cancelReviewsHref(zoneId: number | null = null): string {
  return withQuery(BOOKINGS_PATH, { cancel_review: true, zone_id: zoneId });
}

/**
 * The A02 overview's review queue: customer cancellations waiting for staff (spec §10.4), the first few with a link to
 * each booking and to the whole filtered list. Shown to readers of bookings who act on reviews (the accountant
 * resolves them with a refund, coordinators keep or cancel them). Loaded with the page, not on a timer.
 */
export function CancelReviewQueue({ zoneId }: { zoneId: number | null }) {
  const t = useTranslations("admin.bookings.reviewQueue");
  const text = useBookingText();
  const { can, canAny } = useAdminSession();
  const shown = can("bookings.view") && canAny(REVIEW_QUEUE_PERMISSIONS);
  const list = useQuery({
    queryKey: adminKeys.bookingList({ cancel_review: true, zone: zoneId ?? 0, page: 1, perPage: 5 }),
    queryFn: () => fetchBookings({ cancelReview: true, zoneId, page: 1, perPage: 5 }),
    refetchOnWindowFocus: true,
    enabled: shown,
  });
  if (!shown) return null;
  const total = list.data?.meta.total ?? 0;

  return (
    <Card
      title={t("title")}
      actions={
        <Link href={cancelReviewsHref(zoneId)} className="text-sm font-bold">
          {list.data ? t("all", { count: total }) : t("open")}
        </Link>
      }
    >
      {list.isPending ? (
        <LoadingBlock lines={2} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} className="py-4" />
      ) : list.data.data.length === 0 ? (
        <EmptyState title={t("empty")} className="py-6" />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.data.data.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="flex flex-col">
                <Link href={`${BOOKINGS_PATH}/${b.id}`} className="font-bold" aria-label={t("openBooking", { reference: b.reference })}>
                  <Ltr className="whitespace-nowrap">{b.reference}</Ltr>
                </Link>
                <span className="text-xs text-ink-600">
                  {b.customer.name || <Ltr>{b.customer.phone}</Ltr>} · {text.dateShort(b.service_date)}
                </span>
              </span>
              <span className="font-latin whitespace-nowrap">{text.money(b.total_fils)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-600">{can("bookings.cancel") ? t("hintCoordinator") : t("hintFinance")}</p>
    </Card>
  );
}
