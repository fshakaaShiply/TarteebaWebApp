"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { ConfirmDialog, Notice, TextArea } from "@/components/admin";
import { codeOf } from "@/lib/admin/subscriptions/actions";
import { declineCancelReview, rejectSubscription, switchAutoRenewOff, unfreezeSubscription } from "@/lib/admin/subscriptions/endpoints";
import type { SubscriptionDetail } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { ChangedNotice, ErrorNotice, hasFieldErrors, useDialogMutation, useFieldError, type SubscriptionDialogProps } from "./kit";

/** The shortest reason the API accepts for these routes (min:3), and the longest (500; 1000 for review notes). */
const MIN_REASON = 3;

type ReasonProps<R> = SubscriptionDialogProps & {
  /** Message group under admin.subscriptions: title, body, label, submit, done. */
  ns: "reject" | "autoRenew" | "declineReview";
  tone?: "primary" | "danger";
  op?: string;
  max: number;
  send: (reason: string, key: string) => Promise<R>;
  done: (result: R) => SubscriptionDetail;
  field: string;
  extra?: ReactNode;
};

/** A confirmation with one required reason (reject, auto-renew off, keep after a cancellation review). */
function ReasonDialog<R>({ subscription, onClose, onStale, changed, returnFocusTo, ns, tone, op, max, send, done, field, extra }: ReasonProps<R>) {
  const t = useTranslations(`admin.subscriptions.${ns}`);
  const fieldError = useFieldError();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op,
    send: (input: { reason: string }, key) => send(input.reason, key),
    done: (result) => ({ detail: done(result), message: t("done", { reference: subscription.reference }) }),
  });
  const unknown = codeOf(mutation.error) === "PAYMENT_RESULT_UNKNOWN";
  const serverProblem = fieldError(mutation.error, field, t("reasonInvalid"));
  const submit = () => {
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON) {
      setProblem(t("reasonShort"));
      return;
    }
    setProblem(null);
    mutation.mutate({ reason: trimmed });
  };
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={t("submit")}
      tone={tone}
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {extra}
      <TextArea
        label={t("label")}
        required
        rows={3}
        maxLength={max}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setProblem(null);
        }}
        error={problem ?? serverProblem}
      />
      {unknown ? (
        <Notice tone="warning" title={t.has("unknownTitle" as never) ? t("unknownTitle" as never) : undefined}>
          {t.has("unknownBody" as never) ? t("unknownBody" as never) : null}
        </Notice>
      ) : (
        <ErrorNotice error={mutation.error} hideCodes={hasFieldErrors(mutation.error, [field]) ? ["VALIDATION_FAILED"] : []} />
      )}
    </ConfirmDialog>
  );
}

/** Reject a request: voids the held payment (or refunds a sale); the customer is told. */
export function RejectSubscriptionDialog(props: SubscriptionDialogProps) {
  return (
    <ReasonDialog
      {...props}
      ns="reject"
      tone="danger"
      op="reject"
      max={500}
      field="reason"
      send={(reason, key) => rejectSubscription(props.subscription.id, reason, props.subscription.version, key)}
      done={(detail) => detail}
    />
  );
}

/** Staff can only switch auto-renew off, on the customer's request; switching it on is the customer's consent (P4-52). */
export function AutoRenewOffDialog(props: SubscriptionDialogProps) {
  const t = useTranslations("admin.subscriptions.autoRenew");
  return (
    <ReasonDialog
      {...props}
      ns="autoRenew"
      max={500}
      field="reason"
      extra={<p className="text-sm text-ink-600">{t("effect")}</p>}
      send={(reason) => switchAutoRenewOff(props.subscription.id, reason, props.subscription.version)}
      done={(detail) => detail}
    />
  );
}

/** Keep the subscription after a customer's cancellation review: it runs on, no money moves. */
export function DeclineReviewDialog(props: SubscriptionDialogProps) {
  return (
    <ReasonDialog
      {...props}
      ns="declineReview"
      max={1000}
      field="note"
      send={(note) => declineCancelReview(props.subscription.id, note, props.subscription.version)}
      done={(detail) => detail}
    />
  );
}

/** End a freeze: the frozen visits come back where they still fit; those inside the lead time or without room stay frozen. */
export function UnfreezeDialog({ subscription, onClose, onStale, changed, returnFocusTo }: SubscriptionDialogProps) {
  const t = useTranslations("admin.subscriptions.unfreeze");
  const text = useSubscriptionText();
  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    send: () => unfreezeSubscription(subscription.id, subscription.version),
    done: (result) => ({
      detail: result.data,
      message:
        result.still_frozen.length > 0
          ? t("doneSome", { restored: result.restored.length, frozen: result.still_frozen.length })
          : t("done", { restored: result.restored.length }),
    }),
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={t("submit")}
      pending={mutation.isPending}
      onConfirm={() => mutation.mutate({})}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {subscription.freeze && (
        <p className="text-sm text-ink-900">
          {t("range", { from: text.dateShort(subscription.freeze.from), to: text.dateShort(subscription.freeze.to) })}
        </p>
      )}
      <ErrorNotice error={mutation.error} />
    </ConfirmDialog>
  );
}
