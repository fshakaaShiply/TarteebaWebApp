"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, DataTable, EmptyState, PageHeader, StatusBadge, useToast, type Column, type StatusTone } from "@/components/admin";
import { useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { downloadExport, type ExportRecord, type ExportStatus } from "@/lib/admin/exports";
import { fetchExports } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import { adminKeys } from "@/lib/admin/keys";
import { RequirePermission } from "../../../_components/RequirePermission";
import { Code } from "../_components/FinanceParts";
import { useFinanceText } from "../_components/financeText";

const PER_PAGE = 25;
const POLL_MS = 5_000;

const statusTone: Record<ExportStatus, StatusTone> = {
  queued: "progress",
  running: "progress",
  ready: "success",
  failed: "danger",
  expired: "neutral",
};

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A09 exports (reports.export): the files this person asked for in the last days, newest first. A ready file is kept for
 * a day; "Download" asks for a fresh 15-minute link each time, so a link is never kept. A file still being written
 * refreshes in the background every 5 seconds.
 */
export function ExportsScreen() {
  return (
    <RequirePermission anyOf={["reports.export"]}>
      <ExportsContent />
    </RequirePermission>
  );
}

function ExportsContent() {
  const t = useTranslations("admin.finance.exports");
  const text = useFinanceText();
  const describe = useFinanceError();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const key = adminKeys.exportList(page);
  const list = useQuery({
    queryKey: key,
    queryFn: () => fetchExports({ page, perPage: PER_PAGE }),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
  const inFlight = (list.data?.data ?? []).some((e) => e.status === "queued" || e.status === "running");
  useBackgroundRefresh(key, () => fetchExports({ page, perPage: PER_PAGE }, { background: true }), { everyMs: POLL_MS, enabled: inFlight });

  const download = useMutation({
    mutationFn: (id: number) => downloadExport(id),
    onSuccess: (link) => toast.success(t("ready", { file: link.file_name })),
    onError: (error) => {
      toast.error(describe(error));
      // An expired or not-ready answer changes the row: read the list again.
      void list.refetch();
    },
  });

  const columns: Column<ExportRecord>[] = [
    {
      id: "report",
      header: t("columns.report"),
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink-900">{text.name(e.report_label)}</span>
          {e.file_name && (
            <Code wrap className="text-xs text-ink-600">
              {e.file_name}
            </Code>
          )}
        </span>
      ),
    },
    { id: "format", header: t("columns.format"), cell: (e) => <Code>{e.format.toUpperCase()}</Code> },
    { id: "created", header: t("columns.created"), cell: (e) => <span className="whitespace-nowrap">{text.dateTime(e.created_at)}</span> },
    {
      id: "status",
      header: t("columns.status"),
      cell: (e) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={statusTone[e.status] ?? "neutral"}>{text.name(e.status_label) || t(`status.${e.status}`)}</StatusBadge>
          {e.status === "failed" && <span className="text-xs text-danger-700">{t(`failure.${e.failure_code ?? "internal_error"}`)}</span>}
        </span>
      ),
    },
    {
      id: "size",
      header: t("columns.size"),
      cell: (e) => (
        <span className="flex flex-col text-xs text-ink-600">
          <span>{e.row_count === null ? "—" : t("rows", { count: e.row_count })}</span>
          <span>{formatSize(e.size_bytes)}</span>
        </span>
      ),
    },
    {
      id: "expires",
      header: t("columns.expires"),
      cell: (e) => (e.status === "ready" && e.expires_at ? <span className="whitespace-nowrap text-sm">{text.dateTime(e.expires_at)}</span> : <span className="text-ink-600">—</span>),
    },
    {
      id: "download",
      header: <span className="sr-only">{t("columns.download")}</span>,
      cell: (e) =>
        e.status === "ready" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => download.mutate(e.id)}
            loading={download.isPending && download.variables === e.id}
            icon={<Download aria-hidden className="size-4" />}
            aria-label={t("downloadLabel", { file: e.file_name ?? text.name(e.report_label) })}
          >
            {t("download")}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card>
        <DataTable
          caption={t("caption")}
          columns={columns}
          rows={list.data?.data}
          getRowId={(e) => e.id}
          loading={list.isPending}
          fetching={list.isFetching && !list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={<EmptyState title={t("empty")} body={t("emptyBody")} />}
          pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
          minWidth={860}
        />
      </Card>
    </>
  );
}
