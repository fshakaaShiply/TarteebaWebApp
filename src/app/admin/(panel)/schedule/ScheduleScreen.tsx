"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import {
  Button,
  Card,
  ErrorState,
  FilterBar,
  LoadingBlock,
  PageHeader,
  Select,
  TabPanel,
  Tabs,
  TextField,
} from "@/components/admin";
import { fetchAllWorkers, fetchSchedule } from "@/lib/admin/endpoints";
import { businessToday, formatMonth, isIsoDate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import {
  NO_SCHEDULE_FILTERS,
  SCHEDULE_VIEWS,
  VISIT_STATUSES,
  hasScheduleFilters,
  scheduleFiltersFromParams,
  scheduleFiltersToParams,
  scheduleKey,
  scheduleQuery,
  shiftDate,
  type ScheduleFilters,
} from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import type { ScheduleView, VisitStatus } from "@/lib/admin/types";
import { RequirePermission } from "../../_components/RequirePermission";
import { useChoiceLabel, useChoiceOptions, useServiceChoices, useSlotPickList, useZoneChoices } from "../_ops/options";
import { useOpsText } from "../_ops/opsText";
import { useZoneInUrl } from "../_ops/zoneParam";
import { useBookingText } from "../bookings/_components/bookingText";
import { MonthView } from "./MonthView";
import { ScheduleGridView } from "./ScheduleGrid";

const TABS_ID = "schedule-view";

/**
 * A04 operations schedule (spec §14.3, §17 A04; design AdminSchedule.dc.html; schedule.view to read, assignments.manage
 * to move cards): day and week as cleaner rows × slot (or date) columns with the visit cards, the unassigned lane and the
 * day markers; month as per-day counts and capacity. The view, date and filters live in the URL; the zone is the shared
 * top-bar zone, mirrored in the URL as zone_id. No timed refresh: data refreshes on focus, after a move and with Refresh.
 * The slot filter lists the slot templates from their pick-list (GET /admin/slot-templates/options).
 */
export function ScheduleScreen() {
  const t = useTranslations("admin.schedule");
  return (
    <RequirePermission anyOf={["schedule.view"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <ScheduleContent />
    </RequirePermission>
  );
}

function ScheduleContent() {
  const t = useTranslations("admin.schedule");
  const text = useOpsText();
  const booking = useBookingText();
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useAdminSession();
  const filters = useMemo(() => scheduleFiltersFromParams(searchParams), [searchParams]);
  const today = businessToday();
  const date = filters.date || today;
  const zones = useZoneChoices();
  const services = useServiceChoices();
  const choiceOptions = useChoiceOptions();
  const choiceLabel = useChoiceLabel();

  /** Changes stay in this page's URL without a server round trip (history.replaceState is synced by Next). */
  const writeParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );
  // The shared top-bar zone, kept in the URL as zone_id beside the filters (a link opens the same zone).
  const { zoneId: effectiveZone, setZoneId } = useZoneInUrl(searchParams, writeParams);
  const setFilters = (next: Partial<ScheduleFilters>) => writeParams(scheduleFiltersToParams({ ...filters, ...next }, effectiveZone));

  const query = scheduleQuery(filters, date, effectiveZone);
  const board = useQuery({
    queryKey: adminKeys.scheduleBoard(scheduleKey(query)),
    queryFn: () => fetchSchedule(query),
    placeholderData: keepPreviousData,
  });
  const slots = useSlotPickList();
  // The active slots, and the filtered one while it is out of service (marked).
  const slotChoices = (slots.data ?? []).filter((s) => s.is_active || s.id === filters.slotTemplateId);
  const workers = useQuery({ queryKey: adminKeys.workerOptions(), queryFn: fetchAllWorkers, staleTime: 60_000, enabled: can("workers.view") });

  // Cleaner options: every worker (workers.view), else the rows this board shows.
  const workerOptions = (
    workers.data?.filter((w) => w.employment_status !== "terminated").map((w) => ({ id: w.id, name: w.display_name })) ??
    (board.data && board.data.view !== "month" ? board.data.rows.map((r) => ({ id: r.worker.id, name: r.worker.display_name })) : [])
  ).sort((a, b) => a.name.localeCompare(b.name, locale));

  const stepLabel = (step: -1 | 1) => t(`${step < 0 ? "previous" : "next"}.${filters.view}`);
  // The week's Monday–Sunday comes from the API's answer for this view and date (not a previous one still shown).
  const current = board.data && board.data.view === filters.view && board.data.date === date ? board.data : null;
  const rangeLabel =
    filters.view === "month"
      ? formatMonth(date, locale)
      : filters.view === "week" && current
        ? t("weekRange", { from: text.dateShort(current.from), to: text.dateShort(current.to) })
        : text.date(date);

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Tabs
            id={TABS_ID}
            label={t("views.label")}
            items={SCHEDULE_VIEWS.map((v) => ({ value: v, label: t(`views.${v}`) }))}
            value={filters.view}
            onValueChange={(v) => setFilters({ view: v as ScheduleView })}
          />
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex items-end gap-1">
              <Button
                variant="outline"
                className="h-11 px-3"
                aria-label={stepLabel(-1)}
                onClick={() => setFilters({ date: shiftDate(filters.view, date, -1) })}
                icon={<ChevronRight aria-hidden className="size-4 ltr:rotate-180" />}
              />
              <TextField
                type="date"
                label={t("date")}
                value={date}
                onChange={(e) => isIsoDate(e.target.value) && setFilters({ date: e.target.value === today ? "" : e.target.value })}
                dir="ltr"
                className="font-latin text-start"
                containerClassName="min-w-[170px]"
              />
              <Button
                variant="outline"
                className="h-11 px-3"
                aria-label={stepLabel(1)}
                onClick={() => setFilters({ date: shiftDate(filters.view, date, 1) })}
                icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
              />
            </div>
            <Button variant="ghost" className="h-11" onClick={() => setFilters({ date: "" })} disabled={date === today}>
              {t("today")}
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => void board.refetch()}
              loading={board.isFetching && !board.isPending}
              icon={<RefreshCw aria-hidden className="size-4" />}
            >
              {t("refresh")}
            </Button>
          </div>
        </div>

        <FilterBar
          canReset={hasScheduleFilters(filters)}
          onReset={() => setFilters({ ...NO_SCHEDULE_FILTERS, view: filters.view, date: filters.date })}
        >
          <Select
            label={t("filters.zone")}
            value={effectiveZone === null ? "" : String(effectiveZone)}
            onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}
            placeholder={t("filters.allZones")}
            options={choiceOptions(zones.data)}
            containerClassName="min-w-[180px]"
          />
          <Select
            label={t("filters.service")}
            value={filters.serviceId === null ? "" : String(filters.serviceId)}
            onChange={(e) => setFilters({ serviceId: e.target.value ? Number(e.target.value) : null })}
            placeholder={t("filters.allServices")}
            options={choiceOptions(services.data)}
            containerClassName="min-w-[170px]"
          />
          <Select
            label={t("filters.slot")}
            value={filters.slotTemplateId === null ? "" : String(filters.slotTemplateId)}
            onChange={(e) => setFilters({ slotTemplateId: e.target.value ? Number(e.target.value) : null })}
            placeholder={t("filters.allSlots")}
            options={slotChoices.map((s) => ({ value: String(s.id), label: t("slotOption", { name: choiceLabel(s), start: s.start_time, end: s.end_time }) }))}
            containerClassName="min-w-[170px]"
          />
          <Select
            label={t("filters.worker")}
            value={filters.workerId === null ? "" : String(filters.workerId)}
            onChange={(e) => setFilters({ workerId: e.target.value ? Number(e.target.value) : null })}
            placeholder={t("filters.allWorkers")}
            options={workerOptions.map((w) => ({ value: String(w.id), label: w.name }))}
            containerClassName="min-w-[170px]"
          />
          <Select
            label={t("filters.status")}
            value={filters.statuses.length === 1 ? filters.statuses[0] : ""}
            onChange={(e) => setFilters({ statuses: e.target.value ? [e.target.value as VisitStatus] : [] })}
            placeholder={filters.statuses.length > 1 ? t("filters.severalStatuses") : t("filters.allStatuses")}
            options={VISIT_STATUSES.map((s) => ({ value: s, label: booking.visit(s) }))}
            containerClassName="min-w-[170px]"
          />
        </FilterBar>
        <p className="text-sm font-medium text-ink-900" aria-live="polite">
          {rangeLabel}
        </p>
      </Card>

      <TabPanel id={TABS_ID} value={filters.view} className="flex flex-col gap-4 outline-none">
        {board.isPending ? (
          <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />
        ) : board.isError ? (
          <Card>
            <ErrorState error={board.error} onRetry={() => void board.refetch()} />
          </Card>
        ) : board.data.view === "month" ? (
          <MonthView board={board.data} onOpenDay={(day) => setFilters({ view: "day", date: day === today ? "" : day })} />
        ) : (
          <ScheduleGridView board={board.data} />
        )}
      </TabPanel>
    </>
  );
}
