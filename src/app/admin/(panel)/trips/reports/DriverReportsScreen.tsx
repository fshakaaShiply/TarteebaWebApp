"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FilterBar,
  Notice,
  PageHeader,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { fetchDriverReports, updateDriverReport } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { formatDateTime, isIsoDate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { TRIPS_PATH, TRIPS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import { DRIVER_REPORT_STATUSES, DRIVER_REPORT_TYPES, REPORT_NOTE_MAX, reportTargets } from "@/lib/admin/trips/rounds";
import type { DriverReport, DriverReportStatus, DriverReportType } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useOpsText } from "../../_ops/opsText";
import { Ltr } from "../../bookings/_components/BookingBits";
import { errorCodeOf, reportTone, useTripText } from "../tripText";

const PER_PAGE = 25;

/**
 * A06 driver reports inbox (spec §6.8, §18 D03): what drivers reported from the road — delay, cannot reach, vehicle
 * issue, other — with the round, the stop's area, the reason and the expected delay, newest first. trips.manage marks a
 * report seen or handled with a note; schedule.view reads the inbox (Fleet routes/admin.php).
 */
export function DriverReportsScreen() {
  const t = useTranslations("admin.driverReports");
  return (
    <RequirePermission anyOf={TRIPS_READ}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <ReportsTable />
    </RequirePermission>
  );
}

function ReportsTable() {
  const t = useTranslations("admin.driverReports");
  const trip = useTripText();
  const ops = useOpsText();
  const { can } = useAdminSession();
  const canHandle = can("trips.manage");
  const [status, setStatus] = useState<DriverReportStatus | "">("open");
  const [type, setType] = useState<DriverReportType | "">("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [handling, setHandling] = useState<DriverReport | null>(null);
  const validDate = date === "" || isIsoDate(date);
  const query = { page, perPage: PER_PAGE, status, type, date: validDate && date ? date : undefined };
  const list = useQuery({
    queryKey: adminKeys.driverReportList({ page, status, type, date: query.date ?? "" }),
    queryFn: () => fetchDriverReports(query),
    placeholderData: keepPreviousData,
  });

  const columns: Column<DriverReport>[] = [
    {
      id: "time",
      header: t("columns.time"),
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.created_at, ops.locale)}</span>,
    },
    { id: "type", header: t("columns.type"), cell: (r) => <span className="font-medium text-ink-900">{trip.reportType(r.type, r.type_label)}</span> },
    {
      id: "round",
      header: t("columns.round"),
      cell: (r) => (
        <span className="flex flex-col">
          <Link href={`${TRIPS_PATH}?date=${r.round.date}&slot_template_id=${r.round.slot_template_id}`}>
            {trip.kind(r.round.kind)} · <Ltr>{r.round.vehicle.plate_no}</Ltr>
          </Link>
          <span className="text-xs text-ink-600">
            {ops.dateShort(r.round.date)} · <Ltr>{r.round.slot_code}</Ltr>
          </span>
        </span>
      ),
    },
    {
      id: "stop",
      header: t("columns.stop"),
      cell: (r) => (r.stop ? t("stopValue", { sequence: r.stop.sequence, area: r.stop.area ?? t("noArea") }) : <span className="text-ink-600">{t("wholeRound")}</span>),
    },
    { id: "reason", header: t("columns.reason"), cell: (r) => <span className="text-ink-900">{r.reason || "—"}</span> },
    {
      id: "delay",
      header: t("columns.delay"),
      cell: (r) => (r.eta_delay_min ? <span className="font-latin whitespace-nowrap">{t("delayValue", { minutes: r.eta_delay_min })}</span> : "—"),
    },
    { id: "driver", header: t("columns.driver"), cell: (r) => r.driver.name },
    {
      id: "status",
      header: t("columns.status"),
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={reportTone[r.status] ?? "neutral"}>{trip.reportStatus(r.status, r.status_label)}</StatusBadge>
          {r.handled_by && (
            <span className="text-xs text-ink-600">{t("handledBy", { name: r.handled_by.name, time: formatDateTime(r.handled_at, ops.locale) })}</span>
          )}
          {r.handled_note && <span className="text-xs text-ink-900">{r.handled_note}</span>}
        </span>
      ),
    },
    ...(canHandle
      ? [
          {
            id: "actions",
            header: <span className="sr-only">{t("columns.actions")}</span>,
            className: "text-end",
            cell: (r: DriverReport) =>
              reportTargets(r.status).length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHandling(r)}
                  aria-label={t("handleLabel", { type: trip.reportType(r.type, r.type_label), plate: r.round.vehicle.plate_no })}
                  icon={<CheckCheck aria-hidden className="size-4" />}
                >
                  {t("handle")}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <Card>
      <FilterBar
        canReset={status !== "open" || type !== "" || date !== ""}
        onReset={() => {
          setStatus("open");
          setType("");
          setDate("");
          setPage(1);
        }}
      >
        <Select
          label={t("filters.status")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as DriverReportStatus | "");
            setPage(1);
          }}
          placeholder={t("filters.allStatuses")}
          options={DRIVER_REPORT_STATUSES.map((s) => ({ value: s, label: trip.reportStatus(s) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.type")}
          value={type}
          onChange={(e) => {
            setType(e.target.value as DriverReportType | "");
            setPage(1);
          }}
          placeholder={t("filters.allTypes")}
          options={DRIVER_REPORT_TYPES.map((s) => ({ value: s, label: trip.reportType(s) }))}
          containerClassName="min-w-[170px]"
        />
        <TextField
          type="date"
          label={t("filters.date")}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPage(1);
          }}
          dir="ltr"
          className="font-latin text-start"
          containerClassName="min-w-[170px]"
        />
        <Button
          variant="outline"
          className="h-11"
          onClick={() => void list.refetch()}
          loading={list.isFetching && !list.isPending}
          icon={<RefreshCw aria-hidden className="size-4" />}
        >
          {t("refresh")}
        </Button>
      </FilterBar>
      {!canHandle && <p className="text-sm text-ink-600">{t("readOnly")}</p>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        loading={list.isPending}
        fetching={list.isFetching && list.isPlaceholderData}
        error={list.error}
        onRetry={() => void list.refetch()}
        minWidth={960}
        empty={<EmptyState title={status === "open" && !type && !date ? t("emptyOpen") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
      />
      {handling && <HandleReportDialog report={handling} onClose={() => setHandling(null)} />}
    </Card>
  );
}

const handleSchema = z.object({ status: z.enum(["acknowledged", "resolved"], { message: "required" }), note: z.string().max(REPORT_NOTE_MAX, "tooLong") });

function HandleReportDialog({ report, onClose }: { report: DriverReport; onClose: () => void }) {
  const t = useTranslations("admin.driverReports.handleDialog");
  const f = useTranslations("admin.trips.formErrors");
  const trip = useTripText();
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const serverMessage = useServerFieldMessage();
  const queryClient = useQueryClient();
  const targets = reportTargets(report.status);
  const form = useForm<{ status: string; note: string }>({
    resolver: zodResolver(handleSchema) as never,
    defaultValues: { status: targets[targets.length - 1] ?? "", note: report.handled_note ?? "" },
  });
  const mutation = useMutation({
    mutationFn: (input: { status: "acknowledged" | "resolved"; note: string }) =>
      updateDriverReport(report.id, { status: input.status, note: input.note.trim() || null }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.driverReports() });
      toast.success(t("done", { status: trip.reportStatus(updated.status, updated.status_label) }));
      onClose();
    },
    onError: (error) => {
      applyFieldErrors(error, form.setError, ["status", "note"]);
      void queryClient.invalidateQueries({ queryKey: adminKeys.driverReports() });
    },
  });
  const errors = form.formState.errors;
  const msg = (e: { message?: string; type?: string } | undefined) =>
    e?.message ? (e.type === "server" ? serverMessage(e.message, f("invalid")) : f.has(e.message) ? f(e.message) : f("invalid")) : undefined;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { type: trip.reportType(report.type, report.type_label), plate: report.round.vehicle.plate_no })}
      description={report.reason ? t("bodyWithReason", { reason: report.reason }) : t("body")}
      confirmLabel={t("submit")}
      pending={mutation.isPending}
      onConfirm={() => void form.handleSubmit((values) => mutation.mutate(values as never))()}
    >
      <Select
        label={t("status")}
        required
        options={targets.map((s) => ({ value: s, label: trip.reportStatus(s) }))}
        error={msg(errors.status)}
        {...form.register("status")}
      />
      <TextArea label={t("note")} hint={t("noteHint")} rows={3} maxLength={REPORT_NOTE_MAX} error={msg(errors.note)} {...form.register("note")} />
      {mutation.error && errorCodeOf(mutation.error) !== "VALIDATION_FAILED" ? (
        <Notice tone="danger">{describe(mutation.error)}</Notice>
      ) : null}
    </ConfirmDialog>
  );
}
