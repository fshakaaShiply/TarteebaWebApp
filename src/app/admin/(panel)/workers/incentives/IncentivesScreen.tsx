"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Calculator, ListChecks, Plus, Settings2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ButtonLink, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, FilterBar, Notice, PageHeader, SearchField, Select, StatusBadge, TabPanel, Tabs, useToast, type Column } from "@/components/admin";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { INCENTIVE_RULES_PATH, INCENTIVE_POSTINGS_PATH } from "@/lib/admin/nav";
import type { FilterSpec } from "@/lib/admin/finance/filters";
import { computeIncentives, fetchAdjustments, fetchPostings, fetchProposals } from "@/lib/admin/workforce/endpoints";
import { useWorkforceError } from "@/lib/admin/workforce/errors";
import { bpText, canApprove, closedPeriods, hoursText, INCENTIVE_STATUSES, isStale, periodFromParam, proposalFils, starsText } from "@/lib/admin/workforce/incentives";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { IncentiveAdjustment, IncentiveProposal } from "@/lib/admin/workforce/types";
import { useAdminSession } from "@/lib/admin/session";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useUrlFilters } from "../../finance/_components/useUrlFilters";
import { useZoneName } from "../../_ops/options";
import { WorkerAvatar } from "../_components/WorkerAvatar";
import { AdjustmentDialog, DeleteAdjustmentDialog } from "./_components/AdjustmentDialogs";
import { BulkApproveDialog, BulkRejectDialog } from "./_components/BulkDialogs";
import { PostDialog } from "./_components/PostDialog";
import { ProposalDrawer } from "./_components/ProposalDrawer";
import { incentiveTone } from "./_components/ProposalFacts";
import { useIncentiveRefresh } from "./_components/ProposalDialogs";

const PER_PAGE = 25;
const TABS = ["proposals", "adjustments", "postings"] as const;
const FILTERS = {
  period: { kind: "text", max: 7 },
  status: { kind: "enum", values: INCENTIVE_STATUSES },
  q: { kind: "text", max: 60 },
  sort: { kind: "enum", values: ["amount", "employee_no"] },
  tab: { kind: "enum", values: TABS },
} as const satisfies FilterSpec;

/**
 * A05 incentives (incentives.approve, workforce §3.3): one month's proposals, with the money decisions HR makes: approve
 * (at the proposed amount or an edited one with a reason), reject, reopen, recompute, and post as one posting. Postings
 * and approvals are money: every dialog shows the lines and the total before anything is sent, and a change under the
 * API's locks (409 TERMS_CHANGED) or in the month's figures (409 METRICS_STALE) is put on screen, never retried silently.
 */
export function IncentivesScreen() {
  return (
    <RequirePermission anyOf={["incentives.approve"]}>
      <Incentives />
    </RequirePermission>
  );
}

