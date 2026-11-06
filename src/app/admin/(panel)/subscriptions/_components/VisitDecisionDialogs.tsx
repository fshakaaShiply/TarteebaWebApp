"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog, TextArea } from "@/components/admin";
import { decideRescheduleRequest, writeVisit } from "@/lib/admin/subscriptions/endpoints";
import type { RescheduleRequestRow, SlotRef, SubscriptionOccurrence } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { ChangedNotice, ErrorNotice, Ltr, PreviewBox, TermsRow, hasFieldErrors, useDialogMutation, useFieldError, type SubscriptionDialogProps } from "./kit";

type VisitProps = SubscriptionDialogProps & { visit: SubscriptionOccurrence };

/** What a decision is about: the occurrence (the route's {visit}), where it is served now, and the time asked for. */
export type RescheduleDecision = {
  visit: string;
  current: { date: string; slot: SlotRef | null };
  requested: { date: string; slot: SlotRef | null };
};

/** A Visits row's waiting request, or null. */
export function decisionFromOccurrence(o: SubscriptionOccurrence): RescheduleDecision | null {
  if (!o.reschedule_request) return null;
  return { visit: o.ulid, current: { date: o.scheduled_date, slot: o.slot }, requested: { date: o.reschedule_request.date, slot: o.reschedule_request.slot } };
}

/**
 * A request of the detail's `reschedule_requests` (P4-244: `occurrence_ulid` is the {visit} of the decision route and
 * `occurrence_date` the date it is served on now), wherever the visit is in the series; null when the API names no
 * occurrence. The current time is shown when the visit is among the detail's next visits.
 */
export function decisionFromRequest(r: RescheduleRequestRow, upcoming: readonly SubscriptionOccurrence[]): RescheduleDecision | null {
  if (!r.occurrence_ulid) return null;
  const known = upcoming.find((o) => o.ulid === r.occurrence_ulid);
  return { visit: r.occurrence_ulid, current: { date: r.occurrence_date ?? r.from_date, slot: known?.slot ?? null }, requested: { date: r.date, slot: r.slot } };
}

/**
 * A customer's request to move one visit (it needs staff approval, P3-34): approve it (the new slot is reserved, so a
 * full slot keeps the request pending: 409 SLOT_FULL) or decline it with a note the customer is told. A series visit is
 * decided here, never on the booking page (409 USE_SUBSCRIPTION_ACTIONS).
 */
export function RescheduleRequestDialog({
  subscription,
  request,
  onClose,
  onStale,
  changed,
  returnFocusTo,
}: SubscriptionDialogProps & { request: RescheduleDecision }) {
  const t = useTranslations("admin.subscriptions.request");
  const text = useSubscriptionText();
  const fieldError = useFieldError();
  const [decision, setDecision] = useState<"approve" | "decline">("approve");
  const [reason, setReason] = useState("");
  const when = (at: { date: string; slot: SlotRef | null }) => (at.slot ? `${text.dateShort(at.date)} · ${text.slot(at.slot)}` : text.dateShort(at.date));
  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "reschedule-request",
    send: (input: { decision: "approve" | "decline"; reason?: string }, key) => decideRescheduleRequest(subscription.id, request.visit, input, subscription.version, key),
    done: (detail, input) => ({ detail, message: input.decision === "approve" ? t("approved") : t("declined") }),
  });
  const submit = () => mutation.mutate({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}) });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={decision === "approve" ? t("approve") : t("decline")}
      tone={decision === "decline" ? "danger" : "primary"}
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <PreviewBox title={t("requestTitle")}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <TermsRow label={t("current")} value={<Ltr>{when(request.current)}</Ltr>} />
          <TermsRow label={t("requested")} value={<Ltr>{when(request.requested)}</Ltr>} />
        </dl>
      </PreviewBox>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 text-sm font-medium text-ink-900">{t("decision")}</legend>
        {(["approve", "decline"] as const).map((d) => (
          <label key={d} className="flex items-center gap-2 text-sm">
            <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="size-4 accent-petrol-700" />
            {t(d)}
          </label>
        ))}
      </fieldset>
      <TextArea
        label={t("reason")}
        hint={decision === "decline" ? t("reasonHintDecline") : t("reasonHint")}
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={fieldError(mutation.error, "reason", t("reasonInvalid"))}
      />
      <ErrorNotice error={mutation.error} hideCodes={hasFieldErrors(mutation.error, ["reason"]) ? ["VALIDATION_FAILED"] : []} />
    </ConfirmDialog>
  );
}

/**
 * The company could not serve a visit: it is cancelled and credited (no money moves): a visit is added at the end of
 * the term under the package's rule (Live-out: under its "absence without a substitute" rule). Any time before the
 * visit starts; a served visit is refused (409 INVALID_STATE).
 */
export function CancelVisitByCompanyDialog({ subscription, visit, onClose, onStale, changed, returnFocusTo }: VisitProps) {
  const t = useTranslations("admin.subscriptions.companyMiss");
  const text = useSubscriptionText();
  const fieldError = useFieldError();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "company-miss",
    send: (input: { reason: string }, key) => writeVisit(subscription.id, visit.ulid, { scope: "this", action: "cancel_by_company", reason: input.reason }, subscription.version, key),
    done: (result) => ({
      detail: result.data,
      message: result.credited?.new_date ? t("doneAdded", { date: text.dateShort(result.credited.new_date) }) : t("done"),
    }),
  });
  const submit = () => {
    if (reason.trim().length < 3) {
      setProblem(t("reasonShort"));
      return;
    }
    setProblem(null);
    mutation.mutate({ reason: reason.trim() });
  };
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { date: text.dateShort(visit.scheduled_date) })}
      description={t("body")}
      confirmLabel={t("submit")}
      tone="danger"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <p className="text-sm font-medium text-ink-900">{`${text.dateShort(visit.scheduled_date)} · ${text.slot(visit.slot)}`}</p>
      <TextArea
        label={t("reason")}
        required
        rows={3}
        maxLength={500}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setProblem(null);
        }}
        error={problem ?? fieldError(mutation.error, "reason", t("reasonShort"))}
      />
      <p className="text-xs text-ink-600">{t("noMoney")}</p>
      <ErrorNotice error={mutation.error} hideCodes={hasFieldErrors(mutation.error, ["reason"]) ? ["VALIDATION_FAILED"] : []} />
    </ConfirmDialog>
  );
}
