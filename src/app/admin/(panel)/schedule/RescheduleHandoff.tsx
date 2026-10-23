"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, ButtonLink, Dialog, ErrorState, LoadingBlock, Notice, useToast } from "@/components/admin";
import { availableActions } from "@/lib/admin/bookings/actions";
import { fetchBooking } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { DragSource } from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import { RescheduleBookingDialog } from "../bookings/[id]/BookingActions";

/*
 * A card dropped on another date or slot (the API answers 422 USE_RESCHEDULE): moving the appointment is a reschedule,
 * which the booking package owns (policy, customer notice, the capacity hold moving with it). The booking's own
 * reschedule dialog opens with the drop's date and time filled in; a request not confirmed yet, or a user without
 * bookings.reschedule, is told why and offered the booking page.
 */
export function RescheduleHandoff({
  source,
  date,
  slotId,
  onClose,
}: {
  source: DragSource;
  date: string;
  slotId: number | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.schedule.handoff");
  const toast = useToast();
  const { can } = useAdminSession();
  const bookingId = source.card.booking.id;
  const reference = source.card.booking.reference;
  const readable = can("bookings.view");
  const detail = useQuery({ queryKey: adminKeys.booking(bookingId), queryFn: () => fetchBooking(bookingId), enabled: readable });

  if (detail.data && availableActions(detail.data, can).has("reschedule")) {
    return (
      <RescheduleBookingDialog
        booking={detail.data}
        initial={{ service_date: date, slot_template_id: slotId }}
        onClose={onClose}
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
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
          <ButtonLink href={`/admin/bookings/${bookingId}`}>{t("openBooking")}</ButtonLink>
        </>
      }
    >
      {readable && detail.isPending ? (
        <LoadingBlock lines={2} />
      ) : readable && detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} className="py-4" />
      ) : (
        <Notice tone="info">{reason}</Notice>
      )}
    </Dialog>
  );
}
