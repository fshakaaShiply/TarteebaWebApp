"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Dialog, FileField, Notice, Select, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { keepsIdempotencyKey, useIdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { createCase, uploadCaseFile } from "@/lib/admin/quality/endpoints";
import { useQualityError } from "@/lib/admin/quality/errors";
import { CASE_SOURCES_STAFF, DESCRIPTION_MAX, FILE_MAX_BYTES, MAX_FILES, NOTE_MAX, buildNewCase, type FormError, type NewCaseField, type NewCaseValues } from "@/lib/admin/quality/forms";
import { useQualityText } from "@/lib/admin/quality/labels";
import { qualityKeys } from "@/lib/admin/quality/keys";
import { CASE_CATEGORIES, CASE_PRIORITIES, type Attachment } from "@/lib/admin/quality/types";
import type { BookingDetail } from "@/lib/admin/types";

/** The customer sees the files of a case staff log, so only images go on it (the API refuses a staff PDF there). */
const IMAGES = ["image/jpeg", "image/png", "image/webp", ".jpg", ".jpeg", ".png", ".webp"] as const;

/**
 * "Open complaint" on the booking page (A03, complaints.manage): logs what the customer said by phone or WhatsApp as a
 * case on this booking (POST /admin/complaints, prefilled with the customer and the booking). The same rules apply as
 * for the customer; staff may go past the complaint window with a reason, which the API asks for in its own answer
 * (422 COMPLAINT_NOT_ALLOWED window_closed) and the form then offers. The Idempotency-Key is one per body; images go up
 * first and stay attached across a retry.
 */
export function OpenComplaintDialog({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const t = useTranslations("admin.quality.openComplaint");
  const text = useQualityText();
  const describe = useQualityError();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys();
  const [values, setValues] = useState<NewCaseValues>({ category: "", description: "", priority: "", source: "phone", overrideReason: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<{ file: File; attachment: Attachment }[]>([]);
  const [problem, setProblem] = useState<{ field: NewCaseField; error: FormError } | null>(null);
  const set = (patch: Partial<NewCaseValues>) => setValues((v) => ({ ...v, ...patch }));

  const send = useMutation({
    mutationFn: async () => {
      const built = buildNewCase(values, { customerUlid: booking.customer.id, bookingId: booking.id });
      if (!built.ok) throw new Problem(built.field, built.error);
      const ready = [...uploaded];
      for (const file of files) {
        if (ready.some((r) => r.file === file)) continue;
        ready.push({ file, attachment: await uploadCaseFile(file) });
        setUploaded([...ready]);
      }
      const body = { ...built.body, ...(files.length > 0 ? { attachment_ids: files.map((f) => ready.find((r) => r.file === f)!.attachment.id) } : {}) };
      try {
        const answer = await createCase(body, keys.keyFor(body));
        keys.settle();
        return answer;
      } catch (e) {
        keys.settle(e);
        throw e;
      }
    },
    onSuccess: (answer) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.booking(booking.id) });
      void queryClient.invalidateQueries({ queryKey: qualityKeys.all });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      toast.success(t("done", { reference: answer.reference }));
      onClose();
      router.push(`/admin/quality/${answer.id}`);
    },
    onError: (e) => {
      if (e instanceof Problem) setProblem({ field: e.field, error: e.error });
    },
  });

  const windowClosed = send.error instanceof AdminApiError && send.error.code === "COMPLAINT_NOT_ALLOWED" && send.error.details.reason === "window_closed";
  const unknown = send.isError && keepsIdempotencyKey(send.error);
  const shown = send.isError && !(send.error instanceof Problem) && !unknown ? send.error : null;
  const err = (field: NewCaseField) => (problem?.field === field ? t(`errors.${problem.error}`) : undefined);

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      closeOnOutsideClick={false}
      title={t("title", { reference: booking.reference })}
      description={t("description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={() => (setProblem(null), send.mutate())} loading={send.isPending}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t("category")}
            required
            placeholder={t("chooseCategory")}
            value={values.category}
            onChange={(e) => set({ category: e.target.value })}
            options={CASE_CATEGORIES.map((c) => ({ value: c, label: text.category(c) }))}
            error={err("category")}
          />
          <Select label={t("source")} required value={values.source} onChange={(e) => set({ source: e.target.value })} options={CASE_SOURCES_STAFF.map((s) => ({ value: s, label: t(`sources.${s}`) }))} error={err("source")} />
          <Select label={t("priority")} placeholder={t("defaultPriority")} value={values.priority} onChange={(e) => set({ priority: e.target.value })} options={CASE_PRIORITIES.map((p) => ({ value: p, label: text.priority(p) }))} />
        </div>
        <TextArea label={t("descriptionField")} hint={t("descriptionHint")} required rows={5} maxLength={DESCRIPTION_MAX} value={values.description} onChange={(e) => set({ description: e.target.value })} error={err("description")} />
        {(windowClosed || values.overrideReason !== "") && (
          <>
            <Notice tone="warning">{t("windowClosed")}</Notice>
            <TextArea label={t("overrideReason")} hint={t("overrideHint")} rows={2} maxLength={NOTE_MAX} value={values.overrideReason} onChange={(e) => set({ overrideReason: e.target.value })} error={err("overrideReason")} />
          </>
        )}
        <FileField
          label={t("files")}
          hint={t("filesHint")}
          accept={IMAGES}
          maxBytes={FILE_MAX_BYTES}
          multiple
          maxFiles={MAX_FILES}
          value={files}
          onChange={(next) => {
            setFiles(next);
            setUploaded((u) => u.filter((x) => next.includes(x.file)));
          }}
          disabled={send.isPending}
        />
        <Notice tone="info">{t("customerSeesIt")}</Notice>
        {unknown ? (
          <Notice tone="warning" title={t("unknownTitle")}>
            <p>{describe(send.error)}</p>
            <p>{t("unknownBody")}</p>
          </Notice>
        ) : shown ? (
          <Notice tone="danger">{describe(shown)}</Notice>
        ) : null}
      </div>
    </Dialog>
  );
}

class Problem extends Error {
  constructor(
    readonly field: NewCaseField,
    readonly error: FormError,
  ) {
    super(error);
  }
}
