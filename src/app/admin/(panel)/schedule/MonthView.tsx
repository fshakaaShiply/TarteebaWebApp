"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import { businessToday, dayOfMonth } from "@/lib/admin/format";
import { calendarWeeks } from "@/lib/admin/schedule/board";
import type { ScheduleMonth, ScheduleMonthCapacity } from "@/lib/admin/types";
import { useSlotPickList } from "../_ops/options";
import { useOpsText } from "../_ops/opsText";

/** Monday first, as the API's weeks (ScheduleBoard::range). */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/**
 * A04 month view (spec §17 A04): per day the bookings and visits on the board, the visits still missing cleaners, and
 * per slot how much of the capacity is booked. A day opens in the day view.
 */
export function MonthView({ board, onOpenDay }: { board: ScheduleMonth; onOpenDay: (date: string) => void }) {
  const t = useTranslations("admin.schedule.month");
  const text = useOpsText();
  // Slot names from the slot pick-list (the month answer names a slot by its code only).
  const slots = useSlotPickList();
  const today = businessToday();
  const slotName = (c: ScheduleMonthCapacity) => {
    const slot = slots.data?.find((s) => s.id === c.slot_template_id);
    return slot ? text.name(slot.name) : c.code;
  };
  const weeks = calendarWeeks(board.days);

  return (
    <div className="overflow-x-auto rounded-lg bg-surface shadow-card">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="border-b border-line">
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="px-2 py-2.5 text-start font-bold text-ink-900">
                {text.weekdayShort(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i} className="border-b border-line last:border-b-0">
              {week.map((day, j) =>
                day === null ? (
                  <td key={`pad-${j}`} className="bg-neutral-100/50" />
                ) : (
                  <td key={day.date} className={clsx("px-2 py-2 align-top", day.date === today && "bg-petrol-50/60")}>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenDay(day.date)}
                        aria-label={t("openDay", { date: text.date(day.date) })}
                        className="touch-target self-start rounded-sm px-1 font-latin text-base font-bold text-petrol-700 hover:bg-petrol-50"
                      >
                        {dayOfMonth(day.date)}
                      </button>
                      <span className="text-xs text-ink-900">{t("bookings", { count: day.bookings })}</span>
                      <span className="text-xs text-ink-600">{t("visits", { count: day.visits })}</span>
                      {day.unassigned > 0 && (
                        <span className="self-start rounded-sm bg-apricot-100 px-1.5 text-xs font-medium text-warning-700">
                          {t("unassigned", { count: day.unassigned })}
                        </span>
                      )}
                      <ul className="mt-1 flex flex-col gap-1">
                        {day.capacity.map((c) => (
                          <li key={c.slot_template_id} className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-ink-600">
                              {c.used_percent === null
                                ? t("slotClosed", { name: slotName(c) })
                                : t("slotUsed", { name: slotName(c), percent: c.used_percent })}
                            </span>
                            {c.used_percent !== null && (
                              <span aria-hidden className="h-1.5 overflow-hidden rounded-pill bg-neutral-100">
                                <span
                                  className={clsx(
                                    "block h-full rounded-pill",
                                    c.used_percent >= 100 ? "bg-danger-700" : c.used_percent >= 80 ? "bg-warning-700" : "bg-petrol-700",
                                  )}
                                  style={{ width: `${Math.min(100, Math.max(0, c.used_percent))}%` }}
                                />
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
