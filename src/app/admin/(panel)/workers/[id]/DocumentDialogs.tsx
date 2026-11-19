"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, ConfirmDialog, Dialog, FileField, Notice, Select, TextArea, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { isolate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import {
  DOCUMENT_FILE_ACCEPT,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  documentFormFrom,
  documentPatch,
  emptyDocumentForm,
  maskedNumber,
  renewalFormFrom,
  validateDocumentForm,
  type DocumentErrors,
  type DocumentForm,
} from "@/lib/admin/workforce/documents";
import { createWorkerDocument, deleteWorkerDocument, replaceDocumentFile, updateWorkerDocument } from "@/lib/admin/workforce/endpoints";
import { useApiFieldMessage, useWorkforceError } from "@/lib/admin/workforce/errors";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { WorkerDocument } from "@/lib/admin/workforce/types";
import type { Worker } from "@/lib/admin/types";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";

/** After any document write: this worker's documents, her profile (the summary and the alert) and the lists. */
function useDocumentRefresh(workerId: number) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: workforceKeys.documentsOf(workerId) });
    void queryClient.invalidateQueries({ queryKey: adminKeys.worker(workerId) });
    void queryClient.invalidateQueries({ queryKey: ["admin", "workers", "list"] });
  };
}

export type DocumentMode = "add" | "renew" | "edit";

/**
 * Add, renew or edit one document (workforce §3.1, §5.1). A renewal starts from the document it replaces and sends its id
 * as `supersedes_id`: the old row is archived, never overwritten. An edit works on a copy of the document (useSeenRecord)
 * and sends only the fields that changed with that copy's version; after a 409 STALE_VERSION it shows what is saved now
 * and asks again, never resending the refused version. The number is private: only its last characters come back, so an
 * empty field keeps it.
 */
