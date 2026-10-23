"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ButtonLink, Card, DataTable, EmptyState, FilterBar, Notice, PageHeader, SearchField, Select, StatusBadge, type Column } from "@/components/admin";
import { fetchInvoices } from "@/lib/admin/endpoints";
import { INVOICE_FILTERS, INVOICE_STATUSES, dateRangeValid, filterKey } from "@/lib/admin/finance/filters";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { BILLING_REFUSALS_PATH, DOCUMENTS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { AdminInvoice, InvoiceStatus } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Code, DateRangeFields, Money } from "../_components/FinanceParts";
import { invoiceTone, useFinanceText } from "../_components/financeText";
import { useUrlFilters } from "../_components/useUrlFilters";

const PER_PAGE = 25;

/**
 * A09 tax invoices (spec §9.3, §14.3, §17 "invoices & credit notes (view/download/resend)"; invoices.manage or
 * payments.view): number, issue date, customer, booking, status and totals; search by number, booking reference or
 * customer phone; filters in the URL.
 */
export function InvoicesScreen() {
  const t = useTranslations("admin.finance.invoices");
  return (
    <RequirePermission anyOf={DOCUMENTS_READ}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <ButtonLink href={BILLING_REFUSALS_PATH} variant="outline">
            {t("refusalsLink")}
          </ButtonLink>
        }
      />
      <InvoicesTable />
    </RequirePermission>
  );
}

function InvoicesTable() {
  const t = useTranslations("admin.finance.invoices");
  const f = useTranslations("admin.finance.filters");
  const text = useFinanceText();
  const { can } = useAdminSession();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(INVOICE_FILTERS);

  const search = useDebouncedValue(filters.search.trim(), 300);
  const rangeValid = dateRangeValid(filters);
  const list = useQuery({
    queryKey: adminKeys.invoiceList(filterKey(INVOICE_FILTERS, filters, { search })),
    queryFn: () =>
      fetchInvoices({
        page: filters.page,
        perPage: PER_PAGE,
        status: filters.status as InvoiceStatus | "",
        from: filters.from || undefined,
        to: filters.to || undefined,
        search: search || undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: rangeValid,
  });

  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const columns: Column<AdminInvoice>[] = [
    {
      id: "number",
      header: t("columns.number"),
      cell: (i) => (
        <Link href={`/admin/finance/invoices/${i.id}`} className="font-bold">
          <Code className="whitespace-nowrap">{i.number}</Code>
        </Link>
      ),
    },
    { id: "issued", header: t("columns.issueDate"), cell: (i) => <span className="whitespace-nowrap">{text.date(i.issue_date)}</span> },
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (i) => (
        <span className="flex flex-col">
          <span className="text-ink-900">{i.customer.name || t("noName")}</span>
          {i.customer.phone && (
            <span className="text-xs text-ink-600">
              <Code>{i.customer.phone}</Code>
            </span>
          )}
        </span>
      ),
    },
    {
      id: "booking",
      header: t("columns.booking"),
      cell: (i) =>
        i.booking.reference ? (
          i.booking.id !== null && can("bookings.view") ? (
            <Link href={`/admin/bookings/${i.booking.id}`} className="font-medium">
              <Code>{i.booking.reference}</Code>
            </Link>
          ) : (
            <Code>{i.booking.reference}</Code>
          )
        ) : (
          "—"
        ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (i) => <StatusBadge tone={invoiceTone[i.status] ?? "neutral"}>{text.invoice(i.status, i.status_label)}</StatusBadge>,
    },
    { id: "net", header: t("columns.net"), cell: (i) => <Money fils={i.net_fils} /> },
    { id: "vat", header: t("columns.vat"), cell: (i) => <Money fils={i.vat_fils} /> },
    { id: "total", header: t("columns.total"), cell: (i) => <Money fils={i.total_fils} className="font-bold text-ink-900" /> },
    {
      id: "credited",
      header: t("columns.credited"),
      cell: (i) => (i.credited_fils > 0 ? <Money fils={i.credited_fils} /> : <span className="text-ink-600">—</span>),
    },
    {
      id: "open",
      header: <span className="sr-only">{t("columns.open")}</span>,
      className: "text-end",
      cell: (i) => (
        <ButtonLink
          href={`/admin/finance/invoices/${i.id}`}
          variant="ghost"
          size="sm"
          className="flex-row-reverse"
          icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
          aria-label={t("openLabel", { number: i.number })}
        >
          {t("open")}
        </ButtonLink>
      ),
    },
  ];

  return (
    <Card>
      <FilterBar canReset={filtered} onReset={reset}>
        <SearchField label={f("documentSearch")} placeholder={f("invoiceSearchPlaceholder")} value={filters.search} onChange={(v) => set({ search: v })} />
        <Select
          label={f("status")}
          placeholder={f("allStatuses")}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          options={INVOICE_STATUSES.map((s) => ({ value: s, label: text.invoice(s) }))}
          containerClassName="min-w-[170px]"
        />
        <DateRangeFields from={filters.from} to={filters.to} onChange={set} valid={rangeValid} fromLabel={f("issuedFrom")} toLabel={f("issuedTo")} />
      </FilterBar>
      {!rangeValid && <Notice tone="warning">{f("rangeInvalid")}</Notice>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(i) => i.id}
        loading={list.isPending && rangeValid}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? f("emptyFilteredBody") : t("emptyBody")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={1080}
      />
    </Card>
  );
}
