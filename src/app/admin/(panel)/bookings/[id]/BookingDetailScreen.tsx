"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, EmptyState, ErrorState, LoadingBlock, Notice } from "@/components/admin";
import { BOOKING_REFRESH_MS, useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { availableActions, paymentVerifying } from "@/lib/admin/bookings/actions";
import { fetchBooking } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingDetail } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { StaleDialog } from "../../catalog/_components/CatalogFields";
import { BookingChips, DeadlineCountdown, Ltr, SlotLabel } from "../_components/BookingBits";
import { useBookingText } from "../_components/bookingText";
import { BookingFocusProvider, useFocusRescue } from "../_components/focus";
import { AssignmentPanel } from "./AssignmentPanel";
import { BookingActionBar } from "./BookingActions";
import {
  AddressCard,
  CancelReviewTask,
  CustomerCard,
  HistoryCard,
  NotesCard,
  NotificationsCard,
  PaymentCard,
  PriceCard,
  ProposalsCard,
  RequestCard,
  RescheduleRequestsCard,
} from "./BookingSections";

/**
 * A03 booking page (spec §17; designs AdminBookings.dc.html and the review panel of AdminSchedule.dc.html;
 * bookings.view): reference, status and payment chips, the confirmation countdown, customer, address and flags, the
 * request, price lines and totals, payment and refunds, history and internal notes; actions by status and permission;
 * the assignment panel; customer reschedule requests and cancellation reviews as tasks.
 */
export function BookingDetailScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={["bookings.view"]}>
      <BookingDetailContent id={id} />
    </RequirePermission>
  );
}

function BookingDetailContent({ id }: { id: string }) {
  const t = useTranslations("admin.bookings.detail");
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  // Opening the page, focus, actions and Refresh load it as staff activity; the timer's reads, and the reads a change
  // it brought sets off before anyone acts (candidates, refunds), are background polls (lib/admin/backgroundRefresh.ts),
  // which never keep an idle session alive (spec §13.2).
  const queryClient = useQueryClient();
  const booking = useQuery({
    queryKey: adminKeys.booking(numericId ?? 0),
    queryFn: () => fetchBooking(numericId as number),
    enabled: numericId !== null,
    refetchOnWindowFocus: true,
  });
  useBackgroundRefresh(adminKeys.booking(numericId ?? 0), () => fetchBooking(numericId as number, { background: true }), {
    everyMs: BOOKING_REFRESH_MS,
    enabled: numericId !== null,
  });
  const [stale, setStale] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/bookings" className="inline-flex w-fit items-center gap-1 text-sm font-medium">
          <ChevronRight aria-hidden className="size-4 ltr:rotate-180" />
          {t("back")}
        </Link>
        {booking.data && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void booking.refetch();
              // The cleaners card's candidates too (who is free changes with other bookings).
              for (const visit of booking.data?.visits ?? []) void queryClient.invalidateQueries({ queryKey: adminKeys.visitCandidates(visit.id) });
            }}
            loading={booking.isFetching}
            icon={<RefreshCw aria-hidden className="size-4" />}
          >
            {t("refresh")}
          </Button>
        )}
      </div>
      {numericId === null ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : booking.isPending ? (
        <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : booking.isError ? (
        <Card>
          <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />
        </Card>
      ) : (
        <BookingView booking={booking.data} onStale={() => setStale(true)} />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void booking.refetch();
        }}
      />
    </>
  );
}

function BookingView({ booking, onStale }: { booking: BookingDetail; onStale: () => void }) {
  const t = useTranslations("admin.bookings.detail");
  const text = useBookingText();
  const { can } = useAdminSession();
  const actions = availableActions(booking, can);
  // Where focus goes when an action removes its own button (see _components/focus).
  const [heading, setHeading] = useState<HTMLHeadingElement | null>(null);
  useFocusRescue(heading, `${booking.status}:${booking.version}:${booking.payment_status}`);

  return (
    <BookingFocusProvider value={heading}>
      <section aria-labelledby="booking-title" className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 ref={setHeading} id="booking-title" tabIndex={-1} className="text-[26px]/[34px] font-bold text-ink-900 outline-none">
              <span className="sr-only">{t("titlePrefix")} </span>
              <Ltr>{booking.reference}</Ltr>
            </h1>
            <BookingChips status={booking.status} statusLabel={booking.status_label} payment={booking.payment_status} paymentLabel={booking.payment_status_label} />
            <p className="text-sm text-ink-600">
              {text.name(booking.service.name)} · {text.dateShort(booking.service_date)} · <SlotLabel name={booking.slot.name} start={booking.slot.start} end={booking.slot.end} /> ·{" "}
              {text.name(booking.zone.name)}
            </p>
            {booking.status === "pending_confirmation" && booking.confirmation_deadline_at && (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-600">{t("deadline", { time: text.dateTime(booking.confirmation_deadline_at) })}</span>
                <DeadlineCountdown deadline={booking.confirmation_deadline_at} />
              </p>
            )}
            {booking.status === "held" && booking.hold_expires_at && (
              <p className="text-sm text-ink-600">{t("heldUntil", { time: text.dateTime(booking.hold_expires_at) })}</p>
            )}
          </div>
          <BookingActionBar booking={booking} actions={actions} onStale={onStale} />
        </div>
        {booking.capture_unknown_at && <Notice tone="warning">{t("captureUnknown")}</Notice>}
        {paymentVerifying(booking) && (
          <Notice tone="info">{booking.status === "pending_confirmation" && can("bookings.confirm") ? t("verifyingConfirm") : t("verifying")}</Notice>
        )}
        {booking.status === "alternative_proposed" && <Notice tone="info">{t("waitingCustomer")}</Notice>}
        {(booking.status === "cancelled" || booking.status === "rejected") && booking.cancel_reason_code && (
          <Notice tone="neutral">
            {t("ended", {
              reason: booking.rejected_reason_code ? text.rejectReason(booking.rejected_reason_code) : text.cancelReason(booking.cancel_reason_code),
              time: text.dateTime(booking.cancelled_at),
            })}
            {booking.cancel_reason_text && <span className="block">“{booking.cancel_reason_text}”</span>}
          </Notice>
        )}
        <CancelReviewTask booking={booking} onStale={onStale} />
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
          <RescheduleRequestsCard booking={booking} />
          <ProposalsCard booking={booking} />
          <AssignmentPanel booking={booking} />
          <RequestCard booking={booking} />
          <PriceCard booking={booking} />
          <HistoryCard booking={booking} />
          <NotificationsCard booking={booking} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <CustomerCard booking={booking} />
          <AddressCard booking={booking} />
          <PaymentCard booking={booking} />
          <NotesCard booking={booking} />
        </div>
      </div>
    </BookingFocusProvider>
  );
}
