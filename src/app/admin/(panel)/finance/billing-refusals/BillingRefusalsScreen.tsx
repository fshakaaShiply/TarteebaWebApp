"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Card, DataTable, EmptyState, FilterBar, Notice, PageHeader, Select, StatusBadge, useToast, type Column } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { fetchBillingRefusals, retryBillingRefusal } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { BILLING_DOCUMENTS, REFUSAL_FILTERS, filterKey, idOrUndefined } from "@/lib/admin/finance/filters";
import { adminKeys } from "@/lib/admin/keys";
import { DOCUMENTS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { BillingDocument, BillingRefusal } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Code, Money } from "../_components/FinanceParts";
import { useFinanceText } from "../_components/financeText";
import { useUrlFilters } from "../_components/useUrlFilters";

const PER_PAGE = 25;

/**
 * A09 refused documents (Billing review fix; invoices.manage or payments.view): tax invoices and credit notes Billing
 * would not issue because the records disagree, with the reasons and the amounts compared. Once a person has corrected
 * the records, invoices.manage retries now instead of waiting for the next automatic retry; nothing is issued that
 * the records do not support.
 */
export function BillingRefusalsScreen() {
  const t = useTranslations("admin.finance.refusals");
  return (
    <RequirePermission anyOf={DOCUMENTS_READ}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <RefusalsTable />
    </RequirePermission>
  );
}

function RefusalsTable() {
  const t = useTranslations("admin.finance.refusals");
  const f = useTranslations("admin.finance.filters");
  const text = useFinanceText();
  const { can } = useAdminSession();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(REFUSAL_FILTERS);
  const list = useQuery({
    queryKey: adminKeys.billingRefusalList(filterKey(REFUSAL_FILTERS, filters, {})),
    queryFn: () =>
      fetchBillingRefusals({
        page: filters.page,
        perPage: PER_PAGE,
        document: filters.document as BillingDocument | "",
        paymentId: idOrUndefined(filters.payment_id),
      }),
    placeholderData: keepPreviousData,
  });

  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const columns: Column<BillingRefusal>[] = [
    {
      id: "document",
      header: t("columns.document"),
      cell: (r) => (
        <span className="flex flex-col gap-1">
          <span className="font-bold text-ink-900">{text.document(r.document)}</span>
          {r.reported ? <StatusBadge tone="pending">{t("reported")}</StatusBadge> : <StatusBadge tone="neutral">{t("notReported")}</StatusBadge>}
        </span>
      ),
    },
    {
      id: "payment",
      header: t("columns.payment"),
      cell: (r) => (
        <span className="flex flex-col text-sm">
          {can("payments.view") ? (
            <Link href={`/admin/finance/payments/${r.payment_id}`} className="font-medium">
              {t("payment", { id: r.payment_id })}
            </Link>
          ) : (
            <Code>#{r.payment_id}</Code>
          )}
          {r.refund_id !== null && <span className="text-xs text-ink-600">{t("refund", { id: r.refund_id })}</span>}
        </span>
      ),
    },
    {
      id: "problems",
      header: t("columns.problems"),
      cell: (r) => (
        <ul className="flex flex-col gap-0.5 text-sm">
          {r.problems.map((p) => (
            <li key={p}>{text.problem(p)}</li>
          ))}
        </ul>
      ),
    },
    { id: "details", header: t("columns.details"), cell: (r) => <RefusalDetails details={r.details} /> },
    {
      id: "when",
      header: t("columns.when"),
      cell: (r) => (
        <span className="flex flex-col text-xs text-ink-600">
          <span className="text-sm text-ink-900">{t("lastRefused", { time: text.dateTime(r.last_refused_at) })}</span>
          <span>{t("attempts", { count: r.attempts })}</span>
          <span>{t("retryAfter", { time: text.dateTime(r.retry_after) })}</span>
        </span>
      ),
    },
    ...(can("invoices.manage")
      ? [{ id: "retry", header: <span className="sr-only">{t("columns.retry")}</span>, className: "text-end", cell: (r: BillingRefusal) => <RetryButton refusal={r} /> }]
      : []),
  ];

  return (
    <Card>
      <FilterBar canReset={filtered} onReset={reset}>
        <Select
          label={f("document")}
          placeholder={f("allDocuments")}
          value={filters.document}
          onChange={(e) => set({ document: e.target.value })}
          options={BILLING_DOCUMENTS.map((d) => ({ value: d, label: text.document(d) }))}
          containerClassName="min-w-[200px]"
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
    </Card>
  );
}

/** The amounts Billing compared (fils as AED, other values as written). */
function RefusalDetails({ details }: { details: Record<string, unknown> }) {
  const t = useTranslations("admin.finance.refusals.detailKeys");
  const entries = Object.entries(details).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return <span className="text-ink-600">—</span>;
  return (
    <dl className="flex flex-col gap-0.5 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap gap-1">
          <dt className="text-ink-600">{t.has(key) ? t(key) : key}:</dt>
          <dd className="text-ink-900">
            {key.endsWith("_fils") && typeof value === "number" ? <Money fils={value} /> : <Code>{typeof value === "string" ? value : JSON.stringify(value)}</Code>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RetryButton({ refusal }: { refusal: BillingRefusal }) {
  const t = useTranslations("admin.finance.refusals");
  const text = useFinanceText();
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [stillRefused, setStillRefused] = useState<string[] | null>(null);
  const retry = useMutation({
    mutationFn: () => retryBillingRefusal(refusal.id),
    onSuccess: (result) => {
      setStillRefused(null);
      toast.success(t("issued", { document: text.document(result.document), number: result.number }));
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "BILLING_DOCUMENT_REFUSED") {
        const problems = error.details.problems;
        setStillRefused(Array.isArray(problems) ? problems.filter((p): p is string => typeof p === "string") : []);
        void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
        return;
      }
      setStillRefused(null);
      toast.error(describe(error));
    },
  });
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => retry.mutate()}
        loading={retry.isPending}
        icon={<RotateCw aria-hidden className="size-4" />}
        aria-label={t("retryLabel", { document: text.document(refusal.document), id: refusal.payment_id })}
      >
        {t("retry")}
      </Button>
      {stillRefused && (
        <p role="status" className="max-w-[240px] text-end text-xs font-medium text-danger-700">
          {t("stillRefused", { problems: stillRefused.map((p) => text.problem(p)).join(t("separator")) || t("unknownProblem") })}
        </p>
      )}
    </div>
  );
}
