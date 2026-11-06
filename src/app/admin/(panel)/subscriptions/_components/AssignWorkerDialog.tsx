"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Checkbox, Dialog, Notice, TextField } from "@/components/admin";
import { addDaysIso, businessToday, isIsoDate } from "@/lib/admin/format";
import { notAssignableOf } from "@/lib/admin/subscriptions/actions";
import { assignWorker } from "@/lib/admin/subscriptions/endpoints";
import type { AssignResult, CandidateRole } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { DateList, UnfitList } from "./SubscriptionBits";
import { ChangedNotice, ErrorNotice, Ltr, hasFieldErrors, useDialogMutation, useFieldError, type SubscriptionDialogProps } from "./kit";
import { WorkerPicker } from "./WorkerPicker";

/**
 * Name (or change, or clear) the primary or the backup worker. The change applies to the future visits from a date
 * (default tomorrow): the previous holder is replaced where the new worker fits, and the answer lists the days she
 * could not take (the per-day unfit list), so nothing is silently half done. A Live-out contract's primary cannot be
 * cleared (422 PRIMARY_WORKER_REQUIRED); the same worker cannot hold both roles (422 SAME_WORKER).
 */
export function AssignWorkerDialog({ subscription, role, onClose, onStale, changed, returnFocusTo }: SubscriptionDialogProps & { role: CandidateRole }) {
  const t = useTranslations("admin.subscriptions.assign");
  const text = useSubscriptionText();
  const fieldError = useFieldError();
  const current = role === "primary" ? subscription.workers.primary : subscription.workers.backup;
  const other = role === "primary" ? subscription.workers.backup : subscription.workers.primary;
  const liveOutPrimary = subscription.type === "live_out" && role === "primary";
  const tomorrow = addDaysIso(businessToday(), 1);
  const [worker, setWorker] = useState("");
  const [clear, setClear] = useState(false);
  const [from, setFrom] = useState(tomorrow);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<AssignResult | null>(null);

  const mutation = useDialogMutation({
    subscription,
    // The answer stays on screen (who could not be covered); the dialog's own Close button ends it.
    onClose: () => undefined,
    onStale,
    send: (input: { worker_id: number | null; apply_from: string }) => assignWorker(subscription.id, role, input.worker_id, input.apply_from, subscription.version),
    done: (answer) => {
      setResult(answer);
      return { detail: answer.data, message: t("done", { role: t(`roles.${role}`) }) };
    },
  });
  const refused = notAssignableOf(mutation.error);

  const submit = () => {
    if (!clear && !worker) {
      setProblem(t("chooseWorker"));
      return;
    }
    if (!isIsoDate(from) || from < tomorrow) {
      setProblem(t("fromInvalid"));
      return;
    }
    setProblem(null);
    mutation.mutate({ worker_id: clear ? null : Number(worker), apply_from: from });
  };

  const pending = mutation.isPending;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={t(`title.${role}`, { reference: subscription.reference })}
      description={t("body")}
      dismissible={!pending}
      returnFocusTo={returnFocusTo}
      footer={
        result ? (
          <Button onClick={onClose}>{t("close")}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} loading={pending}>
              {clear ? t("clear") : t("submit")}
            </Button>
          </>
        )
      }
    >
      <ChangedNotice changed={changed} />
      {result ? (
        <div className="flex flex-col gap-3 text-sm" role="status">
          <p className="font-medium text-success-700">{t("resultTitle")}</p>
          <p>{t("resultCounts", { assigned: result.assigned.length, kept: result.kept.length })}</p>
          {result.assigned.length > 0 && <DateList dates={result.assigned} />}
          {result.unfit.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-warning-700">{t("resultUnfit", { count: result.unfit.length })}</p>
              <UnfitList days={result.unfit} />
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-ink-900">{current ? t("currentIs", { name: current.name }) : t("currentNone")}</p>
          <WorkerPicker
            subscriptionId={subscription.id}
            role={role}
            from={from}
            label={t("worker")}
            required={!clear}
            value={worker}
            onChange={setWorker}
            excludeId={other?.id ?? null}
            disabled={clear}
            hint={t("workerHint")}
          />
          {!liveOutPrimary && current && <Checkbox label={t("clearLabel")} description={t("clearHint")} checked={clear} onChange={(e) => setClear(e.target.checked)} />}
          <TextField
            type="date"
            label={t("from")}
            required
            min={tomorrow}
            value={from}
            dir="ltr"
            className="font-latin text-start"
            hint={t("fromHint")}
            onChange={(e) => setFrom(e.target.value)}
            error={fieldError(mutation.error, "apply_from", t("fromInvalid"))}
          />
          {problem && (
            <Notice tone="warning" role="alert">
              {problem}
            </Notice>
          )}
          <ErrorNotice error={mutation.error} hideCodes={hasFieldErrors(mutation.error, ["apply_from"]) ? ["VALIDATION_FAILED"] : []} />
          {refused.length > 0 && (
            <ul className="list-disc ps-5 text-sm text-danger-700">
              {refused.map((w) => (
                <li key={w.workerId}>
                  <Ltr>{String(w.workerId)}</Ltr> · {[w.reason, ...w.reasons].filter(Boolean).map((r) => text.unfit(r)).join(text.locale === "ar" ? "، " : ", ")}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}
