"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, ButtonLink, Dialog, ErrorState, LoadingBlock, Notice, useToast, type FocusTarget } from "@/components/admin";
import { availableActions } from "@/lib/admin/bookings/actions";
import { fetchBooking } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { DragSource } from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import { RescheduleBookingDialog } from "../bookings/[id]/BookingActions";

/*
 * A card dropped on another date or slot (the API answers 422 USE_RESCHEDULE to such a move): moving the appointment is
 * a reschedule, which the booking package owns (policy, customer notice, the capacity hold moving with it). The
 * booking's own reschedule dialog opens with the drop's date and time filled in; a request not confirmed yet, or a user
 * without bookings.reschedule, is told why and offered the booking page (with bookings.view).
 *
 * A drop on another cleaner's row at another time names a cleaner too: the reschedule moves only the time, so the
 * dialog says that cleaner is not added (`dropWorkerName`).
 */
export function RescheduleHandoff({
  source,
  date,
  slotId,
  dropWorkerName,
  onClose,
  returnFocusTo,
}: {
  source: DragSource;
  date: string;
  slotId: number | null;
  dropWorkerName?: string | null;
  onClose: () => void;
  /** The card's Move button where it is now (focus was in the Move dialog, or nowhere after a drop, when this opened). */
  returnFocusTo?: FocusTarget;
}) {
  const t = useTranslations("admin.schedule.handoff");
  const toast = useToast();
  const { can } = useAdminSession();
  const bookingId = source.card.booking.id;
  const reference = source.card.booking.reference;
  const readable = can("bookings.view");
  const detail = useQuery({ queryKey: adminKeys.booking(bookingId), queryFn: () => fetchBooking(bookingId), enabled: readable });
  const workerNote = dropWorkerName ? <Notice tone="warning">{t("workerNotMoved", { name: dropWorkerName })}</Notice> : null;

  if (detail.data && availableActions(detail.data, can).has("reschedule")) {
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

  const reason = !readable || !can("bookings.reschedule") ? t("noPermission") : t("notReschedulable");

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference })}
      description={t("body")}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant={readable ? "outline" : "primary"} onClick={onClose}>
            {t("close")}
          </Button>
          {readable && <ButtonLink href={`/admin/bookings/${bookingId}`}>{t("openBooking")}</ButtonLink>}
        </>
      }
    >
      {readable && detail.isPending ? (
        <LoadingBlock lines={2} />
      ) : readable && detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} className="py-4" />
      ) : (
        <>
          <Notice tone="info">{reason}</Notice>
          {workerNote}
        </>
      )}
    </Dialog>
  );
}
