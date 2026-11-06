"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, EmptyState, ErrorState, LoadingBlock, StatusBadge, TextField } from "@/components/admin";
import { addDaysIso, businessToday, isIsoDate } from "@/lib/admin/format";
import { useAdminSession } from "@/lib/admin/session";
import { conflictReasonOf, visitActions } from "@/lib/admin/subscriptions/actions";
import { fetchSubscriptionVisits } from "@/lib/admin/subscriptions/endpoints";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import { occurrenceTone, tone } from "@/lib/admin/subscriptions/status";
import type { SubscriptionDetail, SubscriptionOccurrence } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { Ltr } from "./kit";
import type { DialogRequest } from "./DialogHost";
import { WorkerNames } from "./DetailParts";
import { decisionFromOccurrence } from "./VisitDecisionDialogs";

/** The visits list covers 31 days at a time (the API serves at most 92). */
const WINDOW_DAYS = 30;

/** States of a visit that will still take place: only these wait for a worker to be named. */
const TO_SERVE: readonly string[] = ["planned", "held", "materialized"];

/** Rows grouped by the period they belong to, in date order; replaced dates (the old pattern) are not shown. */
export function groupByPeriod(rows: readonly SubscriptionOccurrence[]): { sequence: number | null; rows: SubscriptionOccurrence[] }[] {
  const groups = new Map<number | null, SubscriptionOccurrence[]>();
  for (const row of rows) {
    if (row.state === "replaced") continue;
    const list = groups.get(row.period_sequence) ?? [];
    list.push(row);
    groups.set(row.period_sequence, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER))
    .map(([sequence, list]) => ({ sequence, rows: list.sort((x, y) => x.scheduled_date.localeCompare(y.scheduled_date) || x.id - y.id) }));
}

/**
 * The Visits tab (spec §17 A08 "recurring series"): the series' visits by served date, grouped by period, each with its
 * state, workers and marks (a moved visit, a conflict or a blackout day, a customer's request waiting). A row has two
 * separate buttons, "Edit this visit" and "Edit following visits" (the weekly pattern from it on), plus skip, undo skip,
 * the company's miss and the decision on a customer's request, each only where the API says the visit can take it
 * (`editable`) and the user may write.
 */
