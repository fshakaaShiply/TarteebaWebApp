"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Dialog, Notice, TextArea, useToast } from "@/components/admin";
import { reopenItem } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import { NOTE_MAX, NOTE_MIN, type ItemRow } from "@/lib/admin/finance/reconciliation";
import { adminKeys } from "@/lib/admin/keys";
import { useReconText } from "./ReconParts";

/**
 * Take a note-only resolution back (reconciliation.run; accepted, provider_to_correct, timing). The item goes back to
 * the differences that need action; the person says why (3 to 1000 characters, audited). The item's version is the
 * If-Match (409 STALE_VERSION); 409 RESOLUTION_NOT_REOPENABLE for a resolution that moved money or paired two lines.
 */
export function ReopenItemDialog({ item, onClose }: { item: Pick<ItemRow, "id" | "line_no" | "version" | "resolution">; onClose: () => void }) {
  const t = useTranslations("admin.finance.reconciliation.reopen");
  const label = useReconText();
  const describe = useFinanceError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = note.trim();
  const problem = trimmed === "" ? t("noteRequired") : trimmed.length < NOTE_MIN ? t("noteShort") : trimmed.length > NOTE_MAX ? t("noteLong") : null;

  const send = useMutation({
    mutationFn: () => reopenItem(item.id, trimmed, item.version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      toast.success(t("done"));
      onClose();
    },
    onError: () => {
      // A stale or changed item: the list reloads, the person opens it again.
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
    },
  });

  const submit = () => {
    setTouched(true);
    if (problem) return;
    send.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      title={t("title", { line: item.line_no ?? "—" })}
      description={item.resolution ? t("description", { resolution: label.resolution(item.resolution.code, item.resolution.label) }) : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} loading={send.isPending}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextArea
          label={t("note")}
          required
          hint={t("noteHint")}
          rows={3}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={touched ? (problem ?? undefined) : undefined}
        />
        {send.isError && <Notice tone="danger">{describe(send.error)}</Notice>}
      </div>
    </Dialog>
  );
}
