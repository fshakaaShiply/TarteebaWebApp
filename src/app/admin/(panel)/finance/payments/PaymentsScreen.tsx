"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import {
  ButtonLink,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  Notice,
  PageHeader,
  SearchField,
  Select,
  StatusBadge,
  type Column,
} from "@/components/admin";
import { PAYMENT_STATUSES } from "@/lib/admin/bookings/filters";
import { fetchPayments } from "@/lib/admin/endpoints";
import { PAYABLE_TYPES, PAYMENT_FILTERS, dateRangeValid, filterKey, phoneSearchValid } from "@/lib/admin/finance/filters";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { AdminPayment, PaymentStatus } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { paymentTone } from "../../bookings/_components/bookingText";
import { Code, DateRangeFields, Money, ReviewBadge } from "../_components/FinanceParts";
import { useFinanceText } from "../_components/financeText";
import { useUrlFilters } from "../_components/useUrlFilters";

const PER_PAGE = 25;

/**
 * A09 transactions (spec §14.3, §17; design AdminFinance.dc.html; payments.view): provider reference, payable, status
 * as the provider reported it, amount, VAT, discount, net of VAT, captured and refunded; filters in the URL.
 */
export function PaymentsScreen() {
  const t = useTranslations("admin.finance.payments");
  return (
    <RequirePermission anyOf={["payments.view"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <PaymentsTable />
    </RequirePermission>
  );
}

function PaymentsTable() {
  const t = useTranslations("admin.finance.payments");
  const f = useTranslations("admin.finance.filters");
  const text = useFinanceText();
  const { can } = useAdminSession();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(PAYMENT_FILTERS);

  const phone = useDebouncedValue(filters.phone.trim(), 300);
  const reference = useDebouncedValue(filters.reference.trim(), 300);
  const rangeValid = dateRangeValid(filters);
  const phoneValid = phoneSearchValid(phone);
  const list = useQuery({
    queryKey: adminKeys.paymentList(filterKey(PAYMENT_FILTERS, filters, { phone, reference })),
    queryFn: () =>
      fetchPayments({
        page: filters.page,
        perPage: PER_PAGE,
        status: filters.status as PaymentStatus | "",
        from: filters.from || undefined,
        to: filters.to || undefined,
        phone: phone || undefined,
        payableType: filters.payable_type || undefined,
        needsReview: filters.needs_review === "1",
        reference: reference || undefined,
      }),
    placeholderData: keepPreviousData,
    enabled: rangeValid && phoneValid,
  });

  // A page past the last one (the list shrank meanwhile) goes back to the last page instead of showing "no payments".
  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const columns: Column<AdminPayment>[] = [
    {
      id: "reference",
      header: t("columns.reference"),
      cell: (p) => (
        <span className="flex flex-col">
          <Link href={`/admin/finance/payments/${p.id}`} className="font-bold">
            <Code className="whitespace-nowrap">{p.gateway_payment_ref ?? t("noReference")}</Code>
          </Link>
          <span className="text-xs text-ink-600">{text.dateTime(p.created_at)}</span>
        </span>
      ),
    },
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (p) =>
        p.customer ? (
          <span className="flex flex-col">
            <span className="text-ink-900">{p.customer.name || t("noName")}</span>
            <span className="text-xs text-ink-600">
              <Code>{p.customer.phone}</Code>
            </span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "payable",
      header: t("columns.payable"),
      cell: (p) =>
        p.payable.type === "booking" && can("bookings.view") ? (
          <Link href={`/admin/bookings/${p.payable.id}`} className="text-sm font-medium">
            {t("bookingLink", { id: p.payable.id })}
          </Link>
        ) : (
          <span className="text-sm">
            {text.payable(p.payable.type)} <Code>#{p.payable.id}</Code>
          </span>
        ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge tone={paymentTone[p.status] ?? "neutral"}>{text.payment(p.status, p.status_label)}</StatusBadge>
          {p.needs_review && <ReviewBadge />}
        </span>
      ),
    },
    { id: "amount", header: t("columns.amount"), cell: (p) => <Money fils={p.amount_fils} /> },
    { id: "vat", header: t("columns.vat"), cell: (p) => <Money fils={p.vat_fils} /> },
    { id: "discount", header: t("columns.discount"), cell: (p) => <Money fils={p.discount_fils} /> },
    { id: "net", header: t("columns.net"), cell: (p) => <Money fils={p.net_fils} /> },
    {
      id: "captured",
      header: t("columns.capturedRefunded"),
      cell: (p) => (
        <span className="flex flex-col text-sm">
          <Money fils={p.captured_fils} />
          {p.refunded_fils > 0 && (
            <span className="text-xs text-ink-600">
              {t("refundedShort")} <Money fils={p.refunded_fils} />
            </span>
          )}
        </span>
      ),
    },
    {
      id: "open",
      header: <span className="sr-only">{t("columns.open")}</span>,
      className: "text-end",
      cell: (p) => (
        <ButtonLink
          href={`/admin/finance/payments/${p.id}`}
          variant="ghost"
          size="sm"
          className="flex-row-reverse"
          icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
          aria-label={t("openLabel", { reference: p.gateway_payment_ref ?? p.ulid })}
        >
          {t("open")}
        </ButtonLink>
      ),
    },
  ];

  return (
    <Card>
      <FilterBar canReset={filtered} onReset={reset}>
        <SearchField
          label={f("reference")}
          placeholder={f("referencePlaceholder")}
          value={filters.reference}
          onChange={(v) => set({ reference: v })}
        />
        <SearchField label={f("phone")} placeholder={f("phonePlaceholder")} value={filters.phone} onChange={(v) => set({ phone: v })} className="max-w-[240px]" />
        <Select
          label={f("status")}
          placeholder={f("allStatuses")}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          options={PAYMENT_STATUSES.map((s) => ({ value: s, label: text.payment(s) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={f("payableType")}
          placeholder={f("allPayables")}
          value={filters.payable_type}
          onChange={(e) => set({ payable_type: e.target.value })}
          options={PAYABLE_TYPES.map((s) => ({ value: s, label: text.payable(s) }))}
          containerClassName="min-w-[160px]"
        />
        <DateRangeFields
          from={filters.from}
          to={filters.to}
          onChange={set}
          valid={rangeValid}
          fromLabel={f("createdFrom")}
          toLabel={f("createdTo")}
        />
        <Checkbox
          label={f("needsReview")}
          checked={filters.needs_review === "1"}
          onChange={(e) => set({ needs_review: e.target.checked ? "1" : "" })}
          className="self-center"
        />
      </FilterBar>
      {!rangeValid && <Notice tone="warning">{f("rangeInvalid")}</Notice>}
      {!phoneValid && <Notice tone="warning">{f("phoneInvalid")}</Notice>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(p) => p.id}
        loading={list.isPending && rangeValid && phoneValid}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? f("emptyFilteredBody") : undefined} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={1180}
      />
    </Card>
  );
}
