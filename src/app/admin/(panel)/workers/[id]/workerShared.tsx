"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchWorker } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { Worker } from "@/lib/admin/types";
import { useOpsInvalidate } from "../../_ops/invalidate";

/**
 * Worker tabs share one cached profile: a save puts the returned worker (with its new version) in the cache, so the
 * next save from any tab sends the right If-Match, then refreshes the lists and the capacity view.
 */
export function useWorkerCache() {
  const queryClient = useQueryClient();
  const invalidate = useOpsInvalidate();
  const saved = useCallback(
    (worker: Worker) => {
      queryClient.setQueryData(adminKeys.worker(worker.id), worker);
      invalidate(["admin", "workers", "list"], ["admin", "workers", "leaves", worker.id]);
    },
    [queryClient, invalidate],
  );
  /** After 409 STALE_VERSION: the latest profile from the API (also refreshes the cache). */
  const reload = useCallback(
    (id: number) => queryClient.fetchQuery({ queryKey: adminKeys.worker(id), queryFn: () => fetchWorker(id), staleTime: 0 }),
    [queryClient],
  );
  /** The cached profile's version (the one the next write must send). */
  const version = useCallback(
    (worker: Worker) => queryClient.getQueryData<Worker>(adminKeys.worker(worker.id))?.version ?? worker.version,
    [queryClient],
  );
  return { saved, reload, version };
}
