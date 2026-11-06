"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ConfirmDialog, LoadingBlock, Notice } from "@/components/admin";
import { codeOf, termsChangedOf, type TermsChanged } from "@/lib/admin/subscriptions/actions";
import { previewRenew, renewSubscription } from "@/lib/admin/subscriptions/endpoints";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { RenewPreview } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { ChangedNotice, DRY_RUN, ErrorNotice, PreviewBox, TermsChangedNotice, TermsRow, useDialogMutation, type SubscriptionDialogProps } from "./kit";

/**
 * Renew now (a failed or suspended renewal): charges the card the subscription already has, never another one (P4-65),
 * for the amount the preview shows. That amount goes back as expected_amount_fils: when the price moved meanwhile (409
 * TERMS_CHANGED) the new amount is on screen and needs a fresh confirm. A charge the provider is still checking is
 * "payment verifying", never "paid" (spec §16); the outcome shows on the Periods tab.
 */
export function RenewDialog({ subscription, onClose, onStale, changed, returnFocusTo }: SubscriptionDialogProps) {
  const t = useTranslations("admin.subscriptions.renew");
  const text = useSubscriptionText();
  const describe = useSubscriptionErrorMessage();
  const [problem, setProblem] = useState(false);
  const preview = useQuery({
    queryKey: subscriptionKeys.preview("renew", subscription.id, subscription.version),
    queryFn: () => previewRenew(subscription.id),
    ...DRY_RUN,
  });
  const [updated, setUpdated] = useState<TermsChanged<RenewPreview> | null>(null);
  const terms: RenewPreview | undefined = updated?.preview ?? preview.data;

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "renew",
    send: (input: { expected_amount_fils: number }, key) => renewSubscription(subscription.id, input.expected_amount_fils, key),
    done: (result) => {
      const status = result.payment?.status ?? "";
      if (status === "failed") return { detail: result.data, message: t("doneFailed", { reference: subscription.reference }), tone: "error" };
      if (status === "captured" || status === "paid") return { detail: result.data, message: t("done", { reference: subscription.reference }) };
      return { detail: result.data, message: t("donePending", { reference: subscription.reference }), tone: "info" };
    },
    onError: (error) => {
      const next = termsChangedOf<RenewPreview>(error);
      if (next) setUpdated(next);
    },
  });
  const noPrice = terms !== undefined && terms.amount_fils === null;
  const submit = () => {
    if (!terms || terms.amount_fils === null) {
      setProblem(true);
      return;
    }
    setProblem(false);
    mutation.mutate({ expected_amount_fils: terms.amount_fils });
  };
  const moved = updated?.changed.includes("amount_fils") ?? false;

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={updated ? t("submitNewTerms") : codeOf(mutation.error) === "PAYMENT_RESULT_UNKNOWN" ? t("retry") : t("submit")}
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {preview.isPending && !updated ? (
        <LoadingBlock lines={3} />
      ) : !terms ? (
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
            <TermsRow label={t("amount")} value={terms.amount_fils === null ? t("noPrice") : text.moneyFixed(terms.amount_fils)} changed={moved} />
            <TermsRow label={t("card")} value={terms.card_label ?? t("noCard")} />
            <TermsRow label={t("period")} value={`${text.dateShort(terms.period.start)} – ${text.dateShort(terms.period.end)}`} />
            <TermsRow label={t("attempt")} value={terms.attempt_no} />
          </dl>
          {noPrice && <p className="font-medium text-danger-700">{t("noPriceBody")}</p>}
          <p className="text-xs text-ink-600">{t("sameCard")}</p>
        </PreviewBox>
      )}
      {updated && <TermsChangedNotice body={t("termsChangedBody")} />}
      {problem && (
        <Notice tone="warning" role="alert">
          {t("termsMissing")}
        </Notice>
      )}
      {codeOf(mutation.error) === "PAYMENT_RESULT_UNKNOWN" ? (
        <Notice tone="warning" title={t("unknownTitle")}>
          {t("unknownBody")}
        </Notice>
      ) : (
        termsChangedOf(mutation.error) === null && <ErrorNotice error={mutation.error} />
      )}
    </ConfirmDialog>
  );
}
