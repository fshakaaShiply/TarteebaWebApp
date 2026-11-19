"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  Notice,
  PageHeader,
  SearchField,
  Select,
  SlaChip,
  StarRating,
  StatusBadge,
  useToast,
  type Column,
} from "@/components/admin";
import { Ltr } from "../bookings/_components/BookingBits";
import { useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { dateRangeValid, filterKey } from "@/lib/admin/finance/filters";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { QUALITY_READ } from "@/lib/admin/nav";
import { fetchAssignees, fetchCase, fetchCases, updateCase } from "@/lib/admin/quality/endpoints";
import { useQualityError } from "@/lib/admin/quality/errors";
import { CASE_FILTERS, CASE_SORTS, CASE_SLA_FILTERS, CASE_STATUS_CHOICES, caseQuery } from "@/lib/admin/quality/filters";
import { qualityKeys } from "@/lib/admin/quality/keys";
import { priorityTone, statusTone, useQualityText } from "@/lib/admin/quality/labels";
import { CASE_CATEGORIES, CASE_PRIORITIES, CASE_TYPES, type AdminCaseRow } from "@/lib/admin/quality/types";
import { useAdminSession } from "@/lib/admin/session";
import { RequirePermission } from "../../_components/RequirePermission";
import { useZoneChoices } from "../_ops/options";
import { useUrlFilters } from "../finance/_components/useUrlFilters";
import { CaseView } from "./ComplaintCaseScreen";
import { useCaseRefresh } from "./_components/useCaseRefresh";

const PER_PAGE = 25;
/** The inbox is read again this often in the background (D-11), while the tab is visible. */
export const INBOX_REFRESH_MS = 20_000;
/** From this width the case opens beside the list (design AdminQuality); below it the row opens the case's own page. */
const PANE_QUERY = "(min-width: 1280px)";

/**
 * A10 inbox (spec §17 A10; design AdminQuality.dc.html; complaints.manage or compensation.approve): complaints, support
 * requests and low-rating follow-ups in one list, most urgent first, with the SLA chip. Filters live in the URL.
 */
export function QualityInboxScreen() {
  const t = useTranslations("admin.quality.inbox");
  return (
    <RequirePermission anyOf={QUALITY_READ}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Inbox />
    </RequirePermission>
  );
}

function Inbox() {
  const t = useTranslations("admin.quality.inbox");
  const f = useTranslations("admin.quality.filters");
  const text = useQualityText();
  const describe = useQualityError();
  const toast = useToast();
  const refresh = useCaseRefresh();
  const { can, me } = useAdminSession();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(CASE_FILTERS);
  const zones = useZoneChoices();
  const assignees = useQuery({ queryKey: qualityKeys.assignees(), queryFn: fetchAssignees, staleTime: 5 * 60_000, enabled: can("complaints.manage") });

  const q = useDebouncedValue(filters.q.trim(), 300);
  const rangeValid = dateRangeValid(filters);
  const query = useMemo(() => caseQuery(filters, q, PER_PAGE), [filters, q]);
  const key = qualityKeys.caseList(filterKey(CASE_FILTERS, filters, { q, assignee: filters.assignee, customer_id: filters.customer_id }));
  const list = useQuery({ queryKey: key, queryFn: () => fetchCases(query), placeholderData: keepPreviousData, enabled: rangeValid });
  useBackgroundRefresh(key, () => fetchCases(query, { background: true }), { everyMs: INBOX_REFRESH_MS, enabled: rangeValid });

  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  // The case beside the list (wide screens only).
  const [selected, setSelected] = useState<number | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    // No media queries (an old browser, a test): the row always opens the case's own page.
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(PANE_QUERY);
    const sync = () => setWide(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const pane = wide && selected !== null;

  // "Take": read the case, and assign it only when nobody holds it (the row carries no version to send as If-Match).
  const [taking, setTaking] = useState<number | null>(null);
  const take = useMutation({
    mutationFn: async (row: AdminCaseRow) => {
      const current = await fetchCase(row.id);
      if (current.assignee && current.assignee.id !== me.id) return { taken: false as const, by: current.assignee.name };
      if (current.assignee?.id === me.id) return { taken: true as const, case: current };
      return { taken: true as const, case: await updateCase(row.id, { assignee_id: me.id }, current.version) };
    },
    onMutate: (row) => setTaking(row.id),
    onSettled: () => setTaking(null),
    onSuccess: (result, row) => {
      refresh(result.taken ? result.case : undefined);
      if (result.taken) toast.success(t("taken", { reference: row.reference }));
      else toast.error(t("alreadyTaken", { reference: row.reference, name: result.by }));
    },
    onError: (e) => toast.error(describe(e)),
  });

  const open = (event: MouseEvent<HTMLAnchorElement>, row: AdminCaseRow) => {
    // A plain click on a wide screen opens the pane; a modified click or a narrow screen follows the link.
    if (!wide || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setSelected(row.id);
  };

  const columns: Column<AdminCaseRow>[] = [
    {
      id: "reference",
      header: t("columns.reference"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          <Link
            href={`/admin/quality/${r.id}`}
            onClick={(e) => open(e, r)}
            aria-current={selected === r.id && wide ? "true" : undefined}
            aria-label={t("openCase", { reference: r.reference })}
            className="w-fit font-bold"
          >
            <Ltr>{r.reference}</Ltr>
          </Link>
          <span className="text-xs text-ink-600">
            {text.type(r.type, r.type_label)}
            {r.type !== "rating_followup" ? ` · ${text.category(r.category, r.category_label)}` : ""}
          </span>
        </span>
      ),
    },
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-ink-900">{r.customer.name_short ?? t("deletedCustomer")}</span>
          {r.rating && <StarRating value={r.rating.overall} size="sm" />}
          {r.booking && (
            <span className="text-xs text-ink-600">
              <Ltr>{r.booking.reference}</Ltr>
            </span>
          )}
        </span>
      ),
    },
    {
      id: "workers",
      header: t("columns.workers"),
      cell: (r) => (r.workers.length > 0 ? r.workers.map((w) => w.name).join("، ") : <span className="text-ink-600">—</span>),
    },
    {
      id: "priority",
      header: t("columns.priority"),
      cell: (r) => <StatusBadge tone={priorityTone[r.priority]}>{text.priority(r.priority, r.priority_label)}</StatusBadge>,
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={statusTone[r.status]}>{text.status(r.status, r.status_label)}</StatusBadge>
          {r.customer_replied && r.status !== "closed" && <span className="text-xs font-medium text-warning-700">{t("customerReplied")}</span>}
          {r.awaiting_approval && <span className="text-xs font-medium text-warning-700">{t("awaitingApproval")}</span>}
        </span>
      ),
    },
    {
      id: "assignee",
      header: t("columns.assignee"),
      cell: (r) => (r.assignee ? r.assignee.name : <span className="text-ink-600">{t("unassigned")}</span>),
    },
    { id: "sla", header: t("columns.sla"), cell: (r) => <SlaChip sla={r.sla} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      cell: (r) =>
        can("complaints.manage") && !r.assignee && r.status !== "closed" && r.status !== "resolved" ? (
          <Button size="sm" variant="secondary" loading={taking === r.id} disabled={taking !== null} onClick={() => take.mutate(r)} aria-label={t("takeLabel", { reference: r.reference })}>
            {t("take")}
          </Button>
        ) : null,
    },
  ];

  const counts = meta?.counts;
  const chips: { id: string; label: string; count: number | undefined; pressed: boolean; apply: () => void }[] = [
    { id: "active", label: t("counts.active"), count: counts?.active, pressed: !filtered, apply: reset },
    { id: "unassigned", label: t("counts.unassigned"), count: counts?.unassigned, pressed: filters.assignee === "unassigned", apply: () => set({ assignee: filters.assignee === "unassigned" ? "" : "unassigned" }) },
    { id: "breached", label: t("counts.breached"), count: counts?.breached, pressed: filters.sla === "breached", apply: () => set({ sla: filters.sla === "breached" ? "" : "breached" }) },
    {
      id: "awaiting_approval",
      label: t("counts.awaitingApproval"),
      count: counts?.awaiting_approval,
      pressed: filters.awaiting_approval === "1",
      apply: () => set({ awaiting_approval: filters.awaiting_approval === "1" ? "" : "1" }),
    },
  ];

  const staffOptions = [
    { value: "me", label: t("mine") },
    { value: "unassigned", label: t("unassigned") },
    ...(assignees.data ?? []).filter((a) => a.id !== me.id).map((a) => ({ value: String(a.id), label: a.name })),
  ];

  const table = (
    <DataTable
      caption={t("caption")}
      columns={columns}
      rows={list.data?.data}
      getRowId={(r) => r.id}
      loading={list.isPending && rangeValid}
      fetching={list.isFetching && !list.isPending}
      error={list.error}
      onRetry={() => void list.refetch()}
      empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? f("emptyFilteredBody") : undefined} />}
      pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
      minWidth={pane ? 760 : 980}
    />
  );

  return (
    <div className={pane ? "grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,560px)]" : "flex flex-col gap-5"}>
      <Card className="min-w-0">
        <ul aria-label={t("counts.title")} className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.id}>
              <button
                type="button"
                aria-pressed={chip.pressed}
                onClick={chip.apply}
                className="touch-target inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm aria-pressed:border-petrol-700 aria-pressed:bg-petrol-50"
              >
                <span className="font-medium text-ink-900">{chip.label}</span>
                <span className="font-latin font-bold text-petrol-700">{chip.count ?? "—"}</span>
              </button>
            </li>
          ))}
        </ul>
        <FilterBar canReset={filtered} onReset={reset}>
          <SearchField label={f("search")} placeholder={f("searchPlaceholder")} value={filters.q} onChange={(v) => set({ q: v })} className="max-w-[260px]" />
          <Select label={f("type")} placeholder={f("allTypes")} value={filters.type} onChange={(e) => set({ type: e.target.value })} options={CASE_TYPES.map((v) => ({ value: v, label: text.type(v) }))} containerClassName="min-w-[150px]" />
          <Select
            label={f("status")}
            placeholder={f("activeStatuses")}
            value={filters.status}
            onChange={(e) => set({ status: e.target.value })}
            options={CASE_STATUS_CHOICES.map((v) => ({ value: v, label: v === "all" ? f("allStatuses") : text.status(v) }))}
            containerClassName="min-w-[160px]"
          />
          <Select label={f("priority")} placeholder={f("allPriorities")} value={filters.priority} onChange={(e) => set({ priority: e.target.value })} options={CASE_PRIORITIES.map((v) => ({ value: v, label: text.priority(v) }))} containerClassName="min-w-[140px]" />
          <Select label={f("category")} placeholder={f("allCategories")} value={filters.category} onChange={(e) => set({ category: e.target.value })} options={CASE_CATEGORIES.map((v) => ({ value: v, label: text.category(v) }))} containerClassName="min-w-[170px]" />
          <Select
            label={f("assignee")}
            placeholder={f("anyone")}
            value={filters.assignee}
            onChange={(e) => set({ assignee: e.target.value })}
            options={staffOptions}
            containerClassName="min-w-[160px]"
          />
          <Select label={f("sla")} placeholder={f("anySla")} value={filters.sla} onChange={(e) => set({ sla: e.target.value })} options={CASE_SLA_FILTERS.map((v) => ({ value: v, label: f(`slaChoices.${v}`) }))} containerClassName="min-w-[150px]" />
          <Select
            label={f("zone")}
            placeholder={f("allZones")}
            value={filters.zone_id}
            onChange={(e) => set({ zone_id: e.target.value })}
            options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
            containerClassName="min-w-[160px]"
          />
          <Select label={f("sort")} value={filters.sort || "sla"} onChange={(e) => set({ sort: e.target.value === "sla" ? "" : e.target.value })} options={CASE_SORTS.map((v) => ({ value: v, label: f(`sorts.${v}`) }))} containerClassName="min-w-[160px]" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="inbox-from" className="text-sm font-medium text-ink-900">
              {f("from")}
            </label>
            <input id="inbox-from" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="inbox-to" className="text-sm font-medium text-ink-900">
              {f("to")}
            </label>
            <input id="inbox-to" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" />
          </div>
          <Checkbox label={f("customerReplied")} checked={filters.customer_replied === "1"} onChange={(e) => set({ customer_replied: e.target.checked ? "1" : "" })} className="self-center" />
        </FilterBar>
        {(filters.worker_id !== "" || filters.customer_id !== "") && (
          <Notice
            tone="neutral"
            action={
              <button type="button" className="touch-target w-fit text-start text-sm font-bold text-petrol-700" onClick={() => set({ worker_id: "", customer_id: "" })}>
                {f("clearScope")}
              </button>
            }
          >
            {filters.worker_id !== "" ? f("oneWorker", { id: filters.worker_id }) : f("oneCustomer")}
          </Notice>
        )}
        {!rangeValid && <Notice tone="warning">{f("rangeInvalid")}</Notice>}
        {table}
      </Card>
      {pane && selected !== null && (
        <aside aria-label={t("pane")} className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <CaseView id={String(selected)} compact onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  );
}

