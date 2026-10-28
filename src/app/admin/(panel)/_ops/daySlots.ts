"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSchedule } from "@/lib/admin/endpoints";
import { isIsoDate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { scheduleKey } from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import type { ScheduleBoard, ScheduleGrid } from "@/lib/admin/types";

const dayGrid = (board: ScheduleBoard): ScheduleGrid | null => (board.view === "month" ? null : board);

/**
 * The whole A04 day board of one date and zone (GET /admin/schedule?view=day, schedule.view), unfiltered: its rows,
 * cards and unassigned lane are the date's visits (the trip planner's "add a stop" lists them). It shares its cache
 * entry with the schedule's own unfiltered day view. Slot pickers read the slot pick-list instead (`useSlotPickList`).
 */
export function useDayVisits(date: string, zoneId: number | null) {
  const allowed = useAdminSession().can("schedule.view");
  const query = { view: "day" as const, date, zoneId };
  return useQuery({
    queryKey: adminKeys.scheduleBoard(scheduleKey(query)),
    queryFn: () => fetchSchedule(query),
    enabled: allowed && isIsoDate(date),
    staleTime: 60_000,
    select: dayGrid,
  });
}
