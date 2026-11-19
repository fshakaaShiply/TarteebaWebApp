"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, FileField, Notice, TextArea, useToast, useUnsavedChanges } from "@/components/admin";
import { keepsIdempotencyKey, useIdempotencyKeys } from "@/lib/admin/idempotency";
import { postMessage, uploadCaseFile } from "@/lib/admin/quality/endpoints";
import { useQualityError } from "@/lib/admin/quality/errors";
import { FILE_ACCEPT, FILE_MAX_BYTES, MAX_FILES, MESSAGE_MAX, buildReply, canAwaitCustomer } from "@/lib/admin/quality/forms";
import type { AdminCaseDetail, Attachment } from "@/lib/admin/quality/types";
import { useCaseRefresh } from "./useCaseRefresh";

/**
 * The reply box of a case (complaints.manage, the case not closed): a public reply the customer reads, or an internal
 * note only staff see (a switch, public by default and said in words). "Wait for the customer" is offered only with a
 * public reply on a case the customer can see (P5-Q52): it pauses the resolution clock. Files go up first, one by one
 * (a PDF only on an internal note), and the message names them; a file that went up stays attached when the message
 * itself fails, so a retry never uploads it twice. The Idempotency-Key is kept for a retry of the same message.
 */
type ReplyComposerProps = {
  c: AdminCaseDetail;
  /** Told whether an unsent draft is in the box (the inbox's side pane asks before it closes one). */
  onDraftChange?: (dirty: boolean) => void;
};

export function ReplyComposer({ c, onDraftChange }: ReplyComposerProps) {
  const t = useTranslations("admin.quality.reply");
  const describe = useQualityError();
  const toast = useToast();
  const refresh = useCaseRefresh();
  const keys = useIdempotencyKeys();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [awaitCustomer, setAwaitCustomer] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploaded, setUploaded] = useState<{ file: File; attachment: Attachment }[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [field, setField] = useState<{ field: "body" | "files"; error: string } | null>(null);

  // A draft is worth keeping: leaving through a link asks first, and so does closing the tab.
  const dirty = body.trim() !== "" || files.length > 0;
  useUnsavedChanges(dirty);
  const reportDraft = useRef(onDraftChange);
  useEffect(() => {
    reportDraft.current = onDraftChange;
  });
  useEffect(() => {
    reportDraft.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => reportDraft.current?.(false), []);
  const mayAwait = canAwaitCustomer(c, internal);
  const waiting = c.status === "awaiting_customer";

  const send = useMutation({
    mutationFn: async () => {
      // Files first. Each one that is up stays in `uploaded`, so a retry sends only the rest.
      const ready: { file: File; attachment: Attachment }[] = [...uploaded];
      for (const [i, file] of files.entries()) {
        if (ready.some((r) => r.file === file)) continue;
        setProgress(Math.round((i / files.length) * 100));
        const attachment = await uploadCaseFile(file);
        ready.push({ file, attachment });
        setUploaded([...ready]);
      }
      setProgress(null);
      const attachments = files.map((f) => ready.find((r) => r.file === f)!.attachment);
      const built = buildReply({ body, internal, awaitCustomer }, c, attachments);
      if (!built.ok) throw new FieldProblem(built.field, built.error);
      try {
        const answer = await postMessage(c.id, built.body, keys.keyFor({ case: c.id, ...built.body }));
        keys.settle();
        return answer;
      } catch (e) {
        keys.settle(e);
        throw e;
      }
    },
    onSuccess: (answer) => {
      setBody("");
      setAwaitCustomer(false);
      setFiles([]);
      setUploaded([]);
      setField(null);
      refresh(answer);
      toast.success(internal ? t("noteSent") : t("sent"));
      textarea.current?.focus();
    },
    onError: (e) => {
      setProgress(null);
      if (e instanceof FieldProblem) setField({ field: e.field, error: t(`errors.${e.error}`) });
    },
  });

  const submit = () => {
    setField(null);
    // Checked before anything is uploaded.
    const empty = buildReply({ body, internal, awaitCustomer }, c, []);
    if (!empty.ok && empty.field === "body") return setField({ field: "body", error: t(`errors.${empty.error}`) });
    if (!internal && files.some(isPdfFile)) return setField({ field: "files", error: t("errors.pdf_public") });
    send.mutate();
  };

  const unknown = send.isError && keepsIdempotencyKey(send.error);
  const shownError = send.isError && !(send.error instanceof FieldProblem) ? send.error : null;

  return (
    <form
      aria-label={t("title")}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!send.isPending) submit();
      }}
    >
      <fieldset className="flex flex-wrap gap-2" disabled={send.isPending}>
        <legend className="sr-only">{t("audience")}</legend>
        {([false, true] as const).map((isInternal) => (
          <label key={String(isInternal)} className="touch-target flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-petrol-700 has-[:checked]:bg-petrol-50">
            <input type="radio" name={`reply-audience-${c.id}`} checked={internal === isInternal} onChange={() => setInternal(isInternal)} />
            <span className="font-medium text-ink-900">{isInternal ? t("internal") : t("public")}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-ink-600">{internal ? t("internalHint") : c.customer_visible ? t("publicHint") : t("hiddenHint")}</p>
      <TextArea
        ref={textarea}
        label={internal ? t("noteField") : t("messageField")}
        rows={4}
        maxLength={MESSAGE_MAX}
        value={body}
        disabled={send.isPending}
        onChange={(e) => setBody(e.target.value)}
        error={field?.field === "body" ? field.error : undefined}
        required
      />
      {mayAwait && (
        <Checkbox
          label={t("awaitCustomer")}
          description={waiting ? t("alreadyWaiting") : t("awaitHint")}
          checked={awaitCustomer || waiting}
          disabled={send.isPending || waiting}
          onChange={(e) => setAwaitCustomer(e.target.checked)}
        />
      )}
      <FileField
        label={t("files")}
        hint={internal ? t("filesHintInternal") : t("filesHint")}
        accept={FILE_ACCEPT}
        maxBytes={FILE_MAX_BYTES}
        multiple
        maxFiles={MAX_FILES}
        value={files}
        onChange={(next) => {
          setFiles(next);
          setUploaded((u) => u.filter((x) => next.includes(x.file)));
        }}
        busy={send.isPending && progress !== null}
        progress={progress ?? undefined}
        disabled={send.isPending}
        error={field?.field === "files" ? field.error : null}
      />
      {files.some(isPdfFile) && !internal && !field && <Notice tone="warning">{t("pdfPublic")}</Notice>}
      {unknown ? (
        <Notice tone="warning" title={t("unknownTitle")}>
          <p>{describe(send.error)}</p>
          <p>{t("unknownBody")}</p>
        </Notice>
      ) : shownError ? (
        <Notice tone="danger">{describe(shownError)}</Notice>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" loading={send.isPending}>
          {internal ? t("sendNote") : t("send")}
        </Button>
      </div>
    </form>
  );
}

const isPdfFile = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

class FieldProblem extends Error {
  constructor(
    readonly field: "body" | "files",
    readonly error: string,
  ) {
    super(error);
  }
}

