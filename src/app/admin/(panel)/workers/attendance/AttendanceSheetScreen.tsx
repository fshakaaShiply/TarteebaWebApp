"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ClipboardEdit, Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, DataTable, EmptyState, FilterBar, Notice, PageHeader, SearchField, Select, StatusBadge, TextField, type Column } from "@/components/admin";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { businessToday, isIsoDate } from "@/lib/admin/format";
import { useAdminZone } from "@/lib/admin/zone";
import { attendanceTone, dayActions, SHEET_STATUSES } from "@/lib/admin/workforce/attendance";
import { fetchAttendanceSheet } from "@/lib/admin/workforce/endpoints";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { AttendanceDay } from "@/lib/admin/workforce/types";
import type { FilterSpec } from "@/lib/admin/finance/filters";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useUrlFilters } from "../../finance/_components/useUrlFilters";
import { useZoneName } from "../../_ops/options";
import { AttendanceDialog, RevertAttendanceDialog } from "../_components/AttendanceDialogs";

const PER_PAGE = 50;
const SHEET_FILTERS = { date: { kind: "date" }, status: { kind: "enum", values: SHEET_STATUSES }, q: { kind: "text", max: 60 } } as const satisfies FilterSpec;
type Dialog = { kind: "edit" | "revert"; day: AttendanceDay };

/**
 * The day sheet (attendance.manage, workforce §5.4): who was expected on a day in the chosen zone, what is recorded and
 * what the system found. A day is computed live until the night's derivation stores it ("computed, not saved yet"); a
 * conflict marks a recorded status that the day's visits contradict. A day is never later than today.
 */
export function AttendanceSheetScreen() {
  const t = useTranslations("admin.workers.attendance");
  return (
    <RequirePermission anyOf={["attendance.manage"]}>
      <PageHeader title={t("sheetTitle")} subtitle={t("sheetSubtitle")} />
      <Sheet />
    </RequirePermission>
  );
}

