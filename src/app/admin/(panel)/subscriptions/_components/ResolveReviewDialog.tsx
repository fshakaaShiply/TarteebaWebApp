"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog, MoneyField, Notice, TextArea } from "@/components/admin";
import { maxRefundOf, pendingReview } from "@/lib/admin/subscriptions/actions";
import { resolveCancelReview } from "@/lib/admin/subscriptions/endpoints";
import type { CancelPlan } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { filsToAedInput, parseAedToFils } from "@/lib/money";
import { PeriodsTable } from "./PlanTable";
import { ChangedNotice, ErrorNotice, PreviewBox, TermsRow, hasFieldErrors, useDialogMutation, useFieldError, type SubscriptionDialogProps } from "./kit";

/** The review's stored preview (the API's CancelPlan when the review was asked for), or null. */
function storedReviewPlan(review: { preview?: unknown } | null): CancelPlan | null {
  const preview = review?.preview;
  return preview && typeof preview === "object" && Array.isArray((preview as CancelPlan).periods) && typeof (preview as CancelPlan).totals === "object" ? (preview as CancelPlan) : null;
}

/**
 * Finish a cancellation that waits for review (refunds.create plus a read permission, P4-57): the total refund and a
 * note that becomes the refund's note and the audit reason. What each period can give back is the API's own list of
 * refund lines, stored with the review (`cancel_review.preview.periods`: the paid and partly refunded periods only, never
 * a closed or void one, P4-57 / PlanCancellation), so the cap shown is the API's figure, not a sum of the detail's
 * periods. The API checks the amount again when it resolves (oldest period first; more → 422 REFUND_AMOUNT_INVALID
 * {max_fils}), and from then on its max_fils is the cap. The stored preview's refund (what the policy would have
 * given) fills the amount. A fresh cancel preview cannot replace it: the API refuses a customer's preview while the
 * review is open (409 CANCEL_REVIEW_PENDING).
 */
export function ResolveReviewDialog({ subscription, onClose, onStale, changed, returnFocusTo }: SubscriptionDialogProps) {
  const t = useTranslations("admin.subscriptions.resolve");
  const text = useSubscriptionText();
  const fieldError = useFieldError();
  const review = pendingReview(subscription);
  const stored = storedReviewPlan(review);
  const lines = stored?.periods ?? [];
  const storedCap = stored ? lines.reduce((sum, p) => sum + p.refundable_fils, 0) : null;
  const sequenceOf = (ulid: string) => subscription.periods.find((p) => p.ulid === ulid)?.sequence ?? null;
  const [refund, setRefund] = useState(stored ? filsToAedInput(Math.min(stored.totals.refund_fils, storedCap ?? stored.totals.refund_fils)) : "");
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<{ refund?: string; note?: string }>({});
  // 422 REFUND_AMOUNT_INVALID {max_fils}: the API's latest cap wins over the figures stored with the review.
  const [apiCap, setApiCap] = useState<number | null>(null);

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "resolve-review",
    send: (input: { refund_fils: number; note: string }, key) => resolveCancelReview(subscription.id, input, subscription.version, key),
    done: (result, input) => ({
      detail: result.data,
      message: input.refund_fils > 0 ? t("doneRefund", { reference: subscription.reference, amount: text.moneyFixed(input.refund_fils) }) : t("done", { reference: subscription.reference }),
    }),
    onError: (error) => {
      const max = maxRefundOf(error);
      if (max !== null) setApiCap(max);
    },
  });
  const maxFromError = maxRefundOf(mutation.error);
  const cap = apiCap ?? storedCap;

  const submit = () => {
    const next: typeof problems = {};
    const parsed = parseAedToFils(refund);
    if (!parsed.ok) next.refund = t("refundInvalid");
    else if (cap !== null && parsed.fils > cap) next.refund = t("refundTooHigh", { max: text.moneyFixed(cap) });
    if (note.trim().length < 3) next.note = t("noteShort");
    setProblems(next);
    if (Object.keys(next).length > 0 || !parsed.ok) return;
    mutation.mutate({ refund_fils: parsed.fils, note: note.trim() });
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={t("submit")}
      tone="danger"
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {review && (
        <PreviewBox title={t("reviewTitle")}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {review.requested_at && <TermsRow label={t("requestedAt")} value={text.dateTime(review.requested_at)} />}
            {review.party && <TermsRow label={t("party")} value={t(`parties.${review.party}`)} />}
            {review.reason_code && <TermsRow label={t("reason")} value={text.reason(review.reason_code)} />}
          </dl>
          {review.reason_text && <p className="text-ink-900">{review.reason_text}</p>}
          {stored && <PeriodsTable plan={stored} />}
        </PreviewBox>
      )}
      {stored && (
        <PreviewBox title={t("capTitle")}>
          {lines.length === 0 ? (
            <p className="text-ink-600">{t("noPaidPeriod")}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {lines.map((p) => {
                const n = sequenceOf(p.ulid);
                const dates = { start: text.dateShort(p.start), end: text.dateShort(p.end) };
                return (
                  <li key={p.ulid} className="flex flex-wrap justify-between gap-x-4">
                    <span>{n !== null ? t("period", { n, ...dates }) : t("periodDates", dates)}</span>
                    <span className="font-latin">{text.moneyFixed(p.refundable_fils)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {cap !== null && <p className="font-bold text-ink-900">{t("capTotal", { max: text.moneyFixed(cap) })}</p>}
          <p className="text-xs text-ink-600">{t("capNote")}</p>
        </PreviewBox>
      )}
      <MoneyField
        label={t("refund")}
        required
        hint={t("refundHint")}
        value={refund}
        onChange={(e) => setRefund(e.target.value)}
        error={problems.refund ?? (maxFromError !== null ? t("refundTooHigh", { max: text.moneyFixed(maxFromError) }) : fieldError(mutation.error, "refund_fils", t("refundInvalid")))}
      />
      <TextArea
        label={t("note")}
        required
        rows={3}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={problems.note ?? fieldError(mutation.error, "note", t("noteShort"))}
      />
      {!review && <Notice tone="warning">{t("noReview")}</Notice>}
      <ErrorNotice
        error={mutation.error}
        hideCodes={hasFieldErrors(mutation.error, ["refund_fils", "note"]) || maxFromError !== null ? ["VALIDATION_FAILED", "REFUND_AMOUNT_INVALID"] : []}
      />
    </ConfirmDialog>
  );
}
