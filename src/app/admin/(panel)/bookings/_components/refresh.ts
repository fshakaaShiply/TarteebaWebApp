"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { AdminApiError } from "@/lib/admin/client";
import { adminKeys } from "@/lib/admin/keys";
import type { BookingDetail } from "@/lib/admin/types";

/**
 * After a booking action: show the booking the API answered with at once, then refresh the lists, the overview, the
 * capacity figures, the schedule board and the trip planner it moves.
 */
export function useBookingRefresh() {
  const queryClient = useQueryClient();
  return useCallback(
    (booking?: BookingDetail | null) => {
      if (booking) queryClient.setQueryData(adminKeys.booking(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.capacity() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.schedule() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.rounds() });
    },
    [queryClient],
  );
}

export function isStaleVersion(error: unknown): boolean {
  return error instanceof AdminApiError && error.code === "STALE_VERSION";
}

export function errorCode(error: unknown): string | null {
  return error instanceof AdminApiError ? error.code : null;
}
