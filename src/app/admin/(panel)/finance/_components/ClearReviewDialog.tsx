"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Dialog, Notice, TextArea, useToast } from "@/components/admin";
import { clearPaymentReview, clearRefundReview } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import { REFUND_OPS_NOTE_MAX, checkNote } from "@/lib/admin/finance/refundOps";
import { adminKeys } from "@/lib/admin/keys";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import { RecordMovedNotice } from "./RecordMovedNotice";
import { recordMoved, useSeenRecord } from "./useSeenRecord";

/**
 * The record whose flag is cleared, as the page holds it now: its version (If-Match) and whether its flag can be cleared
 * (flagged, a payment the provider settled, a refund that is final). After a 409 the page reads it again.
 */
type Target = { kind: "payment" | "refund"; id: number; version: number; clearable?: boolean };

/**
 * Close a payment's or a refund's review flag (reconciliation.run): the person says what they checked (3 to 500
 * characters, audited under their name). The record's version is the If-Match (409 STALE_VERSION); the API refuses a flag
 * that is not set (NOT_FLAGGED), a payment still verifying (PAYMENT_VERIFYING, said in words) and a refund still open
 * (REFUND_OPEN). STALE_VERSION, NOT_FLAGGED and REFUND_OPEN mean the record moved: the dialog waits for the page to read it
 * again, takes its new version, and says so (or that the flag no longer needs clearing) before the person confirms again;
 * it never resends the refused version.
 */
export function ClearReviewDialog({ target: live, unavailable, onClose }: { target: Target; unavailable?: boolean; onClose: () => void }) {
  const t = useTranslations("admin.finance.clearReview");
  const describe = useFinanceError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const seen = useSeenRecord(live);
  const target = seen.record;
  const applies = target.clearable ?? true;
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const problem = checkNote(note);

  const send = useMutation<unknown>({
    mutationFn: () => (target.kind === "payment" ? clearPaymentReview(target.id, note.trim(), target.version) : clearRefundReview(target.id, note.trim(), target.version)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
      void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
      toast.success(t(`done.${target.kind}`));
      onClose();
    },
    onError: (error) => {
      // Read the record again; when it moved, its new version replaces the one refused (useSeenRecord).
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      if (recordMoved(error)) seen.moved();
    },
  });

  const submit = () => {
    setTouched(true);
    if (problem) return;
    send.reset();
    seen.seen();
    send.mutate();
  };

  const shownError = send.isError && !recordMoved(send.error) ? send.error : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      title={t(`title.${target.kind}`)}
      description={t(`description.${target.kind}`)}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} loading={send.isPending} disabled={seen.waiting || !applies}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RecordMovedNotice kind={target.kind} waiting={seen.waiting} renewed={seen.renewed} applies={applies} unavailable={unavailable} facts={false} />
        <TextArea
          label={t("note")}
          required
          hint={t("noteHint")}
          rows={3}
          maxLength={REFUND_OPS_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={touched && problem ? t(`errors.${problem}`) : undefined}
        />
        {shownError && <Notice tone="danger">{describe(shownError)}</Notice>}
      </div>
    </Dialog>
  );
}
