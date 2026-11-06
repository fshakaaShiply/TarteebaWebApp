"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ConfirmDialog, LoadingBlock, Notice, Select, TextField } from "@/components/admin";
import { isIsoDate } from "@/lib/admin/format";
import { conflictEntries, notAssignableOf } from "@/lib/admin/subscriptions/actions";
import { changeLiveOutDay, previewLiveOutDay, type LiveOutDayInput } from "@/lib/admin/subscriptions/endpoints";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { ChangedNotice, DRY_RUN, ErrorNotice, Ltr, PreviewBox, TermsRow, hasFieldErrors, useDialogMutation, useFieldError, type SubscriptionDialogProps } from "./kit";
import { RefusedWorkers, UnfitList } from "./SubscriptionBits";
import { WorkerPicker } from "./WorkerPicker";

type Change = LiveOutDayInput["change"];

/** The changes a day of this type can take: a service day becomes an absence or a public holiday; anything else goes back to service. */
export function changesFor(type: string): Change[] {
  return type === "service" ? ["absence", "public_holiday"] : ["service"];
}

/**
 * "Edit this day only" / "Edit following days" of a Live-out contract: mark a day an absence (with a substitute, or
 * credited), a public holiday, or back to service. The preview lists each day before and after, the substitute, the
 * credited days and the days the substitute could not cover (they are credited as without one); following days run
 * to the end of the period or to the date given. The primary worker is booked for the whole day, so nothing else is
 * checked on the client. The new end of the term is the API's. Nothing is sent before the preview of the current
 * choice is on screen. Each day's substitute comes named (`{id, name}`, P4-241); a substitute the API refuses (422
 * WORKER_NOT_ASSIGNABLE) is named with her role and why.
 */
export function LiveOutDayDialog({
  subscription,
  date,
  type,
  scope: initialScope,
  onClose,
  onStale,
  changed,
  returnFocusTo,
}: SubscriptionDialogProps & { date: string; type: string; scope: "this" | "following" }) {
  const t = useTranslations("admin.subscriptions.day");
  const text = useSubscriptionText();
  const describe = useSubscriptionErrorMessage();
  const fieldError = useFieldError();
  const changes = changesFor(type);
  const [change, setChange] = useState<Change>(changes[0]);
  const [scope, setScope] = useState<"this" | "following">(initialScope);
  const [until, setUntil] = useState("");
  const [substitute, setSubstitute] = useState("");
  const [problem, setProblem] = useState(false);
  const primaryId = subscription.workers.primary?.id ?? null;

  const input: LiveOutDayInput = {
    change,
    scope,
    ...(scope === "following" && isIsoDate(until) ? { until } : {}),
    ...(change === "absence" && substitute ? { substitute_worker_id: Number(substitute) } : {}),
  };
  const untilInvalid = scope === "following" && until !== "" && (!isIsoDate(until) || until < date);
  const body = JSON.stringify(input);
  const preview = useQuery({
    queryKey: subscriptionKeys.preview("day", subscription.id, subscription.version, date, body),
    queryFn: () => previewLiveOutDay(subscription.id, date, input),
    enabled: !untilInvalid,
    ...DRY_RUN,
  });

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "live-out-day",
    send: (body: LiveOutDayInput, key) => changeLiveOutDay(subscription.id, date, body, subscription.version, key),
    done: (result) => ({
      detail: result.data,
      message: result.unfit.length > 0 ? t("doneUnfit", { count: result.unfit.length }) : t("done"),
      tone: result.unfit.length > 0 ? "info" : "success",
    }),
  });

  const terms = untilInvalid ? undefined : preview.data;
  // The write's refusal, else the preview's (it checks the same substitute).
  const refused = mutation.error ? notAssignableOf(mutation.error) : notAssignableOf(preview.error);
  const submit = () => {
    // The preview first (§9.1): absences and credits over a range are applied only once its days are on screen.
    if (!terms) {
      setProblem(true);
      return;
    }
    setProblem(false);
    mutation.mutate(input);
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={scope === "this" ? t("titleThis", { date: text.dateShort(date) }) : t("titleFollowing", { date: text.dateShort(date) })}
      description={t("body")}
      confirmLabel={t("submit")}
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={t("change")}
          required
          value={change}
          onChange={(e) => {
            setChange(e.target.value as Change);
            mutation.reset();
          }}
          options={changes.map((c) => ({ value: c, label: t(`changes.${c}`) }))}
        />
        <Select
          label={t("scope")}
          required
          value={scope}
          onChange={(e) => setScope(e.target.value as "this" | "following")}
          options={[
            { value: "this", label: t("scopeThis") },
            { value: "following", label: t("scopeFollowing") },
          ]}
        />
      </div>
      {scope === "following" && (
        <TextField
          type="date"
          label={t("until")}
          hint={t("untilHint")}
          value={until}
          min={date}
          dir="ltr"
          className="font-latin text-start"
          onChange={(e) => setUntil(e.target.value)}
          error={untilInvalid ? t("untilInvalid") : fieldError(mutation.error, "until", t("untilInvalid"))}
        />
      )}
      {change === "absence" && (
        <WorkerPicker
          subscriptionId={subscription.id}
          role="backup"
          from={date}
          label={t("substitute")}
          value={substitute}
          onChange={setSubstitute}
          excludeId={primaryId}
          placeholder={t("noSubstitute")}
          hint={t("substituteHint")}
        />
      )}

      {untilInvalid ? null : preview.isPending ? (
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
          <ul className="flex flex-col gap-1">
            {terms.days.map((d) => (
              <li key={d.date} className="flex flex-wrap items-baseline gap-x-2">
                <Ltr>{text.dateShort(d.date)}</Ltr>
                <span className="text-ink-600">
                  {text.day(d.before)} → <span className="font-medium text-ink-900">{text.day(d.after)}</span>
                </span>
                {d.substitute !== null && <span>{t("substituteIs", { name: d.substitute.name })}</span>}
                {d.credited && <span className="text-success-700">{t("credited")}</span>}
                {d.appended_date && <span className="text-ink-600">{t("appended", { date: text.dateShort(d.appended_date) })}</span>}
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <TermsRow label={t("newEnd")} value={terms.term_end_date ? text.dateShort(terms.term_end_date) : "—"} />
          </dl>
          {terms.unfit.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-warning-700">{t("unfitTitle")}</p>
              <UnfitList days={terms.unfit.map((u) => ({ date: u.date, reasons: u.reasons }))} />
            </div>
          )}
          {conflictEntries(terms.conflicts).length > 0 && (
            <ul className="text-sm text-warning-700">
              {conflictEntries(terms.conflicts).map((c) => (
                <li key={c.date}>
                  <Ltr>{text.dateShort(c.date)}</Ltr> · {text.dateReason(c.reason)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-600">{t("noMoney")}</p>
        </PreviewBox>
      )}
      {problem && !terms && (
        <Notice tone="warning" role="alert">
          {t("termsMissing")}
        </Notice>
      )}
      <ErrorNotice error={mutation.error} hideCodes={hasFieldErrors(mutation.error, ["until"]) ? ["VALIDATION_FAILED"] : []} />
      <RefusedWorkers workers={refused} />
    </ConfirmDialog>
  );
}
