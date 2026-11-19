"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { adminKeys } from "@/lib/admin/keys";
import { qualityKeys } from "@/lib/admin/quality/keys";
import type { AdminCaseDetail } from "@/lib/admin/quality/types";

/**
 * What a write on a case refreshes: the case itself takes the answer the API sent (it is the newest version, so nothing
 * is read twice), and everything a case touches is read again: the inbox and its counts, the accountant's queue, the
 * ratings, the booking's quality block, the overview's alerts, and A09 (a compensation can create a refund).
 */
export function useCaseRefresh() {
  const queryClient = useQueryClient();
  return useCallback(
    (updated?: AdminCaseDetail | null) => {
      if (updated) queryClient.setQueryData(qualityKeys.case(updated.id), updated);
      void queryClient.invalidateQueries({
        queryKey: qualityKeys.all,
        predicate: (query) => !(updated && query.queryKey[2] === "cases" && query.queryKey[3] === "detail" && query.queryKey[4] === updated.id),
      });
      void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
    },
    [queryClient],
  );
}

/** An answer that means the case (or compensation) is not the version the person was looking at. */
export function isStaleVersion(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "STALE_VERSION";
}
