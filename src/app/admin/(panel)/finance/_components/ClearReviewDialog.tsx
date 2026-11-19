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

type Target = { kind: "payment" | "refund"; id: number; version: number };

/**
 * Close a payment's or a refund's review flag (reconciliation.run): the person says what they checked (3 to 500
 * characters, audited under their name). The record's version is the If-Match (409 STALE_VERSION); the API refuses a flag
 * that is not set (NOT_FLAGGED), a payment still verifying (PAYMENT_VERIFYING) and a refund still open (REFUND_OPEN), and
 * the screen says so in words.
 */
export function ClearReviewDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const t = useTranslations("admin.finance.clearReview");
  const describe = useFinanceError();
  const toast = useToast();
  const queryClient = useQueryClient();
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
    onError: () => {
      // STALE_VERSION, NOT_FLAGGED and the like mean the record moved: read it again.
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
      title={t(`title.${target.kind}`)}
      description={t(`description.${target.kind}`)}
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
          maxLength={REFUND_OPS_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={touched && problem ? t(`errors.${problem}`) : undefined}
        />
        {send.isError && <Notice tone="danger">{describe(send.error)}</Notice>}
      </div>
    </Dialog>
  );
}
