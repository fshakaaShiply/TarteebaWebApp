"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, CustomerLink, DataTable, EmptyState, FilterBar, Notice, PageHeader, Select, StatusBadge, type Column } from "@/components/admin";
import { Ltr } from "../../bookings/_components/BookingBits";
import { useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { QUALITY_READ } from "@/lib/admin/nav";
import { fetchCompensations } from "@/lib/admin/quality/endpoints";
import { COMPENSATION_FILTERS, COMPENSATION_STATUS_CHOICES, compensationQuery } from "@/lib/admin/quality/filters";
import { qualityKeys } from "@/lib/admin/quality/keys";
import { compensationTone, useQualityText } from "@/lib/admin/quality/labels";
import type { Compensation } from "@/lib/admin/quality/types";
import { useAdminSession } from "@/lib/admin/session";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useUrlFilters } from "../../finance/_components/useUrlFilters";
import { ApproveCompensationDialog, RejectCompensationDialog } from "../_components/CompensationDialogs";

const PER_PAGE = 25;
const QUEUE_REFRESH_MS = 20_000;

/**
 * A10 compensations (spec §17 A10; design §4; compensation.approve or complaints.manage): what staff proposed and the
 * accountant decides. Waiting for approval by default, oldest first. A refund also needs refunds.create (the API says
 * 403 REFUND_PERMISSION_REQUIRED, the dialog says so first).
 */
export function CompensationsScreen() {
  const t = useTranslations("admin.quality.compensations");
  return (
    <RequirePermission anyOf={QUALITY_READ}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Queue />
    </RequirePermission>
  );
}

function Queue() {
  const t = useTranslations("admin.quality.compensations");
  const f = useTranslations("admin.quality.filters");
  const text = useQualityText();
  const { can } = useAdminSession();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(COMPENSATION_FILTERS);
  const query = useMemo(() => compensationQuery(filters, PER_PAGE), [filters]);
  const key = qualityKeys.compensationList({ ...filters });
  const list = useQuery({ queryKey: key, queryFn: () => fetchCompensations(query), placeholderData: keepPreviousData });
  useBackgroundRefresh(key, () => fetchCompensations(query), { everyMs: QUEUE_REFRESH_MS });

  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const mayDecide = can("compensation.approve");
  const [action, setAction] = useState<{ kind: "approve" | "reject"; row: Compensation } | null>(null);
  // The dialog follows the row the queue holds now; the click's copy stands in once the decision took it out of the list.
  const listed = action ? list.data?.data.find((r) => r.id === action.row.id) : undefined;
  const actionRow = listed ?? action?.row;

  const columns: Column<Compensation>[] = [
    {
      id: "case",
      header: t("columns.case"),
      cell: (r) =>
        r.case ? (
          <span className="flex flex-col gap-0.5">
            <Link href={`/admin/quality/${r.case.id}`} className="w-fit font-bold" aria-label={t("openCase", { reference: r.case.reference })}>
              <Ltr>{r.case.reference}</Ltr>
            </Link>
            <span className="text-xs text-ink-600">
              {text.type(r.case.type)} · {text.category(r.case.category)}
            </span>
          </span>
        ) : (
          "—"
        ),
    },
    { id: "customer", header: t("columns.customer"), cell: (r) => (r.customer ? <CustomerLink customer={r.customer} /> : "—") },
    {
      id: "compensation",
      header: t("columns.compensation"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-bold text-ink-900">
            {text.compensationType(r.type, r.type_label)}
            {r.type !== "free_visit" && ` · ${text.money(r.amount_fils)}`}
          </span>
          {r.destination && <span className="text-xs text-ink-600">{t(`destination.${r.destination}`)}</span>}
          {r.recovery_booking && (
            <span className="text-xs text-ink-600">
              {text.date(r.recovery_booking.service_date)} · <Ltr>{r.recovery_booking.reference}</Ltr>
            </span>
          )}
        </span>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={compensationTone[r.status]}>{text.compensationStatus(r.status, r.status_label)}</StatusBadge>
          {r.status === "failed" && r.failure_code && <span className="text-xs text-danger-700">{t(`failure.${r.failure_code}`)}</span>}
          {r.status === "executed" && !r.settled_at && <span className="text-xs text-ink-600">{t("notSettled")}</span>}
        </span>
      ),
    },
    {
      id: "proposed",
      header: t("columns.proposed"),
      cell: (r) => (
        <span className="flex flex-col text-xs">
          <span className="text-sm text-ink-900">{r.proposed_by?.name ?? "—"}</span>
          <span className="whitespace-nowrap text-ink-600">{text.dateTime(r.proposed_at)}</span>
        </span>
      ),
    },
    { id: "note", header: t("columns.note"), cell: (r) => (r.note ? <span className="text-ink-900">“{r.note}”</span> : <span className="text-ink-600">—</span>) },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      cell: (r) =>
        mayDecide && r.status === "pending_approval" ? (
          <span className="flex flex-col items-start gap-1">
            <Button size="sm" onClick={() => setAction({ kind: "approve", row: r })} aria-label={t("approveLabel", { reference: r.case?.reference ?? String(r.id) })}>
              {t("approve")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAction({ kind: "reject", row: r })} aria-label={t("rejectLabel", { reference: r.case?.reference ?? String(r.id) })}>
              {t("reject")}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <Card>
      <FilterBar canReset={filtered} onReset={reset}>
        <Select
          label={f("compensationStatus")}
          placeholder={f("pendingApproval")}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          options={COMPENSATION_STATUS_CHOICES.map((v) => ({ value: v, label: v === "all" ? f("allStatuses") : text.compensationStatus(v) }))}
          containerClassName="min-w-[190px]"
        />
        <Select
          label={f("compensationType")}
          placeholder={f("allCompensationTypes")}
          value={filters.type}
          onChange={(e) => set({ type: e.target.value })}
          options={(["refund", "credit", "free_visit"] as const).map((v) => ({ value: v, label: text.compensationType(v) }))}
          containerClassName="min-w-[180px]"
        />
      </FilterBar>
      {!mayDecide && <Notice tone="neutral">{t("readOnly")}</Notice>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? f("emptyFilteredBody") : t("emptyBody")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={1000}
      />
      {action?.kind === "approve" && actionRow && <ApproveCompensationDialog compensation={actionRow} onClose={() => setAction(null)} />}
      {action?.kind === "reject" && actionRow && <RejectCompensationDialog compensation={actionRow} onClose={() => setAction(null)} />}
    </Card>
  );
}
