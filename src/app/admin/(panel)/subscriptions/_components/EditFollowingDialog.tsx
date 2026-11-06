"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Checkbox, ConfirmDialog, LoadingBlock, Notice } from "@/components/admin";
import { conflictEntries, seriesPriceHigherOf, termsChangedOf, type TermsChanged } from "@/lib/admin/subscriptions/actions";
import { previewFollowing, writeVisit, type FollowingScope } from "@/lib/admin/subscriptions/endpoints";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { FollowingPreview, SubscriptionOccurrence } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { SlotSelect } from "../../bookings/_components/SlotSelect";
import { DateList } from "./SubscriptionBits";
import { ChangedNotice, DRY_RUN, ErrorNotice, Ltr, PreviewBox, TermsChangedNotice, TermsRow, useDialogMutation, type SubscriptionDialogProps } from "./kit";

const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * "Edit following visits": a new weekly pattern from this visit on (scope following; recurring: the weekdays and the
 * time, Live-out: the weekly rest days). The preview shows what stays, what is replaced and the new dates (each
 * available or not), and the price check per date: a new date dearer than the one it replaces is refused (422
 * SERIES_PRICE_HIGHER), because a customer's agreed price never rises through an edit. The write sends the end of the
 * term the preview showed (409 TERMS_CHANGED shows the new one).
 */
