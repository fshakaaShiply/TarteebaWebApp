"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button, Card, ErrorState, FilterBar, Notice, PageHeader, Skeleton, TextField } from "@/components/admin";
import { fetchFinanceSummary } from "@/lib/admin/endpoints";
import { useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { SUMMARY_FILTERS } from "@/lib/admin/finance/filters";
import { summaryFieldErrors, summaryPeriod } from "@/lib/admin/finance/summary";
import { businessToday } from "@/lib/admin/format";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { DOCUMENTS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { FinanceSummary } from "@/lib/admin/types";
import { useAdminZone } from "@/lib/admin/zone";
import { RequirePermission } from "../../_components/RequirePermission";
import { PICK_LIST_PERMISSIONS } from "../_ops/options";
import { useFinanceText } from "./_components/financeText";
import { useUrlFilters } from "./_components/useUrlFilters";

/** How long the date fields stay still before the API is asked for that period. */
const SUMMARY_PERIOD_DEBOUNCE_MS = 400;

/**
 * A09 landing page (spec §17 A09; design AdminFinance.dc.html header cards; payments.view or invoices.manage): what was
 * collected (VAT included), the VAT of the tax documents issued (net of credit notes), what the provider refunded, and
 * the reconciliation differences ("—" until reconciliation exists, Phase 5), for a period of local dates (month to date
 * by default, at most 366 days: the API says so in its own words) and the top bar's zone. The period lives in the URL.
 * Money always has two decimals (P2-35). No timed refresh (StaffIdleTimeout): on focus and with Refresh.
 */
export function FinanceSummaryScreen() {
  return (
    <RequirePermission anyOf={DOCUMENTS_READ}>
      <SummaryContent />
    </RequirePermission>
  );
}

function SummaryContent() {
  const t = useTranslations("admin.finance.summary");
  const text = useFinanceText();
  const describe = useAdminErrorMessage();
  const serverMessage = useServerFieldMessage();
  const { canAny } = useAdminSession();
  const shared = useAdminZone();
  // The top bar shows its zone picker only to those who read the zone list; for anyone else a zone remembered in this
  // browser would narrow the figures out of sight, so they always see every zone.
  const zoneId = canAny(PICK_LIST_PERMISSIONS) ? shared.zoneId : null;
  const { filters, set, reset, filtered } = useUrlFilters(SUMMARY_FILTERS);
  // A native date field reports every keystroke of a year as a whole date (0002-10-01, 0020-10-01, 0202-10-01,
  // 2026-10-01): the fields and the URL follow at once, the API only the period the user stopped on.
  const from = useDebouncedValue(filters.from, SUMMARY_PERIOD_DEBOUNCE_MS);
  const to = useDebouncedValue(filters.to, SUMMARY_PERIOD_DEBOUNCE_MS);
  const [today] = useState(() => businessToday());

  const summary = useQuery({
    queryKey: adminKeys.financeSummary(from, to, zoneId),
    queryFn: () => fetchFinanceSummary({ from: from || undefined, to: to || undefined, zoneId }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
  const data = summary.data;
  // An end left to the default shows the period the API counted (it picks "today" in Dubai on every refetch); this
  // browser's own guess only until figures for the dates in the fields arrive.
  const counted = data && !summary.isPlaceholderData && from === filters.from && to === filters.to ? data.period : null;
  const period = summaryPeriod(filters, today);
  const fromValue = filters.from || (counted?.from ?? period.from);
  const toValue = filters.to || (counted?.to ?? period.to);
  const refused = summaryFieldErrors(summary.error);
  const fieldMessage = (message: string | undefined, fallback: string) => (message ? serverMessage(message, fallback) : undefined);
  const fromError = fieldMessage(refused?.from, t("errors.period"));
  const toError = fieldMessage(refused?.to, t("errors.period"));
  const zoneError = fieldMessage(refused?.zone_id, t("errors.zone"));

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={
          data && !summary.isPlaceholderData
            ? t("subtitle", {
                from: text.date(data.period.from),
                to: text.date(data.period.to),
                days: data.period.days,
                zone: data.zone ? text.name(data.zone.name) : t("allZones"),
              })
            : t("subtitleLoading")
        }
      />

      <Card>
        <FilterBar>
          <TextField
            type="date"
            label={t("from")}
            value={fromValue}
            onChange={(e) => set({ from: e.target.value })}
            error={fromError}
            dir="ltr"
            className="font-latin text-start"
            containerClassName="min-w-[160px]"
          />
          <TextField
            type="date"
            label={t("to")}
            value={toValue}
            onChange={(e) => set({ to: e.target.value })}
            error={toError}
            dir="ltr"
            className="font-latin text-start"
            containerClassName="min-w-[160px]"
          />
          {filtered && (
            <Button variant="ghost" onClick={reset}>
              {t("monthToDate")}
            </Button>
          )}
          <div className="ms-auto flex flex-wrap items-center gap-3 self-center">
            {data && !summary.isPlaceholderData && <p className="text-xs text-ink-600">{t("generated", { time: text.dateTime(data.generated_at) })}</p>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void summary.refetch()}
              loading={summary.isFetching}
              icon={<RefreshCw aria-hidden className="size-4" />}
            >
              {t("refresh")}
            </Button>
          </div>
        </FilterBar>
        <p className="text-xs text-ink-600">{t("periodHint")}</p>
      </Card>

      {refused ? (
        // The API refused the period (its words are on the date field concerned) or the zone (its words here).
        <Notice tone="warning" title={t("refusedTitle")}>
          {(fromError || toError) && <p>{t("refusedPeriod")}</p>}
          {zoneError && <p>{zoneError}</p>}
          {refused.other.map((message, i) => (
            <p key={i}>{serverMessage(message, describe(summary.error))}</p>
          ))}
          {!fromError && !toError && !zoneError && refused.other.length === 0 && <p>{describe(summary.error)}</p>}
        </Notice>
      ) : data ? (
        <>
          {summary.isError && (
            <Notice
              tone="danger"
              title={t("refreshFailed")}
              action={
                <Button variant="secondary" size="sm" className="self-start" onClick={() => void summary.refetch()} loading={summary.isFetching}>
                  {t("refreshRetry")}
                </Button>
              }
            >
              {describe(summary.error)}
            </Notice>
          )}
          <SummaryCards summary={data} stale={summary.isPlaceholderData} />
        </>
      ) : summary.isError ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <SummarySkeleton />
      )}
    </>
  );
}

function SummarySkeleton() {
  const t = useTranslations("admin.ui");
  return (
    <div role="status" aria-live="polite" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <span className="sr-only">{t("loading")}</span>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-32 rounded-lg" />
      ))}
    </div>
  );
}

