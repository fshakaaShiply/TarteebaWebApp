"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ConfirmDialog, LoadingBlock, Notice, Select } from "@/components/admin";
import { addDaysIso, businessToday } from "@/lib/admin/format";
import { termsChangedOf, type TermsChanged } from "@/lib/admin/subscriptions/actions";
import { fetchSubscriptionVisits, previewSkip, skipVisit, undoSkip } from "@/lib/admin/subscriptions/endpoints";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { SkipPreview, SubscriptionOccurrence } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { ChangedNotice, DRY_RUN, ErrorNotice, PreviewBox, TermsChangedNotice, TermsRow, useDialogMutation, type SubscriptionDialogProps } from "./kit";

type VisitChoiceProps = SubscriptionDialogProps & {
  /** The visit the dialog was opened on (a row of the Visits tab); without it the dialog asks which one. */
  visit?: SubscriptionOccurrence | null;
};

function useVisitLabel() {
  const text = useSubscriptionText();
  return (v: SubscriptionOccurrence) => `${text.dateShort(v.scheduled_date)} · ${text.slot(v.slot)}`;
}

/**
 * Skip one visit (recurring): the visit is cancelled without a fee, the capacity is released and, under the package's
 * rule, a visit is added at the end of the term (nothing is charged or refunded, D-06). Staff have no monthly limit.
 * The write sends the end date the preview showed (409 TERMS_CHANGED shows the new one).
 */
export function SkipDialog({ subscription, visit, onClose, onStale, changed, returnFocusTo }: VisitChoiceProps) {
  const t = useTranslations("admin.subscriptions.skip");
  const text = useSubscriptionText();
  const describe = useSubscriptionErrorMessage();
  const label = useVisitLabel();
  const choices = (subscription.upcoming ?? []).filter((v) => v.editable.skip);
  const [chosen, setChosen] = useState(visit?.ulid ?? choices[0]?.ulid ?? "");
  const [problem, setProblem] = useState(false);

  const preview = useQuery({
    queryKey: subscriptionKeys.preview("skip", subscription.id, subscription.version, chosen),
    queryFn: () => previewSkip(subscription.id, chosen),
    enabled: chosen !== "",
    ...DRY_RUN,
  });
  const [updated, setUpdated] = useState<{ visit: string; terms: TermsChanged<SkipPreview> } | null>(null);
  const fresh = updated && updated.visit === chosen ? updated.terms : null;
  const terms: SkipPreview | undefined = fresh?.preview ?? (chosen ? preview.data : undefined);

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "skip",
    send: (input: { visit_id: string; expected_term_end_date: string | null }, key) =>
      skipVisit(subscription.id, input.visit_id, input.expected_term_end_date, subscription.version, key),
    done: (detail) => ({ detail, message: t("done", { reference: subscription.reference }) }),
    onError: (error, input) => {
      const next = termsChangedOf<SkipPreview>(error);
      if (next) setUpdated({ visit: input.visit_id, terms: next });
    },
  });

  const blocked = terms !== undefined && terms.allowed === false;
  const submit = () => {
    if (!terms || blocked) {
      setProblem(!terms);
      return;
    }
    setProblem(false);
    mutation.mutate({ visit_id: chosen, expected_term_end_date: terms.new_term_end_date });
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={fresh ? t("submitNewTerms") : t("submit")}
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {visit ? (
        <p className="text-sm font-medium text-ink-900">{label(visit)}</p>
      ) : choices.length === 0 ? (
        <Notice tone="warning">{t("none")}</Notice>
      ) : (
        <Select
          label={t("visit")}
          required
          value={chosen}
          onChange={(e) => {
            setChosen(e.target.value);
            mutation.reset();
          }}
          options={choices.map((v) => ({ value: v.ulid, label: label(v) }))}
        />
      )}
      {chosen &&
        (preview.isPending && !fresh ? (
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
            {blocked && <p className="font-medium text-danger-700">{terms.reason ? t.has(`reasons.${terms.reason}` as never) ? t(`reasons.${terms.reason}` as never) : text.name(terms.explanation) : t("notAllowed")}</p>}
            {!blocked && <p className="text-ink-900">{text.name(terms.explanation)}</p>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <TermsRow label={t("added")} value={terms.appended_date ? text.dateShort(terms.appended_date) : t("noneAdded")} changed={fresh?.changed.includes("term_end_date")} />
              {/* The API's new_term_end_date is the subscription's term end (the paid periods'): a visit added in a later,
                  unpaid period moves that period's end (the added date says where), never this one. Shown only when it moves. */}
              {terms.new_term_end_date && terms.new_term_end_date !== subscription.term_end_date && (
                <TermsRow label={t("newEnd")} value={text.dateShort(terms.new_term_end_date)} changed={fresh?.changed.includes("term_end_date")} />
              )}
            </dl>
            <p className="text-xs text-ink-600">{t("noMoney")}</p>
          </PreviewBox>
        ))}
      {fresh && <TermsChangedNotice body={t("termsChangedBody")} />}
      {problem && (
        <Notice tone="warning" role="alert">
          {t("termsMissing")}
        </Notice>
      )}
      {termsChangedOf(mutation.error) === null && <ErrorNotice error={mutation.error} />}
    </ConfirmDialog>
  );
}

/** Undo a skip: the visit is planned again and its capacity held (it may be full: 409 SLOT_FULL), the added date goes. */
export function UndoSkipDialog({ subscription, visit, onClose, onStale, changed, returnFocusTo }: VisitChoiceProps) {
  const t = useTranslations("admin.subscriptions.undoSkip");
  const label = useVisitLabel();
  const today = businessToday();
  // Skipped visits are not in the "next 14" of the detail: ask the visits list (the next 90 days).
  const skipped = useQuery({
    queryKey: subscriptionKeys.visits(subscription.id, today, addDaysIso(today, 90)),
    queryFn: () => fetchSubscriptionVisits(subscription.id, { from: today, to: addDaysIso(today, 90), perPage: 100 }),
    enabled: !visit,
    staleTime: 30_000,
    retry: false,
  });
  const choices = (skipped.data?.data ?? []).filter((v) => v.editable.undo_skip);
  const [chosen, setChosen] = useState(visit?.ulid ?? "");
  const current = chosen || choices[0]?.ulid || "";

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "undoSkip",
    send: (input: { visit_id: string }, key) => undoSkip(subscription.id, input.visit_id, subscription.version, key),
    done: (detail) => ({ detail, message: t("done", { reference: subscription.reference }) }),
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: subscription.reference })}
      description={t("body")}
      confirmLabel={t("submit")}
      pending={mutation.isPending}
      onConfirm={() => current && mutation.mutate({ visit_id: current })}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {visit ? (
        <p className="text-sm font-medium text-ink-900">{label(visit)}</p>
      ) : skipped.isPending ? (
        <LoadingBlock lines={2} />
      ) : skipped.isError ? (
        <Notice tone="danger">{t("loadError")}</Notice>
      ) : choices.length === 0 ? (
        <Notice tone="warning">{t("none")}</Notice>
      ) : (
        <Select
          label={t("visit")}
          required
          value={current}
          onChange={(e) => setChosen(e.target.value)}
          options={choices.map((v) => ({ value: v.ulid, label: label(v) }))}
        />
      )}
      <ErrorNotice error={mutation.error} />
    </ConfirmDialog>
  );
}
