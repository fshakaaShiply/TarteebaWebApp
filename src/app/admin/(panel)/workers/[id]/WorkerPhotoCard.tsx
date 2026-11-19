"use client";

import { useMutation } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, Checkbox, ConfirmDialog, FileField, Notice, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { PHOTO_FILE_ACCEPT, PHOTO_MAX_BYTES } from "@/lib/admin/workforce/documents";
import { deleteWorkerPhoto, uploadWorkerPhoto } from "@/lib/admin/workforce/endpoints";
import { useWorkforceError } from "@/lib/admin/workforce/errors";
import { useAdminSession } from "@/lib/admin/session";
import type { Worker } from "@/lib/admin/types";
import { WorkerAvatar } from "../_components/WorkerAvatar";
import { useWorkerCache } from "./workerShared";

/**
 * The cleaner's photo (workforce §3.5, P5-W22): customers see the approved photo and her name only. Uploading is the
 * approval, by a workers.manage holder who ticks "approved for customers"; the worker's version is the If-Match, the API
 * re-encodes the image (upright, at most 800 px, no location data) and the old file is deleted. The photo's link is a
 * short-lived signed URL, so it is only shown, never kept.
 */
export function WorkerPhotoCard({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.photo");
  const { can } = useAdminSession();
  const toast = useToast();
  const cache = useWorkerCache();
  const describe = useWorkforceError();
  const [files, setFiles] = useState<File[]>([]);
  const [approved, setApproved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const url = worker.photo?.url ?? worker.photo_url ?? null;
  const manage = can("workers.manage");

  const upload = useMutation({
    mutationFn: (file: File) => uploadWorkerPhoto(worker.id, file, worker.version),
    onSuccess: (saved) => {
      cache.saved(saved);
      setFiles([]);
      setApproved(false);
      setProblem(null);
      toast.success(t("saved"));
    },
    onError: (error) => {
      setProblem(describe(error));
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") void cache.reload(worker.id);
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteWorkerPhoto(worker.id, worker.version),
    onSuccess: (saved) => {
      cache.saved(saved);
      setRemoving(false);
      toast.success(t("removed"));
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") void cache.reload(worker.id);
    },
  });

  const submit = () => {
    if (files.length === 0) return setProblem(t("chooseFile"));
    if (!approved) return setProblem(t("approvalRequired"));
    setProblem(null);
    upload.mutate(files[0]);
  };

  return (
    <Card title={t("title")}>
      <div className="flex flex-wrap items-start gap-4">
        <WorkerAvatar name={worker.display_name} url={url} size="lg" />
        <div className="flex min-w-[240px] flex-1 flex-col gap-3">
          <p className="text-sm text-ink-900">{url ? (worker.photo?.approved_by ? t("approvedBy", { name: worker.photo.approved_by.name }) : t("approved")) : t("none")}</p>
          <p className="text-sm/6 text-ink-600">{t("note")}</p>
          {manage && (
            <div className="flex flex-col gap-3">
              <FileField
                label={url ? t("replace") : t("upload")}
                accept={PHOTO_FILE_ACCEPT}
                maxBytes={PHOTO_MAX_BYTES}
                value={files}
                onChange={(next) => {
                  setFiles(next);
                  setProblem(null);
                }}
                busy={upload.isPending}
                error={problem}
              />
              <Checkbox label={t("approvedForCustomers")} description={t("approvedHint")} checked={approved} onChange={(e) => setApproved(e.target.checked)} disabled={upload.isPending} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={submit} loading={upload.isPending} icon={<Upload aria-hidden className="size-4" />} disabled={files.length === 0}>
                  {t("submit")}
                </Button>
                {url && (
                  <Button variant="outline" className="text-danger-700" onClick={() => setRemoving(true)} icon={<Trash2 aria-hidden className="size-4" />}>
                    {t("remove")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={(open) => !open && setRemoving(false)}
        title={t("removeTitle", { name: worker.display_name })}
        description={t("removeBody")}
        confirmLabel={t("remove")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        {remove.error && (
          <Notice tone="danger">{describe(remove.error)}</Notice>
        )}
      </ConfirmDialog>
    </Card>
  );
}
