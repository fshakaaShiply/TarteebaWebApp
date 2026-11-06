"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo } from "react";
import { ButtonLink, Card, Checkbox, DataTable, EmptyState, FilterBar, Notice, PageHeader, SearchField, Select, TextField, type Column } from "@/components/admin";
import { fetchAllWorkers } from "@/lib/admin/endpoints";
import { isolate } from "@/lib/admin/format";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { SUBSCRIPTIONS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import { fetchSubscriptions } from "@/lib/admin/subscriptions/endpoints";
import {
  NO_SUBSCRIPTION_FILTERS,
  SUBSCRIPTION_TYPES,
  filtersFromParams,
  filtersToParams,
  filtersToQuery,
  hasFilters,
  renewalRangeValid,
  toggleStatus,
  type SubscriptionFilters,
} from "@/lib/admin/subscriptions/filters";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import { SUBSCRIPTION_STATUSES, PAYMENT_HEALTHS, type SubscriptionRow } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { RequirePermission } from "../../_components/RequirePermission";
import { useChoiceOptions, useZoneChoices } from "../_ops/options";
import { DeadlineCountdown } from "../bookings/_components/BookingBits";
import { HealthChip, StatusChip } from "./_components/SubscriptionBits";
import { Ltr } from "./_components/kit";

const PER_PAGE = 25;

/**
 * A08 subscriptions (spec §17; design AdminSubscriptions.dc.html; subscriptions.view or subscriptions.manage): every
 * recurring and Live-out subscription with its status and payment health, filters kept in the URL (the overview's
 * links open the list filtered), a status strip with the counts the API gives under the other filters, server
 * pagination; a row opens the subscription.
 */
export function SubscriptionsScreen() {
  const t = useTranslations("admin.subscriptions");
  return (
    <RequirePermission anyOf={[...SUBSCRIPTIONS_READ]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SubscriptionsTable />
    </RequirePermission>
  );
}

function SubscriptionsTable() {
  const t = useTranslations("admin.subscriptions");
  const text = useSubscriptionText();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useAdminSession();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const zones = useZoneChoices();
  const choiceOptions = useChoiceOptions();
  const canSeeWorkers = can("workers.view");
  const workers = useQuery({ queryKey: adminKeys.workerOptions(), queryFn: fetchAllWorkers, staleTime: 60_000, enabled: canSeeWorkers });

  /** Filter changes stay in this page's URL without a server round trip (history.replaceState is synced by Next). */
  const writeParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );
  const setFilters = (next: Partial<SubscriptionFilters>) => writeParams(filtersToParams({ ...filters, page: 1, ...next }));

  const search = useDebouncedValue(filters.search.trim(), 300);
  const rangeValid = renewalRangeValid(filters);
  const query = filtersToQuery({ ...filters, search }, PER_PAGE);
  const { search: _search, ...keyFilters } = filters;
  void _search;
  const list = useQuery({
    queryKey: subscriptionKeys.list({ ...keyFilters, search }),
    queryFn: () => fetchSubscriptions(query),
    placeholderData: keepPreviousData,
    enabled: rangeValid,
  });

  // A page past the last one (the list shrank meanwhile) goes back to the last page instead of showing "no subscriptions".
  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) {
      writeParams(filtersToParams({ ...filters, page: Math.max(1, meta.last_page) }));
    }
  }, [meta, list.isPlaceholderData, filters, writeParams]);

  const withSelected = (options: { value: string; label: string }[], value: string) =>
    value && !options.some((o) => o.value === value) ? [...options, { value, label: t("filters.unknownChoice", { id: value }) }] : options;
  const zoneOptions = withSelected(choiceOptions(zones.data), filters.zone_id);
  const workerOptions = withSelected(
    [...(workers.data ?? [])].sort((a, b) => a.display_name.localeCompare(b.display_name)).map((w) => ({ value: String(w.id), label: w.display_name })),
    filters.worker_id,
  );

  const columns: Column<SubscriptionRow>[] = [
    {
      id: "reference",
      header: t("columns.reference"),
      cell: (s) => (
        <span className="flex flex-col">
          <Link href={`/admin/subscriptions/${s.id}`} className="font-bold">
            <Ltr className="whitespace-nowrap">{s.reference}</Ltr>
          </Link>
          <span className="text-xs text-ink-600">{text.type(s.type)}</span>
        </span>
      ),
    },
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (s) => (
        <span className="flex flex-col">
          <span className="text-ink-900">{s.customer.name || t("noName")}</span>
          {s.customer.phone_masked && (
            <span className="text-xs text-ink-600">
              <Ltr>{s.customer.phone_masked}</Ltr>
            </span>
          )}
        </span>
      ),
    },
    {
      id: "plan",
      header: t("columns.plan"),
      cell: (s) => (
        <span className="flex flex-col">
          <span>{text.name(s.plan_label) || text.type(s.type)}</span>
          {s.visits_per_week !== null && <span className="text-xs text-ink-600">{t("perWeek", { count: s.visits_per_week })}</span>}
        </span>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (s) => (
        <span className="flex flex-col items-start gap-1">
          <StatusChip status={s.status} label={s.status_label} pausedTo={s.paused_to} />
          {s.status === "pending_confirmation" && <DeadlineCountdown deadline={s.confirmation_deadline_at} />}
          <span className="flex flex-wrap gap-1">
            {s.conflicts_count > 0 && <span className="text-xs font-medium text-danger-700">{t("conflicts", { count: s.conflicts_count })}</span>}
            {s.cancel_review_requested_at && <span className="text-xs font-medium text-warning-700">{t("cancelReview")}</span>}
          </span>
        </span>
      ),
    },
    {
      id: "renewal",
      header: t("columns.renewal"),
      cell: (s) =>
        s.next_renewal_at ? (
          <span className="flex flex-col">
            <span>{text.instantDate(s.next_renewal_at)}</span>
            {s.renewal_attempts > 0 && <span className="text-xs text-warning-700">{t("attempts", { count: s.renewal_attempts })}</span>}
          </span>
        ) : (
          <span className="text-ink-600">{s.status === "pending_confirmation" && s.first_visit_at ? t("firstVisit", { date: text.instantDate(s.first_visit_at) }) : "—"}</span>
        ),
    },
    { id: "payment", header: t("columns.payment"), cell: (s) => <HealthChip health={s.payment_health} /> },
    {
      id: "workers",
      header: t("columns.workers"),
      cell: (s) => (
        <span className="flex flex-col text-sm">
          <span>{s.primary_worker ? <bdi>{s.primary_worker.name}</bdi> : <span className="text-ink-600">{t("noWorker")}</span>}</span>
          {s.backup_worker && <span className="text-xs text-ink-600">{t("backup", { name: isolate(s.backup_worker.name) })}</span>}
        </span>
      ),
    },
    { id: "zone", header: t("columns.zone"), cell: (s) => text.name(s.zone.name) },
    {
      id: "open",
      header: <span className="sr-only">{t("columns.open")}</span>,
      className: "text-end",
      cell: (s) => (
        <ButtonLink
          href={`/admin/subscriptions/${s.id}`}
          variant="ghost"
          size="sm"
          className="flex-row-reverse"
          icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
          aria-label={t("openLabel", { reference: s.reference })}
        >
          {t("open")}
        </ButtonLink>
      ),
    },
  ];

  const filtered = hasFilters(filters);
  const counts = list.data?.meta.counts_by_status ?? {};
  const chipStatuses = SUBSCRIPTION_STATUSES.filter((s) => (counts[s] ?? 0) > 0 || filters.status.includes(s));

  return (
    <Card>
      <FilterBar canReset={filtered} onReset={() => writeParams(filtersToParams(NO_SUBSCRIPTION_FILTERS))}>
        <SearchField label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} value={filters.search} onChange={(v) => setFilters({ search: v })} />
        <Select
          label={t("filters.type")}
          placeholder={t("filters.allTypes")}
          value={filters.type}
          onChange={(e) => setFilters({ type: e.target.value as SubscriptionFilters["type"] })}
          options={SUBSCRIPTION_TYPES.map((v) => ({ value: v, label: text.type(v) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.health")}
          placeholder={t("filters.allHealths")}
          value={filters.payment_health}
          onChange={(e) => setFilters({ payment_health: e.target.value as SubscriptionFilters["payment_health"] })}
          options={PAYMENT_HEALTHS.map((v) => ({ value: v, label: text.health(v) }))}
          containerClassName="min-w-[170px]"
        />
        {(zones.data || filters.zone_id) && (
          <Select
            label={t("filters.zone")}
            placeholder={t("filters.allZones")}
            value={filters.zone_id}
            onChange={(e) => setFilters({ zone_id: e.target.value })}
            options={zoneOptions}
            containerClassName="min-w-[170px]"
          />
        )}
        {(canSeeWorkers || filters.worker_id) && (
          <Select
            label={t("filters.worker")}
            placeholder={t("filters.allWorkers")}
            value={filters.worker_id}
            onChange={(e) => setFilters({ worker_id: e.target.value })}
            options={workerOptions}
            containerClassName="min-w-[170px]"
          />
        )}
        <TextField
          type="date"
          label={t("filters.renewalFrom")}
          value={filters.renewal_from}
          onChange={(e) => setFilters({ renewal_from: e.target.value })}
          dir="ltr"
          className="font-latin text-start"
          containerClassName="min-w-[160px]"
        />
        <TextField
          type="date"
          label={t("filters.renewalTo")}
          value={filters.renewal_to}
          onChange={(e) => setFilters({ renewal_to: e.target.value })}
          dir="ltr"
          className="font-latin text-start"
          containerClassName="min-w-[160px]"
          error={rangeValid ? undefined : t("filters.rangeInvalid")}
        />
        <Checkbox label={t("filters.conflicts")} checked={filters.conflicts} onChange={(e) => setFilters({ conflicts: e.target.checked })} className="self-center" />
        <Checkbox label={t("filters.cancelReview")} checked={filters.cancel_review} onChange={(e) => setFilters({ cancel_review: e.target.checked })} className="self-center" />
      </FilterBar>

      {chipStatuses.length > 0 && (
        <div role="group" aria-label={t("statusStrip")} className="flex flex-wrap gap-1.5">
          {chipStatuses.map((s) => {
            const on = filters.status.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => writeParams(filtersToParams(toggleStatus(filters, s)))}
                className={clsx(
                  "touch-target rounded-full border px-3 py-1 text-sm transition-colors",
                  on ? "border-petrol-700 bg-petrol-50 font-bold text-petrol-700" : "border-line bg-surface text-ink-900 hover:bg-neutral-100",
                )}
              >
                {text.status(s)} <span className="font-latin text-ink-600">{counts[s] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      {!rangeValid && <Notice tone="warning">{t("filters.rangeInvalid")}</Notice>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(s) => s.id}
        loading={list.isPending && rangeValid}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? t("emptyFilteredBody") : undefined} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: (next) => writeParams(filtersToParams({ ...filters, page: next })) } : undefined}
        minWidth={1100}
      />
    </Card>
  );
}
