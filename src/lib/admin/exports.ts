"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/admin/Toast";
import { AdminApiError } from "./client";
import { useAdminErrorMessage } from "./errors";
import { useFinanceError } from "./finance/errors";
import { createExport, fetchExport, fetchExportUrl } from "./finance/endpoints";

/*
 * Exports (finance §5.4, A1b §3): the page asks for a file with POST /admin/exports (202, queued), the API writes it in
 * the background, and the file is read through a 15-minute signed link. The browser polls the export every 2 seconds as
 * a background poll (X-Background-Poll, so an idle tab still times out) for up to 3 minutes, then fetches the link and
 * navigates to it. The link is never kept: a later "Download" asks for a fresh one. Needs reports.export, and the API
 * also checks the permission to read the data itself (403 FORBIDDEN).
 */

export type ExportFormat = "csv" | "xlsx" | "pdf";
export type ExportStatus = "queued" | "running" | "ready" | "failed" | "expired";

type Both = { ar: string; en: string };

export type ExportRecord = {
  id: number;
  report: string;
  report_label: Both;
  format: ExportFormat;
  status: ExportStatus;
  status_label: Both;
  row_count: number | null;
  file_name: string | null;
  size_bytes: number | null;
  filters: Record<string, unknown>;
  created_at: string | null;
  finished_at: string | null;
  expires_at: string | null;
  failure_code: "too_large" | "internal_error" | "worker_lost" | null;
};

export type ExportUrl = { url: string; expires_at: string; file_name: string };

export const EXPORT_STATUSES = ["queued", "running", "ready", "failed", "expired"] as const satisfies readonly ExportStatus[];
export const EXPORT_FAILURES = ["too_large", "internal_error", "worker_lost"] as const;

/** The nine reports and the formats each offers (A1b §3.2); the page shows only what the report supports. */
export const EXPORT_REPORTS = {
  payments: ["xlsx", "csv"],
  refunds: ["xlsx", "csv"],
  invoices: ["xlsx", "csv"],
  invoice_lines: ["xlsx", "csv"],
  credit_notes: ["xlsx", "csv"],
  vat_summary: ["xlsx", "csv", "pdf"],
  reconciliation_runs: ["xlsx", "csv"],
  reconciliation_items: ["xlsx", "csv"],
  wallet_transactions: ["xlsx", "csv"],
} as const satisfies Record<string, readonly ExportFormat[]>;

export type ExportReportKey = keyof typeof EXPORT_REPORTS;

export const EXPORT_POLL_MS = 2_000;
export const EXPORT_POLL_MAX_MS = 3 * 60_000;

/** Filters left unset are not sent (the API validates the rest and stores them with its own defaults). */
export function exportFilters(filters: Record<string, string | number | boolean | null | undefined | readonly string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value === true ? 1 : value;
  }
  return out;
}

export type PollDeps = {
  read?: (id: number) => Promise<ExportRecord>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxMs?: number;
  intervalMs?: number;
  signal?: { aborted: boolean };
};

export class ExportStillRunning extends Error {
  constructor(readonly record: ExportRecord) {
    super("export still running");
    this.name = "ExportStillRunning";
  }
}

/** Reads the export until it is ready, failed or expired; throws ExportStillRunning when the time is up. */
export async function waitForExport(first: ExportRecord, deps: PollDeps = {}): Promise<ExportRecord> {
  const read = deps.read ?? ((id: number) => fetchExport(id, { background: true }));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const started = now();
  let record = first;
  while (record.status === "queued" || record.status === "running") {
    if (deps.signal?.aborted) throw new ExportStillRunning(record);
    if (now() - started >= (deps.maxMs ?? EXPORT_POLL_MAX_MS)) throw new ExportStillRunning(record);
    await sleep(deps.intervalMs ?? EXPORT_POLL_MS);
    record = await read(record.id);
  }
  return record;
}

/** Fetches a fresh signed link and opens it: the browser downloads the file. */
export async function downloadExport(id: number, navigate: (url: string) => void = (url) => window.location.assign(url)): Promise<ExportUrl> {
  const link = await fetchExportUrl(id);
  navigate(link.url);
  return link;
}

export type ExportRequest = { report: ExportReportKey; format: ExportFormat; filters?: Record<string, unknown> };

/**
 * Starts an export and follows it to the download, with a toast for each step. One export runs at a time per button;
 * `busy` is true from the click until the file has been handed to the browser (or the wait gave up).
 */
export function useExport() {
  const t = useTranslations("admin.finance.exports");
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const financeError = useFinanceError();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(
    async (request: ExportRequest) => {
      setBusy(true);
      try {
        const queued = await createExport({ report: request.report, format: request.format, filters: request.filters ?? {} });
        toast.info(t("preparing"));
        const done = await waitForExport(queued, { signal: { get aborted() { return !alive.current; } } });
        if (done.status === "ready") {
          await downloadExport(done.id);
          toast.success(t("ready", { file: done.file_name ?? "" }));
        } else if (done.status === "failed") {
          toast.error(t(`failure.${done.failure_code ?? "internal_error"}`));
        } else {
          toast.error(t("expired"));
        }
      } catch (error) {
        if (error instanceof ExportStillRunning) toast.info(t("stillRunning"));
        else toast.error(error instanceof AdminApiError ? financeError(error) : describe(error));
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [t, toast, describe, financeError],
  );

  return { start, busy };
}
