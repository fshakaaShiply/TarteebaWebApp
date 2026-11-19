"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Button, Dialog, Notice, TextArea, TextField, useToast } from "@/components/admin";
import { recordRefundOutcome, reinstateRefund, type ReinstateBody, type RefundOutcomeBody } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import { PROVIDER_REF_MAX, REFUND_OPS_NOTE_MAX, buildOutcome, buildReinstate, type OpsFormError } from "@/lib/admin/finance/refundOps";
import { termsChangedAmount } from "@/lib/admin/finance/reconciliation";
import { keepsIdempotencyKey, useIdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { AdminRefund } from "@/lib/admin/types";
import { Code, Money } from "../../_components/FinanceParts";
import { useFinanceText } from "../../_components/financeText";

/*
 * Two staff actions on a refund the provider's answers left flagged (refunds.create; finance §3.3, A1a §5.2):
 *  - "Record provider answer": a flagged refund that is still open: the provider paid it (with its reference when we
 *    have none) or declined it (with the provider's code). Success issues the credit note, as a webhook would.
 *  - "Provider paid after all": a refund that failed and was later reported paid. The amount is the refund's own.
 * Both show the refund's facts first, then the exact amount in a second step, and send an Idempotency-Key (one per body)
 * and the refund's version as If-Match. A 409 TERMS_CHANGED puts the API's amount on screen and asks again.
 */

type Props = { refund: AdminRefund; onClose: () => void };

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
    void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
    void queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
  };
}

function RefundFacts({ refund, amount }: { refund: AdminRefund; amount?: number }) {
  const t = useTranslations("admin.finance.refundOps");
  const text = useFinanceText();
  return (
    <dl className="flex flex-col gap-2 rounded-md bg-ivory-50 p-4 text-sm">
      <div className="flex justify-between gap-3 text-base font-bold text-ink-900">
        <dt>{t("amount")}</dt>
        <dd>
          <Money fils={amount ?? refund.amount_fils} />
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>{t("status")}</dt>
        <dd className="text-end">{text.refund(refund.status, refund.status_label)}</dd>
      </div>
      {refund.customer && (
        <div className="flex justify-between gap-3">
          <dt>{t("customer")}</dt>
          <dd className="text-end">{refund.customer.name || <Code>{refund.customer.phone}</Code>}</dd>
        </div>
      )}
      {refund.review?.reason_label && (
        <div className="flex justify-between gap-3">
          <dt>{t("flag")}</dt>
          <dd className="text-end">{text.name(refund.review.reason_label)}</dd>
        </div>
      )}
      {refund.gateway_refund_ref && (
        <div className="flex justify-between gap-3">
          <dt>{t("providerRef")}</dt>
          <dd className="min-w-0 text-end">
            <Code wrap className="text-xs">
              {refund.gateway_refund_ref}
            </Code>
          </dd>
        </div>
      )}
      {refund.failure_code && (
        <div className="flex justify-between gap-3">
          <dt>{t("failure")}</dt>
          <dd className="min-w-0 text-end">
            <Code wrap className="text-xs">
              {refund.failure_code}
            </Code>
          </dd>
        </div>
      )}
    </dl>
  );
}

/** The two-step shell both dialogs share: form first, then the summary with the money confirmed. */
function useConfirmFocus(active: boolean) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) summary.current?.focus();
  }, [active]);
  return summary;
}

