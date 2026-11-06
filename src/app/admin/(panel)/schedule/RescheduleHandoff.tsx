"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, ButtonLink, Dialog, ErrorState, LoadingBlock, Notice, useToast, type FocusTarget } from "@/components/admin";
import { availableActions, isSeriesVisit } from "@/lib/admin/bookings/actions";
import { fetchBooking } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { SUBSCRIPTIONS_READ } from "@/lib/admin/nav";
import type { DragSource } from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import { seriesMoveHref } from "@/lib/admin/subscriptions/handoff";
import { RescheduleBookingDialog } from "../bookings/[id]/BookingActions";
import type { SeriesLink } from "./moveFlow";

/*
 * A card dropped on another date or slot (the API answers 422 USE_RESCHEDULE to such a move): moving the appointment is
 * a reschedule, which the booking package owns (policy, customer notice, the capacity hold moving with it). The
 * booking's own reschedule dialog opens with the drop's date and time filled in; a request not confirmed yet, or a user
 * without bookings.reschedule, is told why and offered the booking page (with bookings.view).
 *
 * A subscription's visit (the booking's `subscription` block, or USE_RESCHEDULE details.subscription) moves only from
 * its subscription (P4-48, design §6.2): staff are told so and, with an A08 permission, offered the subscription page
 * opened on that visit's move dialog with the drop's date and time filled in (lib/admin/subscriptions/handoff.ts).
 * Opened from the Move dialog's "Another day or time" (`ownTime`), nothing was dropped: the move dialog opens on the
 * visit's own day and time, and the copy says the new ones are chosen there.
 *
 * A drop on another cleaner's row at another time names a cleaner too: the reschedule moves only the time, so the
 * dialog says that cleaner is not added (`dropWorkerName`).
 */
export function RescheduleHandoff({
  source,
  date,
  slotId,
  dropWorkerName,
  subscription = null,
  ownTime = false,
  onClose,
  returnFocusTo,
}: {
  source: DragSource;
  date: string;
  slotId: number | null;
  dropWorkerName?: string | null;
  /** The subscription the API named when it refused the move (USE_RESCHEDULE details.subscription). */
  subscription?: SeriesLink | null;
  /** Opened on the visit's own day and time (the Move dialog's "Another day or time"), not by a drop. */
  ownTime?: boolean;
  onClose: () => void;
  /** The card's Move button where it is now (focus was in the Move dialog, or nowhere after a drop, when this opened). */
  returnFocusTo?: FocusTarget;
}) {
  const t = useTranslations("admin.schedule.handoff");
  const toast = useToast();
  const { can, canAny } = useAdminSession();
  const bookingId = source.card.booking.id;
  const reference = source.card.booking.reference;
  const readable = can("bookings.view");
  const detail = useQuery({ queryKey: adminKeys.booking(bookingId), queryFn: () => fetchBooking(bookingId), enabled: readable });
  const workerNote = dropWorkerName ? <Notice tone="warning">{t("workerNotMoved", { name: dropWorkerName })}</Notice> : null;

  const loaded = detail.data?.subscription ?? null;
  const seriesLink: SeriesLink | null = subscription ?? (loaded ? { id: loaded.id, reference: loaded.reference } : null);
  const series = seriesLink !== null || (detail.data ? isSeriesVisit(detail.data) : false);

  if (!series && detail.data && availableActions(detail.data, can).has("reschedule")) {
    return (
      <RescheduleBookingDialog
        booking={detail.data}
        initial={{ service_date: date, slot_template_id: slotId }}
        note={workerNote}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
        onStale={() => {
          toast.error(t("stale", { reference }));
          void detail.refetch();
        }}
      />
    );
  }

  const canOpenSeries = canAny([...SUBSCRIPTIONS_READ]);
  // A08 opens on this visit's move dialog, filled with the drop (a week-view cell keeps the card's own slot).
  const seriesHref =
    seriesLink && canOpenSeries
      ? seriesMoveHref(seriesLink.id, { booking: bookingId, on: source.card.service_date, date, slotId: slotId ?? source.card.slot_template_id })
      : null;
  // Not known yet whether it is a subscription's visit: no explanation until the booking is read.
  const checking = !series && readable && detail.isPending;
  const reason = series
    ? canOpenSeries
      ? t(ownTime ? "seriesMoveOwn" : "seriesMove")
      : t("seriesNoAccess")
    : !readable || !can("bookings.reschedule")
      ? t("noPermission")
      : t("notReschedulable");

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference })}
      description={checking ? undefined : series ? t("seriesBody") : t("body")}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant={readable || seriesHref ? "outline" : "primary"} onClick={onClose}>
            {t("close")}
          </Button>
          {readable && (
            <ButtonLink href={`/admin/bookings/${bookingId}`} variant={seriesHref ? "outline" : "primary"}>
              {t("openBooking")}
            </ButtonLink>
          )}
          {seriesHref && <ButtonLink href={seriesHref}>{seriesLink?.reference ? t("openSubscription", { reference: seriesLink.reference }) : t("openSubscriptionPlain")}</ButtonLink>}
        </>
      }
    >
      {checking ? (
        <LoadingBlock lines={2} />
      ) : readable && !series && detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} className="py-4" />
      ) : (
        <>
          <Notice tone="info">{reason}</Notice>
          {!series && workerNote}
        </>
      )}
    </Dialog>
  );
}