function Sheet() {
  const t = useTranslations("admin.workers.attendance");
  const wt = useWorkforceText();
  const zoneName = useZoneName();
  const { zoneId } = useAdminZone();
  const today = businessToday();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(SHEET_FILTERS);
  const [search, setSearch] = useState(filters.q);
  const q = useDebouncedValue(search.trim(), 300);
  const date = isIsoDate(filters.date) && filters.date <= today ? filters.date : today;
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const query = useQuery({
    queryKey: workforceKeys.attendanceSheet({ date, zone: zoneId ?? 0, status: filters.status, q, page: filters.page }),
    queryFn: () => fetchAttendanceSheet({ date, zoneId: zoneId ?? undefined, status: filters.status || undefined, search: q || undefined, page: filters.page, perPage: PER_PAGE }),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data;
  const counts = query.data?.meta.counts;
  const live = (day: AttendanceDay): AttendanceDay | null => (rows ? (rows.find((d) => d.worker.id === day.worker.id) ?? null) : day);

  const columns: Column<AttendanceDay>[] = [
    {
      id: "worker",
      header: t("columns.worker"),
      cell: (d) => (
        <span className="flex flex-col">
          <Link href={`/admin/workers/${d.worker.id}?tab=attendance`} className="font-bold">
            <bdi>{d.worker.display_name}</bdi>
          </Link>
          <bdi dir="ltr" className="font-latin text-xs text-ink-600">
            {d.worker.employee_no}
          </bdi>
        </span>
      ),
    },
    { id: "zone", header: t("columns.zone"), cell: (d) => zoneName(d.worker.home_zone_id) },
    {
      id: "day",
      header: t("columns.day"),
      cell: (d) => <span className="text-sm">{d.leave ? t("kind.leave") : d.rest_day ? t("kind.rest") : d.expected ? t("kind.expected") : t("kind.notExpected")}</span>,
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (d) => (
        <span className="flex flex-col items-start gap-1">
          {d.status ? <StatusBadge tone={attendanceTone[d.status]}>{wt.attendanceStatus(d.status)}</StatusBadge> : d.expected && d.leave === null ? <StatusBadge tone="neutral">{wt.attendanceStatus(null)}</StatusBadge> : <span className="text-sm text-ink-600">—</span>}
          {d.status === "late" && d.late_minutes !== null && <span className="text-xs text-ink-600">{t("lateBy", { minutes: d.late_minutes })}</span>}
          {!d.stored && <span className="text-xs text-ink-600">{t("computedNotSaved")}</span>}
          {d.conflicts_with_evidence && <StatusBadge tone="pending">{t("conflict")}</StatusBadge>}
          {d.locked && <StatusBadge tone="neutral">{t("locked")}</StatusBadge>}
        </span>
      ),
    },
    {
      id: "times",
      header: t("columns.times"),
      cell: (d) =>
        d.check_in_at || d.check_out_at ? (
          <bdi dir="ltr" className="font-latin text-sm">
            {wt.time(d.check_in_at) || "—"} – {wt.time(d.check_out_at) || "—"}
          </bdi>
        ) : (
          <span className="text-sm text-ink-600">—</span>
        ),
    },
    { id: "source", header: t("columns.source"), cell: (d) => (d.source ? <span className="text-sm">{wt.source(d.source)}</span> : <span className="text-sm text-ink-600">—</span>) },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (d) => {
        const actions = dayActions(d, today);
        const name = d.worker.display_name;
        if (!actions.canRecord) return <span className="text-xs text-ink-600">{d.locked ? t("locked") : d.leave ? t("kind.leave") : "—"}</span>;
        return (
          <div className="flex flex-wrap justify-end gap-1">
            <Button variant="ghost" size="sm" icon={<ClipboardEdit aria-hidden className="size-4" />} aria-label={t("recordFor", { name })} onClick={() => setDialog({ kind: "edit", day: d })}>
              {d.status ? t("change") : t("record")}
            </Button>
            {actions.canRevert && (
              <Button variant="ghost" size="sm" icon={<Undo2 aria-hidden className="size-4" />} aria-label={t("revertFor", { name })} onClick={() => setDialog({ kind: "revert", day: d })}>
                {t("revert")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const countChips: { key: (typeof SHEET_STATUSES)[number] | "expected"; value: number }[] = counts
    ? [
        { key: "expected", value: counts.expected },
        { key: "present", value: counts.present },
        { key: "absent", value: counts.absent },
        { key: "late", value: counts.late },
        { key: "half_day", value: counts.half_day },
        { key: "unrecorded", value: counts.unrecorded },
        { key: "leave", value: counts.leave },
      ]
    : [];

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          reset();
          setSearch("");
        }}
      >
        <TextField label={t("filters.date")} type="date" dir="ltr" max={today} value={date} onChange={(e) => set({ date: e.target.value })} containerClassName="min-w-[170px]" />
        <Select label={t("filters.status")} placeholder={t("filters.allStatuses")} value={filters.status} onChange={(e) => set({ status: e.target.value })} options={SHEET_STATUSES.map((s) => ({ value: s, label: wt.sheetStatus(s) }))} containerClassName="min-w-[170px]" />
        <SearchField label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} value={search} onChange={(v) => { setSearch(v); set({ q: v }); }} />
      </FilterBar>
      {filters.date !== "" && date !== filters.date && <Notice tone="warning">{t("dateAdjusted")}</Notice>}
      {counts && (
        <ul className="flex flex-wrap gap-2" aria-label={t("countsLabel")}>
          {countChips.map((c) => (
            <li key={c.key}>
              {c.key === "expected" ? (
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-neutral-100 px-3 py-1 text-sm text-ink-900">
                  {t("counts.expected")} <span className="font-latin font-bold">{c.value}</span>
                </span>
              ) : (
                <button
                  type="button"
                  aria-pressed={filters.status === c.key}
                  onClick={() => set({ status: filters.status === c.key ? "" : c.key })}
                  className="touch-target inline-flex items-center gap-1.5 rounded-pill bg-petrol-50 px-3 py-1 text-sm text-petrol-700 aria-pressed:bg-petrol-700 aria-pressed:text-white"
                >
                  {wt.sheetStatus(c.key)} <span className="font-latin font-bold">{c.value}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <DataTable
        caption={t("sheetCaption", { date: wt.dateLong(date) })}
        columns={columns}
        rows={rows}
        getRowId={(d) => d.worker.id}
        loading={query.isPending}
        fetching={query.isFetching && !query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("sheetEmpty")} />}
        pagination={query.data ? { meta: query.data.meta, onPageChange: setPage } : undefined}
        minWidth={980}
      />
      {dialog?.kind === "edit" && <AttendanceDialog day={dialog.day} live={live(dialog.day)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "revert" && <RevertAttendanceDialog day={dialog.day} live={live(dialog.day)} onClose={() => setDialog(null)} />}
    </Card>
  );
}