export function RecordRefundOutcomeDialog({ refund, onClose }: Props) {
  const t = useTranslations("admin.finance.refundOps");
  const text = useFinanceText();
  const describe = useFinanceError();
  const toast = useToast();
  const refresh = useRefresh();
  const keys = useIdempotencyKeys();
  const [status, setStatus] = useState<"succeeded" | "failed">("succeeded");
  const [providerRef, setProviderRef] = useState("");
  const [failureCode, setFailureCode] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"note" | "provider_refund_ref" | "failure_code", OpsFormError>>>({});
  const [confirming, setConfirming] = useState<RefundOutcomeBody | null>(null);
  const summary = useConfirmFocus(confirming !== null);

  const send = useMutation({
    mutationFn: (body: RefundOutcomeBody) => recordRefundOutcome(refund.id, body, refund.version ?? 0, keys.keyFor({ refund: refund.id, version: refund.version, ...body })),
    onSuccess: (updated) => {
      keys.settle();
      refresh();
      toast.success(t("outcome.done", { status: text.refund(updated.status, updated.status_label) }));
      onClose();
    },
    onError: (e) => {
      keys.settle(e);
      refresh();
    },
  });

  const review = () => {
    const built = buildOutcome({ status, provider_refund_ref: providerRef, failure_code: failureCode, note }, refund);
    if (!built.ok) {
      setErrors({ [built.field]: built.error });
      return;
    }
    setErrors({});
    send.reset();
    setConfirming(built.body);
  };
  const confirm = (event: MouseEvent<HTMLButtonElement>, body: RefundOutcomeBody) => {
    if (event.detail > 1) return;
    send.mutate(body);
  };

  const unknown = send.isError && keepsIdempotencyKey(send.error);
  const err = (field: keyof typeof errors) => (errors[field] ? t(`errors.${errors[field]}`) : undefined);

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      closeOnOutsideClick={false}
      title={confirming ? t("outcome.confirmTitle") : t("outcome.title")}
      description={confirming ? undefined : t("outcome.description")}
      footer={
        confirming ? (
          <>
            <Button key="back" variant="outline" onClick={() => setConfirming(null)} disabled={send.isPending}>
              {t("back")}
            </Button>
            <Button key="confirm" variant={confirming.status === "succeeded" ? "primary" : "danger"} onClick={(event) => confirm(event, confirming)} loading={send.isPending}>
              {confirming.status === "succeeded" ? t("outcome.confirmPaid", { amount: text.money(refund.amount_fils) }) : t("outcome.confirmFailed")}
            </Button>
          </>
        ) : (
          <>
            <Button key="cancel" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button key="review" onClick={review}>
              {t("review")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <RefundFacts refund={refund} />
        {confirming ? (
          <div ref={summary} tabIndex={-1} className="flex flex-col gap-3 outline-none">
            <Notice tone="warning">{confirming.status === "succeeded" ? t("outcome.confirmPaidNote") : t("outcome.confirmFailedNote")}</Notice>
            <dl className="flex flex-col gap-1.5 text-sm">
              {confirming.status === "succeeded" && confirming.provider_refund_ref && (
                <div className="flex justify-between gap-3">
                  <dt>{t("providerRef")}</dt>
                  <dd className="min-w-0 text-end">
                    <Code wrap>{confirming.provider_refund_ref}</Code>
                  </dd>
                </div>
              )}
              {confirming.status === "failed" && (
                <div className="flex justify-between gap-3">
                  <dt>{t("failure")}</dt>
                  <dd className="min-w-0 text-end">
                    <Code wrap>{confirming.failure_code}</Code>
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt>{t("note")}</dt>
                <dd className="text-end">“{confirming.note}”</dd>
              </div>
            </dl>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink-900">{t("outcome.answer")}</legend>
              {(["succeeded", "failed"] as const).map((value) => (
                <label key={value} className="touch-target flex items-center gap-2.5 rounded-md border border-line px-3 py-2.5 text-sm has-[:checked]:border-petrol-700 has-[:checked]:bg-petrol-50">
                  <input type="radio" name="refund-outcome" value={value} checked={status === value} onChange={() => setStatus(value)} />
                  <span className="font-medium text-ink-900">{t(`outcome.answers.${value}`)}</span>
                </label>
              ))}
            </fieldset>
            {status === "succeeded" ? (
              <TextField
                label={refund.gateway_refund_ref ? t("providerRefOptional") : t("providerRefRequired")}
                required={!refund.gateway_refund_ref}
                hint={t("providerRefHint")}
                maxLength={PROVIDER_REF_MAX}
                value={providerRef}
                onChange={(e) => setProviderRef(e.target.value)}
                error={err("provider_refund_ref")}
                dir="ltr"
                className="font-latin text-start"
              />
            ) : (
              <TextField
                label={t("failureCode")}
                required
                hint={t("failureCodeHint")}
                maxLength={64}
                value={failureCode}
                onChange={(e) => setFailureCode(e.target.value)}
                error={err("failure_code")}
                dir="ltr"
                className="font-latin text-start"
              />
            )}
            <TextArea label={t("noteField")} required hint={t("noteHint")} rows={3} maxLength={REFUND_OPS_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} error={err("note")} />
          </>
        )}
        {unknown ? (
          <Notice tone="warning" title={t("unknownTitle")}>
            <p>{describe(send.error)}</p>
            <p>{t("unknownBody")}</p>
          </Notice>
        ) : send.isError ? (
          <Notice tone="danger">{describe(send.error)}</Notice>
        ) : null}
      </div>
    </Dialog>
  );
}

export function ReinstateRefundDialog({ refund, onClose }: Props) {
  const t = useTranslations("admin.finance.refundOps");
  const text = useFinanceText();
  const describe = useFinanceError();
  const toast = useToast();
  const refresh = useRefresh();
  const keys = useIdempotencyKeys();
  const [providerRef, setProviderRef] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"note" | "provider_refund_ref", OpsFormError>>>({});
  const [confirming, setConfirming] = useState<ReinstateBody | null>(null);
  const [changed, setChanged] = useState<{ from: number; to: number } | null>(null);
  const summary = useConfirmFocus(confirming !== null);

  const send = useMutation({
    mutationFn: (body: ReinstateBody) => reinstateRefund(refund.id, body, refund.version ?? 0, keys.keyFor({ refund: refund.id, version: refund.version, ...body })),
    onSuccess: (updated) => {
      keys.settle();
      refresh();
      toast.success(t("reinstate.done", { amount: text.money(updated.amount_fils) }));
      onClose();
    },
    onError: (e) => {
      keys.settle(e);
      refresh();
      const moved = termsChangedAmount(e);
      if (moved !== null && confirming) {
        setChanged({ from: confirming.expected_amount_fils, to: moved });
        setConfirming({ ...confirming, expected_amount_fils: moved });
      }
    },
  });

  const review = () => {
    const built = buildReinstate({ provider_refund_ref: providerRef, note }, refund.amount_fils);
    if (!built.ok) {
      setErrors({ [built.field]: built.error });
      return;
    }
    setErrors({});
    setChanged(null);
    send.reset();
    setConfirming(built.body);
  };
  const confirm = (event: MouseEvent<HTMLButtonElement>, body: ReinstateBody) => {
    if (event.detail > 1) return;
    send.mutate(body);
  };

  const unknown = send.isError && keepsIdempotencyKey(send.error);
  const shownError = send.error && termsChangedAmount(send.error) === null ? send.error : null;
  const err = (field: keyof typeof errors) => (errors[field] ? t(`errors.${errors[field]}`) : undefined);

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      closeOnOutsideClick={false}
      title={confirming ? t("reinstate.confirmTitle") : t("reinstate.title")}
      description={confirming ? undefined : t("reinstate.description")}
      footer={
        confirming ? (
          <>
            <Button key="back" variant="outline" onClick={() => setConfirming(null)} disabled={send.isPending}>
              {t("back")}
            </Button>
            <Button key="confirm" onClick={(event) => confirm(event, confirming)} loading={send.isPending}>
              {t("reinstate.confirm", { amount: text.money(confirming.expected_amount_fils) })}
            </Button>
          </>
        ) : (
          <>
            <Button key="cancel" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button key="review" onClick={review}>
              {t("review")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <RefundFacts refund={refund} amount={confirming?.expected_amount_fils} />
        {changed && (
          <Notice tone="warning" title={t("termsChangedTitle")}>
            {t("termsChanged", { from: text.money(changed.from), to: text.money(changed.to) })}
          </Notice>
        )}
        {confirming ? (
          <div ref={summary} tabIndex={-1} className="flex flex-col gap-3 outline-none">
            <Notice tone="warning">{t("reinstate.confirmNote")}</Notice>
            <dl className="flex flex-col gap-1.5 text-sm">
              {confirming.provider_refund_ref && (
                <div className="flex justify-between gap-3">
                  <dt>{t("providerRef")}</dt>
                  <dd className="min-w-0 text-end">
                    <Code wrap>{confirming.provider_refund_ref}</Code>
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt>{t("note")}</dt>
                <dd className="text-end">“{confirming.note}”</dd>
              </div>
            </dl>
          </div>
        ) : (
          <>
            <TextField
              label={t("providerRefOptional")}
              hint={t("providerRefHint")}
              maxLength={PROVIDER_REF_MAX}
              value={providerRef}
              onChange={(e) => setProviderRef(e.target.value)}
              error={err("provider_refund_ref")}
              dir="ltr"
              className="font-latin text-start"
            />
            <TextArea label={t("noteField")} required hint={t("noteHint")} rows={3} maxLength={REFUND_OPS_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} error={err("note")} />
          </>
        )}
        {unknown ? (
          <Notice tone="warning" title={t("unknownTitle")}>
            <p>{describe(send.error)}</p>
            <p>{t("unknownBody")}</p>
          </Notice>
        ) : shownError ? (
          <Notice tone="danger">{describe(shownError)}</Notice>
        ) : null}
      </div>
    </Dialog>
  );
}
