"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ConfirmDialog, LoadingBlock, Notice, TextArea, TextField } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { addDaysIso, businessToday, isIsoDate } from "@/lib/admin/format";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { termsChangedOf, type TermsChanged } from "@/lib/admin/subscriptions/actions";
import { freezeSubscription, previewFreeze, type FreezeInput } from "@/lib/admin/subscriptions/endpoints";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { FreezePreview } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { DateList } from "./SubscriptionBits";
import {
  ChangedNotice,
  DRY_RUN,
  ErrorNotice,
  PreviewBox,
  ShiftNote,
  TermsChangedNotice,
  TermsRow,
  hasFieldErrors,
  useDialogMutation,
  useFieldError,
  type SubscriptionDialogProps,
} from "./kit";

/**
 * Freeze a range of visits (recurring only): the visits in it are credited back at the end of the term, nothing is
 * charged or refunded (D-07). Staff may go over the package's freeze limit with a reason (audited). The preview shows
 * the visits frozen, the dates added at the end and the new end of the term; the write sends that end date back
 * (409 TERMS_CHANGED shows the new terms and needs a fresh confirm).
 */
export function FreezeDialog({ subscription, onClose, onStale, changed, returnFocusTo }: SubscriptionDialogProps) {
  const t = useTranslations("admin.subscriptions.freeze");
  const text = useSubscriptionText();
  const describe = useSubscriptionErrorMessage();
  const fieldError = useFieldError();
  const [from, setFrom] = useState(() => addDaysIso(businessToday(), 1));
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const reasonDebounced = useDebouncedValue(reason.trim(), 400);
  const valid = isIsoDate(from) && isIsoDate(to) && to >= from;

  const preview = useQuery({
    queryKey: subscriptionKeys.preview("freeze", subscription.id, subscription.version, from, to, reasonDebounced),
    queryFn: () => previewFreeze(subscription.id, { from, to, ...(reasonDebounced ? { reason: reasonDebounced } : {}) }),
    enabled: valid,
    ...DRY_RUN,
  });
  const [updated, setUpdated] = useState<{ range: string; terms: TermsChanged<FreezePreview> } | null>(null);
  const range = `${from}|${to}`;
  const fresh = updated && updated.range === range ? updated.terms : null;
  const terms: FreezePreview | undefined = fresh?.preview ?? (valid ? preview.data : undefined);

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "freeze",
    send: (input: FreezeInput, key) => freezeSubscription(subscription.id, input, subscription.version, key),
    done: (detail, input) => ({ detail, message: t("done", { reference: subscription.reference, from: text.dateShort(input.from), to: text.dateShort(input.to) }) }),
    onError: (error, input) => {
      const next = termsChangedOf<FreezePreview>(error);
      if (next) setUpdated({ range: `${input.from}|${input.to}`, terms: next });
    },
  });
  // Over the package's freeze limit: staff may still freeze, with a reason.
  const needsReason = preview.error instanceof AdminApiError && preview.error.code === "FREEZE_TOO_LONG" && preview.error.details.can_exceed === true && !reasonDebounced;
  const reasonError = fieldError(mutation.error, "reason", t("reasonInvalid"));

  const submit = () => {
    if (!valid) {
      setProblem(t("rangeInvalid"));
      return;
    }
    if (!terms || terms.allowed === false) {
      setProblem(terms ? null : t("termsMissing"));
      return;
    }
    setProblem(null);
    mutation.mutate({
      from,
      to,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      expected_term_end_date: terms.new_term_end_date,
    });
  };

  const moved = (field: string) => fresh?.changed.includes(field) ?? false;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={fresh ? t("submitNewTerms") : t("submit")}
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField type="date" label={t("from")} required value={from} dir="ltr" className="font-latin text-start" onChange={(e) => setFrom(e.target.value)} />
        <TextField
          type="date"
          label={t("to")}
          required
          value={to}
          min={from}
          dir="ltr"
          className="font-latin text-start"
          onChange={(e) => setTo(e.target.value)}
          error={to && isIsoDate(to) && isIsoDate(from) && to < from ? t("rangeInvalid") : undefined}
        />
      </div>
      <TextArea
        label={t("reason")}
        hint={needsReason ? undefined : t("reasonHint")}
        error={needsReason ? t("reasonNeeded") : reasonError}
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      {!valid ? (
        <p className="text-sm text-ink-600">{t("chooseRange")}</p>
      ) : preview.isPending && !fresh ? (
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
          {terms.allowed === false && <p className="font-medium text-danger-700">{terms.explanation ? text.name(terms.explanation) : t("notAllowed")}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <TermsRow label={t("days")} value={terms.days} />
            <TermsRow label={t("visitsFrozen")} value={terms.affected.length} />
            {/* The subscription's term end (the paid periods'): frozen visits credited in a later, unpaid period move
                that period's end, never this one. Shown only when it moves. */}
            {terms.new_term_end_date && terms.new_term_end_date !== subscription.term_end_date && (
              <TermsRow label={t("newEnd")} value={text.dateShort(terms.new_term_end_date)} changed={moved("term_end_date")} />
            )}
            {terms.max_freeze_days !== null && (
              <TermsRow label={t("daysUsed")} value={t("daysOfMax", { used: terms.freeze_days_used_this_period, max: terms.max_freeze_days })} />
            )}
          </dl>
          {terms.appended_dates.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-ink-900">{t("added")}</p>
              <DateList dates={terms.appended_dates} />
            </div>
          )}
          {/* A freeze in the paid term with the next period open: both moves are said (P4-218). */}
          <ShiftNote before={subscription.term_end_date} end={terms.new_term_end_date} added={terms.appended_dates} />
          <p className="text-xs text-ink-600">{t("noMoney")}</p>
        </PreviewBox>
      )}
      {fresh && <TermsChangedNotice body={t("termsChangedBody")} />}
      {problem && (
        <Notice tone="warning" role="alert">
          {problem}
        </Notice>
      )}
      {mutation.error && termsChangedOf(mutation.error) === null && <ErrorNotice error={mutation.error} hideCodes={hasFieldErrors(mutation.error, ["reason"]) ? ["VALIDATION_FAILED"] : []} />}
    </ConfirmDialog>
  );
}
