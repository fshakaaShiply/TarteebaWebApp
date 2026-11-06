"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ConfirmDialog, LoadingBlock, MoneyField, Notice, Select, TextArea } from "@/components/admin";
import { CANCEL_PARTIES, CANCEL_REASONS, reasonTextRequired } from "@/lib/admin/bookings/actions";
import { REFUND_PERMISSION, codeOf, maxRefundOf, termsChangedOf, type TermsChanged } from "@/lib/admin/subscriptions/actions";
import { cancelSubscription, previewCancel, type CancelInput } from "@/lib/admin/subscriptions/endpoints";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { CancelParty, CancelPlan } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { useAdminSession } from "@/lib/admin/session";
import { parseAedToFils } from "@/lib/money";
import { PeriodsTable } from "./PlanTable";
import { ChangedNotice, DRY_RUN, ErrorNotice, PreviewBox, TermsChangedNotice, TermsRow, hasFieldErrors, useDialogMutation, useFieldError, type SubscriptionDialogProps } from "./kit";

/**
 * Cancel with the financial preview first (design §4.7, §9.1; the booking page's CancelBookingDialog pattern): whose
 * cancellation it is (the customer's: the policy's fee and the package-discount clawback; the company's: the company
 * rule and compensation), the periods table (paid, refundable, unused, fee, clawback, refund) and the totals, all from
 * the API. Only someone with refunds.create may type a custom total refund; a preview that needs a review sends the
 * cancellation to the finance review queue. The fee, refund and clawback the preview showed go back as expected_*; when
 * they moved (409 TERMS_CHANGED) the new ones are on screen, the changes marked, and a fresh confirm sends them.
 *
 * A custom amount replaces the policy's figures (PlanCancellation: no fee, no clawback, exactly that refund), so with
 * one the terms confirmed are fee 0, clawback 0 and refund = the amount typed, which the dialog says under the field.
 *
 * `companyOnly`: while a cancellation waits for review, a coordinator may still cancel as the company (§4.7); the API
 * closes the review as superseded. The party is fixed and the dialog says so.
 */
