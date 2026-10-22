"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";
import { adminKeys } from "@/lib/admin/keys";

/**
 * After a workforce, fleet or scheduling write: refresh the given areas and the capacity view, whose figures depend on
 * workers, shifts, leave, vehicles, rules and blackouts.
 */
export function useOpsInvalidate() {
  const queryClient = useQueryClient();
  return useCallback(
    (...keys: QueryKey[]) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: adminKeys.capacity() });
    },
    [queryClient],
  );
}
