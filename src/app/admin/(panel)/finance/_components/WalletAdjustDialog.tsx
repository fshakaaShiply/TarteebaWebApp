"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { Button, Dialog, MoneyField, Notice, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { useServerFieldMessage } from "@/lib/admin/errors";
import { adjustCustomerWallet } from "@/lib/admin/finance/endpoints";
import { useFinanceError } from "@/lib/admin/finance/errors";
import {
  WALLET_NOTE_MAX,
  walletCeiling,
  initialWalletValues,
  walletBody,
  walletFormSchema,
  type WalletAdjustBody,
  type WalletFormError,
  type WalletFormValues,
  type WalletType,
} from "@/lib/admin/finance/wallet";
import { keepsIdempotencyKey, type IdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { Money } from "./FinanceParts";
import { useFinanceText } from "./financeText";

type Props = {
  customerUlid: string;
  type: WalletType;
  balanceFils: number;
  /** The panel's key store for this customer and movement type (walletKeysFor): it outlives the dialog. */
  keys: IdempotencyKeys;
  onClose: () => void;
};

/**
 * Add credit (goodwill) or correct the balance (a debit) of one customer (refunds.create). The amount is typed in AED and
 * confirmed in a second step that says what the balance becomes; the request carries an Idempotency-Key (one per body)
 * and the API checks the limits again. Credits only while the balance is on (409 WALLET_DISABLED), never for an account
 * being closed (409 ACCOUNT_CLOSING); a debit can't pass the balance (422 WALLET_BALANCE_INSUFFICIENT). The note is for
 * staff only: the customer never sees it.
 *
 * The route has no If-Match and no expected balance, so the key is the only guard against booking a movement twice. The
 * key store comes from the panel (one per customer and type, kept in this tab): after an attempt whose outcome is unknown
 * the key stays with that first request, also when the dialog is closed and opened again or the page reloads. The form
 * then offers to send that request again (the API replays it if it was booked), and a changed amount or note under the
 * held key is refused by the API (422 IDEMPOTENCY_KEY_REUSED) if the first one was booked.
 */
export function WalletAdjustDialog({ customerUlid, type, balanceFils, keys, onClose }: Props) {
  const t = useTranslations("admin.finance.wallet.adjust");
  const text = useFinanceText();
  const describe = useFinanceError();
  const serverMessage = useServerFieldMessage();
  const errorsT = useTranslations("admin.errors");
  const toast = useToast();
  const queryClient = useQueryClient();
  const summary = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<WalletAdjustBody | null>(null);

  const form = useForm<WalletFormValues>({
    resolver: zodResolver(walletFormSchema(type, balanceFils)) as Resolver<WalletFormValues>,
    defaultValues: initialWalletValues,
  });
  const errors = form.formState.errors;

  useEffect(() => {
    if (confirming) summary.current?.focus();
    else form.setFocus("amount");
  }, [confirming, form]);

  const send = useMutation({
    mutationFn: (body: WalletAdjustBody) => adjustCustomerWallet(customerUlid, body, keys.keyFor({ customer: customerUlid, ...body })),
    onSuccess: (result) => {
      keys.settle();
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      toast.success(t(type === "credit" ? "doneCredit" : "doneDebit", { balance: text.money(result.balance_fils) }));
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      void queryClient.invalidateQueries({ queryKey: adminKeys.finance() });
      if (error instanceof AdminApiError && error.code === "VALIDATION_FAILED") {
        setConfirming(null);
        const fields = error.fieldErrors;
        const amount = fields.amount_fils?.[0];
        const note = fields.note?.[0];
        if (amount) form.setError("amount", { type: "server", message: serverMessage(amount, errorsT("fieldInvalid")) });
        if (note) form.setError("note", { type: "server", message: serverMessage(note, errorsT("fieldInvalid")) });
      }
    },
  });

  const review = form.handleSubmit((values) => {
    const body = walletBody(type, values);
    if (body) setConfirming(body);
  });
  const confirm = (event: MouseEvent<HTMLButtonElement>, body: WalletAdjustBody) => {
    if (event.detail > 1) return;
    send.mutate(body);
  };

  const message = (code: string | undefined) => (code ? t(`errors.${code as WalletFormError}`, { max: text.money(walletCeiling(type, balanceFils)) }) : undefined);
  // The first request while its outcome is unknown, also from an earlier opening of this dialog: sending it again under
  // its key replays the API's answer for it.
  const held = keys.heldBody<{ customer: string } & WalletAdjustBody>();
  const heldBody: WalletAdjustBody | null =
    held && held.customer === customerUlid && held.type === type ? { type: held.type, amount_fils: held.amount_fils, reason_code: held.reason_code, note: held.note } : null;
  const errorCode = send.error instanceof AdminApiError ? send.error.code : null;
  const unknown = send.isError && keepsIdempotencyKey(send.error);
  // Another amount or note under the held key, and the first request had been booked: show that one first.
  const earlierStored = errorCode === "IDEMPOTENCY_KEY_REUSED" && heldBody !== null;
  const shownError = send.error && !unknown && !earlierStored && errorCode !== "VALIDATION_FAILED" ? send.error : null;
  const resendEarlier = heldBody ? (
    <Button variant="secondary" size="sm" className="self-start" onClick={() => send.mutate(heldBody)} loading={send.isPending}>
      {t("resendEarlier", { amount: text.money(heldBody.amount_fils) })}
    </Button>
  ) : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      closeOnOutsideClick={false}
      title={confirming ? t("confirmTitle") : t(type === "credit" ? "creditTitle" : "debitTitle")}
      description={confirming ? undefined : t(type === "credit" ? "creditDescription" : "debitDescription")}
      footer={
        confirming ? (
          <>
            <Button key="back" variant="outline" onClick={() => setConfirming(null)} disabled={send.isPending}>
              {t("back")}
            </Button>
            <Button key="confirm" variant={type === "debit" ? "danger" : "primary"} onClick={(event) => confirm(event, confirming)} loading={send.isPending}>
              {t(type === "credit" ? "confirmCredit" : "confirmDebit", { amount: text.money(confirming.amount_fils) })}
            </Button>
          </>
        ) : (
          <>
            <Button key="cancel" variant="outline" onClick={onClose} disabled={send.isPending}>
              {t("cancel")}
            </Button>
            <Button key="review" onClick={() => void review()} disabled={send.isPending}>
              {t("review")}
            </Button>
          </>
        )
      }
    >
      {confirming ? (
        <div ref={summary} tabIndex={-1} className="flex flex-col gap-3 outline-none">
          <dl className="flex flex-col gap-2 rounded-md bg-ivory-50 p-4 text-sm">
            <div className="flex justify-between gap-3 text-base font-bold text-ink-900">
              <dt>{t(type === "credit" ? "amountCredit" : "amountDebit")}</dt>
              <dd>
                <Money fils={confirming.amount_fils} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("balanceNow")}</dt>
              <dd>
                <Money fils={balanceFils} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("note")}</dt>
              <dd className="text-end">“{confirming.note}”</dd>
            </div>
          </dl>
          <Notice tone="warning">{t(type === "credit" ? "confirmNoteCredit" : "confirmNoteDebit")}</Notice>
        </div>
      ) : (
        <form noValidate onSubmit={(e) => void review(e)} className="flex flex-col gap-4">
          <MoneyField
            label={t("amount")}
            required
            hint={t("amountHint", { max: text.money(walletCeiling(type, balanceFils)) })}
            error={message(errors.amount?.message)}
            {...form.register("amount")}
          />
          <TextArea
            label={t("noteField")}
            required
            hint={t("noteHint")}
            rows={3}
            maxLength={WALLET_NOTE_MAX}
            error={message(errors.note?.message)}
            {...form.register("note")}
          />
          {heldBody && (
            <Notice tone="warning" action={resendEarlier}>
              {t("heldNote", { amount: text.money(heldBody.amount_fils) })}
            </Notice>
          )}
        </form>
      )}
      {unknown ? (
        <Notice tone="warning" title={t("unknownTitle")} className="mt-3">
          <p>{describe(send.error)}</p>
          <p>{t("unknownBody")}</p>
        </Notice>
      ) : earlierStored ? (
        // The form step offers the same button in its own note.
        <Notice tone="warning" title={t("earlierTitle")} className="mt-3" action={confirming ? resendEarlier : undefined}>
          {t("earlierBody")}
        </Notice>
      ) : shownError ? (
        <Notice tone="danger" className="mt-3">
          {describe(shownError)}
        </Notice>
      ) : null}
    </Dialog>
  );
}
