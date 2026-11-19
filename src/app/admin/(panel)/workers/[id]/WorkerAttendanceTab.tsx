"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardEdit, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, DataTable, EmptyState, IconButton, Notice, StatusBadge, type Column } from "@/components/admin";
import { businessToday } from "@/lib/admin/format";
import { attendanceTone, dayActions, dubaiTime, shiftMonth } from "@/lib/admin/workforce/attendance";
import { fetchWorkerAttendance } from "@/lib/admin/workforce/endpoints";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { AttendanceDay } from "@/lib/admin/workforce/types";
import type { Worker } from "@/lib/admin/types";
import { AttendanceDialog, EvidenceList, RevertAttendanceDialog } from "../_components/AttendanceDialogs";

type Dialog = { kind: "edit" | "revert"; day: AttendanceDay };

/**
 * Attendance tab (attendance.manage, workforce §5.4): the month's days with what was expected (a working day, a rest day,
 * leave), the status and where it came from, check-in and check-out on the Dubai clock, and the evidence behind a derived
 * day. A month whose incentive is approved is locked; a Live-out absence is recorded in A08 so the day is covered.
 */
export function WorkerAttendanceTab({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.attendance");
  const wt = useWorkforceText();
  const today = businessToday();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const query = useQuery({ queryKey: workforceKeys.attendanceMonth(worker.id, month), queryFn: () => fetchWorkerAttendance(worker.id, month) });
  const days = query.data?.data;
  const meta = query.data?.meta;
  const live = (day: AttendanceDay): AttendanceDay | null => (days ? (days.find((d) => d.date === day.date) ?? null) : day);

  const columns: Column<AttendanceDay>[] = [
    {
      id: "date",
      header: t("columns.date"),
      cell: (d) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink-900">{wt.date(d.date)}</span>
          <span className="text-xs text-ink-600">{d.leave ? t("kind.leave") : d.rest_day ? t("kind.rest") : d.expected ? t("kind.expected") : t("kind.notExpected")}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (d) => (
        <span className="flex flex-col items-start gap-1">
          {d.status ? <StatusBadge tone={attendanceTone[d.status]}>{wt.attendanceStatus(d.status)}</StatusBadge> : d.expected && d.leave === null ? <StatusBadge tone="neutral">{wt.attendanceStatus(null)}</StatusBadge> : <span className="text-sm text-ink-600">—</span>}
          {d.status === "late" && d.late_minutes !== null && <span className="text-xs text-ink-600">{t("lateBy", { minutes: d.late_minutes })}</span>}
          {d.conflicts_with_evidence && <StatusBadge tone="pending">{t("conflict")}</StatusBadge>}
        </span>
      ),
    },
    { id: "source", header: t("columns.source"), cell: (d) => (d.source ? <span className="text-sm">{wt.source(d.source)}</span> : <span className="text-sm text-ink-600">—</span>) },
    {
      id: "times",
      header: t("columns.times"),
      cell: (d) =>
        d.check_in_at || d.check_out_at ? (
          <bdi dir="ltr" className="font-latin text-sm">
            {dubaiTime(d.check_in_at) || "—"} – {dubaiTime(d.check_out_at) || "—"}
          </bdi>
        ) : (
          <span className="text-sm text-ink-600">—</span>
        ),
    },
    {
      id: "evidence",
      header: t("columns.evidence"),
      cell: (d) => (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-petrol-700">{t("evidence.show")}</summary>
          <div className="mt-1 min-w-[200px]">
            <EvidenceList day={d} />
            {d.note && <p className="mt-1 text-xs text-ink-600">{t("noteLine", { note: d.note })}</p>}
          </div>
        </details>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (d) => {
        const actions = dayActions(d, today);
        if (!actions.canRecord && !d.locked) return <span className="text-xs text-ink-600">{d.leave ? t("kind.leave") : "—"}</span>;
        return (
          <div className="flex flex-wrap justify-end gap-1">
            <Button variant="ghost" size="sm" icon={<ClipboardEdit aria-hidden className="size-4" />} aria-label={t("recordLabel", { date: wt.date(d.date) })} onClick={() => setDialog({ kind: "edit", day: d })} disabled={d.locked}>
              {d.status ? t("change") : t("record")}
            </Button>
            {actions.canRevert && (
              <Button variant="ghost" size="sm" icon={<Undo2 aria-hidden className="size-4" />} aria-label={t("revertLabel", { date: wt.date(d.date) })} onClick={() => setDialog({ kind: "revert", day: d })}>
                {t("revert")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const s = meta?.summary;
  return (
    <Card title={t("title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label={t("previousMonth")} onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronRight aria-hidden className="size-4 ltr:rotate-180" />
          </IconButton>
          <h3 className="min-w-[140px] text-center font-bold text-ink-900" aria-live="polite">
            {wt.month(month)}
          </h3>
          <IconButton label={t("nextMonth")} onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth}>
            <ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />
          </IconButton>
        </div>
        {s && (
          <p className="text-sm text-ink-600">
            {t("summary", { expected: s.expected_days, present: s.present_days, absent: s.absent_days, late: s.late_days, half: s.half_days, unrecorded: s.unrecorded_days, leave: s.leave_days })}
          </p>
        )}
      </div>
      {meta?.locked && <Notice tone="warning">{t("lockBanner")}</Notice>}
      <DataTable
        caption={t("caption", { month: wt.month(month) })}
        columns={columns}
        rows={days}
        getRowId={(d) => d.date}
        loading={query.isPending}
        fetching={query.isFetching && !query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={t("empty")} />}
        minWidth={900}
      />
      {dialog?.kind === "edit" && <AttendanceDialog day={dialog.day} live={live(dialog.day)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "revert" && <RevertAttendanceDialog day={dialog.day} live={live(dialog.day)} onClose={() => setDialog(null)} />}
    </Card>
  );
}
