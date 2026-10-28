"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button, Card, Checkbox, DataTable, EmptyState, FilterBar, Notice, PageHeader, SearchField, Select, StatusBadge, type Column } from "@/components/admin";
import { fetchRefunds } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { REFUND_FILTERS, dateRangeValid, filterKey, idOrUndefined, phoneSearchValid } from "@/lib/admin/finance/filters";
import { REFUND_STATUSES } from "@/lib/admin/finance/refund";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { REFUNDS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { AdminRefund, RefundStatus } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Code, CreditNoteNumber, DateRangeFields, Money, ReviewBadge } from "../_components/FinanceParts";
import { refundTone, useFinanceText } from "../_components/financeText";
import { useRefundReasons } from "../_components/useRefundReasons";
import { useUrlFilters } from "../_components/useUrlFilters";

const PER_PAGE = 25;

/**
 * A09 refunds (spec §10.4, §14.3 GET /admin/refunds; refunds.create or payments.view): every refund with the
 * provider's status, newest first, filtered by status, dates, reason, review flag, customer phone or payment.
 */
export function RefundsScreen() {
  const t = useTranslations("admin.finance.refunds");
  return (
    <RequirePermission anyOf={REFUNDS_READ}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <RefundsTable />
    </RequirePermission>
  );
}

function RefundsTable() {
  const t = useTranslations("admin.finance.refunds");
  const f = useTranslations("admin.finance.filters");
  // The refund dialog's words for the same list of reasons.
  const reasonText = useTranslations("admin.finance.refund");
  const describe = useAdminErrorMessage();
  const text = useFinanceText();
  const { can } = useAdminSession();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(REFUND_FILTERS);
  const reasons = useRefundReasons();
  // Every reason the API lists, the system-only ones too; one in the URL it does not name stays visible as its code.
  const reasonOptions = (reasons.data ?? []).map((r) => ({ value: r.code, label: text.reason(r.label) }));
  if (filters.reason_code !== "" && !reasonOptions.some((o) => o.value === filters.reason_code)) {
    reasonOptions.push({ value: filters.reason_code, label: filters.reason_code });
  }

  const phone = useDebouncedValue(filters.phone.trim(), 300);
  const rangeValid = dateRangeValid(filters);
  const phoneValid = phoneSearchValid(phone);
  const list = useQuery({
    queryKey: adminKeys.refundList(filterKey(REFUND_FILTERS, filters, { phone })),
    queryFn: () =>
      fetchRefunds({
        page: filters.page,
        perPage: PER_PAGE,
        status: filters.status as RefundStatus | "",
        from: filters.from || undefined,
        to: filters.to || undefined,
        paymentId: idOrUndefined(filters.payment_id),
        reasonCode: filters.reason_code || undefined,
        needsReview: filters.needs_review === "1",
        phone: phone || undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: rangeValid && phoneValid,
  });

  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const seesPayments = can("payments.view");
  const columns: Column<AdminRefund>[] = [
    {
      id: "created",
      header: t("columns.created"),
      cell: (r) => <span className="whitespace-nowrap">{text.dateTime(r.created_at)}</span>,
    },
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (r) =>
        r.customer ? (
          <span className="flex flex-col">
            <span className="text-ink-900">{r.customer.name || t("noName")}</span>
            <span className="text-xs text-ink-600">
              <Code>{r.customer.phone}</Code>
            </span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "payment",
      header: t("columns.payment"),
      cell: (r) =>
        r.payment ? (
          seesPayments ? (
            <Link href={`/admin/finance/payments/${r.payment.id}`} className="font-medium">
              <Code className="text-xs">{r.payment.gateway_payment_ref ?? r.payment.ulid}</Code>
            </Link>
          ) : (
            <Code className="text-xs">{r.payment.gateway_payment_ref ?? r.payment.ulid}</Code>
          )
        ) : (
          "—"
        ),
    },
    { id: "amount", header: t("columns.amount"), cell: (r) => <Money fils={r.amount_fils} className="font-bold text-ink-900" /> },
    {
      id: "status",
      header: t("columns.status"),
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge tone={refundTone[r.status] ?? "neutral"}>{text.refund(r.status, r.status_label)}</StatusBadge>
            {r.needs_review && <ReviewBadge />}
          </span>
          {r.status !== "succeeded" && r.status !== "failed" && text.either(r.estimated_arrival_text) && (
            <span className="text-xs text-ink-600">{t("estimate", { text: text.either(r.estimated_arrival_text) })}</span>
          )}
        </span>
      ),
    },
    {
      id: "reason",
      header: t("columns.reason"),
      cell: (r) => (
        <span className="flex flex-col">
          <span>{text.reason(r.reason_label)}</span>
          {r.reason_text && <span className="text-xs text-ink-600">“{r.reason_text}”</span>}
        </span>
      ),
    },
    {
      id: "requestedBy",
      header: t("columns.requestedBy"),
      cell: (r) => r.requested_by.name ?? text.requester(r.requested_by.type),
    },
    {
      id: "documents",
      header: t("columns.creditNote"),
      cell: (r) => (r.credit_note ? <CreditNoteNumber note={r.credit_note} /> : <span className="text-ink-600">—</span>),
    },
  ];

  return (
    <Card>
      <FilterBar canReset={filtered} onReset={reset}>
        <SearchField label={f("phone")} placeholder={f("phonePlaceholder")} value={filters.phone} onChange={(v) => set({ phone: v })} className="max-w-[240px]" />
        <Select
          label={f("status")}
          placeholder={f("allStatuses")}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          options={REFUND_STATUSES.map((s) => ({ value: s, label: text.refund(s) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={f("reason")}
          placeholder={reasons.isPending ? reasonText("reasonsLoading") : f("allReasons")}
          disabled={reasons.isPending}
          value={filters.reason_code}
          onChange={(e) => set({ reason_code: e.target.value })}
          options={reasonOptions}
          containerClassName="min-w-[200px]"
        />
        <DateRangeFields from={filters.from} to={filters.to} onChange={set} valid={rangeValid} fromLabel={f("createdFrom")} toLabel={f("createdTo")} />
        <Checkbox
          label={f("needsReview")}
          checked={filters.needs_review === "1"}
          onChange={(e) => set({ needs_review: e.target.checked ? "1" : "" })}
          className="self-center"
        />
      </FilterBar>
      {filters.payment_id !== "" && (
        <Notice
          tone="neutral"
          action={
            <button type="button" className="touch-target w-fit text-start text-sm font-bold text-petrol-700" onClick={() => set({ payment_id: "" })}>
              {f("showAllPayments")}
            </button>
          }
        >
          {f("onePayment", { id: filters.payment_id })}
        </Notice>
      )}
      {reasons.isError && (
        // Only the reason filter is affected: the list itself still loads.
        <Notice
          tone="warning"
          title={reasonText("reasonsFailed")}
          action={
            <Button variant="secondary" size="sm" className="self-start" onClick={() => void reasons.refetch()} loading={reasons.isFetching}>
              {reasonText("reasonsRetry")}
            </Button>
          }
        >
          {describe(reasons.error)}
        </Notice>
      )}
      {!rangeValid && <Notice tone="warning">{f("rangeInvalid")}</Notice>}
      {!phoneValid && <Notice tone="warning">{f("phoneInvalid")}</Notice>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        loading={list.isPending && rangeValid && phoneValid}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? f("emptyFilteredBody") : undefined} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={1100}
      />
    </Card>
  );
}