export function EditFollowingDialog({ subscription, visit, onClose, onStale, changed, returnFocusTo }: SubscriptionDialogProps & { visit: SubscriptionOccurrence }) {
  const t = useTranslations("admin.subscriptions.following");
  const text = useSubscriptionText();
  const describe = useSubscriptionErrorMessage();
  const liveOut = subscription.type === "live_out";
  const currentDays = subscription.pattern.days_of_week ?? [];
  const currentRest = subscription.pattern.rest_weekdays ?? [];
  const currentSlot = subscription.pattern.slot?.id ?? null;
  const [days, setDays] = useState<number[]>(currentDays);
  const [rest, setRest] = useState<number[]>(currentRest);
  const [slotId, setSlotId] = useState(currentSlot ? String(currentSlot) : "");
  const [problem, setProblem] = useState<string | null>(null);

  const scope: FollowingScope = liveOut
    ? { scope: "following", ...(sameSet(rest, currentRest) ? {} : { rest_weekdays: [...rest].sort() }) }
    : {
        scope: "following",
        ...(sameSet(days, currentDays) ? {} : { days_of_week: [...days].sort() }),
        ...(slotId && Number(slotId) !== currentSlot ? { slot_template_id: Number(slotId) } : {}),
      };
  const edited = Object.keys(scope).length > 1;
  const emptyDays = !liveOut && days.length === 0;
  const body = JSON.stringify(scope);

  const preview = useQuery({
    queryKey: subscriptionKeys.preview("following", subscription.id, subscription.version, visit.ulid, body),
    queryFn: () => previewFollowing(subscription.id, visit.ulid, scope),
    enabled: edited && !emptyDays,
    ...DRY_RUN,
  });
  const [updated, setUpdated] = useState<{ body: string; terms: TermsChanged<FollowingPreview> } | null>(null);
  const fresh = updated && updated.body === body ? updated.terms : null;
  const terms: FollowingPreview | undefined = fresh?.preview ?? (edited ? preview.data : undefined);

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "following",
    send: (input: FollowingScope & { expected_term_end_date: string | null }, key) =>
      writeVisit(subscription.id, visit.ulid, { ...input, action: "edit" }, subscription.version, key),
    done: (result) => ({ detail: result.data, message: t("done", { date: text.dateShort(visit.scheduled_date) }) }),
    onError: (error, input) => {
      const next = termsChangedOf<FollowingPreview>(error);
      if (next) setUpdated({ body: JSON.stringify(stripExpected(input)), terms: next });
    },
  });
  const priceHigher = seriesPriceHigherOf(mutation.error) ?? (preview.error ? seriesPriceHigherOf(preview.error) : null);
  const priceBlocked = terms !== undefined && terms.price.allowed === false;

  const submit = () => {
    if (!edited || emptyDays) {
      setProblem(emptyDays ? t("noDays") : t("unchanged"));
      return;
    }
    if (!terms) {
      setProblem(t("termsMissing"));
      return;
    }
    if (priceBlocked) return;
    setProblem(null);
    mutation.mutate({ ...scope, expected_term_end_date: terms.term_end_date });
  };

  const toggle = (list: number[], set: (next: number[]) => void, n: number) => set(list.includes(n) ? list.filter((d) => d !== n) : [...list, n]);
  const moved = (field: string) => fresh?.changed.includes(field) ?? false;

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { date: text.dateShort(visit.scheduled_date) })}
      description={liveOut ? t("bodyLiveOut") : t("body")}
      confirmLabel={fresh ? t("submitNewTerms") : t("submit")}
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {liveOut ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink-900">{t("restDays")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {WEEK.map((n) => (
              <Checkbox key={n} label={text.weekday(n)} checked={rest.includes(n)} onChange={() => toggle(rest, setRest, n)} />
            ))}
          </div>
          <p className="text-xs text-ink-600">{t("restHint", { count: currentRest.length })}</p>
        </fieldset>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-ink-900">{t("weekdays")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {WEEK.map((n) => (
                <Checkbox key={n} label={text.weekday(n)} checked={days.includes(n)} onChange={() => toggle(days, setDays, n)} />
              ))}
            </div>
            <p className="text-xs text-ink-600">{t("weekdaysHint", { count: currentDays.length })}</p>
          </fieldset>
          <SlotSelect label={t("slot")} serviceKind="standard_visit" value={slotId} onChange={(e) => setSlotId(e.target.value)} />
        </>
      )}

      {!edited || emptyDays ? (
        <p className="text-sm text-ink-600">{emptyDays ? t("noDays") : t("chooseChange")}</p>
      ) : preview.isPending && !fresh ? (
        <LoadingBlock lines={4} />
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
            <TermsRow label={t("from")} value={text.dateShort(terms.from)} />
            <TermsRow label={t("kept")} value={terms.kept.length} />
            <TermsRow label={t("replaced")} value={terms.replaced.length} />
            <TermsRow label={t("newDates")} value={terms.new.length} />
            {/* The subscription's term end (the paid periods'): an edit inside a later, unpaid period moves that
                period's end, never this one. Shown only when it moves. */}
            {terms.term_end_date && terms.term_end_date !== subscription.term_end_date && (
              <TermsRow label={t("newEnd")} value={text.dateShort(terms.term_end_date)} changed={moved("term_end_date")} />
            )}
          </dl>
          {terms.replaced.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-ink-900">{t("replacedTitle")}</p>
              <DateList dates={terms.replaced.map((d) => d.date)} />
            </div>
          )}
          {terms.new.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-ink-900">{t("newTitle")}</p>
              <ul className="flex flex-col gap-0.5">
                {terms.new.map((d) => (
                  <li key={d.date} className="flex flex-wrap gap-x-2">
                    <Ltr>{text.dateShort(d.date)}</Ltr>
                    <span className={d.status === "unavailable" ? "text-danger-700" : "text-ink-600"}>
                      {t.has(`newStates.${d.status}` as never) ? t(`newStates.${d.status}` as never) : d.status}
                      {d.reason ? ` · ${text.dateReason(d.reason)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {terms.price.checks.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-ink-900">{t("priceTitle")}</p>
              <ul className="flex flex-col gap-0.5">
                {terms.price.checks.map((c) => (
                  <li key={c.date} className="flex flex-wrap gap-x-2">
                    <Ltr>{text.dateShort(c.date)}</Ltr>
                    <span className="font-latin">
                      {text.moneyFixed(c.old_unit_fils)} → {text.moneyFixed(c.new_unit_fils)}
                    </span>
                    {c.new_unit_fils > c.old_unit_fils && <span className="font-medium text-danger-700">{t("dearer")}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {priceBlocked && <p className="font-medium text-danger-700">{t("priceBlocked")}</p>}
          {conflictEntries(terms.conflicts).length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-warning-700">{t("conflictsTitle")}</p>
              <ul className="text-sm">
                {conflictEntries(terms.conflicts).map((c) => (
                  <li key={c.date}>
                    <Ltr>{text.dateShort(c.date)}</Ltr> · {text.dateReason(c.reason)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </PreviewBox>
      )}
      {fresh && <TermsChangedNotice body={t("termsChangedBody")} />}
      {priceHigher && (
        <Notice tone="danger" title={t("priceHigherTitle")} role="alert">
          {t("priceHigherBody", {
            date: text.dateShort(priceHigher.date),
            oldPrice: text.moneyFixed(priceHigher.oldUnitFils),
            newPrice: text.moneyFixed(priceHigher.newUnitFils),
          })}
        </Notice>
      )}
      {problem && (
        <Notice tone="warning" role="alert">
          {problem}
        </Notice>
      )}
      {termsChangedOf(mutation.error) === null && !priceHigher && <ErrorNotice error={mutation.error} />}
    </ConfirmDialog>
  );
}

function stripExpected(input: FollowingScope & { expected_term_end_date?: string | null }): FollowingScope {
  const { expected_term_end_date: _expected, ...rest } = input;
  void _expected;
  return rest;
}