export function CancelSubscriptionDialog({ subscription, onClose, onStale, changed, returnFocusTo, companyOnly = false }: SubscriptionDialogProps & { companyOnly?: boolean }) {
  const t = useTranslations("admin.subscriptions.cancel");
  const text = useSubscriptionText();
  const describe = useSubscriptionErrorMessage();
  const fieldError = useFieldError();
  const { can } = useAdminSession();
  const mayRefund = can(REFUND_PERMISSION);
  const [party, setParty] = useState<CancelParty>(companyOnly ? "company" : "customer");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [refund, setRefund] = useState("");
  const [problems, setProblems] = useState<{ reason?: string; text?: string; refund?: string }>({});

  const preview = useQuery({
    queryKey: subscriptionKeys.preview("cancel", subscription.id, subscription.version, party),
    queryFn: () => previewCancel(subscription.id, party),
    ...DRY_RUN,
  });
  const [updated, setUpdated] = useState<{ party: CancelParty; plan: TermsChanged<CancelPlan> } | null>(null);
  const fresh = updated && updated.party === party ? updated.plan : null;
  const plan: CancelPlan | undefined = fresh?.preview ?? preview.data;
  const refundable = plan ? plan.periods.reduce((sum, p) => sum + p.refundable_fils, 0) : null;

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "cancel",
    send: (input: CancelInput, key) => cancelSubscription(subscription.id, input, subscription.version, key),
    done: (result) => {
      if (result.review_requested) return { detail: result.data, message: t("doneReview", { reference: subscription.reference }), tone: "info" };
      const refunded = result.refunds.reduce((sum, r) => sum + r.amount_fils, 0);
      return {
        detail: result.data,
        message: refunded > 0 ? t("doneRefund", { reference: subscription.reference, amount: text.moneyFixed(refunded) }) : t("done", { reference: subscription.reference }),
      };
    },
    onError: (error, input) => {
      const next = termsChangedOf<CancelPlan>(error);
      if (next) setUpdated({ party: input.party, plan: next });
    },
  });

  const maxFromError = maxRefundOf(mutation.error);
  const blocked = plan !== undefined && !plan.allowed;
  const needsReview = plan?.review_required === true;
  const refundError = problems.refund ?? (maxFromError !== null ? t("refundTooHigh", { max: text.moneyFixed(maxFromError) }) : fieldError(mutation.error, "refund_fils", t("refundInvalid")));

  const submit = () => {
    const next: typeof problems = {};
    if (!reasonCode) next.reason = t("reasonRequired");
    if (reasonTextRequired(reasonCode) && reasonText.trim().length < 3) next.text = t("detailsRequired");
    let refundFils: number | undefined;
    if (mayRefund && refund.trim() !== "") {
      const parsed = parseAedToFils(refund);
      if (!parsed.ok) next.refund = t("refundInvalid");
      else if (refundable !== null && parsed.fils > refundable) next.refund = t("refundTooHigh", { max: text.moneyFixed(refundable) });
      else refundFils = parsed.fils;
    }
    setProblems(next);
    if (Object.keys(next).length > 0 || !plan || blocked) return;
    mutation.mutate({
      party,
      reason_code: reasonCode,
      ...(reasonText.trim() ? { reason_text: reasonText.trim() } : {}),
      ...(refundFils !== undefined
        ? // The API plans a custom amount with no fee and no clawback, refunding exactly that amount.
          { refund_fils: refundFils, expected_fee_fils: 0, expected_refund_fils: refundFils, expected_clawback_fils: 0 }
        : { expected_fee_fils: plan.totals.fee_fils, expected_refund_fils: plan.totals.refund_fils, expected_clawback_fils: plan.totals.clawback_fils }),
    });
  };
  const customTyped = mayRefund && refund.trim() !== "";

  const moved = (field: string) => fresh?.changed.includes(field) ?? false;
  const unknown = codeOf(mutation.error) === "PAYMENT_RESULT_UNKNOWN";

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={unknown ? t("retry") : fresh ? t("submitNewTerms") : needsReview && refund.trim() === "" ? t("submitReview") : t("submit")}
      tone="danger"
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {companyOnly ? (
        <Notice tone="info" title={`${t("party")}: ${t("parties.company")}`}>
          {t("companyDuringReview")}
        </Notice>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink-900">{t("party")}</legend>
          <div className="flex flex-wrap gap-4">
            {CANCEL_PARTIES.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="cancel-party"
                  value={p}
                  checked={party === p}
                  onChange={() => {
                    setParty(p);
                    setRefund("");
                    setProblems({});
                    mutation.reset();
                  }}
                  className="size-4 accent-petrol-700"
                />
                {t(`parties.${p}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {preview.isPending && !fresh ? (
        <LoadingBlock lines={5} />
      ) : !plan ? (
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
          <p className="text-ink-900">{text.name(plan.explanation)}</p>
          <PeriodsTable plan={plan} changed={moved} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <TermsRow label={t("totalPaid")} value={text.moneyFixed(plan.totals.paid_fils)} />
            <TermsRow label={t("totalFee")} value={text.moneyFixed(plan.totals.fee_fils)} changed={moved("fee_fils")} />
            <TermsRow label={t("totalClawback")} value={text.moneyFixed(plan.totals.clawback_fils)} changed={moved("clawback_fils")} />
            {plan.totals.clawback_waived_fils > 0 && <TermsRow label={t("clawbackWaived")} value={text.moneyFixed(plan.totals.clawback_waived_fils)} />}
            <TermsRow label={t("totalRefund")} value={text.moneyFixed(plan.totals.refund_fils)} changed={moved("refund_fils")} />
            {plan.refund_to && <TermsRow label={t("refundTo")} value={plan.refund_to.label} />}
            {plan.party === "company" && plan.rule_applied && <TermsRow label={t("ruleApplied")} value={text.cancelRule(plan.rule_applied)} />}
            {plan.party === "company" && plan.compensation && <TermsRow label={t("compensation")} value={text.compensation(plan.compensation)} />}
            {plan.unpaid.action !== "none" && <TermsRow label={t("unpaid")} value={t(`unpaidActions.${plan.unpaid.action}`)} />}
          </dl>
          {plan.discount.revoked && <p className="text-warning-700">{t("discountRevoked")}</p>}
          {needsReview && <p className="font-medium text-warning-700">{mayRefund ? t("reviewRequiredCanDecide") : t("reviewRequired")}</p>}
          {blocked && <p className="font-medium text-danger-700">{plan.blocked_reason && t.has(`blocked.${plan.blocked_reason}` as never) ? t(`blocked.${plan.blocked_reason}` as never) : t("blocked.other")}</p>}
          <p className="text-xs text-ink-600">{t("providerNote")}</p>
        </PreviewBox>
      )}
      {fresh && <TermsChangedNotice body={t("termsChangedBody")} />}

      <Select
        label={t("reason")}
        required
        placeholder={t("chooseReason")}
        value={reasonCode}
        onChange={(e) => {
          setReasonCode(e.target.value);
          setProblems((p) => ({ ...p, reason: undefined }));
        }}
        options={CANCEL_REASONS.map((r) => ({ value: r, label: text.reason(r) }))}
        error={problems.reason ?? fieldError(mutation.error, "reason_code", t("reasonRequired"))}
      />
      <TextArea
        label={t("details")}
        required={reasonTextRequired(reasonCode)}
        rows={2}
        maxLength={1000}
        value={reasonText}
        onChange={(e) => setReasonText(e.target.value)}
        error={problems.text ?? fieldError(mutation.error, "reason_text", t("detailsRequired"))}
      />
      {mayRefund && plan && (
        <MoneyField
          label={t("refund")}
          hint={refundable !== null ? t("refundHint", { max: text.moneyFixed(refundable) }) : undefined}
          value={refund}
          onChange={(e) => setRefund(e.target.value)}
          error={refundError}
        />
      )}
      {customTyped && <p className="text-sm font-medium text-ink-900">{t("customRefundNote")}</p>}
      {unknown ? (
        <Notice tone="warning" title={t("unknownTitle")}>
          {t("unknownBody")}
        </Notice>
      ) : (
        termsChangedOf(mutation.error) === null && (
          <ErrorNotice error={mutation.error} hideCodes={hasFieldErrors(mutation.error, ["reason_code", "reason_text", "refund_fils"]) || maxFromError !== null ? ["VALIDATION_FAILED", "REFUND_AMOUNT_INVALID"] : []} />
        )
      )}
    </ConfirmDialog>
  );
}