export function DocumentFormDialog({ worker, mode, doc, live, onClose }: { worker: Worker; mode: DocumentMode; doc?: WorkerDocument; live?: WorkerDocument | null; onClose: () => void }) {
  const t = useTranslations("admin.workers.documents");
  const e = useTranslations("admin.workers.documents.errors");
  const toast = useToast();
  const describe = useWorkforceError();
  const refresh = useDocumentRefresh(worker.id);
  const wt = useWorkforceText();
  const formId = useId();
  const seen = useSeenRecord(live ?? doc ?? ({ version: 0 } as WorkerDocument));
  const record = mode === "edit" ? (seen.record as WorkerDocument) : null;
  const [form, setForm] = useState<DocumentForm>(() => (mode === "edit" && doc ? documentFormFrom(doc) : mode === "renew" && doc ? renewalFormFrom(doc) : emptyDocumentForm()));
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<DocumentErrors>({});
  const archived = record?.archived_at != null;
  const set = <K extends keyof DocumentForm>(key: K, value: DocumentForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((x) => ({ ...x, [key]: undefined }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const checked = validateDocumentForm(form, { requireFile: mode !== "edit", fileChosen: files.length > 0 });
      if (!checked.ok) throw new FormProblem(checked.errors);
      if (mode === "edit" && record) {
        const patch = documentPatch(record, checked.fields, form);
        if (Object.keys(patch).length === 0) return null;
        return updateWorkerDocument(record.id, patch, record.version);
      }
      return createWorkerDocument(worker.id, checked.fields, files[0] ?? null, mode === "renew" ? (doc?.id ?? null) : null);
    },
    onSuccess: (saved) => {
      refresh();
      if (saved) toast.success(mode === "edit" ? t("saved") : mode === "renew" ? t("renewed") : t("added"));
      onClose();
    },
    onError: (error) => {
      if (error instanceof FormProblem) return setErrors(error.errors);
      refresh();
      if (error instanceof AdminApiError && (error.code === "STALE_VERSION" || error.code === "DOCUMENT_ARCHIVED")) seen.moved();
    },
  });
  const apiField = useApiFieldMessage(save.error);
  const fieldError = (field: keyof DocumentForm | "file", fallbackKey: string) => {
    const own = errors[field];
    if (own) return e(own);
    return apiField(field, e(fallbackKey));
  };
  const stale = mode === "edit" && (seen.waiting || seen.renewed);
  const gone = mode === "edit" && live === null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={mode === "add" ? t("addTitle") : mode === "renew" ? t("renewTitle", { type: wt.documentTitle(doc!) }) : t("editTitle", { type: wt.documentTitle(record ?? doc!) })}
      description={mode === "renew" ? t("renewBody") : mode === "add" ? t("addBody") : undefined}
      size="lg"
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending} disabled={gone || seen.waiting}>
            {mode === "renew" ? t("renewSubmit") : mode === "add" ? t("addSubmit") : t("save")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }} className="flex flex-col gap-4">
        {gone && <Notice tone="danger">{t("deletedMeanwhile")}</Notice>}
        {stale && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
        {archived && <Notice tone="info">{t("archivedNote")}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t("fields.type")}
            required
            disabled={mode === "edit"}
            placeholder={t("fields.typeChoose")}
            value={form.type}
            onChange={(ev) => set("type", ev.target.value)}
            options={DOCUMENT_TYPES.map((v) => ({ value: v, label: wt.documentType(v) }))}
            error={fieldError("type", "typeRequired")}
          />
          {(form.type === "other" || (mode === "edit" && record?.type === "other")) && (
            <TextField label={t("fields.title")} required disabled={archived} value={form.title} maxLength={100} onChange={(ev) => set("title", ev.target.value)} error={fieldError("title", "titleRequired")} />
          )}
          <TextField
            label={t("fields.number")}
            hint={mode === "edit" && maskedNumber(record?.number_last4) ? t("fields.numberKept", { masked: isolate(maskedNumber(record?.number_last4) ?? "", "ltr") }) : t("fields.numberHint")}
            dir="ltr"
            className="font-latin text-start"
            autoComplete="off"
            disabled={archived || form.clearNumber}
            value={form.number}
            maxLength={50}
            onChange={(ev) => set("number", ev.target.value)}
            error={fieldError("number", "numberLength")}
          />
          {mode === "edit" && !archived && maskedNumber(record?.number_last4) && (
            <label className="flex items-center gap-2 self-end pb-3 text-sm text-ink-900">
              <input type="checkbox" className="size-4.5 accent-petrol-700" checked={form.clearNumber} onChange={(ev) => set("clearNumber", ev.target.checked)} />
              {t("fields.clearNumber")}
            </label>
          )}
          <TextField label={t("fields.issuedAt")} type="date" dir="ltr" disabled={archived} value={form.issued_at} onChange={(ev) => set("issued_at", ev.target.value)} error={fieldError("issued_at", "dateInvalid")} />
          <TextField label={t("fields.expiresAt")} type="date" dir="ltr" disabled={archived} value={form.expires_at} onChange={(ev) => set("expires_at", ev.target.value)} error={fieldError("expires_at", "dateInvalid")} hint={t("fields.expiresHint")} />
          <TextField
            label={t("fields.alertDays")}
            inputMode="numeric"
            dir="ltr"
            className="font-latin text-start"
            disabled={archived}
            value={form.alert_days_before}
            onChange={(ev) => set("alert_days_before", ev.target.value)}
            error={fieldError("alert_days_before", "alertDays")}
            hint={t("fields.alertDaysHint")}
          />
        </div>
        <TextArea label={t("fields.notes")} rows={3} maxLength={1000} value={form.notes} onChange={(ev) => set("notes", ev.target.value)} error={fieldError("notes", "notesLength")} />
        {mode !== "edit" && (
          <FileField
            label={t("fields.file")}
            accept={DOCUMENT_FILE_ACCEPT}
            maxBytes={DOCUMENT_MAX_BYTES}
            value={files}
            onChange={(next) => {
              setFiles(next);
              setErrors((x) => ({ ...x, file: undefined }));
            }}
            busy={save.isPending}
            required
            error={fieldError("file", "fileRequired") ?? null}
          />
        )}
        {save.error && !(save.error instanceof FormProblem) && !stale && <Notice tone="danger">{describe(save.error)}</Notice>}
      </form>
    </Dialog>
  );
}

