"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  TextField,
  type Column,
} from "@/components/admin";
import {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  PAYMENT_STATUSES,
  dateRangeValid,
  filtersFromParams,
  filtersToParams,
  filtersToQuery,
  hasFilters,
  NO_BOOKING_FILTERS,
  type BookingFilters,
} from "@/lib/admin/bookings/filters";
import { fetchAllWorkers, fetchBookings } from "@/lib/admin/endpoints";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingRow } from "@/lib/admin/types";
import { useAdminZone } from "@/lib/admin/zone";
import { RequirePermission } from "../../_components/RequirePermission";
import { useChoiceLabel, useChoiceOptions, useDriverPickList, useServiceChoices, useZoneChoices } from "../_ops/options";
import { BookingChips, DeadlineCountdown, Ltr, SlotLabel } from "./_components/BookingBits";
import { useSlotLabel, useSlotTemplatePickList } from "./_components/SlotSelect";
import { useBookingText } from "./_components/bookingText";

const PER_PAGE = 25;

/**
 * The slot, worker and driver filters' options: every slot template (inactive ones marked), every worker (workers.view
 * only; the filter is hidden without it) and every driver, each by name. A filter value from a link that is not in its
 * list still shows (as "#id"), so the list never looks unfiltered.
 */
function useExtraFilterOptions(selected: { slot: string; worker: string; driver: string }) {
  const t = useTranslations("admin.bookings.filters");
  const { can } = useAdminSession();
  const slotLabel = useSlotLabel();
  const slots = useSlotTemplatePickList();
  const canSeeWorkers = can("workers.view");
  const workers = useQuery({ queryKey: adminKeys.workerOptions(), queryFn: fetchAllWorkers, staleTime: 60_000, enabled: canSeeWorkers });
  const drivers = useDriverPickList();
  const withSelected = (options: { value: string; label: string }[], value: string) =>
    value && !options.some((o) => o.value === value) ? [...options, { value, label: t("unknownChoice", { id: value }) }] : options;

  return {
    slots: withSelected(
      (slots.query.data ?? []).map((s) => ({ value: String(s.id), label: s.is_active ? slotLabel(s) : t("inactive", { name: slotLabel(s) }) })),
      selected.slot,
    ),
    canSeeWorkers,
    workers: withSelected(
      [...(workers.data ?? [])]
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
        .map((w) => ({ value: String(w.id), label: w.employment_status === "terminated" ? t("workerLeft", { name: w.display_name }) : w.display_name })),
      selected.worker,
    ),
    drivers: withSelected(
      (drivers.data ?? []).map((d) => ({ value: String(d.id), label: d.is_active ? d.name : t("inactive", { name: d.name }) })),
      selected.driver,
    ),
  };
}

/**
 * A03 bookings (spec §14.3, §17; design AdminBookings.dc.html; bookings.view): every request with its status and
 * payment status, filters kept in the URL (the overview's cards and alerts open this list filtered), server pagination.
 */