function Incentives() {
  const t = useTranslations("admin.incentives");
  const wt = useWorkforceText();
  const { filters, set, setPage, reset } = useUrlFilters(FILTERS);
  const period = periodFromParam(filters.period);
  const tab = (TABS as readonly string[]).includes(filters.tab) ? filters.tab : "proposals";
  const [adding, setAdding] = useState(false);
  const [computing, setComputing] = useState(false);
  const periods = closedPeriods(12);
  const options = periods.includes(period) ? periods : [period, ...periods];

  // The month of the adjustments and the postings tab: its own query each (below), the proposals have theirs.
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { month: wt.month(period) })}
        actions={
          <>
            <ButtonLink href={INCENTIVE_RULES_PATH} variant="outline" icon={<Settings2 aria-hidden className="size-4" />}>
              {t("rulesLink")}
            </ButtonLink>
            <Button variant="outline" onClick={() => setAdding(true)} icon={<Plus aria-hidden className="size-4" />}>
              {t("addAdjustment")}
            </Button>
            <Button onClick={() => setComputing(true)} icon={<Calculator aria-hidden className="size-4" />}>
              {t("computeNow")}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t("month")} value={period} onChange={(e) => set({ period: e.target.value })} options={options.map((p) => ({ value: p, label: wt.month(p) }))} containerClassName="min-w-[200px]" />
      </div>
      <Tabs id="a05-incentives" label={t("tabsLabel")} value={tab} onValueChange={(v) => set({ tab: v === "proposals" ? "" : v })} items={TABS.map((v) => ({ value: v, label: t(`tabs.${v}`) }))} />
      <TabPanel id="a05-incentives" value="proposals" hidden={tab !== "proposals"} className="flex flex-col gap-4">
        {tab === "proposals" && <ProposalsPanel period={period} filters={filters} set={set} setPage={setPage} reset={reset} onCompute={() => setComputing(true)} />}
      </TabPanel>
      <TabPanel id="a05-incentives" value="adjustments" hidden={tab !== "adjustments"} className="flex flex-col gap-4">
        {tab === "adjustments" && <AdjustmentsPanel period={period} />}
      </TabPanel>
      <TabPanel id="a05-incentives" value="postings" hidden={tab !== "postings"} className="flex flex-col gap-4">
        {tab === "postings" && <PostingsPanel period={period} />}
      </TabPanel>
      {adding && <AdjustmentDialog defaultPeriod={period} onClose={() => setAdding(false)} />}
      {computing && <ComputeDialog period={period} onClose={() => setComputing(false)} />}
    </>
  );
}

type Filters = ReturnType<typeof useUrlFilters<typeof FILTERS>>["filters"];

