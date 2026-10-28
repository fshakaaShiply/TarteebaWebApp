"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isPollDriven } from "@/lib/admin/backgroundRefresh";
import { refundsOfBooking } from "@/lib/admin/bookings/actions";
import { fetchRefundsByPhone } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingDetail } from "@/lib/admin/types";

/** Any of these reads the refunds (GET /admin/refunds). */
export const REFUND_READ_PERMISSIONS = ["payments.view", "refunds.create"] as const;

/**
 * The refunds of the booking's payment, with the provider's status (the payment card's list; the cancellation review's
 * cap leaves out the ones still open). Any money taken may have refunds, also ones still processing or failed
 * (refunded_fils counts only those the provider confirmed): a reschedule's price difference, money the booking never
 * accepted, a cancellation.
 */
export function useBookingRefunds(booking: BookingDetail) {
  const { canAny } = useAdminSession();
  const queryClient = useQueryClient();
  const p = booking.payment;
  const mayHaveRefunds = !!p && (p.captured_fils > 0 || p.refunded_fils > 0 || (booking.cancellation.refund_fils ?? 0) > 0);
  return useQuery({
    queryKey: adminKeys.bookingRefunds(booking.id),
    // Turned on by the page's timed refresh (money taken meanwhile, no one acted since): a background poll too.
    queryFn: () => fetchRefundsByPhone(booking.customer.phone, { background: isPollDriven(queryClient) }),
    enabled: canAny(REFUND_READ_PERMISSIONS) && mayHaveRefunds,
    select: (rows) => refundsOfBooking(rows, booking),
  });
}
