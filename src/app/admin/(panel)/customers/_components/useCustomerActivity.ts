"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchLinked } from "@/lib/admin/customers/endpoints";
import { customerKeys } from "@/lib/admin/customers/keys";
import { isOpenBooking, isOpenSubscription } from "@/lib/admin/customers/status";
import type { CustomerDetail } from "@/lib/admin/customers/types";
import type { BookingRow } from "@/lib/admin/types";
import type { SubscriptionRow } from "@/lib/admin/subscriptions/types";
import type { OpenItem } from "./BlockCustomerDialog";

const RECENT = 5;

export type ActivityRow =
  | { kind: "booking"; key: string; date: string; booking: BookingRow }
  | { kind: "subscription"; key: string; date: string; subscription: SubscriptionRow };

/**
 * The customer's latest single bookings and subscriptions, from their own modules' lists filtered by the id the profile's
 * `links` name (the module owning each list decides who may read it: a link is null without that permission), merged by
 * date, newest first. The block dialog lists the open ones among them.
 */
export function useCustomerActivity(customer: CustomerDetail) {
  const gone = customer.status === "deleted";
  const bookingsLink = gone ? null : customer.links.bookings;
  const subscriptionsLink = gone ? null : customer.links.subscriptions;
  const bookings = useQuery({
    queryKey: customerKeys.linked(customer.id, "bookings", 1),
    queryFn: () => fetchLinked<BookingRow>(bookingsLink!, { perPage: RECENT, extra: { kind: "single" } }),
    enabled: bookingsLink !== null,
  });
  const subscriptions = useQuery({
    queryKey: customerKeys.linked(customer.id, "subscriptions", 1),
    queryFn: () => fetchLinked<SubscriptionRow>(subscriptionsLink!, { perPage: RECENT }),
    enabled: subscriptionsLink !== null,
  });

  const rows = useMemo<ActivityRow[]>(() => {
    const out: ActivityRow[] = [
      ...(bookings.data?.data ?? []).map((booking): ActivityRow => ({ kind: "booking", key: `b${booking.id}`, date: booking.service_date, booking })),
      ...(subscriptions.data?.data ?? []).map(
        (subscription): ActivityRow => ({ kind: "subscription", key: `s${subscription.id}`, date: (subscription.first_visit_at ?? subscription.term_end_date).slice(0, 10), subscription }),
      ),
    ];
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [bookings.data, subscriptions.data]);

  const openItems = useMemo<OpenItem[]>(
    () =>
      rows.flatMap((row): OpenItem[] =>
        row.kind === "booking"
          ? isOpenBooking(row.booking.status)
            ? [{ type: "booking", id: row.booking.id, reference: row.booking.reference, href: `/admin/bookings/${row.booking.id}` }]
            : []
          : isOpenSubscription(row.subscription.status)
            ? [{ type: "subscription", id: row.subscription.id, reference: row.subscription.reference, href: `/admin/subscriptions/${row.subscription.id}` }]
            : [],
      ),
    [rows],
  );

  return {
    rows,
    openItems,
    enabled: bookingsLink !== null || subscriptionsLink !== null,
    pending: (bookingsLink !== null && bookings.isPending) || (subscriptionsLink !== null && subscriptions.isPending),
    error: bookings.error ?? subscriptions.error,
    retry: () => {
      void bookings.refetch();
      void subscriptions.refetch();
    },
  };
}
