"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState, FilterBar, PageHeader, Select } from "@/components/admin";
import { INCENTIVES_READ } from "@/lib/admin/nav";
import type { FilterSpec } from "@/lib/admin/finance/filters";
import { fetchPostings } from "@/lib/admin/workforce/endpoints";
import { closedPeriods, isPeriod } from "@/lib/admin/workforce/incentives";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { IncentivePosting } from "@/lib/admin/workforce/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useUrlFilters } from "../_components/useUrlFilters";

const FILTERS = { period: { kind: "text", max: 7 } } as const satisfies FilterSpec;

/**
 * A09 incentive postings (incentives.approve or incentives.view; workforce §5.6): the payroll files HR posted, one per
 * posting, which accounting downloads. A posting is final: its lines are never changed, a correction is an adjustment
 * posted with a later one. Payroll is not a customer payment, so nothing here touches the payment cards or refunds.
 */
export function IncentivePostingsScreen() {
  const t = useTranslations("admin.incentives.postings");
  return (
    <RequirePermission anyOf={INCENTIVES_READ}>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <PostingsTable />
    </RequirePermission>
  );
}

function PostingsTable() {
  const t = useTranslations("admin.incentives.postings");
  const wt = useWorkforceText();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(FILTERS);
  const period = isPeriod(filters.period) ? filters.period : "";
  // The months to pick from: the last two years, plus the one a link names that falls outside them.
  const months = closedPeriods(24);
  const options = period && !months.includes(period) ? [period, ...months] : months;
  const query = useQuery({
    queryKey: workforceKeys.postings({ period, page: filters.page }),
    queryFn: () => fetchPostings({ period: period || undefined, page: filters.page }),
    placeholderData: keepPreviousData,
  });
  const columns = [
    {
      id: "reference",
      header: t("columns.reference"),
      cell: (p: IncentivePosting) => (
        <Link href={`/admin/finance/incentive-postings/${p.id}`} className="font-bold">
          <bdi dir="ltr" className="font-latin">
            {p.reference}
          </bdi>
        </Link>
      ),
    },
    { id: "period", header: t("columns.period"), cell: (p: IncentivePosting) => wt.month(p.period.start.slice(0, 7)) },
    { id: "lines", header: t("columns.lines"), cell: (p: IncentivePosting) => <span className="font-latin">{p.lines_count}</span> },
    {
      id: "total",
      header: t("columns.total"),
      cell: (p: IncentivePosting) => (
        <span className="font-latin font-bold" dir="ltr">
          {wt.money(p.total_fils)}
        </span>
      ),
    },
    { id: "by", header: t("columns.by"), cell: (p: IncentivePosting) => (p.posted_by ? <bdi>{p.posted_by.name}</bdi> : <span className="text-ink-600">—</span>) },
    { id: "at", header: t("columns.at"), cell: (p: IncentivePosting) => wt.dateTime(p.posted_at) },
  ];
  return (
    <Card>
      <FilterBar canReset={filtered} onReset={reset}>
        <Select label={t("filters.period")} placeholder={t("filters.allPeriods")} value={period} onChange={(e) => set({ period: e.target.value })} options={options.map((p) => ({ value: p, label: wt.month(p) }))} containerClassName="min-w-[200px]" />
      </FilterBar>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={query.data?.data}
        getRowId={(p) => p.id}
        loading={query.isPending}
        fetching={query.isFetching && !query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? undefined : t("emptyBody")} />}
        pagination={query.data ? { meta: query.data.meta, onPageChange: setPage } : undefined}
        minWidth={760}
      />
    </Card>
  );
}
