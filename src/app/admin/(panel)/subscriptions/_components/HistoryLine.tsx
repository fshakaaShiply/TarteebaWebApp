"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { isolate } from "@/lib/admin/format";
import { HISTORY_LABELS, historyFacts, type HistoryValue, type LabelGroup } from "@/lib/admin/subscriptions/history";
import type { SubscriptionEvent, SubscriptionPeriod } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { Ltr } from "./kit";

/** Dates listed in full before "+N more". */
const MAX_DATES = 6;

/**
 * The detail line of one history row (lib/admin/subscriptions/history): each fact labelled in the UI language, workers
 * named from the row (`workers`, P4-260, isolated so a Latin name keeps its period in Arabic), slots by their times,
 * periods by number, dates and instants in Dubai time, money as AED. A fact whose worker, slot or period cannot be
 * named is left out rather than shown as an id.
 */
export function HistoryLine({ event, periods }: { event: SubscriptionEvent; periods: readonly SubscriptionPeriod[] }) {
  const t = useTranslations("admin.subscriptions.history");
  const text = useSubscriptionText();
  const facts = historyFacts(event.type, event.payload);
  if (facts.length === 0) return null;

  const names = new Map((event.workers ?? []).map((w) => [w.id, w.name]));
  const slots = new Map((event.slots ?? []).map((s) => [s.id, s]));
  const sequences = new Map(periods.map((p) => [p.id, p.sequence]));
  const worker = (id: number) => isolate(names.get(id) ?? t("workerNo", { id }));
  const slotTimes = (id: number) => {
    const slot = slots.get(id);
    return slot ? text.slot(slot) : null;
  };
  const change = (from: string, to: string) => t("change", { from, to });
  const date = (iso: string) => text.dateShort(iso);
  const label = (group: LabelGroup, value: string): string => {
    if (group === "status") return text.status(value);
    if (group === "cancelReason") return text.reason(value);
    if (group === "day") return text.day(value);
    if ((HISTORY_LABELS[group] as readonly string[]).includes(value)) return t(`values.${group}.${value}` as never);
    return group === "failure" ? t("values.failure.generic") : value;
  };

  const render = (value: HistoryValue): ReactNode => {
    switch (value.kind) {
      case "date":
        return date(value.date);
      case "dates": {
        const shown = value.dates.slice(0, MAX_DATES).map(date);
        const rest = value.dates.length - shown.length;
        return rest > 0 ? `${text.list(shown)} ${t("more", { count: rest })}` : text.list(shown);
      }
      case "range":
        if (value.from === value.to) return date(value.from);
        return value.days ? t("rangeDays", { from: date(value.from), to: date(value.to), days: value.days }) : t("range", { from: date(value.from), to: date(value.to) });
      case "dateChange":
        return change(date(value.from), date(value.to));
      case "moves":
        return text.list(value.moves.map((m) => change(date(m.from), date(m.to))));
      case "instant":
        return text.dateTime(value.at);
      case "money":
        return <span className="font-latin">{text.moneyFixed(value.fils)}</span>;
      case "number":
        return <span className="font-latin">{value.value}</span>;
      case "ratio":
        return t("ratio", { value: value.value, of: value.of });
      case "attempt":
        return value.scheduled === null ? <span className="font-latin">{value.no}</span> : t(value.scheduled ? "attemptScheduled" : "attemptAsked", { n: value.no });
      case "workers":
        return text.list(value.ids.map(worker));
      case "workerChange":
        return change(value.from ? worker(value.from) : t("nobody"), value.to ? worker(value.to) : t("nobody"));
      case "label":
        return label(value.group, value.value);
      case "labelChange":
        return change(label(value.group, value.from), label(value.group, value.to));
      case "weekdaysChange":
        return change(text.weekdays(value.from) || "—", text.weekdays(value.to) || "—");
      case "slot": {
        const times = slotTimes(value.id);
        return times ? <Ltr>{times}</Ltr> : null;
      }
      case "slotChange": {
        const from = slotTimes(value.from);
        const to = slotTimes(value.to);
        return from && to ? change(isolate(from, "ltr"), isolate(to, "ltr")) : null;
      }
      case "period": {
        const n = sequences.get(value.id);
        return n === undefined ? null : <span className="font-latin">{n}</span>;
      }
      case "conflict":
        return text.conflictWithReason(value.code, value.reason);
      case "quote":
        return `“${value.text}”`;
      case "ltr":
        return <Ltr>{value.text}</Ltr>;
      case "flag":
        return "";
    }
  };

  const parts = facts
    .map((f) => ({ fact: f, value: render(f.value) }))
    .filter(({ value }) => value !== null);
  if (parts.length === 0) return null;

  return (
    <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-ink-600">
      {parts.map(({ fact, value }) => (
        <span key={fact.key}>
          {fact.bare ? (
            <span className="font-medium text-ink-900">{value}</span>
          ) : (
            <>
              {t(`facts.${fact.key}`)}
              {value !== "" && (
                <>
                  {": "}
                  <span className="text-ink-900">{value}</span>
                </>
              )}
            </>
          )}
        </span>
      ))}
    </p>
  );
}