export function BookingsScreen() {
  const t = useTranslations("admin.bookings");
  const { can } = useAdminSession();
  return (
    <RequirePermission anyOf={["bookings.view"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          can("bookings.create_manual") ? (
            <ButtonLink href="/admin/bookings/new" icon={<Plus aria-hidden className="size-4" />}>
              {t("manualBooking")}
            </ButtonLink>
          ) : undefined
        }
      />
      <BookingsTable />
    </RequirePermission>
  );
}

function BookingsTable() {
  const t = useTranslations("admin.bookings");
  const text = useBookingText();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const { zoneId, setZoneId } = useAdminZone();
  const zones = useZoneChoices();
  const services = useServiceChoices();
  const choiceOptions = useChoiceOptions();
  const choiceLabel = useChoiceLabel();
  const extra = useExtraFilterOptions({ slot: filters.slot_template_id, worker: filters.worker_id, driver: filters.driver_id });

  /** Filter changes stay in this page's URL without a server round trip (history.replaceState is synced by Next). */
  const writeParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );
  const setFilters = (next: Partial<BookingFilters>) => writeParams(filtersToParams({ ...filters, page: 1, ...next }));

  // A link from the overview carries the zone it was filtered by: it becomes the shared zone filter.
  const zoneParam = searchParams.get("zone_id");
  useEffect(() => {
    if (zoneParam === null) return;
    const id = Number(zoneParam);
    setZoneId(Number.isInteger(id) && id > 0 ? id : null);
    const rest = new URLSearchParams(searchParams);
    rest.delete("zone_id");
    writeParams(rest);
  }, [zoneParam, searchParams, setZoneId, writeParams]);
  const zoneFromParam = zoneParam !== null && Number.isInteger(Number(zoneParam)) && Number(zoneParam) > 0 ? Number(zoneParam) : null;
  const effectiveZone = zoneParam !== null ? zoneFromParam : zoneId;

  // Like every other filter, another zone (here or in the top bar) starts on page 1: page 3 of one zone may not exist in
  // the next, and an empty page would read as "no bookings". `pageZone` is the zone the URL's page belongs to; until the
  // URL says page 1 the list already asks for page 1.
  const [pageZone, setPageZone] = useState(effectiveZone);
  if (pageZone !== effectiveZone && filters.page === 1) setPageZone(effectiveZone);
  useEffect(() => {
    if (pageZone !== effectiveZone && filters.page > 1) writeParams(filtersToParams({ ...filters, page: 1 }));
  }, [pageZone, effectiveZone, filters, writeParams]);
  const page = pageZone === effectiveZone ? filters.page : 1;

  // A cleaner filter from a link applies only for users who see the Cleaner filter (workers.view): for anyone else the
  // list would be filtered with nothing on screen saying so. The URL keeps it for whoever opens the link next.
  const applied = extra.canSeeWorkers ? filters : { ...filters, worker_id: "" };
  const search = useDebouncedValue(filters.search.trim(), 300);
  const rangeValid = dateRangeValid(filters);
  const query = filtersToQuery({ ...applied, search, page }, effectiveZone, PER_PAGE);
  const list = useQuery({
    queryKey: adminKeys.bookingList({ ...filtersToKey({ ...applied, page }), search, zone: effectiveZone ?? 0 }),
    queryFn: () => fetchBookings(query),
    placeholderData: keepPreviousData,
    enabled: rangeValid,
  });

  // A page past the last one (the list shrank meanwhile) goes back to the last page instead of showing "no bookings".
  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) {
      writeParams(filtersToParams({ ...filters, page: Math.max(1, meta.last_page) }));
    }
  }, [meta, list.isPlaceholderData, filters, writeParams]);

  const columns: Column<BookingRow>[] = [
    {
      id: "reference",
      header: t("columns.reference"),
      cell: (b) => (
        <Link href={`/admin/bookings/${b.id}`} className="font-bold">
          <Ltr className="whitespace-nowrap">{b.reference}</Ltr>
        </Link>
      ),
    },
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (b) => (
        <span className="flex flex-col">
          <span className="text-ink-900">{b.customer.name || t("noName")}</span>
          <span className="text-xs text-ink-600">
            <Ltr>{b.customer.phone}</Ltr>
          </span>
        </span>
      ),
    },
    {
      id: "when",
      header: t("columns.when"),
      cell: (b) => (
        <span className="flex flex-col">
          <span>{text.dateShort(b.service_date)}</span>
          <SlotLabel className="text-xs text-ink-600" name={b.slot.name} start={b.slot.start} end={b.slot.end} />
        </span>
      ),
    },
    {
      id: "service",
      header: t("columns.service"),
      cell: (b) => (
        <span className="flex flex-col">
          <span>{text.name(b.service.name)}</span>
          <span className="text-xs text-ink-600">{t("workersCount", { count: b.workers_count })}</span>
        </span>
      ),
    },
    { id: "zone", header: t("columns.zone"), cell: (b) => text.name(b.zone.name) },
    {
      id: "status",
      header: t("columns.status"),
      cell: (b) => (
        <span className="flex flex-col items-start gap-1">
          <BookingChips status={b.status} statusLabel={b.status_label} payment={b.payment_status} paymentLabel={b.payment_status_label} />
          {b.status === "pending_confirmation" && <DeadlineCountdown deadline={b.confirmation_deadline_at} />}
        </span>
      ),
    },
    { id: "source", header: t("columns.source"), cell: (b) => text.source(b.source, b.source_label) },
    { id: "total", header: t("columns.total"), cell: (b) => <span className="font-latin whitespace-nowrap">{text.money(b.total_fils)}</span> },
    {
      id: "open",
      header: <span className="sr-only">{t("columns.open")}</span>,
      className: "text-end",
      cell: (b) => (
        <ButtonLink
          href={`/admin/bookings/${b.id}`}
          variant="ghost"
          size="sm"
          className="flex-row-reverse"
          icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
          aria-label={t("openLabel", { reference: b.reference })}
        >
          {t("open")}
        </ButtonLink>
      ),
    },
  ];

  const filtered = hasFilters(applied) || effectiveZone !== null;

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setZoneId(null);
          writeParams(filtersToParams(NO_BOOKING_FILTERS));
        }}
      >
        <SearchField
          label={t("filters.search")}
          placeholder={t("filters.searchPlaceholder")}
          value={filters.search}
          onChange={(v) => setFilters({ search: v })}
        />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={filters.status}
          onChange={(e) => setFilters({ status: e.target.value as BookingFilters["status"] })}
          options={BOOKING_STATUSES.map((s) => ({ value: s, label: text.status(s) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.payment")}
          placeholder={t("filters.allPayments")}
          value={filters.payment_status}
          onChange={(e) => setFilters({ payment_status: e.target.value as BookingFilters["payment_status"] })}
          options={PAYMENT_STATUSES.map((s) => ({ value: s, label: text.payment(s) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.zone")}
          placeholder={t("filters.allZones")}
          value={effectiveZone === null ? "" : String(effectiveZone)}
          onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}
          options={choiceOptions(zones.data)}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.service")}
          placeholder={t("filters.allServices")}
          value={filters.service}
          onChange={(e) => setFilters({ service: e.target.value })}
          options={(services.data ?? []).map((s) => ({ value: s.code, label: choiceLabel(s) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.source")}
          placeholder={t("filters.allSources")}
          value={filters.source}
          onChange={(e) => setFilters({ source: e.target.value as BookingFilters["source"] })}
          options={BOOKING_SOURCES.map((s) => ({ value: s, label: text.source(s) }))}
          containerClassName="min-w-[150px]"
        />
        <Select
          label={t("filters.slot")}
          placeholder={t("filters.allSlots")}
          value={filters.slot_template_id}
          onChange={(e) => setFilters({ slot_template_id: e.target.value })}
          options={extra.slots}
          containerClassName="min-w-[170px]"
        />
        {extra.canSeeWorkers && (
          <Select
            label={t("filters.worker")}
            placeholder={t("filters.allWorkers")}
            value={filters.worker_id}
            onChange={(e) => setFilters({ worker_id: e.target.value })}
            options={extra.workers}
            containerClassName="min-w-[170px]"
          />
        )}
        <Select
          label={t("filters.driver")}
          placeholder={t("filters.allDrivers")}
          value={filters.driver_id}
          onChange={(e) => setFilters({ driver_id: e.target.value })}
          options={extra.drivers}
          containerClassName="min-w-[170px]"
        />
        <TextField
          type="date"
          label={t("filters.from")}
          value={filters.from}
          onChange={(e) => setFilters({ from: e.target.value })}
          dir="ltr"
          className="font-latin text-start"
          containerClassName="min-w-[160px]"
        />
        <TextField
          type="date"
          label={t("filters.to")}
          value={filters.to}
          onChange={(e) => setFilters({ to: e.target.value })}
          dir="ltr"
          className="font-latin text-start"
          containerClassName="min-w-[160px]"
          error={rangeValid ? undefined : t("filters.rangeInvalid")}
        />
        <Checkbox
          label={t("filters.cancelReview")}
          checked={filters.cancel_review}
          onChange={(e) => setFilters({ cancel_review: e.target.checked })}
          className="self-center"
        />
      </FilterBar>
      {!rangeValid && <Notice tone="warning">{t("filters.rangeInvalid")}</Notice>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(b) => b.id}
        loading={list.isPending && rangeValid}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? t("emptyFilteredBody") : undefined} />}
        pagination={
          list.data
            ? {
                meta: list.data.meta,
                onPageChange: (next) => {
                  setPageZone(effectiveZone);
                  writeParams(filtersToParams({ ...filters, page: next }));
                },
              }
            : undefined
        }
        minWidth={1080}
      />
    </Card>
  );
}

/** The query key's filter part (everything but the free-text search, which is debounced). */
function filtersToKey(filters: BookingFilters): Record<string, string | number | boolean> {
  const { search: _search, ...rest } = filters;
  void _search;
  return rest;
}
