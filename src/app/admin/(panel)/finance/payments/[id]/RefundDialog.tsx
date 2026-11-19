"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { Button, Dialog, MoneyField, Notice, Select, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createRefund } from "@/lib/admin/endpoints";
import { useServerFieldMessage } from "@/lib/admin/errors";
import { fetchWalletEnabled } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import {
  REFUND_NOTE_MAX,
  checkRefund,
  initialRefundValues,
  pickableReason,
  refundFormSchema,
  refundableAfter,
  refundableFromError,
  selectableReasons,
  type RefundFormError,
  type RefundFormValues,
} from "@/lib/admin/finance/refund";
import { keepsIdempotencyKey, type IdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { AdminPaymentDetail, AdminRefund, CreateRefundPayload } from "@/lib/admin/types";
import { Code, Money } from "../../_components/FinanceParts";
import { useFinanceText } from "../../_components/financeText";
import { useRefundReasons } from "../../_components/useRefundReasons";

/**
 * Refund (spec §10.4; refunds.create): the amount in AED (sent as fils), never more than what is left to refund, a
 * reason from the API's list (GET /admin/refund-reasons: the selectable ones, a note when the reason requires text),
 * then an explicit confirmation of the exact amount. The request
 * carries an Idempotency-Key: one per refund intent, kept for a retry after a lost answer or a server error. After an
 * unknown outcome the key stays with that first request even if the form changes (the API then answers 422
 * IDEMPOTENCY_KEY_REUSED instead of refunding twice), and "Try again" resends exactly that request. The result shows
 * the provider's status: a refund is "processing" until the provider says otherwise, and one the provider declined at
 * once (201 with status failed) keeps the dialog open with the provider's message.
 *
 * The confirmation is a separate step that a repeated activation of "Continue" can never pass: its buttons are new
 * elements (keyed), focus moves to the summary, and a click that is the second of a double-click (detail > 1) on the
 * confirm button is ignored, since in a browser it lands on whatever now sits where "Continue" was.
 */
export function RefundDialog({ payment, keys, onClose }: { payment: AdminPaymentDetail; keys: IdempotencyKeys; onClose: () => void }) {
  const t = useTranslations("admin.finance.refund");
  const text = useFinanceText();
  // The Phase 5 codes (WALLET_DISABLED, ACCOUNT_CLOSING, REFUND_AMOUNT_INVALID with the figure …) first, the rest as before.
  const describe = useFinanceError();
  const serverMessage = useServerFieldMessage();
  const errorsT = useTranslations("admin.errors");
  const toast = useToast();
  const queryClient = useQueryClient();
  const formId = useId();

  // What may be refunded: the page's figure, or the API's own after it refused an amount (another refund meanwhile).
  // react-hook-form takes the resolver of the latest render, so the check follows this value.
  const [refundable, setRefundable] = useState(payment.refundable_fils);
  const [confirming, setConfirming] = useState<CreateRefundPayload | null>(null);
  // A refund the provider refused on the spot: nothing was refunded, the form stays open to correct or try later.
  const [declined, setDeclined] = useState<AdminRefund | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  const reasons = useRefundReasons();
  const reasonList = reasons.data ?? [];

  /*
   * Where the money goes (Phase 5). The customer balance is off by owner ruling: the choice appears only while the public
   * config says it is on. A payment the customer paid from the balance has no card to refund, so its refund goes back to
   * the balance (named, not chosen). With the balance off and a card payment nothing is sent: the API's default is the card.
   */
  const walletConfig = useQuery({ queryKey: adminKeys.walletEnabled(), queryFn: fetchWalletEnabled, staleTime: 5 * 60_000, retry: false });
  const paidFromBalance = payment.method === "wallet";
  const offersChoice = walletConfig.data === true && !paidFromBalance;
  const [destination, setDestination] = useState<"card" | "wallet">("card");
  const destinationSent: "card" | "wallet" | null = paidFromBalance ? "wallet" : offersChoice ? destination : null;

  const form = useForm<RefundFormValues>({
    resolver: zodResolver(refundFormSchema(refundable, reasonList)) as Resolver<RefundFormValues>,
    defaultValues: initialRefundValues(payment.refundable_fils),
  });
  const reasonCode = useWatch({ control: form.control, name: "reason_code" });
  // The chosen reason as the API describes it (whether it needs a note).
  const reason = pickableReason(reasonList, reasonCode);
  /** A reason's label as the API names it (the confirm step reads it from the same list). */
  const reasonLabel = (code: string) => text.reason(reasonList.find((r) => r.code === code)?.label);

  // Focus follows the step: the summary when the confirmation opens (never its Refund button, so a second Enter on
  // "Continue" does nothing), the amount when the form comes back.
  const step = confirming ? "confirm" : "form";
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    if (step === "confirm") summary.current?.focus();
    else form.setFocus("amount");
  }, [step, form]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
    // The booking page shows the payment status and its refunds; A08 shows each period's refunded and refundable
    // amounts (a subscription period's payment); the overview counts refunds.
    void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
    void queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
  };

  const send = useMutation({
    mutationFn: (payload: CreateRefundPayload) => createRefund(payment.id, payload, keys.keyFor({ payment: payment.id, ...payload })),
    onMutate: () => setDeclined(null),
    onSuccess: (refund) => {
      keys.settle();
      refresh();
      if (refund.status === "failed") {
        // 201 with the provider's refusal: no success styling, and the dialog stays.
        setConfirming(null);
        setDeclined(refund);
        return;
      }
      // The provider's status as it is now (spec §16): usually still processing, which is not a success yet.
      const message = t("done", { amount: text.money(refund.amount_fils), status: text.refund(refund.status, refund.status_label) });
      if (refund.status === "succeeded") toast.success(message);
      else toast.info(message);
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      refresh();
      const left = refundableFromError(error);
      if (left !== null) {
        setRefundable(left);
        setConfirming(null);
        form.setError("amount", { type: "server", message: "amount_over" });
        return;
      }
      if (error instanceof AdminApiError && error.code === "VALIDATION_FAILED") {
        const fields = error.fieldErrors;
        setConfirming(null);
        for (const field of ["amount_fils", "reason_code", "reason_text"] as const) {
          const message = fields[field]?.[0];
          if (message) {
            form.setError(field === "amount_fils" ? "amount" : field, { type: "server", message: serverMessage(message, errorsT("fieldInvalid")) });
          }
        }
      }
    },
  });

  /**
   * The first request's body while its outcome is unknown: "Try again" sends exactly that. The key store belongs to the
   * payment page, so it is still held when the dialog is closed and opened again.
   */
  const held = keys.heldBody<{ payment: number } & CreateRefundPayload>();
  const heldPayload: CreateRefundPayload | null = held
    ? { amount_fils: held.amount_fils, reason_code: held.reason_code, reason_text: held.reason_text, ...(held.destination ? { destination: held.destination } : {}) }
    : null;
  const errorCode = send.error instanceof AdminApiError ? send.error.code : null;
  const outcomeUnknown = send.isError && keepsIdempotencyKey(send.error);
  const earlierStored = errorCode === "IDEMPOTENCY_KEY_REUSED" && heldPayload !== null;

  const message = (code: string | undefined) => {
    if (!code) return undefined;
    if (code === "amount_over") return t("errors.amount_over", { max: text.money(refundable) });
    return t.has(`errors.${code}`) ? t(`errors.${code as RefundFormError}`) : code;
  };

  const review = form.handleSubmit((values) => {
    const check = checkRefund(values, refundable, reasonList);
    if (check.ok) setConfirming(destinationSent ? { ...check.payload, destination: destinationSent } : check.payload);
  });

  const busy = send.isPending;
  const errors = form.formState.errors;
  const unhandledError =
    send.error && !outcomeUnknown && !earlierStored && refundableFromError(send.error) === null && errorCode !== "VALIDATION_FAILED" ? send.error : null;

  /*
   * The second click of a double-click on "Continue" lands on this button, or (the confirm step is shorter, so the
   * centred dialog shrinks) on the overlay: only a deliberate activation refunds, and an outside click never closes the
   * dialog (closeOnOutsideClick false; Escape, the close button and Cancel still do).
   */
  const confirm = (event: MouseEvent<HTMLButtonElement>, payload: CreateRefundPayload) => {
    if (event.detail > 1) return;
    send.mutate(payload);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      dismissible={!busy}
      closeOnOutsideClick={false}
      title={confirming ? t("confirmTitle") : t("title")}
      description={confirming ? undefined : t("description")}
      footer={
        // Keyed: the confirm step's buttons are new elements, never the focused "Continue" button relabelled.
        confirming ? (
          <>
            <Button key="back" variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              {t("back")}
            </Button>
            <Button key="confirm" variant="danger" onClick={(event) => confirm(event, confirming)} loading={busy}>
              {t(confirming.destination === "wallet" ? "confirmWallet" : "confirm", { amount: text.money(confirming.amount_fils) })}
            </Button>
          </>
        ) : (
          <>
            <Button key="cancel" variant="outline" onClick={onClose} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button key="review" type="submit" form={formId} disabled={busy}>
              {t("review")}
            </Button>
          </>
        )
      }
    >
      {confirming ? (
        // Focused when the step opens, so a screen reader reads the amount, customer and reason first.
        <div ref={summary} tabIndex={-1} className="flex flex-col gap-3 outline-none">
          <dl className="flex flex-col gap-2 rounded-md bg-ivory-50 p-4 text-sm">
            <div className="flex justify-between gap-3 text-base font-bold text-ink-900">
              <dt>{t("amountToRefund")}</dt>
              <dd>
                <Money fils={confirming.amount_fils} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("customer")}</dt>
              {/* A phone without a name is isolated LTR, so its "+" stays in front in Arabic. */}
              <dd className="text-end">{payment.customer?.name || (payment.customer?.phone ? <Code>{payment.customer.phone}</Code> : "—")}</dd>
            </div>
            {confirming.destination && (
              <div className="flex justify-between gap-3">
                <dt>{t("destination")}</dt>
                <dd className="text-end">{confirming.destination === "wallet" ? t("destinationWallet") : t("destinationCard")}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt>{t("reason")}</dt>
              <dd className="text-end">{reasonLabel(confirming.reason_code)}</dd>
            </div>
            {confirming.reason_text && (
              <div className="flex justify-between gap-3">
                <dt>{t("note")}</dt>
                <dd className="text-end">“{confirming.reason_text}”</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 text-ink-600">
              <dt>{t("leftAfter")}</dt>
              <dd>
                <Money fils={refundableAfter(refundable, confirming.amount_fils)} />
              </dd>
            </div>
          </dl>
          <Notice tone="warning">{confirming.destination === "wallet" ? t("confirmNoteWallet") : t("confirmNote")}</Notice>
          {outcomeUnknown ? (
            <Notice
              tone="warning"
              title={t("unknownTitle")}
              action={
                heldPayload ? (
                  <Button variant="secondary" size="sm" className="self-start" onClick={() => send.mutate(heldPayload)}>
                    {t("tryAgain")}
                  </Button>
                ) : undefined
              }
            >
              <p>{describe(send.error)}</p>
              <p>{t("unknownBody")}</p>
            </Notice>
          ) : earlierStored && heldPayload ? (
            <Notice
              tone="warning"
              title={t("earlierTitle")}
              action={
                <Button size="sm" className="self-start" onClick={() => send.mutate(heldPayload)}>
                  {t("showEarlier", { amount: text.money(heldPayload.amount_fils) })}
                </Button>
              }
            >
              {t("earlierBody")}
            </Notice>
          ) : unhandledError ? (
            <Notice tone="danger">{describe(unhandledError)}</Notice>
          ) : null}
        </div>
      ) : (
        <form id={formId} noValidate onSubmit={review} className="flex flex-col gap-4">
          {declined && (
            <Notice tone="danger" title={t("declinedTitle", { amount: text.money(declined.amount_fils) })}>
              {declined.failure_message && <p>{declined.failure_message}</p>}
              <p>
                {t("declinedBody", { status: text.refund(declined.status, declined.status_label) })}
                {declined.failure_code && (
                  <>
                    {" "}
                    <Code wrap>({declined.failure_code})</Code>
                  </>
                )}
              </p>
            </Notice>
          )}
          {paidFromBalance && <Notice tone="info">{t("paidFromBalance")}</Notice>}
          {offersChoice && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink-900">{t("destination")}</legend>
              {(["card", "wallet"] as const).map((value) => (
                <label key={value} className="touch-target flex items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-sm has-[:checked]:border-petrol-700 has-[:checked]:bg-petrol-50">
                  <input type="radio" name={`${formId}-destination`} value={value} checked={destination === value} onChange={() => setDestination(value)} className="mt-1" />
                  <span className="flex flex-col">
                    <span className="font-medium text-ink-900">{value === "card" ? t("destinationCard") : t("destinationWallet")}</span>
                    <span className="text-xs text-ink-600">{value === "card" ? t("destinationCardHint") : t("destinationWalletHint")}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <MoneyField
            label={t("amount")}
            required
            hint={t("amountHint", { max: text.money(refundable) })}
            error={message(errors.amount?.message)}
            {...form.register("amount")}
          />
          <Select
            label={t("reason")}
            required
            placeholder={reasons.isPending ? t("reasonsLoading") : t("chooseReason")}
            disabled={reasons.isPending}
            options={selectableReasons(reasons.data).map((r) => ({ value: r.code, label: text.reason(r.label) }))}
            error={message(errors.reason_code?.message)}
            {...form.register("reason_code")}
          />
          {reasons.isError && (
            <Notice
              tone="danger"
              title={t("reasonsFailed")}
              action={
                <Button variant="secondary" size="sm" className="self-start" onClick={() => void reasons.refetch()} loading={reasons.isFetching}>
                  {t("reasonsRetry")}
                </Button>
              }
            >
              {describe(reasons.error)}
            </Notice>
          )}
          <TextArea
            label={reason?.requires_text ? t("noteRequired") : t("noteOptional")}
            required={reason?.requires_text ?? false}
            hint={t("noteHint")}
            rows={2}
            maxLength={REFUND_NOTE_MAX}
            error={message(errors.reason_text?.message)}
            {...form.register("reason_text")}
          />
          <Notice tone="info">{t("creditNoteNote")}</Notice>
          {heldPayload && (
            <Notice
              tone="warning"
              action={
                <Button variant="secondary" size="sm" className="self-start" onClick={() => send.mutate(heldPayload)} loading={busy}>
                  {t("resendEarlier", { amount: text.money(heldPayload.amount_fils) })}
                </Button>
              }
            >
              {t("heldNote")}
            </Notice>
          )}
        </form>
      )}
    </Dialog>
  );
}
