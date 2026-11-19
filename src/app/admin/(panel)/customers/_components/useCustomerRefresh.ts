"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { customerKeys } from "@/lib/admin/customers/keys";
import type { CustomerDetail } from "@/lib/admin/customers/types";
import { adminKeys } from "@/lib/admin/keys";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";

/**
 * What a write on a customer refreshes. The block, unblock and opt-out answer the whole profile, which replaces the cached
 * one (it is the newest version, so it is not read twice); everything else a customer touches is read again: the list, the
 * privacy queue, the linked tabs, and, because a block switches auto-renew off, the subscriptions and the bookings'
 * "customer blocked" banners.
 */
export function useCustomerRefresh(ulid: string) {
  const queryClient = useQueryClient();
  return useCallback(
    (updated?: CustomerDetail | null) => {
      if (updated) queryClient.setQueryData(customerKeys.detail(ulid), updated);
      void queryClient.invalidateQueries({
        queryKey: customerKeys.all,
        predicate: (query) => !(updated && query.queryKey[1] === "customers" && query.queryKey[2] === "detail" && query.queryKey[3] === ulid),
      });
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
      void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
    },
    [queryClient, ulid],
  );
}
