"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Card, DataTable, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, SearchField, Select, TabPanel, Tabs, useToast, type Column } from "@/components/admin";
import { ExportButton } from "@/components/admin/ExportButton";
import { useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { exportFilters } from "@/lib/admin/exports";
import { fetchReconciliationItems, fetchReconciliationRun, recheckRun } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import { filterKey } from "@/lib/admin/finance/filters";
import {
  ITEM_FILTERS,
  ITEM_STATUSES,
  LINE_TYPES,
  REOPENABLE_RESOLUTIONS,
  RUN_POLL_MS,
  documentIssues,
  itemRef,
  itemView,
  runInFlight,
  type ItemRow,
  type RunDetail,
  type RunError,
} from "@/lib/admin/finance/reconciliation";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { RECONCILIATION_PATH, RECONCILIATION_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { BackLink, Code, Fact, Facts, Money } from "../../_components/FinanceParts";
import { useFinanceText } from "../../_components/financeText";
import { useUrlFilters } from "../../_components/useUrlFilters";
import { CopyableRef, DocumentCheckChip, ItemStatusChip, OurRecord, RunStatusChip, useReconText } from "../_components/ReconParts";
import { ReopenItemDialog } from "../_components/ReopenItemDialog";
import { ResolveItemDialog } from "../_components/ResolveItemDialog";
import { FetchReportDialog, UploadSettlementDialog } from "../_components/RunDialogs";
import { RunTotals } from "../_components/RunTotals";

const PER_PAGE = 50;
const TABS_ID = "recon-items";

/**
 * A09 one reconciliation run (spec §10.7, design finance §7.1; reconciliation.run or payments.view): the report's facts,
 * its totals in three columns (provider, our records, tax documents), and the items in five tabs: Differences (the
 * default), Documents, Matched, Resolved and All. A run that is still being read refreshes in the background every 5
 * seconds; a failed one lists the errors by line. Resolving, reopening, rechecking and replacing need reconciliation.run.
 */
export function ReconciliationRunScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={RECONCILIATION_READ}>
      <RunContent key={id} id={id} />
    </RequirePermission>
  );
}

