import { addDaysIso, businessToday, daysBetween, isIsoDate } from "../format";

/*
 * The period of a cleaner's performance figures (GET /admin/workers/{id}/stats?from=&to=, workforce §4.1, §5.5): the
 * presets of the design (this month, last month, last 3 months) and a custom range. The API refuses a period of more than
 * 366 days or one that ends after today (422 PERIOD_INVALID); the screen checks first and says why.
 */

export const STATS_PRESETS = ["thisMonth", "lastMonth", "last3Months", "custom"] as const;
export type StatsPreset = (typeof STATS_PRESETS)[number];
export const MAX_STATS_DAYS = 366;

export type Range = { from: string; to: string };

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** "2026-11-19" gives "2026-10-01": the first day of the month before. */
function firstOfPreviousMonth(date: string): string {
  return firstOfMonth(addDaysIso(firstOfMonth(date), -1));
}

/** The range of a preset on `today` (a business date); null for "custom", which the person types. */
export function presetRange(preset: StatsPreset, today: string = businessToday()): Range | null {
  switch (preset) {
    case "thisMonth":
      return { from: firstOfMonth(today), to: today };
    case "lastMonth": {
      const from = firstOfPreviousMonth(today);
      return { from, to: addDaysIso(firstOfMonth(today), -1) };
    }
    case "last3Months":
      return { from: firstOfPreviousMonth(`${firstOfPreviousMonth(today)}`), to: today };
    default:
      return null;
  }
}

export type RangeProblem = "invalid" | "order" | "future" | "tooLong";

export function rangeProblem(range: Range, today: string = businessToday()): RangeProblem | null {
  if (!isIsoDate(range.from) || !isIsoDate(range.to)) return "invalid";
  if (range.to < range.from) return "order";
  if (range.to > today) return "future";
  if (daysBetween(range.from, range.to) + 1 > MAX_STATS_DAYS) return "tooLong";
  return null;
}

/** The share of a ratio as a whole percent for display ("42"), "—" when there is nothing to divide. Integer math. */
export function percentText(part: number, whole: number): string {
  return whole <= 0 ? "—" : String(Math.round((part * 100) / whole));
}