/** One header card of the design: the label, the figure, and what it is made of. */
function KpiCard({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail: ReactNode; tone?: "neutral" | "danger" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-surface p-5 shadow-card">
      <span className="text-sm font-medium text-ink-600">{label}</span>
      <span className={clsx("font-latin text-2xl font-bold break-words", tone === "danger" ? "text-danger-700" : "text-ink-900")}>{value}</span>
      <span className="flex flex-col gap-0.5 text-sm text-ink-600">{detail}</span>
    </div>
  );
}

function SummaryCards({ summary, stale }: { summary: FinanceSummary; stale: boolean }) {
  const t = useTranslations("admin.finance.summary.cards");
  const text = useFinanceText();
  const { collected, vat, refunds, reconciliation_differences: recon } = summary.cards;
  const differences = recon.available && recon.count !== null ? recon.count : null;

  return (
    <div className="flex flex-col gap-3">
      {/* While another period loads, the last figures stay, dimmed and marked busy. */}
      <div aria-busy={stale || undefined} className={clsx("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", stale && "opacity-60")}>
        <KpiCard label={text.name(collected.label)} value={text.money(collected.amount_fils)} detail={<span>{t("collectedDetail", { count: collected.payments })}</span>} />
        <KpiCard
          label={text.name(vat.label)}
          value={text.money(vat.amount_fils)}
          detail={
            <>
              <span>{t("vatNet", { amount: text.money(vat.net_fils) })}</span>
              <span>{t("vatCredited", { amount: text.money(vat.credited_fils), count: vat.credit_notes })}</span>
              <span>{t("vatInvoices", { amount: text.money(vat.invoiced_fils), count: vat.invoices })}</span>
            </>
          }
        />
        <KpiCard label={text.name(refunds.label)} value={text.money(refunds.amount_fils)} detail={<span>{t("refundsDetail", { count: refunds.refunds })}</span>} />
        <KpiCard
          label={text.name(recon.label)}
          value={differences ?? "—"}
          tone={differences !== null && differences > 0 ? "danger" : "neutral"}
          detail={<span>{differences === null ? t("reconciliationUnavailable") : t("reconciliationDetail")}</span>}
        />
      </div>
      <p className="text-xs text-ink-600">{t("basisNote")}</p>
    </div>
  );
}