export function VisitsTab({ subscription, open }: { subscription: SubscriptionDetail; open: (request: DialogRequest) => void }) {
  const t = useTranslations("admin.subscriptions.visits");
  const text = useSubscriptionText();
  const { can } = useAdminSession();
  const [from, setFrom] = useState(() => businessToday());
  const valid = isIsoDate(from);
  const to = valid ? addDaysIso(from, WINDOW_DAYS) : from;
  const query = useQuery({
    queryKey: subscriptionKeys.visits(subscription.id, from, to),
    queryFn: () => fetchSubscriptionVisits(subscription.id, { from, to, perPage: 100 }),
    enabled: valid,
    retry: false,
  });
  const groups = groupByPeriod(query.data?.data ?? []);
  const liveOut = subscription.type === "live_out";

  return (
    <section aria-label={t("title")} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setFrom((f) => addDaysIso(f, -(WINDOW_DAYS + 1)))}>
          {t("earlier")}
        </Button>
        <TextField type="date" label={t("from")} value={from} dir="ltr" className="font-latin text-start" onChange={(e) => setFrom(e.target.value)} containerClassName="w-44" />
        <Button variant="outline" size="sm" onClick={() => setFrom((f) => addDaysIso(f, WINDOW_DAYS + 1))}>
          {t("later")}
        </Button>
        <p className="text-sm text-ink-600">{valid ? t("range", { from: text.dateShort(from), to: text.dateShort(to) }) : t("rangeInvalid")}</p>
      </div>

      {query.isPending && valid ? (
        <LoadingBlock lines={6} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState title={t("empty")} body={t("emptyBody")} />
      ) : (
        groups.map((g) => (
          <div key={g.sequence ?? "none"} className="flex flex-col gap-1">
            <h3 className="text-base font-bold text-ink-900">{g.sequence === null ? t("noPeriod") : t("period", { n: g.sequence })}</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" style={{ minWidth: 760 }}>
                <caption className="sr-only">{g.sequence === null ? t("noPeriod") : t("period", { n: g.sequence })}</caption>
                <thead>
                  <tr className="text-ink-600">
                    <th scope="col" className="px-2 py-2 text-start font-medium">{t("date")}</th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">{t("slot")}</th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">{t("state")}</th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">{t("workers")}</th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">{t("notes")}</th>
                    <th scope="col" className="px-2 py-2 text-start font-medium">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((row) => (
                    <VisitRow key={row.id} row={row} subscription={subscription} liveOut={liveOut} open={open} can={can} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function VisitRow({
  row,
  subscription,
  liveOut,
  open,
  can,
}: {
  row: SubscriptionOccurrence;
  subscription: SubscriptionDetail;
  liveOut: boolean;
  open: (request: DialogRequest) => void;
  can: (permission: string) => boolean;
}) {
  const t = useTranslations("admin.subscriptions.visits");
  const text = useSubscriptionText();
  const actions = visitActions(row, subscription, can);
  const decision = decisionFromOccurrence(row);
  const blackout = row.conflict?.code === "BLACKOUT";
  const conflict = row.conflict !== null;
  return (
    <tr
      className={clsx("border-t border-line align-top", blackout && "bg-apricot-100", conflict && !blackout && "bg-danger-50")}
      data-conflict={conflict ? (blackout ? "blackout" : "conflict") : undefined}
    >
      <td className="px-2 py-2.5 whitespace-nowrap">
        <Ltr>{text.dateShort(row.scheduled_date)}</Ltr>
      </td>
      <td className="px-2 py-2.5 whitespace-nowrap">
        <Ltr>{text.slot(row.slot)}</Ltr>
      </td>
      <td className="px-2 py-2.5">
        <StatusBadge tone={tone(occurrenceTone, row.state)}>{row.state_label || text.occurrence(row.state)}</StatusBadge>
      </td>
      <td className="px-2 py-2.5">
        {/* A skipped, frozen, credited or cancelled visit will not take place: no worker is still to be named. */}
        {row.workers.length > 0 ? (
          <WorkerNames workers={row.workers} />
        ) : TO_SERVE.includes(row.state) ? (
          <span className="text-ink-600">{t("noWorker")}</span>
        ) : (
          <span className="text-ink-600">—</span>
        )}
      </td>
      <td className="px-2 py-2.5">
        <div className="flex flex-col gap-0.5">
          {row.visit?.is_exception && (
            <span className="text-ink-600">{row.visit.original_date ? t("movedFrom", { date: text.dateShort(row.visit.original_date) }) : t("moved")}</span>
          )}
          {row.origin !== "pattern" && <span className="text-ink-600">{text.origin(row.origin)}</span>}
          {conflict && (
            <span className={clsx("font-medium", blackout ? "text-warning-700" : "text-danger-700")}>
              {blackout ? t("blackout") : `${t("conflict")} · ${text.conflictWithReason(row.conflict?.code ?? "", conflictReasonOf(row))}`}
            </span>
          )}
          {row.reschedule_request && (
            <span className="font-medium text-warning-700">
              {t("requestWaiting", { date: text.dateShort(row.reschedule_request.date), slot: text.slot(row.reschedule_request.slot) })}
            </span>
          )}
          {row.booking && (
            <span className="text-ink-600">
              {can("bookings.view") ? (
                <Link href={`/admin/bookings/${row.booking.id}`} className="font-medium">
                  <Ltr>{row.booking.reference}</Ltr>
                </Link>
              ) : (
                <Ltr>{row.booking.reference}</Ltr>
              )}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {actions.has("move") && (
            <Button variant="secondary" size="sm" onClick={() => open({ kind: "move", visit: row })}>
              {t("editThis")}
            </Button>
          )}
          {actions.has("editFollowing") && (
            <Button variant="secondary" size="sm" onClick={() => open({ kind: "following", visit: row })}>
              {liveOut ? t("editFollowingDays") : t("editFollowing")}
            </Button>
          )}
          {actions.has("decide") && decision && (
            <Button size="sm" onClick={() => open({ kind: "decide", request: decision })}>
              {t("decide")}
            </Button>
          )}
          {actions.has("skip") && (
            <Button variant="outline" size="sm" onClick={() => open({ kind: "skip", visit: row })}>
              {t("skip")}
            </Button>
          )}
          {actions.has("undoSkip") && (
            <Button variant="outline" size="sm" onClick={() => open({ kind: "undoSkip", visit: row })}>
              {t("undoSkip")}
            </Button>
          )}
          {actions.has("cancelByCompany") && (
            <Button variant="outline" size="sm" className="text-danger-700" onClick={() => open({ kind: "companyMiss", visit: row })}>
              {t("companyMiss")}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
