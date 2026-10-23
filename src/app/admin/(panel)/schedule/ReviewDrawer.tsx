"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ButtonLink, Drawer, ErrorState, LoadingBlock, Notice, type FocusTarget } from "@/components/admin";
import { availableActions, paymentVerifying } from "@/lib/admin/bookings/actions";
import { fetchBooking } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingDetail } from "@/lib/admin/types";
import { StaleDialog } from "../catalog/_components/CatalogFields";
import { AssignmentPanel } from "../bookings/[id]/AssignmentPanel";
import { BookingActionBar } from "../bookings/[id]/BookingActions";
import { Fact, NotesCard } from "../bookings/[id]/BookingSections";
import { BookingChips, DeadlineCountdown, Ltr, SlotLabel } from "../bookings/_components/BookingBits";
import { useBookingText } from "../bookings/_components/bookingText";
import { BookingFocusProvider, useFocusRescue } from "../bookings/_components/focus";

/*
 * A04 "Schedule & review" (design AdminSchedule.dc.html, the review panel beside the board): a card's booking reviewed
 * without leaving the schedule. The reference and status, the customer, the appointment, the preferred cleaner (asked
 * for, never promised), the payment and the source; the availability check (the visit's ranked candidates and who is
 * excluded and why, from the booking page's assignment panel); the internal notes; and the booking's own actions by
 * status and permission (confirm, propose other times, reject, reschedule, cancel), with the booking page's dialogs.
 * Reading needs bookings.view; each action keeps its own permission, and the API checks it again.
 */
export function ReviewDrawer({ bookingId, onClose, returnFocusTo }: { bookingId: number; onClose: () => void; returnFocusTo?: FocusTarget }) {
  const t = useTranslations("admin.schedule.review");
  // The booking page's own cache entry: its actions refresh this panel and the board alike (useBookingRefresh).
  const booking = useQuery({ queryKey: adminKeys.booking(bookingId), queryFn: () => fetchBooking(bookingId) });
  const [stale, setStale] = useState(false);

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("body")} size="lg" returnFocusTo={returnFocusTo}>
      {booking.isPending ? (
        <LoadingBlock lines={8} />
      ) : booking.isError ? (
        <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />
      ) : (
        <ReviewBody booking={booking.data} onStale={() => setStale(true)} />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void booking.refetch();
        }}
      />
    </Drawer>
  );
}

function ReviewBody({ booking, onStale }: { booking: BookingDetail; onStale: () => void }) {
  const t = useTranslations("admin.schedule.review");
  const d = useTranslations("admin.bookings.detail");
  const text = useBookingText();
  const { can } = useAdminSession();
  const actions = availableActions(booking, can);
  // Where focus goes when an action removes its own button (confirm, reject …), as on the booking page.
  const [heading, setHeading] = useState<HTMLHeadingElement | null>(null);
  useFocusRescue(heading, `${booking.status}:${booking.version}:${booking.payment_status}`);
  const unit = booking.address?.unit_number;
  const amount = booking.payment?.amount_fils ?? booking.total_fils;

  return (
    <BookingFocusProvider value={heading}>
      <section aria-labelledby="schedule-review-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 ref={setHeading} id="schedule-review-title" tabIndex={-1} className="text-lg/7 font-bold text-ink-900 outline-none">
            <span className="sr-only">{d("titlePrefix")} </span>
            <Ltr>{booking.reference}</Ltr>
          </h3>
          <BookingChips status={booking.status} statusLabel={booking.status_label} payment={booking.payment_status} paymentLabel={booking.payment_status_label} />
        </div>
        <dl className="flex flex-col gap-2">
          <Fact label={d("customerTitle")}>
            {booking.customer.name || d("noName")}
            {unit ? ` · ${d("unit", { unit })}` : null}
          </Fact>
          <Fact label={d("when")}>
            {text.dateShort(booking.service_date)} · <SlotLabel name={booking.slot.name} start={booking.slot.start} end={booking.slot.end} />
          </Fact>
          <Fact label={d("teamSize")}>{d("workers", { count: booking.workers_count })}</Fact>
          <Fact label={d("preferredWorker")}>
            {booking.preferred_worker ? (
              <span className="flex flex-col">
                <span>{booking.preferred_worker.display_name}</span>
                <span className="text-xs text-ink-600">{d("preferredNote")}</span>
              </span>
            ) : (
              d("noPreference")
            )}
          </Fact>
          <Fact label={t("payment")}>
            <span className="font-latin">{text.money(amount)}</span> · {text.payment(booking.payment_status, booking.payment_status_label)}
          </Fact>
          <Fact label={d("source")}>{text.source(booking.source, booking.source_label)}</Fact>
        </dl>
        {booking.status === "pending_confirmation" && booking.confirmation_deadline_at && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-600">{d("deadline", { time: text.dateTime(booking.confirmation_deadline_at) })}</span>
            <DeadlineCountdown deadline={booking.confirmation_deadline_at} />
          </p>
        )}
        {booking.capture_unknown_at && <Notice tone="warning">{d("captureUnknown")}</Notice>}
        {paymentVerifying(booking) && (
          <Notice tone="info">{booking.status === "pending_confirmation" && can("bookings.confirm") ? d("verifyingConfirm") : d("verifying")}</Notice>
        )}
        {booking.status === "alternative_proposed" && <Notice tone="info">{d("waitingCustomer")}</Notice>}
        <BookingActionBar booking={booking} actions={actions} onStale={onStale} />
        {booking.status === "pending_confirmation" && actions.has("confirm") && <p className="text-xs text-ink-600">{t("confirmHint")}</p>}
      </section>

      <AssignmentPanel booking={booking} />
      <NotesCard booking={booking} />
      <ButtonLink variant="outline" href={`/admin/bookings/${booking.id}`} className="self-start">
        {t("openBooking")}
      </ButtonLink>
    </BookingFocusProvider>
  );
}
