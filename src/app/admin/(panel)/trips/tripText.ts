"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { StatusTone } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { adminKeys } from "@/lib/admin/keys";
import type { DriverReportStatus, Round, RoundStatus, RoundWarning, StopStatus, Translatable } from "@/lib/admin/types";
import { useOpsText } from "../_ops/opsText";

/* Copy, colours (spec §27.5) and cache updates for the A06 trip planner and the driver reports inbox. */

export const roundTone: Record<RoundStatus, StatusTone> = {
  planned: "confirmed",
  departed: "progress",
  in_progress: "progress",
  completed: "success",
  cancelled: "danger",
};

export const stopTone: Record<StopStatus, StatusTone> = {
  pending: "neutral",
  arrived: "progress",
  dropped_off: "success",
  picked_up: "success",
  failed: "danger",
};

export const reportTone: Record<DriverReportStatus, StatusTone> = { open: "pending", acknowledged: "confirmed", resolved: "success" };

/** Our labels (admin.trips.enums.<group>.<value>), else the API's label in the UI language, else the raw value. */
export function useTripText() {
  const t = useTranslations("admin.trips.enums");
  const ops = useOpsText();
  return useMemo(() => {
    const label = (group: string, value: string, apiLabel?: Translatable | null) => {
      const key = `${group}.${value}`;
      if (t.has(key)) return t(key);
      return apiLabel ? ops.name(apiLabel) : value;
    };
    return {
      kind: (v: string, api?: Translatable | null) => label("kind", v, api),
      roundStatus: (v: string, api?: Translatable | null) => label("roundStatus", v, api),
      stopStatus: (v: string, api?: Translatable | null) => label("stopStatus", v, api),
      reportType: (v: string, api?: Translatable | null) => label("reportType", v, api),
      reportStatus: (v: string, api?: Translatable | null) => label("reportStatus", v, api),
      /** A warning's message: the API words it with its figures (stop, times, minutes) in both languages. */
      warning: (w: RoundWarning) => ops.name(w.message),
    };
  }, [t, ops]);
}

/**
 * After a round change: the answered round replaces the cached one at once (every round list of the planner), then the
 * lists, the schedule (vans on the cards) and the capacity seats refresh.
 */
export function useRoundSaved() {
  const queryClient = useQueryClient();
  return useCallback(
    (round?: Round | null) => {
      if (round) {
        queryClient.setQueriesData<Round[]>({ queryKey: adminKeys.rounds() }, (old) =>
          Array.isArray(old) ? old.map((r) => (r.id === round.id ? round : r)) : old,
        );
      }
      void queryClient.invalidateQueries({ queryKey: adminKeys.rounds() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.schedule() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.capacity() });
    },
    [queryClient],
  );
}

export const errorCodeOf = (error: unknown) => (error instanceof AdminApiError ? error.code : null);
