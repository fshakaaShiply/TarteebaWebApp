"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Checkbox, Dialog, FileField, Notice, Select, TextArea, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { useServerFieldMessage } from "@/lib/admin/errors";
import { createFetchRun, fetchSettlementFormats, settlementTemplateUrl, uploadSettlementRun } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import { businessToday } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { RECONCILIATION_PATH } from "@/lib/admin/nav";
import type { RunDetail } from "@/lib/admin/finance/reconciliation";
import { Code } from "../../_components/FinanceParts";
import { useFinanceText } from "../../_components/financeText";

/*
 * Fetch a provider's report, or upload one (finance §7.1; reconciliation.run). Both create a run that is read in the
 * background (202, status pending). A date that already has a completed run answers 409 RECONCILIATION_RUN_EXISTS: the
 * dialog then offers to replace it, with a reason (3 to 500 characters), and links to the run it would replace.
 */

const REASON_MIN = 3;
const REASON_MAX = 500;
/** The API's upload limit (payment.reconciliation.max_upload_bytes); it says the real one in its own 422. */
export const SETTLEMENT_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = [".csv", "text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"] as const;

type Initial = { date?: string; replace?: boolean };
type Props = { onClose: () => void; onCreated?: (run: RunDetail) => void; initial?: Initial; returnTo?: string };

/** The existing run an error names (`details.run_id`), for the link. */
function runIdOf(error: unknown): number | null {
  if (!(error instanceof AdminApiError)) return null;
  const id = error.details.run_id;
  return typeof id === "number" ? id : null;
}

/** The date and replace fields both dialogs share. */
function useRunForm(initial: Initial | undefined) {
  const [date, setDate] = useState(initial?.date ?? "");
  const [replace, setReplace] = useState(initial?.replace ?? false);
  const [reason, setReason] = useState("");
  return { date, setDate, replace, setReplace, reason, setReason };
}

function RunNotices({ error, replaceable, onReplace }: { error: unknown; replaceable: boolean; onReplace: () => void }) {
  const t = useTranslations("admin.finance.reconciliation.dialog");
  const describe = useFinanceError();
  const code = error instanceof AdminApiError ? error.code : null;
  if (!error || code === "VALIDATION_FAILED") return null;
  const runId = runIdOf(error);
  return (
    <Notice
      tone={code === "RECONCILIATION_RUN_EXISTS" ? "warning" : "danger"}
      action={
        code === "RECONCILIATION_RUN_EXISTS" && replaceable ? (
          <Button variant="secondary" size="sm" className="self-start" onClick={onReplace}>
            {t("replaceInstead")}
          </Button>
        ) : undefined
      }
    >
      <p>{describe(error)}</p>
      {runId !== null && (
        <p>
          <Link href={`${RECONCILIATION_PATH}/${runId}`} className="font-medium">
            {t("openRun")}
          </Link>
        </p>
      )}
    </Notice>
  );
}

function ReplaceFields({ form, error }: { form: ReturnType<typeof useRunForm>; error?: string }) {
  const t = useTranslations("admin.finance.reconciliation.dialog");
  return (
    <>
      <Checkbox label={t("replace")} checked={form.replace} onChange={(e) => form.setReplace(e.target.checked)} />
      {form.replace && (
        <TextArea
          label={t("replaceReason")}
          hint={t("replaceReasonHint")}
          required
          rows={2}
          maxLength={REASON_MAX}
          value={form.reason}
          onChange={(e) => form.setReason(e.target.value)}
          error={error}
        />
      )}
    </>
  );
}

