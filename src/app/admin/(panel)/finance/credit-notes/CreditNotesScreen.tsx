"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ButtonLink, Card, DataTable, EmptyState, FilterBar, Notice, PageHeader, SearchField, type Column } from "@/components/admin";
import { fetchCreditNotes } from "@/lib/admin/endpoints";
import { CREDIT_NOTE_FILTERS, dateRangeValid, filterKey, idOrUndefined } from "@/lib/admin/finance/filters";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { DOCUMENTS_READ } from "@/lib/admin/nav";
import type { AdminCreditNote } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Code, DateRangeFields, Money } from "../_components/FinanceParts";
import { useFinanceText } from "../_components/financeText";
import { useUrlFilters } from "../_components/useUrlFilters";

const PER_PAGE = 25;

/**
 * A09 credit notes (spec §9.3 "refund → credit note referencing the original invoice", §14.3; invoices.manage or
 * payments.view): number, date, the invoice it credits, customer, reason and amounts.
 */
export function CreditNotesScreen() {
  const t = useTranslations("admin.finance.creditNotes");
  return (
    <RequirePermission anyOf={DOCUMENTS_READ}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <CreditNotesTable />
    </RequirePermission>
  );
}

function CreditNotesTable() {
  const t = useTranslations("admin.finance.creditNotes");
  const f = useTranslations("admin.finance.filters");
  const text = useFinanceText();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(CREDIT_NOTE_FILTERS);

  const search = useDebouncedValue(filters.search.trim(), 300);
  const rangeValid = dateRangeValid(filters);
  const list = useQuery({
    queryKey: adminKeys.creditNoteList(filterKey(CREDIT_NOTE_FILTERS, filters, { search })),
    queryFn: () =>
      fetchCreditNotes({
        page: filters.page,
        perPage: PER_PAGE,
        from: filters.from || undefined,
        to: filters.to || undefined,
        invoiceId: idOrUndefined(filters.invoice_id),
        search: search || undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: rangeValid,
  });

  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const columns: Column<AdminCreditNote>[] = [
    {
      id: "number",
      header: t("columns.number"),
      cell: (n) => (
        <Link href={`/admin/finance/credit-notes/${n.id}`} className="font-bold">
          <Code className="whitespace-nowrap">{n.number}</Code>
        </Link>
      ),
    },
    { id: "issued", header: t("columns.issueDate"), cell: (n) => <span className="whitespace-nowrap">{text.date(n.issue_date)}</span> },
    {
      id: "invoice",
      header: t("columns.invoice"),
      cell: (n) => (
        <Link href={`/admin/finance/invoices/${n.invoice.id}`} className="font-medium">
          <Code>{n.invoice.number}</Code>
        </Link>
      ),
    },
    { id: "customer", header: t("columns.customer"), cell: (n) => n.customer.name || t("noName") },
    { id: "booking", header: t("columns.booking"), cell: (n) => (n.booking_reference ? <Code>{n.booking_reference}</Code> : "—") },
    { id: "reason", header: t("columns.reason"), cell: (n) => text.reason(n.reason_code) },
    { id: "vat", header: t("columns.vat"), cell: (n) => <Money fils={n.vat_fils} /> },
    { id: "total", header: t("columns.total"), cell: (n) => <Money fils={n.total_fils} className="font-bold text-ink-900" /> },
    {
      id: "open",
      header: <span className="sr-only">{t("columns.open")}</span>,
      className: "text-end",
      cell: (n) => (
        <ButtonLink
          href={`/admin/finance/credit-notes/${n.id}`}
          variant="ghost"
          size="sm"
          className="flex-row-reverse"
          icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
          aria-label={t("openLabel", { number: n.number })}
        >
          {t("open")}
        </ButtonLink>
      ),
    },
  ];

  return (
    <Card>
      <FilterBar canReset={filtered} onReset={reset}>
        <SearchField label={f("documentSearch")} placeholder={f("creditNoteSearchPlaceholder")} value={filters.search} onChange={(v) => set({ search: v })} />
        <DateRangeFields from={filters.from} to={filters.to} onChange={set} valid={rangeValid} fromLabel={f("issuedFrom")} toLabel={f("issuedTo")} />
      </FilterBar>
      {filters.invoice_id !== "" && (
        <Notice
          tone="neutral"
          action={
            <button type="button" className="touch-target w-fit text-start text-sm font-bold text-petrol-700" onClick={() => set({ invoice_id: "" })}>
              {f("showAllInvoices")}
            </button>
          }
        >
          {f("oneInvoice", { id: filters.invoice_id })}
        </Notice>
      )}
      {!rangeValid && <Notice tone="warning">{f("rangeInvalid")}</Notice>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(n) => n.id}
        loading={list.isPending && rangeValid}
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
