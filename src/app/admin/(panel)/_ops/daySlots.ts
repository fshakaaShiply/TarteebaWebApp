"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSchedule } from "@/lib/admin/endpoints";
import { isIsoDate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { scheduleKey } from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import type { ScheduleBoard, ScheduleGrid, ScheduleSlot } from "@/lib/admin/types";

const dayGrid = (board: ScheduleBoard): ScheduleGrid | null => (board.view === "month" ? null : board);

/**
 * The A04 day board of one date and zone (GET /admin/schedule?view=day, schedule.view), unfiltered: its slot columns
 * are the active slot templates (the templates list itself needs catalog.manage, which operations roles do not hold),
 * and its cards are the date's visits. It shares its cache entry with the schedule's own unfiltered day view.
 */
function useDayBoard<T>(date: string, zoneId: number | null, select: (board: ScheduleGrid | null) => T) {
  const allowed = useAdminSession().can("schedule.view");
  const query = { view: "day" as const, date, zoneId };
  return useQuery({
    queryKey: adminKeys.scheduleBoard(scheduleKey(query)),
    queryFn: () => fetchSchedule(query),
    enabled: allowed && isIsoDate(date),
    staleTime: 60_000,
    select: (board) => select(dayGrid(board)),
  });
}

const slotsOf = (board: ScheduleGrid | null): ScheduleSlot[] => board?.slots ?? [];
const boardOf = (board: ScheduleGrid | null) => board;

/** The active slot templates (id, code, name, times) for a date. */
export function useDaySlots(date: string, zoneId: number | null) {
  return useDayBoard(date, zoneId, slotsOf);
}

/** The whole day board (rows, cards and the unassigned lane) for a date. */
export function useDayVisits(date: string, zoneId: number | null) {
  return useDayBoard(date, zoneId, boardOf);
}
