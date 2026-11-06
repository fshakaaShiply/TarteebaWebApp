"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ErrorState, IconButton, LoadingBlock } from "@/components/admin";
import { businessToday, formatMonth } from "@/lib/admin/format";
import { fetchSubscriptionCalendar } from "@/lib/admin/subscriptions/endpoints";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { CalendarDay, SubscriptionDetail } from "@/lib/admin/subscriptions/types";
import { daysInMonth, monthOf, shiftMonth, useSubscriptionText, weekdayOf } from "@/lib/admin/subscriptions/text";
import { Ltr } from "./kit";

/** Days a staff member can change (the API refuses the rest: DAY_NOT_EDITABLE for rest, dropped and past days). */
const EDITABLE_TYPES = ["service", "absence", "public_holiday"];

const cellTone: Record<string, string> = {
  service: "border-line bg-surface text-ink-900",
  rest: "border-transparent bg-neutral-100 text-ink-600",
  public_holiday: "border-transparent bg-info-50 text-info-700",
  absence: "border-transparent bg-apricot-100 text-warning-700",
  dropped: "border-transparent bg-neutral-100 text-ink-600 line-through",
};

/**
 * The Live-out calendar (design AdminSubscriptions): W1's own month grid, Sunday first in both languages (the schedule's
 * MonthView starts on Monday and has no week-start option), one cell per day with its type: service, weekly rest,
 * public holiday, absence ("Absent: {primary} · Substitute: {name}") or dropped, the credited and conflict marks, and a
 * footer with the month's counts. Pick a day to edit that day only, the following days, or to cancel with the financial
 * preview; whether a day can change is the API's answer.
 */
export function LiveOutCalendar({
  subscription,
  canManage,
  onEditDay,
  onCancel,
}: {
  subscription: SubscriptionDetail;
  canManage: boolean;
  onEditDay: (day: CalendarDay, scope: "this" | "following") => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("admin.subscriptions.calendar");
  const text = useSubscriptionText();
  const today = businessToday();
  const [month, setMonth] = useState(() => monthOf(today < subscription.start_date ? subscription.start_date : today > subscription.term_end_date ? subscription.term_end_date : today));
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: subscriptionKeys.calendar(subscription.id, month),
    queryFn: () => fetchSubscriptionCalendar(subscription.id, month),
    retry: false,
  });
  const calendar = query.data;
  const byDate = new Map((calendar?.days ?? []).map((d) => [d.date, d]));
  const first = `${month}-01`;
  const blanks = weekdayOf(first);
  const total = daysInMonth(month);
  const primary = subscription.workers.primary?.name ?? t("noPrimary");
  const day = selected ? byDate.get(selected) : undefined;
  const canEdit = canManage && day !== undefined && EDITABLE_TYPES.includes(day.type);

  const describeDay = (d: CalendarDay): string => {
    switch (d.type) {
      case "absence":
        return d.substitute ? t("absentWith", { primary: d.worker?.name ?? primary, substitute: d.substitute.name }) : t("absentWithout", { primary: d.worker?.name ?? primary });
      case "service":
        return d.substitute ? t("serviceWith", { substitute: d.substitute.name }) : t("service");
      default:
        return text.day(d.type);
    }
  };

  return (
    <section aria-label={t("title")} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h3 className="text-base font-bold text-ink-900">
            <Ltr>{subscription.reference}</Ltr> · {text.type("live_out")} · {formatMonth(first, text.locale)}
          </h3>
          <p className="text-sm text-ink-600">
            {t("workers", { primary, backup: subscription.workers.backup?.name ?? t("noBackup") })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label={t("previous")} onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft aria-hidden className="size-5 rtl:-scale-x-100" /></IconButton>
          <IconButton label={t("next")} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight aria-hidden className="size-5 rtl:-scale-x-100" /></IconButton>
        </div>
      </div>

      {query.isPending ? (
        <LoadingBlock lines={6} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="grid min-w-[640px] grid-cols-7 gap-1.5" role="group" aria-label={formatMonth(first, text.locale)}>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <div key={n} className="px-1 text-center text-sm font-medium text-ink-600">
                  {text.weekday(n, "short")}
                </div>
              ))}
              {Array.from({ length: blanks }, (_, i) => (
                <div key={`b${i}`} aria-hidden />
              ))}
              {Array.from({ length: total }, (_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, "0")}`;
                const d = byDate.get(date);
                const isSelected = selected === date;
                if (!d) {
                  return (
                    <div key={date} className="min-h-16 rounded-md border border-dashed border-line p-1.5 text-xs text-ink-600">
                      <span className="font-latin">{i + 1}</span>
                    </div>
                  );
                }
                return (
                  <button
                    key={date}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${text.date(date)}: ${describeDay(d)}`}
                    onClick={() => setSelected(isSelected ? null : date)}
                    className={clsx(
                      "touch-target flex min-h-16 flex-col items-start gap-0.5 rounded-md border p-1.5 text-start text-xs transition-colors",
                      cellTone[d.type] ?? cellTone.service,
                      isSelected && "ring-2 ring-petrol-700",
                      d.flags.includes("conflict") && "outline-2 outline-danger-700",
                    )}
                  >
                    <span className="font-latin text-sm font-bold">{i + 1}</span>
                    <span>{describeDay(d)}</span>
                    {d.credited && <span className="text-success-700">{t("credited")}</span>}
                    {d.flags.includes("conflict") && <span className="font-medium text-danger-700">{t("conflict")}</span>}
                    {d.flags.includes("uncovered") && <span className="font-medium text-danger-700">{t("uncovered")}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={!canEdit} onClick={() => day && onEditDay(day, "this")}>
                {t("editThis")}
              </Button>
              <Button variant="secondary" disabled={!canEdit} onClick={() => day && onEditDay(day, "following")}>
                {t("editFollowing")}
              </Button>
              {onCancel && subscription.actions.cancel && (
                <Button variant="outline" className="text-danger-700" onClick={onCancel}>
                  {t("cancel")}
                </Button>
              )}
              {!selected && <span className="text-sm text-ink-600">{t("pickDay")}</span>}
              {selected && !canEdit && <span className="text-sm text-ink-600">{t("notEditable")}</span>}
            </div>
          )}

          {calendar && (
            <p className="text-sm text-ink-600" data-testid="calendar-footer">
              {t("footer", {
                service: calendar.summary.service,
                holidays: calendar.summary.public_holiday,
                rest: calendar.summary.rest,
                absences: calendar.summary.absence,
                dropped: calendar.summary.dropped,
                credited: calendar.summary.credited,
              })}{" "}
              {(subscription.pattern.rest_weekdays ?? []).length > 0 && t("restDays", { days: text.weekdays(subscription.pattern.rest_weekdays, "long") })} {t("primaryBooked")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