class FormProblem extends Error {
  constructor(readonly errors: DocumentErrors) {
    super("form");
  }
}

/** Replaces one document's file (POST …/file, If-Match); the old file is deleted once the new one is stored. */
export function ReplaceFileDialog({ worker, doc, live, onClose }: { worker: Worker; doc: WorkerDocument; live: WorkerDocument | null; onClose: () => void }) {
  const t = useTranslations("admin.workers.documents");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useDocumentRefresh(worker.id);
  const seen = useSeenRecord(live ?? doc);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const gone = live === null;
  const replace = useMutation({
    mutationFn: () => replaceDocumentFile(seen.record.id, files[0], seen.record.version),
    onSuccess: () => {
      refresh();
      toast.success(t("fileReplaced"));
      onClose();
    },
    onError: (error) => {
      refresh();
      if (error instanceof AdminApiError && (error.code === "STALE_VERSION" || error.code === "DOCUMENT_ARCHIVED")) seen.moved();
    },
  });
  const submit = () => {
    if (files.length === 0) return setProblem(t("errors.fileRequired"));
    setProblem(null);
    seen.seen();
    replace.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !replace.isPending && onClose()}
      title={t("replaceTitle", { type: wt.documentTitle(seen.record) })}
      description={t("replaceBody")}
      dismissible={!replace.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={replace.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} loading={replace.isPending} disabled={gone || seen.waiting}>
            {t("replaceSubmit")}
          </Button>
        </>
      }
    >
      {gone && <Notice tone="danger">{t("deletedMeanwhile")}</Notice>}
      {(seen.waiting || seen.renewed) && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
      <FileField label={t("fields.file")} accept={DOCUMENT_FILE_ACCEPT} maxBytes={DOCUMENT_MAX_BYTES} value={files} onChange={setFiles} busy={replace.isPending} required error={problem} />
      {replace.error && !(seen.waiting || seen.renewed) && <Notice tone="danger">{describe(replace.error)}</Notice>}
    </Dialog>
  );
}

/**
 * Deletes a document (If-Match): the stored file is removed for good, the audit keeps the type, the last characters and
 * the dates. Deleting a renewal brings the document it replaced back as the current one (P5-W45), and the dialog says so.
 */
export function DeleteDocumentDialog({ worker, doc, live, onClose }: { worker: Worker; doc: WorkerDocument; live: WorkerDocument | null; onClose: () => void }) {
  const t = useTranslations("admin.workers.documents");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useDocumentRefresh(worker.id);
  const seen = useSeenRecord(live ?? doc);
  const remove = useMutation({
    mutationFn: () => deleteWorkerDocument(seen.record.id, seen.record.version),
    onSuccess: () => {
      refresh();
      toast.success(t("deleted"));
      onClose();
    },
    onError: (error) => {
      refresh();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") seen.moved();
    },
  });
  // The document is gone already (someone else deleted it): nothing is left to confirm.
  const gone = live === null;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteTitle", { type: wt.documentTitle(seen.record) })}
      description={t("deleteBody")}
      confirmLabel={t("delete")}
      tone="danger"
      pending={remove.isPending}
      onConfirm={() => {
        if (gone || seen.waiting) return;
        seen.seen();
        remove.mutate();
      }}
    >
      {seen.record.supersedes_id !== null && seen.record.archived_at === null && <Notice tone="info">{t("deleteRestores")}</Notice>}
      {gone && <Notice tone="danger">{t("deletedMeanwhile")}</Notice>}
      {(seen.waiting || seen.renewed) && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
      {remove.error && !(seen.waiting || seen.renewed) && <Notice tone="danger">{describe(remove.error)}</Notice>}
    </ConfirmDialog>
  );
}