/** Reads the provider's report for a date through the gateway. */
export function FetchReportDialog({ onClose, onCreated, initial }: Props) {
  const t = useTranslations("admin.finance.reconciliation.dialog");
  const toast = useToast();
  const queryClient = useQueryClient();
  const serverMessage = useServerFieldMessage();
  const form = useRunForm(initial);
  const [gateway, setGateway] = useState("");
  const [touched, setTouched] = useState(false);
  const today = businessToday();

  const send = useMutation({
    mutationFn: () =>
      createFetchRun({
        report_date: form.date,
        ...(gateway ? { gateway } : {}),
        ...(form.replace ? { replace: true, reason: form.reason.trim() } : {}),
      }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      toast.info(t("started"));
      onCreated?.(run);
      onClose();
    },
  });

  const error = send.error;
  const code = error instanceof AdminApiError ? error.code : null;
  const gateways = code === "GATEWAY_UNKNOWN" && Array.isArray((error as AdminApiError).details.gateways) ? ((error as AdminApiError).details.gateways as unknown[]).filter((g): g is string => typeof g === "string") : [];
  const fields = error instanceof AdminApiError ? error.fieldErrors : {};
  const dateError = touched && form.date === "" ? t("dateRequired") : form.date > today ? t("dateFuture") : fields.report_date?.[0] ? serverMessage(fields.report_date[0], t("dateInvalid")) : undefined;
  const reasonError = form.replace && form.reason.trim().length < REASON_MIN && touched ? t("reasonShort") : fields.reason?.[0] ? serverMessage(fields.reason[0], t("reasonShort")) : undefined;

  const submit = () => {
    setTouched(true);
    if (form.date === "" || form.date > today) return;
    if (form.replace && form.reason.trim().length < REASON_MIN) return;
    send.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      title={t("fetchTitle")}
      description={t("fetchDescription")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} loading={send.isPending}>
            {form.replace ? t("fetchReplace") : t("fetch")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          type="date"
          label={t("date")}
          required
          value={form.date}
          max={today}
          onChange={(e) => form.setDate(e.target.value)}
          error={dateError}
          hint={t("dateHint")}
          dir="ltr"
          className="font-latin text-start"
        />
        {gateways.length > 0 && (
          <Select
            label={t("gateway")}
            placeholder={t("chooseGateway")}
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
            options={gateways.map((g) => ({ value: g, label: g }))}
          />
        )}
        {code === "GATEWAY_UNKNOWN" && gateways.length === 0 && <Notice tone="warning">{t("noGateway")}</Notice>}
        <ReplaceFields form={form} error={reasonError} />
        <RunNotices
          error={code === "GATEWAY_UNKNOWN" ? null : error}
          replaceable={!form.replace}
          onReplace={() => {
            form.setReplace(true);
            send.reset();
          }}
        />
      </div>
    </Dialog>
  );
}

/** Uploads a settlement file in one of the formats the API reads. */
export function UploadSettlementDialog({ onClose, onCreated, initial }: Props) {
  const t = useTranslations("admin.finance.reconciliation.dialog");
  const toast = useToast();
  const queryClient = useQueryClient();
  const serverMessage = useServerFieldMessage();
  const text = useFinanceText();
  const form = useRunForm(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [formatKey, setFormatKey] = useState("");
  const [touched, setTouched] = useState(false);
  const today = businessToday();
  const formats = useQuery({ queryKey: adminKeys.settlementFormats(), queryFn: fetchSettlementFormats, staleTime: 5 * 60_000 });
  const available = formats.data ?? [];
  const chosen = available.find((f) => f.key === formatKey) ?? available[0] ?? null;

  const send = useMutation({
    mutationFn: () =>
      uploadSettlementRun({
        report_date: form.date,
        file: files[0],
        ...(chosen ? { format: chosen.key } : {}),
        ...(form.replace ? { replace: true, reason: form.reason.trim() } : {}),
      }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      toast.info(t("started"));
      onCreated?.(run);
      onClose();
    },
  });

  const error = send.error;
  const fields = error instanceof AdminApiError ? error.fieldErrors : {};
  const dateError = touched && form.date === "" ? t("dateRequired") : form.date > today ? t("dateFuture") : fields.report_date?.[0] ? serverMessage(fields.report_date[0], t("dateInvalid")) : undefined;
  const fileError = touched && files.length === 0 ? t("fileRequired") : fields.file?.[0] ? serverMessage(fields.file[0], t("fileInvalid")) : null;
  const reasonError = form.replace && form.reason.trim().length < REASON_MIN && touched ? t("reasonShort") : fields.reason?.[0] ? serverMessage(fields.reason[0], t("reasonShort")) : undefined;

  const submit = () => {
    setTouched(true);
    if (form.date === "" || form.date > today || files.length === 0) return;
    if (form.replace && form.reason.trim().length < REASON_MIN) return;
    send.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      title={t("uploadTitle")}
      description={t("uploadDescription")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} loading={send.isPending}>
            {form.replace ? t("uploadReplace") : t("upload")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          type="date"
          label={t("date")}
          required
          value={form.date}
          max={today}
          onChange={(e) => form.setDate(e.target.value)}
          error={dateError}
          hint={t("uploadDateHint")}
          dir="ltr"
          className="font-latin text-start"
        />
        {formats.isError ? (
          <Notice
            tone="warning"
            action={
              <Button variant="secondary" size="sm" className="self-start" onClick={() => void formats.refetch()} loading={formats.isFetching}>
                {t("formatsRetry")}
              </Button>
            }
          >
            {t("formatsFailed")}
          </Notice>
        ) : available.length > 1 ? (
          <Select
            label={t("format")}
            value={chosen?.key ?? ""}
            onChange={(e) => setFormatKey(e.target.value)}
            options={available.map((f) => ({ value: f.key, label: text.name(f.label) }))}
          />
        ) : chosen ? (
          <p className="text-sm text-ink-900">
            {t("formatOne")} <span className="font-medium">{text.name(chosen.label)}</span>
          </p>
        ) : null}
        {chosen && (
          <a
            href={settlementTemplateUrl(chosen.key)}
            download
            className="inline-flex min-h-9 w-fit items-center gap-1.5 text-sm font-medium text-petrol-700"
          >
            <Download aria-hidden className="size-4" />
            {t("template")}
          </a>
        )}
        <FileField
          label={t("file")}
          accept={ACCEPT}
          maxBytes={SETTLEMENT_MAX_BYTES}
          value={files}
          onChange={setFiles}
          required
          busy={send.isPending}
          error={fileError}
        />
        <ReplaceFields form={form} error={reasonError} />
        <RunNotices
          error={error}
          replaceable={!form.replace}
          onReplace={() => {
            form.setReplace(true);
            send.reset();
          }}
        />
        {chosen && (
          <details className="text-xs text-ink-600">
            <summary className="touch-target w-fit cursor-pointer font-medium text-petrol-700">{t("columnsTitle")}</summary>
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {chosen.columns.map((c) => (
                <li key={c.name}>
                  <Code>{c.name}</Code> {c.required ? t("columnRequired") : t("columnOptional")} · {c.format}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Dialog>
  );
}
