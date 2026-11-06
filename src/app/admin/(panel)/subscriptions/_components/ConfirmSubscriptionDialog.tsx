"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ConfirmDialog, LoadingBlock, Notice } from "@/components/admin";
import { capacityDatesOf, codeOf, notAssignableOf } from "@/lib/admin/subscriptions/actions";
import { confirmSubscription, previewConfirm, type ConfirmInput } from "@/lib/admin/subscriptions/endpoints";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { ConfirmPreviewSide } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { DateList, RefusedWorkers, UnfitList } from "./SubscriptionBits";
import { ChangedNotice, DRY_RUN, ErrorNotice, PreviewBox, TermsRow, useDialogMutation, type SubscriptionDialogProps } from "./kit";
import { WorkerPicker } from "./WorkerPicker";

/**
 * Confirm a request (design §9.1): capture the held payment, activate, plan the visits and name the workers. The
 * preview says who can cover which days (the per-day unfit list), the payment, and the dates a start before
 * confirmation credits. A Live-out contract needs its primary worker (P4-63). 502 PAYMENT_RESULT_UNKNOWN: the bank
 * did not answer; the request stays pending and confirming again is safe (the same intent, the same Idempotency-Key).
 * Confirming captures the customer's money, so nothing is sent before the preview of the current choice is on screen.
 * A 422 WORKER_NOT_ASSIGNABLE names each refused worker by the role and name the API gives (P4-242).
 */
export function ConfirmSubscriptionDialog({ subscription, onClose, onStale, changed, returnFocusTo }: SubscriptionDialogProps) {
  const t = useTranslations("admin.subscriptions.confirm");
  const text = useSubscriptionText();
  const describe = useSubscriptionErrorMessage();
  const liveOut = subscription.type === "live_out";
  const [primary, setPrimary] = useState(subscription.workers.primary ? String(subscription.workers.primary.id) : "");
  const [backup, setBackup] = useState(subscription.workers.backup ? String(subscription.workers.backup.id) : "");
  const [missingPrimary, setMissingPrimary] = useState(false);
  const [previewMissing, setPreviewMissing] = useState(false);

  // Only what staff chose goes out; an empty choice leaves the customer's own (a Live-out primary stays required).
  const input: ConfirmInput = {
    ...(primary ? { primary_worker_id: Number(primary) } : {}),
    ...(backup ? { backup_worker_id: Number(backup) } : {}),
  };
  const preview = useQuery({
    queryKey: subscriptionKeys.preview("confirm", subscription.id, subscription.version, primary, backup),
    queryFn: () => previewConfirm(subscription.id, input),
    ...DRY_RUN,
  });

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "confirm",
    send: (body: ConfirmInput, key) => confirmSubscription(subscription.id, body, subscription.version, key),
    done: (detail) => ({ detail, message: t("done", { reference: subscription.reference }) }),
  });
  const unknown = codeOf(mutation.error) === "PAYMENT_RESULT_UNKNOWN";
  const heldDates = capacityDatesOf(mutation.error);
  // The write's refusal, else the preview's (it checks the same workers).
  const refused = mutation.error ? notAssignableOf(mutation.error) : notAssignableOf(preview.error);

  const submit = () => {
    if (liveOut && !primary) {
      setMissingPrimary(true);
      return;
    }
    setMissingPrimary(false);
    if (!preview.data) {
      setPreviewMissing(true);
      return;
    }
    setPreviewMissing(false);
    mutation.mutate(input);
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={unknown ? t("retry") : t("submit")}
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {subscription.capture_unknown_at && !mutation.error && <Notice tone="warning">{t("captureUnknown")}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <WorkerPicker
          subscriptionId={subscription.id}
          role="primary"
          label={liveOut ? t("primaryRequired") : t("primary")}
          required={liveOut}
          value={primary}
          onChange={(v) => {
            setPrimary(v);
            setMissingPrimary(false);
            if (v && v === backup) setBackup("");
          }}
          placeholder={liveOut ? t("choosePrimary") : t("keepCustomerChoice")}
          error={missingPrimary ? t("primaryMissing") : undefined}
          hint={liveOut ? t("primaryHintLiveOut") : t("primaryHint")}
        />
        <WorkerPicker
          subscriptionId={subscription.id}
          role="backup"
          label={t("backup")}
          value={backup}
          onChange={setBackup}
          placeholder={t("keepCustomerChoice")}
          excludeId={primary ? Number(primary) : null}
          hint={t("backupHint")}
        />
      </div>

      {preview.isPending ? (
        <LoadingBlock lines={3} />
      ) : preview.isError ? (
        <Notice
          tone="danger"
          action={
            <Button variant="secondary" size="sm" className="self-start" onClick={() => void preview.refetch()}>
              {t("retryPreview")}
            </Button>
          }
        >
          {describe(preview.error)}
        </Notice>
      ) : (
        <PreviewBox title={t("previewTitle")}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <TermsRow label={t("payment")} value={preview.data.payment.amount_fils > 0 ? text.moneyFixed(preview.data.payment.amount_fils) : "—"} />
            {preview.data.payment.status && (
              <TermsRow
                label={t("paymentStatus")}
                value={t.has(`paymentStates.${preview.data.payment.status}` as never) ? t(`paymentStates.${preview.data.payment.status}` as never) : preview.data.payment.status}
              />
            )}
          </dl>
          <FitSide title={t("primarySide")} side={preview.data.primary} />
          <FitSide title={t("backupSide")} side={preview.data.backup} />
          {preview.data.started.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-warning-700">{t("startedTitle", { count: preview.data.started.length })}</p>
              <DateList dates={preview.data.started.map((s) => s.date)} />
              <p className="text-xs text-ink-600">{t("startedBody")}</p>
            </div>
          )}
        </PreviewBox>
      )}

      {unknown ? (
        <Notice tone="warning" title={t("unknownTitle")}>
          {t("unknownBody")}
        </Notice>
      ) : (
        <ErrorNotice error={mutation.error} />
      )}
      {heldDates.length > 0 && (
        <Notice tone="danger" title={t("notHeldTitle")}>
          <DateList dates={heldDates} />
        </Notice>
      )}
      {previewMissing && !preview.data && (
        <Notice tone="warning" role="alert">
          {t("termsMissing")}
        </Notice>
      )}
      <RefusedWorkers workers={refused} />
    </ConfirmDialog>
  );
}

function FitSide({ title, side }: { title: string; side: ConfirmPreviewSide | null }) {
  const t = useTranslations("admin.subscriptions.confirm");
  if (!side || side.worker_id === null) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium text-ink-900">
        {title} · {t("fits", { fits: side.fits, of: side.of })}
      </p>
      {side.unfit.length > 0 ? <UnfitList days={side.unfit} /> : <p className="text-success-700">{t("fitsAll")}</p>}
    </div>
  );
}