function RunContent({ id }: { id: string }) {
  const t = useTranslations("admin.finance.reconciliation");
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  const key = adminKeys.reconciliationRun(numericId ?? 0);
  const run = useQuery({
    queryKey: key,
    queryFn: () => fetchReconciliationRun(numericId as number),
    enabled: numericId !== null,
    refetchOnWindowFocus: true,
  });
  useBackgroundRefresh(key, () => fetchReconciliationRun(numericId as number, { background: true }), {
    everyMs: RUN_POLL_MS,
    enabled: numericId !== null && run.data !== undefined && runInFlight(run.data.status),
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink href={RECONCILIATION_PATH}>{t("back")}</BackLink>
        {run.data && (
          <Button variant="ghost" size="sm" onClick={() => void run.refetch()} loading={run.isFetching} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {numericId === null ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : run.data ? (
        <RunView run={run.data} />
      ) : run.isError ? (
        <Card>
          <ErrorState error={run.error} onRetry={() => void run.refetch()} />
        </Card>
      ) : (
        <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />
      )}
    </>
  );
}

function RunView({ run }: { run: RunDetail }) {
  const t = useTranslations("admin.finance.reconciliation");
  const text = useFinanceText();
  const describe = useFinanceError();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAdminSession();
  const [dialog, setDialog] = useState<"fetch" | "upload" | null>(null);
  const canRun = can("reconciliation.run");
  const completed = run.status === "completed";

  const recheck = useMutation({
    mutationFn: () => recheckRun(run.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      toast.success(t("rechecked", { rechecked: result.rechecked, resolved: result.auto_resolved }));
    },
    onError: (error) => toast.error(describe(error)),
  });

  // After a replace the new run is the one to watch.
  const opened = (next: RunDetail) => router.push(`${RECONCILIATION_PATH}/${next.id}`);

  const actions = (
    <>
      {canRun && completed && (
        <Button variant="outline" onClick={() => recheck.mutate()} loading={recheck.isPending} icon={<RotateCcw aria-hidden className="size-4" />}>
          {t("recheck")}
        </Button>
      )}
      {canRun && (completed || run.status === "failed") && (
        <>
          <Button variant="secondary" onClick={() => setDialog("fetch")}>
            {completed ? t("replaceFetch") : t("fetchAgain")}
          </Button>
          <Button variant="secondary" onClick={() => setDialog("upload")}>
            {completed ? t("replaceUpload") : t("uploadAgain")}
          </Button>
        </>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t("runTitle", { date: text.date(run.report_date) })}
            <RunStatusChip run={run} />
          </span>
        }
        subtitle={t("runSubtitle", { gateway: run.gateway, lines: run.lines_count })}
        actions={actions}
      />

      {runInFlight(run.status) && (
        <Notice tone="info" role="status">
          {t("inFlight")}
        </Notice>
      )}
      {run.status === "superseded" && run.superseded_by_run_id !== null && (
        <Notice
          tone="warning"
          action={
            <Link href={`${RECONCILIATION_PATH}/${run.superseded_by_run_id}`} className="touch-target w-fit text-sm font-bold text-petrol-700">
              {t("openReplacement")}
            </Link>
          }
        >
          {t("supersededNote")}
        </Notice>
      )}
      {run.status === "failed" && (
        <Notice tone="danger" title={t("failedTitle")}>
          <p>{run.failure_label ? text.name(run.failure_label) : run.failure_code}</p>
          {run.failure_code && <Code className="text-xs">{run.failure_code}</Code>}
        </Notice>
      )}

      <Card title={t("facts.title")}>
        <Facts>
          <Fact label={t("facts.date")}>{text.date(run.report_date)}</Fact>
          <Fact label={t("facts.source")}>
            {t(`source.${run.source}`)} · {text.name(run.parser_label)}
          </Fact>
          {run.source_file?.name && (
            <Fact label={t("facts.file")}>
              <Code wrap className="text-xs">
                {run.source_file.name}
              </Code>
            </Fact>
          )}
          {run.source_file?.sha256 && (
            <Fact label={t("facts.sha")}>
              <CopyableRef value={run.source_file.sha256} label={t("facts.sha")} />
            </Fact>
          )}
          {run.report_ref && (
            <Fact label={t("facts.reportRef")}>
              <Code wrap className="text-xs">
                {run.report_ref}
              </Code>
            </Fact>
          )}
          <Fact label={t("facts.startedBy")}>{run.started_by?.name ?? t("facts.system")}</Fact>
          <Fact label={t("facts.startedAt")}>{text.dateTime(run.started_at)}</Fact>
          <Fact label={t("facts.finishedAt")}>{run.finished_at ? text.dateTime(run.finished_at) : "—"}</Fact>
          {run.supersedes_run_id !== null && (
            <Fact label={t("facts.supersedes")}>
              <Link href={`${RECONCILIATION_PATH}/${run.supersedes_run_id}`} className="font-medium">
                {t("facts.openRun", { id: run.supersedes_run_id })}
              </Link>
            </Fact>
          )}
          {run.replace_reason && (
            <Fact label={t("facts.replaceReason")} wide>
              “{run.replace_reason}”
            </Fact>
          )}
        </Facts>
      </Card>

      {run.status === "failed" && run.errors.length > 0 && <ErrorsTable run={run} />}
      {run.totals && <RunTotals totals={run.totals} />}
      {(completed || run.status === "superseded") && <ItemsPanel run={run} active={completed} canRun={canRun} />}

      {dialog === "fetch" && <FetchReportDialog onClose={() => setDialog(null)} onCreated={opened} initial={{ date: run.report_date, replace: completed }} />}
      {dialog === "upload" && <UploadSettlementDialog onClose={() => setDialog(null)} onCreated={opened} initial={{ date: run.report_date, replace: completed }} />}
    </>
  );
}

function ErrorsTable({ run }: { run: RunDetail }) {
  const t = useTranslations("admin.finance.reconciliation.errors");
  const text = useFinanceText();
  const columns: Column<RunError>[] = [
    { id: "line", header: t("line"), cell: (e) => (e.line === null ? "—" : <Code>{e.line}</Code>) },
    { id: "column", header: t("column"), cell: (e) => (e.column ? <Code>{e.column}</Code> : "—") },
    {
      id: "message",
      header: t("message"),
      cell: (e) => {
        const message = typeof e.message === "string" ? e.message : e.message ? text.name(e.message) : "";
        return (
          <span className="flex flex-col">
            <span>{message || e.code}</span>
            <Code className="text-xs text-ink-600">{e.code}</Code>
          </span>
        );
      },
    },
  ];
  return (
    <Card title={t("title")}>
      <p className="text-sm text-ink-600">{t("hint")}</p>
      <DataTable caption={t("caption")} columns={columns} rows={run.errors} getRowId={(e) => `${e.line}-${e.column}-${e.code}`} minWidth={520} />
      {run.errors_total > run.errors.length && <p className="text-xs text-ink-600">{t("more", { shown: run.errors.length, total: run.errors_total })}</p>}
    </Card>
  );
}

function ItemsPanel({ run, active, canRun }: { run: RunDetail; active: boolean; canRun: boolean }) {
  const t = useTranslations("admin.finance.reconciliation");
  const label = useReconText();
  const text = useFinanceText();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(ITEM_FILTERS);
  const [resolving, setResolving] = useState<ItemRow | null>(null);
  const [reopening, setReopening] = useState<ItemRow | null>(null);
  const view = itemView(filters.view);
  const q = useDebouncedValue(filters.q.trim(), 300);
  const mayExport = useAdminSession().can("reports.export");

  const list = useQuery({
    queryKey: adminKeys.reconciliationItems(run.id, filterKey(ITEM_FILTERS, { ...filters, view }, { q })),
    queryFn: () => fetchReconciliationItems(run.id, { page: filters.page, perPage: PER_PAGE, view, status: filters.status, lineType: filters.line_type, q }),
    placeholderData: keepPreviousData,
  });
  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const issues = documentIssues(run.totals?.documents.checks);
  const tabs = [
    { value: "differences", label: t("tabs.differences", { count: run.unresolved_count }) },
    { value: "documents", label: t("tabs.documents", { count: issues }) },
    { value: "matched", label: t("tabs.matched", { count: run.counts.matched }) },
    { value: "resolved", label: t("tabs.resolved") },
    { value: "all", label: t("tabs.all") },
  ];

  const columns: Column<ItemRow>[] = [
    { id: "line", header: t("columns.line"), cell: (i) => (i.line_no === null ? <span className="text-ink-600">—</span> : <Code>{i.line_no}</Code>) },
    {
      id: "type",
      header: t("columns.type"),
      cell: (i) => <span className="whitespace-nowrap">{label.line(i.line_type, i.line_type_label)}</span>,
    },
    {
      id: "refs",
      header: t("columns.references"),
      cell: (i) => {
        const refs = [
          { key: "gateway", name: t("refs.gateway"), value: i.gateway_ref },
          { key: "refund", name: t("refs.refund"), value: i.refund_ref },
          { key: "merchant", name: t("refs.merchant"), value: i.merchant_ref },
          { key: "payout", name: t("refs.payout"), value: i.payout_ref },
        ].filter((r) => r.value);
        return refs.length === 0 ? (
          <span className="text-ink-600">—</span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {refs.map((r) => (
              <li key={r.key} className="flex min-w-0 flex-col text-xs text-ink-600">
                <span>{r.name}</span>
                <CopyableRef value={r.value as string} label={r.name} />
              </li>
            ))}
          </ul>
        );
      },
    },
    { id: "ours", header: t("columns.ourRecord"), cell: (i) => <OurRecord item={i} /> },
    { id: "ourAmount", header: t("columns.ourAmount"), cell: (i) => <Money fils={i.system_amount_fils} /> },
    { id: "providerAmount", header: t("columns.providerAmount"), cell: (i) => <Money fils={i.gateway_amount_fils} /> },
    {
      id: "difference",
      header: t("columns.difference"),
      cell: (i) =>
        i.difference_fils === null ? <span className="text-ink-600">—</span> : <Money fils={i.difference_fils} className={i.difference_fils !== 0 ? "font-bold text-danger-700" : undefined} />,
    },
    { id: "fee", header: t("columns.fee"), cell: (i) => <Money fils={i.fee_fils} /> },
    {
      id: "status",
      header: t("columns.status"),
      cell: (i) => (
        <span className="flex flex-col items-start gap-1">
          <ItemStatusChip item={i} />
          {i.reason_code !== "ok" && <span className="text-xs text-ink-600">{label.reason(i.reason_code, i.reason_label)}</span>}
        </span>
      ),
    },
    { id: "documents", header: t("columns.documents"), cell: (i) => <DocumentCheckChip item={i} /> },
    {
      id: "resolution",
      header: t("columns.resolution"),
      cell: (i) =>
        i.resolution ? (
          <span className="flex flex-col text-xs">
            <span className="font-medium text-ink-900">{label.resolution(i.resolution.code, i.resolution.label)}</span>
            <span className="text-ink-600">
              {i.resolution.by.type === "system" ? t("bySystem") : (i.resolution.by.name ?? t("byStaff"))} · {text.dateTime(i.resolution.at)}
            </span>
            {i.resolution.note && <span className="text-ink-600">“{i.resolution.note}”</span>}
            {i.resolution.carried && <span className="text-ink-600">{t("carried")}</span>}
          </span>
        ) : i.needs_action ? (
          <span className="text-xs font-medium text-danger-700">{t("needsAction")}</span>
        ) : (
          <span className="text-ink-600">—</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      cell: (i) => {
        if (!active || !canRun) return null;
        const ref = itemRef(i) ?? String(i.line_no ?? i.id);
        if (i.needs_action) {
          return (
            <Button size="sm" variant="secondary" onClick={() => setResolving(i)} aria-label={t("resolveActionLabel", { ref })}>
              {t("resolveAction")}
            </Button>
          );
        }
        if (i.resolution && i.resolution.by.type === "staff" && REOPENABLE_RESOLUTIONS.includes(i.resolution.code)) {
          return (
            <Button size="sm" variant="ghost" onClick={() => setReopening(i)} aria-label={t("reopenActionLabel", { ref })}>
              {t("reopenAction")}
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <Card
      title={t("items")}
      actions={
        <ExportButton
          report="reconciliation_items"
          filters={exportFilters({ run_id: run.id, view, status: filters.status ? [filters.status] : undefined, line_type: filters.line_type ? [filters.line_type] : undefined })}
        />
      }
    >
      <Tabs id={TABS_ID} label={t("tabs.label")} items={tabs} value={view} onValueChange={(value) => set({ view: value })} />
      <TabPanel id={TABS_ID} value={view} className="flex flex-col gap-3">
        <div role="search" className="flex flex-wrap items-end gap-3">
          <SearchField label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} value={filters.q} onChange={(v) => set({ q: v })} className="max-w-[320px]" />
          <Select
            label={t("filters.status")}
            placeholder={t("filters.allStatuses")}
            value={filters.status}
            onChange={(e) => set({ status: e.target.value })}
            options={ITEM_STATUSES.map((s) => ({ value: s, label: label.item(s) }))}
            containerClassName="min-w-[190px]"
          />
          <Select
            label={t("filters.lineType")}
            placeholder={t("filters.allTypes")}
            value={filters.line_type}
            onChange={(e) => set({ line_type: e.target.value })}
            options={LINE_TYPES.map((l) => ({ value: l, label: label.line(l) }))}
            containerClassName="min-w-[170px]"
          />
          {filtered && (
            <Button variant="ghost" onClick={reset}>
              {t("filters.reset")}
            </Button>
          )}
        </div>
        {/* The items export has no search filter (A1b §3.2): say so while a search narrows the list. */}
        {q !== "" && mayExport && <p className="text-xs text-ink-600">{t("exportNoSearch")}</p>}
        <DataTable
          caption={t("itemsCaption")}
          columns={columns}
          rows={list.data?.data}
          getRowId={(i) => i.id}
          loading={list.isPending}
          fetching={list.isFetching && !list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={<EmptyState title={view === "differences" && !filtered ? t("noDifferences") : t("noItems")} body={view === "differences" && !filtered ? t("noDifferencesBody") : undefined} />}
          pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
          minWidth={1500}
        />
      </TabPanel>
      {resolving && <ResolveItemDialog item={resolving} onClose={() => setResolving(null)} />}
      {reopening && <ReopenItemDialog item={reopening} onClose={() => setReopening(null)} />}
    </Card>
  );
}