function ProposalsPanel({
  period,
  filters,
  set,
  setPage,
  reset,
  onCompute,
}: {
  period: string;
  filters: Filters;
  set: (changes: Partial<Record<keyof typeof FILTERS, string>>) => void;
  setPage: (page: number) => void;
  reset: () => void;
  onCompute: () => void;
}) {
  const t = useTranslations("admin.incentives");
  const wt = useWorkforceText();
  const zoneName = useZoneName();
  const { can } = useAdminSession();
  const [search, setSearch] = useState(filters.q);
  const q = useDebouncedValue(search.trim(), 300);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [open, setOpen] = useState<IncentiveProposal | null>(null);
  const [action, setAction] = useState<"approve" | "reject" | "post" | null>(null);
  const [postOne, setPostOne] = useState<IncentiveProposal | null>(null);

  const query = useQuery({
    queryKey: workforceKeys.proposals({ period, status: filters.status, q, sort: filters.sort, page: filters.page }),
    queryFn: () => fetchProposals({ period, status: filters.status ? [filters.status] : undefined, search: q || undefined, sort: filters.sort || undefined, page: filters.page, perPage: PER_PAGE }),
    placeholderData: keepPreviousData,
  });
  const adjustments = useQuery({ queryKey: workforceKeys.adjustments({ period, page: 1 }), queryFn: () => fetchAdjustments({ period, page: 1 }) });
  const rows = query.data?.data;
  const meta = query.data?.meta;
  const openAdjustments = (adjustments.data?.data ?? []).filter((a) => a.posting === null);
  const chosen = (rows ?? []).filter((p) => selected.has(p.id));
  const approvable = chosen.filter(canApprove);
  const proposed = chosen.filter((p) => p.status === "proposed");
  const approved = chosen.filter((p) => p.status === "approved");
  const filtered = filters.status !== "" || q !== "";
  const clearSelection = () => setSelected(new Set());
  const liveOpen = open ? ((rows ?? []).find((p) => p.id === open.id) ?? open) : null;

  const toggle = (id: number, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allOnPage = rows !== undefined && rows.length > 0 && rows.every((p) => selected.has(p.id));

  const columns: Column<IncentiveProposal>[] = [
    {
      id: "select",
      header: (
        <Checkbox
          label={<span className="sr-only">{t("selectAll")}</span>}
          checked={allOnPage}
          onChange={(e) => setSelected(e.target.checked ? new Set((rows ?? []).map((p) => p.id)) : new Set())}
        />
      ),
      cell: (p) => <Checkbox label={<span className="sr-only">{t("selectOne", { name: p.worker.display_name })}</span>} checked={selected.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />,
    },
    {
      id: "worker",
      header: t("columns.worker"),
      cell: (p) => (
        <div className="flex items-center gap-3">
          <WorkerAvatar name={p.worker.display_name} size="sm" />
          <div className="flex flex-col">
            <button type="button" className="touch-target text-start font-bold text-petrol-700" onClick={() => setOpen(p)}>
              <bdi>{p.worker.display_name}</bdi>
            </button>
            <span className="text-xs text-ink-600">
              <bdi dir="ltr" className="font-latin">
                {p.worker.employee_no}
              </bdi>{" "}
              · {zoneName(p.worker.home_zone.id, wt.locale === "ar" ? p.worker.home_zone.name.ar : p.worker.home_zone.name.en)}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: "hours",
      header: t("columns.hours"),
      cell: (p) => <span className="font-latin text-sm">{t("hoursValue", { hours: hoursText(p.metrics_summary.worked_minutes), visits: p.metrics_summary.completed_visits })}</span>,
    },
    {
      id: "rating",
      header: t("columns.rating"),
      cell: (p) =>
        p.metrics_summary.rating_avg_x100 === null ? (
          <span className="text-sm text-ink-600">—</span>
        ) : (
          <span className="font-latin text-sm">
            ★ {starsText(p.metrics_summary.rating_avg_x100)} · {p.metrics_summary.ratings_count ?? 0}
          </span>
        ),
    },
    { id: "score", header: t("columns.score"), cell: (p) => <span className="font-latin text-sm">{bpText(p.score_bp)}%</span> },
    {
      id: "amount",
      header: t("columns.amount"),
      cell: (p) => (
        <span className="flex flex-col">
          <span className="font-latin font-bold" dir="ltr">
            {wt.money(proposalFils(p))}
          </span>
          {p.approved_fils !== null && p.approved_fils !== p.proposed_fils && <span className="text-xs text-ink-600">{t("edited", { amount: wt.money(p.proposed_fils) })}</span>}
        </span>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (p) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={incentiveTone[p.status]}>{wt.incentiveStatus(p.status)}</StatusBadge>
          {isStale(p) && <StatusBadge tone="pending">{t("stale")}</StatusBadge>}
          {p.posting && (
            <Link href={`${INCENTIVE_POSTINGS_PATH}/${p.posting.id}`} className="text-xs font-bold">
              <bdi dir="ltr" className="font-latin">
                {p.posting.reference}
              </bdi>
            </Link>
          )}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (p) => (
        <Button variant="ghost" size="sm" onClick={() => setOpen(p)} aria-label={t("openLabel", { name: p.worker.display_name })}>
          {t("open")}
        </Button>
      ),
    },
  ];

  return (
    <>
      {meta && meta.rule === null && (
        <Notice tone="warning" action={<Link href={INCENTIVE_RULES_PATH} className="touch-target w-fit text-sm font-bold">{t("noRuleLink")}</Link>}>
          {t("noRule")}
        </Notice>
      )}
      {meta && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={t("totalsLabel")}>
          {INCENTIVE_STATUSES.map((s) => (
            <li key={s} className="flex flex-col gap-0.5 rounded-lg bg-surface px-4 py-3 shadow-card">
              <span className="text-xs font-medium text-ink-600">{wt.incentiveStatus(s)}</span>
              <span className="font-latin text-lg font-bold text-ink-900" dir="ltr">
                {wt.money(meta.totals[s].fils)}
              </span>
              <span className="text-xs text-ink-600">{t("totalCount", { count: meta.totals[s].count })}</span>
            </li>
          ))}
        </ul>
      )}
      <Card>
        <FilterBar
          canReset={filtered}
          onReset={() => {
            reset();
            setSearch("");
            clearSelection();
          }}
        >
          <SearchField label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} value={search} onChange={(v) => { setSearch(v); set({ q: v }); clearSelection(); }} />
          <Select label={t("filters.status")} placeholder={t("filters.allStatuses")} value={filters.status} onChange={(e) => { set({ status: e.target.value }); clearSelection(); }} options={INCENTIVE_STATUSES.map((s) => ({ value: s, label: wt.incentiveStatus(s) }))} containerClassName="min-w-[170px]" />
          <Select label={t("filters.sort")} placeholder={t("filters.sortDefault")} value={filters.sort} onChange={(e) => set({ sort: e.target.value })} options={[{ value: "amount", label: t("filters.sortAmount") }, { value: "employee_no", label: t("filters.sortEmployee") }]} containerClassName="min-w-[170px]" />
        </FilterBar>
        {(selected.size > 0 || openAdjustments.length > 0) && can("incentives.approve") && (
          <div role="group" aria-label={t("bulk.label")} className="flex flex-wrap items-center gap-2 rounded-md bg-petrol-50 px-3 py-2">
            <span className="text-sm font-medium text-petrol-700" aria-live="polite">
              {t("bulk.selected", { count: selected.size })}
            </span>
            <Button size="sm" onClick={() => setAction("approve")} disabled={approvable.length === 0} icon={<ListChecks aria-hidden className="size-4" />}>
              {t("bulk.approve", { count: approvable.length })}
            </Button>
            <Button size="sm" variant="outline" className="text-danger-700" onClick={() => setAction("reject")} disabled={proposed.length === 0}>
              {t("bulk.reject", { count: proposed.length })}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAction("post")} disabled={approved.length === 0 && openAdjustments.length === 0}>
              {t("bulk.post", { count: approved.length, adjustments: openAdjustments.length })}
            </Button>
            {chosen.some((p) => isStale(p)) && <span className="text-xs text-warning-700">{t("bulk.staleHint")}</span>}
          </div>
        )}
        <DataTable
          caption={t("caption", { month: wt.month(period) })}
          columns={columns}
          rows={rows}
          getRowId={(p) => p.id}
          loading={query.isPending}
          fetching={query.isFetching && !query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={
            filtered ? (
              <EmptyState title={t("emptyFiltered")} />
            ) : (
              <EmptyState title={t("notComputed")} body={t("notComputedBody", { month: wt.month(period) })} action={<Button onClick={onCompute}>{t("computeNow")}</Button>} />
            )
          }
          pagination={query.data ? { meta: query.data.meta, onPageChange: (page) => { clearSelection(); setPage(page); } } : undefined}
          minWidth={1000}
        />
      </Card>
      {liveOpen && <ProposalDrawer proposal={liveOpen} canPost onClose={() => setOpen(null)} onPost={(p) => { setOpen(null); setPostOne(p); }} />}
      {action === "approve" && <BulkApproveDialog proposals={approvable} live={rows ?? []} onClose={() => { setAction(null); clearSelection(); }} />}
      {action === "reject" && <BulkRejectDialog proposals={proposed} onClose={() => { setAction(null); clearSelection(); }} />}
      {action === "post" && <PostDialog period={period} proposals={approved} adjustments={openAdjustments} onClose={() => { setAction(null); clearSelection(); }} />}
      {postOne && <PostDialog period={period} proposals={[postOne]} adjustments={openAdjustments} onClose={() => setPostOne(null)} />}
    </>
  );
}

function ComputeDialog({ period, onClose }: { period: string; onClose: () => void }) {
  const t = useTranslations("admin.incentives.compute");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useIncentiveRefresh();
  const keys = useIdempotencyKeys();
  const run = useMutation({
    mutationFn: () => computeIncentives(period, keys.keyFor({ period })),
    onSuccess: (result) => {
      keys.settle();
      refresh();
      toast.success(t("done", { created: result.created, rejected: result.rejected_below_threshold, existing: result.existing }));
      onClose();
    },
    onError: (error) => keys.settle(error),
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("title", { month: wt.month(period) })}
      description={t("body")}
      confirmLabel={t("confirm")}
      pending={run.isPending}
      onConfirm={() => run.mutate()}
    >
      {run.error && <Notice tone="danger">{describe(run.error)}</Notice>}
    </ConfirmDialog>
  );
}

function AdjustmentsPanel({ period }: { period: string }) {
  const t = useTranslations("admin.incentives.adjustments");
  const wt = useWorkforceText();
  const [removing, setRemoving] = useState<IncentiveAdjustment | null>(null);
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: workforceKeys.adjustments({ period, page }), queryFn: () => fetchAdjustments({ period, page }), placeholderData: keepPreviousData });
  const columns: Column<IncentiveAdjustment>[] = [
    { id: "worker", header: t("columns.worker"), cell: (a) => <bdi className="font-bold">{a.worker.display_name}</bdi> },
    { id: "amount", header: t("columns.amount"), cell: (a) => <span className="font-latin font-bold" dir="ltr">{wt.money(a.amount_fils)}</span> },
    { id: "reason", header: t("columns.reason"), cell: (a) => <span className="text-sm">{a.reason}</span> },
    {
      id: "corrects",
      header: t("columns.corrects"),
      cell: (a) => (a.corrects_posting ? <bdi dir="ltr" className="font-latin text-sm">{a.corrects_posting.reference}</bdi> : <span className="text-sm text-ink-600">—</span>),
    },
    {
      id: "state",
      header: t("columns.state"),
      cell: (a) => (a.posting ? <StatusBadge tone="success">{t("postedIn", { reference: a.posting.reference })}</StatusBadge> : <StatusBadge tone="pending">{t("open")}</StatusBadge>),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (a) =>
        a.posting ? null : (
          <Button variant="ghost" size="sm" className="text-danger-700" onClick={() => setRemoving(a)} aria-label={t("deleteLabel", { name: a.worker.display_name })}>
            {t("delete")}
          </Button>
        ),
    },
  ];
  return (
    <Card title={t("title", { month: wt.month(period) })}>
      <p className="text-sm text-ink-600">{t("intro")}</p>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={query.data?.data}
        getRowId={(a) => a.id}
        loading={query.isPending}
        fetching={query.isFetching && !query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={t("empty")} />}
        pagination={query.data ? { meta: query.data.meta, onPageChange: setPage } : undefined}
        minWidth={800}
      />
      {removing && <DeleteAdjustmentDialog adjustment={removing} live={(query.data?.data ?? []).find((a) => a.id === removing.id) ?? null} onClose={() => setRemoving(null)} />}
    </Card>
  );
}

