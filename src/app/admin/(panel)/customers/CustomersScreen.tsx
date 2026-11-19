"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { ButtonLink, Card, DataTable, EmptyState, FilterBar, PageHeader, SearchField, Select, StatusBadge, type Column } from "@/components/admin";
import { filterKey } from "@/lib/admin/finance/filters";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { fetchCustomers } from "@/lib/admin/customers/endpoints";
import { CUSTOMER_FILTERS, customerQuery } from "@/lib/admin/customers/filters";
import { customerKeys } from "@/lib/admin/customers/keys";
import { PRIVACY_QUEUE_PATH, customerHref, customerToneOf, isDeletedCustomer } from "@/lib/admin/customers/status";
import { useCustomerText } from "@/lib/admin/customers/text";
import { CUSTOMER_SORTS, CUSTOMER_STATUSES, type CustomerListItem } from "@/lib/admin/customers/types";
import { useAdminSession } from "@/lib/admin/session";
import { RequirePermission } from "../../_components/RequirePermission";
import { Ltr } from "../bookings/_components/BookingBits";
import { useUrlFilters } from "../finance/_components/useUrlFilters";

const PER_PAGE = 25;

/**
 * A07 customers (spec §17 A07; design AdminCustomers.dc.html; customers.view): search by phone, name, e-mail, address, or a
 * booking or subscription reference; a row opens the profile. A deleted account is grey and anonymous (no name, phone or
 * e-mail); a deletion that is waiting names the day it runs.
 */
export function CustomersScreen() {
  const t = useTranslations("admin.customers");
  return (
    <RequirePermission anyOf={["customers.view"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={<QueueLink />} />
      <Customers />
    </RequirePermission>
  );
}

function QueueLink() {
  const t = useTranslations("admin.customers");
  const { can } = useAdminSession();
  if (!can("customers.privacy_requests")) return null;
  return (
    <ButtonLink variant="outline" href={PRIVACY_QUEUE_PATH}>
      {t("privacyQueue")}
    </ButtonLink>
  );
}

function Customers() {
  const t = useTranslations("admin.customers");
  const text = useCustomerText();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(CUSTOMER_FILTERS);
  const q = useDebouncedValue(filters.q.trim(), 300);
  const query = useMemo(() => customerQuery(filters, q, PER_PAGE), [filters, q]);
  const list = useQuery({
    queryKey: customerKeys.list(filterKey(CUSTOMER_FILTERS, filters, { q })),
    queryFn: () => fetchCustomers(query),
    placeholderData: keepPreviousData,
  });
  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const columns: Column<CustomerListItem>[] = [
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (c) => {
        const gone = isDeletedCustomer(c);
        return (
          <span className={gone ? "flex flex-col gap-0.5 text-ink-600" : "flex flex-col gap-0.5"}>
            <Link href={customerHref(c.id)} className="w-fit font-bold">
              {c.name || (gone ? t("deletedCustomer") : t("noName"))}
            </Link>
            {c.phone && (
              <span className="text-xs text-ink-600">
                <Ltr>{c.phone}</Ltr>
              </span>
            )}
            {c.email && (
              <span className="text-xs text-ink-600">
                <Ltr>{c.email}</Ltr>
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (c) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={customerToneOf(c.status)}>{text.status(c.status, c.status_label)}</StatusBadge>
          {c.status === "pending_deletion" && c.deletion_on && <span className="text-xs text-ink-600">{t("deletionOn", { date: text.date(c.deletion_on) })}</span>}
          {c.privacy_pending && c.status !== "pending_deletion" && <span className="text-xs text-ink-600">{t(`privacyPending.${c.privacy_pending}`)}</span>}
        </span>
      ),
    },
    {
      id: "bookings",
      header: t("columns.bookings"),
      cell: (c) => (
        <span className="flex flex-col text-sm">
          <span>{t("bookingsTotal", { count: c.bookings_total })}</span>
          {c.open_bookings > 0 && <span className="text-xs text-ink-600">{t("bookingsOpen", { count: c.open_bookings })}</span>}
        </span>
      ),
    },
    {
      id: "subscriptions",
      header: t("columns.subscriptions"),
      cell: (c) => (c.open_subscriptions > 0 ? t("subscriptionsOpen", { count: c.open_subscriptions }) : <span className="text-ink-600">—</span>),
    },
    {
      id: "last",
      header: t("columns.lastBooking"),
      cell: (c) => (c.last_booking_on ? <span className="whitespace-nowrap">{text.date(c.last_booking_on)}</span> : <span className="text-ink-600">—</span>),
    },
    { id: "since", header: t("columns.since"), cell: (c) => <span className="whitespace-nowrap text-ink-600">{text.dateTime(c.created_at)}</span> },
  ];

  return (
    <Card>
      <FilterBar canReset={filtered} onReset={reset}>
        <SearchField value={filters.q} onChange={(v) => set({ q: v })} label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value })}
          options={CUSTOMER_STATUSES.map((v) => ({ value: v, label: text.status(v) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.sort")}
          placeholder={t("filters.sortDefault")}
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value })}
          options={CUSTOMER_SORTS.filter((v) => v !== "recent").map((v) => ({ value: v, label: t(`sorts.${v}`) }))}
          containerClassName="min-w-[170px]"
        />
      </FilterBar>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(c) => c.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? t("emptyFilteredBody") : t("emptyBody")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={860}
      />
    </Card>
  );
}
