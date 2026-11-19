"use client";

import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Pencil, RefreshCw, Replace, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, Checkbox, DataTable, EmptyState, SignedFileLink, StatusBadge, type Column } from "@/components/admin";
import { isolate } from "@/lib/admin/format";
import { canRenew, documentTone, isArchived, maskedNumber } from "@/lib/admin/workforce/documents";
import { fetchDocumentFile, fetchWorkerDocuments } from "@/lib/admin/workforce/endpoints";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { WorkerDocument } from "@/lib/admin/workforce/types";
import type { Worker } from "@/lib/admin/types";
import { DeleteDocumentDialog, DocumentFormDialog, ReplaceFileDialog, type DocumentMode } from "./DocumentDialogs";

type Dialog = { kind: "form"; mode: DocumentMode; doc?: WorkerDocument } | { kind: "replace"; doc: WorkerDocument } | { kind: "delete"; doc: WorkerDocument };

function sizeText(bytes: number | null | undefined): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Documents tab (workers.documents, HR and the system administrator; workforce §5.1, design 7.1): each document's type,
 * its number's last characters, dates, expiry chip and file. A renewal is a new row and the old one is archived (never
 * overwritten), so "Show archived" lists the earlier scans. Files open through a fresh signed link, never a stored URL.
 */
export function WorkerDocumentsTab({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.documents");
  const wt = useWorkforceText();
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const list = useQuery({ queryKey: workforceKeys.documents(worker.id, archived), queryFn: () => fetchWorkerDocuments(worker.id, archived) });
  const liveOf = (doc: WorkerDocument): WorkerDocument | null => (list.data ? (list.data.find((d) => d.id === doc.id) ?? null) : doc);
  const close = () => setDialog(null);

  const columns: Column<WorkerDocument>[] = [
    {
      id: "type",
      header: t("columns.type"),
      cell: (d) => (
        <div className="flex flex-col items-start gap-1">
          <span className="font-bold text-ink-900">{wt.documentTitle(d)}</span>
          {isArchived(d) && <StatusBadge tone="neutral">{t("archived")}</StatusBadge>}
          {d.supersedes_id !== null && !isArchived(d) && <span className="text-xs text-ink-600">{t("renewalOf")}</span>}
        </div>
      ),
    },
    {
      id: "number",
      header: t("columns.number"),
      cell: (d) => {
        const masked = maskedNumber(d.number_last4);
        return masked ? <bdi dir="ltr" className="font-latin text-sm">{masked}</bdi> : <span className="text-sm text-ink-600">—</span>;
      },
    },
    { id: "issued", header: t("columns.issued"), cell: (d) => (d.issued_at ? wt.date(d.issued_at) : <span className="text-sm text-ink-600">—</span>) },
    { id: "expires", header: t("columns.expires"), cell: (d) => (d.expires_at ? wt.date(d.expires_at) : <span className="text-sm text-ink-600">—</span>) },
    {
      id: "state",
      header: t("columns.state"),
      cell: (d) => (isArchived(d) ? <span className="text-sm text-ink-600">—</span> : <StatusBadge tone={documentTone[d.state]}>{wt.documentState(d.state, d.days_left)}</StatusBadge>),
    },
    {
      id: "file",
      header: t("columns.file"),
      cell: (d) =>
        d.file ? (
          <div className="flex flex-col items-start gap-1">
            <span className="text-xs text-ink-600">
              <bdi>{d.file.file_name}</bdi> {d.file.size_bytes ? `· ${sizeText(d.file.size_bytes)}` : ""}
            </span>
            <SignedFileLink load={() => fetchDocumentFile(d.id)} label={t("openFile")} subject={d.type === "other" ? isolate(wt.documentTitle(d)) : wt.documentTitle(d)} variant="ghost" />
          </div>
        ) : (
          <span className="text-sm text-ink-600">{t("noFile")}</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (d) => {
        // Our own type names read fine in a sentence; the title an HR person typed for an `other` document is its own bidi run.
        const name = d.type === "other" ? isolate(wt.documentTitle(d)) : wt.documentTitle(d);
        return (
          <div className="flex flex-wrap justify-end gap-1">
            <Button variant="ghost" size="sm" icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { name })} onClick={() => setDialog({ kind: "form", mode: "edit", doc: d })}>
              {t("edit")}
            </Button>
            {!isArchived(d) && (
              <Button variant="ghost" size="sm" icon={<Replace aria-hidden className="size-4" />} aria-label={t("replaceLabel", { name })} onClick={() => setDialog({ kind: "replace", doc: d })}>
                {t("replaceFile")}
              </Button>
            )}
            {canRenew(d) && (
              <Button variant="ghost" size="sm" icon={<RefreshCw aria-hidden className="size-4" />} aria-label={t("renewLabel", { name })} onClick={() => setDialog({ kind: "form", mode: "renew", doc: d })}>
                {t("renew")}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-danger-700" icon={<Trash2 aria-hidden className="size-4" />} aria-label={t("deleteLabel", { name })} onClick={() => setDialog({ kind: "delete", doc: d })}>
              {t("delete")}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Card
      title={t("title")}
      actions={
        <Button onClick={() => setDialog({ kind: "form", mode: "add" })} icon={<FilePlus2 aria-hidden className="size-4" />}>
          {t("add")}
        </Button>
      }
    >
      <p className="text-sm/6 text-ink-600">{t("intro")}</p>
      <Checkbox label={t("showArchived")} checked={archived} onChange={(e) => setArchived(e.target.checked)} />
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data}
        getRowId={(d) => d.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={t("empty")} body={t("emptyBody")} />}
        minWidth={980}
      />
      {dialog?.kind === "form" && <DocumentFormDialog worker={worker} mode={dialog.mode} doc={dialog.doc} live={dialog.doc ? liveOf(dialog.doc) : undefined} onClose={close} />}
      {dialog?.kind === "replace" && <ReplaceFileDialog worker={worker} doc={dialog.doc} live={liveOf(dialog.doc)} onClose={close} />}
      {dialog?.kind === "delete" && <DeleteDocumentDialog worker={worker} doc={dialog.doc} live={liveOf(dialog.doc)} onClose={close} />}
    </Card>
  );
}