function PostingsPanel({ period }: { period: string }) {
  const t = useTranslations("admin.incentives.postings");
  const wt = useWorkforceText();
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: workforceKeys.postings({ period, page }), queryFn: () => fetchPostings({ period, page }), placeholderData: keepPreviousData });
  return (
    <Card title={t("title", { month: wt.month(period) })}>
      <DataTable
        caption={t("caption")}
        columns={[
          {
            id: "reference",
            header: t("columns.reference"),
            cell: (p) => (
              <Link href={`${INCENTIVE_POSTINGS_PATH}/${p.id}`} className="font-bold">
                <bdi dir="ltr" className="font-latin">
                  {p.reference}
                </bdi>
              </Link>
            ),
          },
          { id: "lines", header: t("columns.lines"), cell: (p) => <span className="font-latin">{p.lines_count}</span> },
          { id: "total", header: t("columns.total"), cell: (p) => <span className="font-latin font-bold" dir="ltr">{wt.money(p.total_fils)}</span> },
          { id: "by", header: t("columns.by"), cell: (p) => (p.posted_by ? <bdi>{p.posted_by.name}</bdi> : <span className="text-ink-600">—</span>) },
          { id: "at", header: t("columns.at"), cell: (p) => wt.dateTime(p.posted_at) },
        ]}
        rows={query.data?.data}
        getRowId={(p) => p.id}
        loading={query.isPending}
        fetching={query.isFetching && !query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={t("empty")} />}
        pagination={query.data ? { meta: query.data.meta, onPageChange: setPage } : undefined}
        minWidth={700}
      />
    </Card>
  );
}
