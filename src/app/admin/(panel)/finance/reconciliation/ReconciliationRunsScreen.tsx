"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileUp, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Card, Checkbox, DataTable, EmptyState, FilterBar, Notice, PageHeader, Select, type Column } from "@/components/admin";
import { ExportButton } from "@/components/admin/ExportButton";
import { exportFilters } from "@/lib/admin/exports";
import { fetchReconciliationRuns } from "@/lib/admin/finance/endpoints";
import { dateRangeValid, filterKey } from "@/lib/admin/finance/filters";
import { ITEM_STATUSES, RUN_FILTERS, RUN_POLL_MS, RUN_STATUSES, anyRunInFlight, type RunRow, type RunStatus } from "@/lib/admin/finance/reconciliation";
import { useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { adminKeys } from "@/lib/admin/keys";
import { RECONCILIATION_PATH, RECONCILIATION_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Code, DateRangeFields, Money } from "../_components/FinanceParts";
import { useFinanceText } from "../_components/financeText";
import { useUrlFilters } from "../_components/useUrlFilters";
import { FetchReportDialog, UploadSettlementDialog } from "./_components/RunDialogs";
import { RunStatusChip, useReconText } from "./_components/ReconParts";

const PER_PAGE = 25;

/**
 * A09 reconciliation runs (spec §10.7; design finance §7.1; reconciliation.run or payments.view): one run per provider and
 * report date, newest first, with the five item counts, what still needs action and the report's charges, fees and net.
 * A run that is still being read refreshes in the background every 5 seconds. Fetching a report and uploading a file
 * need reconciliation.run.
 */
export function ReconciliationRunsScreen() {
  return (
    <RequirePermission anyOf={RECONCILIATION_READ}>
      <RunsContent />
    </RequirePermission>
  );
}

function RunsContent() {
  const t = useTranslations("admin.finance.reconciliation");
  const f = useTranslations("admin.finance.filters");
  const text = useFinanceText();
  const label = useReconText();
  const { can } = useAdminSession();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(RUN_FILTERS);
  const [dialog, setDialog] = useState<"fetch" | "upload" | null>(null);
  const rangeValid = dateRangeValid(filters);
  const canRun = can("reconciliation.run");

  const query = {
    page: filters.page,
    perPage: PER_PAGE,
    from: filters.from || undefined,
    to: filters.to || undefined,
    status: filters.status || undefined,
    unresolved: filters.unresolved === "1",
  };
  const key = adminKeys.reconciliationRuns(filterKey(RUN_FILTERS, filters, {}));
  const list = useQuery({
    queryKey: key,
    queryFn: () => fetchReconciliationRuns(query),
    placeholderData: keepPreviousData,
    enabled: rangeValid,
    refetchOnWindowFocus: true,
  });
  // A run being read becomes complete without anyone reloading: a background poll while one is in flight.
  useBackgroundRefresh(key, () => fetchReconciliationRuns(query, { background: true }), {
    everyMs: RUN_POLL_MS,
    enabled: rangeValid && anyRunInFlight(list.data?.data),
  });

  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const columns: Column<RunRow>[] = [
    {
      id: "date",
      header: t("columns.date"),
      cell: (r) => (
        <span className="flex flex-col">
          <Link href={`${RECONCILIATION_PATH}/${r.id}`} className="font-bold">
            {text.date(r.report_date)}
          </Link>
          <span className="text-xs text-ink-600">
            <Code>{r.gateway}</Code>
          </span>
        </span>
      ),
    },
    {
      id: "source",
      header: t("columns.source"),
      cell: (r) => (
        <span className="flex flex-col text-sm">
          <span>{t(`source.${r.source}`)}</span>
          {r.source_file_name && (
            <Code wrap className="text-xs text-ink-600">
              {r.source_file_name}
            </Code>
          )}
        </span>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <RunStatusChip run={r} />
          {r.status === "failed" && r.failure_label && <span className="text-xs text-danger-700">{text.name(r.failure_label)}</span>}
          {r.status === "superseded" && r.superseded_by_run_id !== null && (
            <Link href={`${RECONCILIATION_PATH}/${r.superseded_by_run_id}`} className="text-xs font-medium">
              {t("replacedBy")}
            </Link>
          )}
        </span>
      ),
    },
    {
      id: "counts",
      header: t("columns.counts"),
      cell: (r) =>
        r.status === "completed" || r.status === "superseded" ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-600">
            {ITEM_STATUSES.map((s) => (
              <li key={s} className="whitespace-nowrap">
                {label.item(s)} <Code className="font-medium text-ink-900">{r.counts[s]}</Code>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-ink-600">—</span>
        ),
    },
    {
      id: "unresolved",
      header: t("columns.unresolved"),
      cell: (r) =>
        r.status === "completed" ? (
          <Code className={r.unresolved_count > 0 ? "font-bold text-danger-700" : "text-ink-900"}>{r.unresolved_count}</Code>
        ) : (
          <span className="text-ink-600">—</span>
        ),
    },
    {
      id: "totals",
      header: t("columns.totals"),
      cell: (r) =>
        r.totals_brief ? (
          <span className="flex flex-col text-xs text-ink-600">
            <span>
              {t("charges")} <Money fils={r.totals_brief.charges_fils} className="text-ink-900" />
            </span>
            <span>
              {t("fees")} <Money fils={r.totals_brief.fees_fils} className="text-ink-900" />
            </span>
            <span>
              {t("net")} <Money fils={r.totals_brief.net_fils} className="text-ink-900" />
            </span>
          </span>
        ) : (
          <span className="text-ink-600">—</span>
        ),
    },
  ];

  const actions = (
    <>
      {canRun && (
        <>
          <Button onClick={() => setDialog("fetch")} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("fetchReport")}
          </Button>
          <Button variant="secondary" onClick={() => setDialog("upload")} icon={<FileUp aria-hidden className="size-4" />}>
            {t("uploadFile")}
          </Button>
        </>
      )}
      <ExportButton
        report="reconciliation_runs"
        filters={exportFilters({ from: filters.from, to: filters.to, status: filters.status, unresolved: filters.unresolved === "1" })}
      />
    </>
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={meta && meta.unresolved_total > 0 ? t("subtitleUnresolved", { count: meta.unresolved_total }) : t("subtitle")}
        actions={actions}
      />
      <Card>
        <FilterBar canReset={filtered} onReset={reset}>
          <DateRangeFields from={filters.from} to={filters.to} onChange={set} valid={rangeValid} fromLabel={t("filters.from")} toLabel={t("filters.to")} />
          <Select
            label={f("status")}
            placeholder={f("allStatuses")}
            value={filters.status}
            onChange={(e) => set({ status: e.target.value })}
            options={RUN_STATUSES.map((s: RunStatus) => ({ value: s, label: label.run(s) }))}
            containerClassName="min-w-[170px]"
          />
          <Checkbox label={t("filters.unresolved")} checked={filters.unresolved === "1"} onChange={(e) => set({ unresolved: e.target.checked ? "1" : "" })} className="self-center" />
        </FilterBar>
        {!rangeValid && <Notice tone="warning">{f("rangeInvalid")}</Notice>}
        <DataTable
          caption={t("caption")}
          columns={columns}
          rows={list.data?.data}
          getRowId={(r) => r.id}
          loading={list.isPending && rangeValid}
          fetching={list.isFetching && !list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={
            filtered ? (
              <EmptyState title={t("emptyFiltered")} body={f("emptyFilteredBody")} />
            ) : (
              <EmptyState
                title={t("empty")}
                body={canRun ? t("emptyBody") : t("emptyBodyReadOnly")}
                action={
                  canRun ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button onClick={() => setDialog("fetch")}>{t("fetchReport")}</Button>
                      <Button variant="secondary" onClick={() => setDialog("upload")}>
                        {t("uploadFile")}
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            )
          }
          pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
          minWidth={980}
        />
      </Card>
      {dialog === "fetch" && <FetchReportDialog onClose={() => setDialog(null)} />}
      {dialog === "upload" && <UploadSettlementDialog onClose={() => setDialog(null)} />}
    </>
  );
}
