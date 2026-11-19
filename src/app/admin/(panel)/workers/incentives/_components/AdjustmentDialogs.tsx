"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, ConfirmDialog, Dialog, MoneyField, Notice, Select, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { businessToday, isolate } from "@/lib/admin/format";
import { keepsIdempotencyKey, type IdempotencyKeys } from "@/lib/admin/idempotency";
import { fetchAllWorkers } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { heldAdjustment } from "@/lib/admin/workforce/adjustmentKeys";
import { createAdjustment, deleteAdjustment, fetchPostings, type AdjustmentInput } from "@/lib/admin/workforce/endpoints";
import { useApiFieldMessage, useWorkforceError } from "@/lib/admin/workforce/errors";
import { closedPeriods, currentPeriod, validateAdjustment, type AdjustmentErrors, type AdjustmentForm } from "@/lib/admin/workforce/incentives";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { IncentiveAdjustment } from "@/lib/admin/workforce/types";
import { useSeenRecord } from "../../../finance/_components/useSeenRecord";
import { useIncentiveRefresh } from "./ProposalDialogs";

/** The months an adjustment may name: the current local month and the earlier ones (422 on a later one, P5-W89). */
export function adjustmentPeriods(today: string = businessToday()): string[] {
  return [currentPeriod(today), ...closedPeriods(12, today)];
}

/**
 * A correction line (workforce §3.3, P5-W43): a signed amount for one worker and month, with a reason, posted with the
 * month's next posting. It is how an overpayment is taken back and how a worker with no proposal that month is paid
 * something: a posted line is never changed. The amount is typed in AED (negative takes money back) and converted
 * to fils without float math; the API holds the range.
 *
 * The route has no If-Match, so the Idempotency-Key is the only guard against a second copy (which the next post would
 * tick with the others): the key store is the page's (`adjustmentKeys`, holdAfterUnknown, kept in this tab). After an
 * attempt whose outcome is unknown the key stays with that first adjustment even when the form changes or the dialog is
 * closed and opened again; the dialog says so and offers to send that one again (the API replays it if it was saved),
 * and a different adjustment under the held key is refused (422 IDEMPOTENCY_KEY_REUSED) if the first one was saved.
 */
export function AdjustmentDialog({ defaultPeriod, keys, onClose }: { defaultPeriod: string; keys: IdempotencyKeys; onClose: () => void }) {
  const t = useTranslations("admin.incentives.adjustment");
  const e = useTranslations("admin.incentives.errors");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useIncentiveRefresh();
  const formId = useId();
  const [form, setForm] = useState<AdjustmentForm>({ worker_id: "", period: defaultPeriod, amount: "", reason: "", corrects_posting_id: "" });
  const [errors, setErrors] = useState<AdjustmentErrors>({});
  const workers = useQuery({ queryKey: adminKeys.workerOptions(), queryFn: fetchAllWorkers, staleTime: 60_000 });
  const postings = useQuery({ queryKey: workforceKeys.postings({ page: 1 }), queryFn: () => fetchPostings({ page: 1 }), staleTime: 60_000 });
  const earlier = (postings.data?.data ?? []).filter((p) => p.period.start.slice(0, 7) < form.period);
  const set = <K extends keyof AdjustmentForm>(key: K, value: AdjustmentForm[K]) => {
    setForm((f) => ({ ...f, [key]: value, ...(key === "period" ? { corrects_posting_id: "" } : {}) }));
    setErrors((x) => ({ ...x, [key]: undefined }));
  };

  const save = useMutation({
    mutationFn: (input: AdjustmentInput) => createAdjustment(input, keys.keyFor(input)),
    onSuccess: (saved) => {
      keys.settle();
      refresh();
      toast.success(t("saved", { name: isolate(saved.worker.display_name) }));
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      refresh();
    },
  });
  const submit = () => {
    const checked = validateAdjustment(form);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    save.mutate(checked.input);
  };
  const apiField = useApiFieldMessage(save.error);
  const fieldError = (field: keyof AdjustmentForm, fallbackKey: string) => (errors[field] ? e(errors[field]!) : apiField(field === "amount" ? "amount_fils" : field, e(fallbackKey)));
  const rangeError = save.error instanceof AdminApiError && save.error.code === "AMOUNT_OUT_OF_RANGE" ? describe(save.error) : null;

  // The adjustment sent earlier without an answer (also from an earlier opening of this dialog or before a reload).
  const held = heldAdjustment(keys);
  const heldName = held ? (workers.data?.find((w) => w.id === held.worker_id)?.display_name ?? null) : null;
  const heldText = held
    ? t("heldNote", { amount: wt.moneyText(held.amount_fils), name: heldName ? isolate(heldName) : isolate(`#${held.worker_id}`, "ltr"), month: wt.month(held.period) })
    : null;
  const unknown = save.isError && keepsIdempotencyKey(save.error);
  // A different adjustment under the held key, and the first one had been saved: nothing new was added.
  const earlierStored = save.error instanceof AdminApiError && save.error.code === "IDEMPOTENCY_KEY_REUSED" && held !== null;
  const shownError = save.error && !rangeError && !unknown && !earlierStored ? save.error : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={t("title")}
      description={t("body")}
      dismissible={!save.isPending}
      closeOnOutsideClick={false}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {t("submit")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!save.isPending) submit();
        }}
        className="flex flex-col gap-4"
      >
        {(unknown || held) && (
          <Notice
            tone="warning"
            title={unknown ? t("unknownTitle") : earlierStored ? t("earlierTitle") : t("heldTitle")}
            action={
              held ? (
                <Button variant="secondary" size="sm" className="self-start" onClick={() => save.mutate(held)} loading={save.isPending}>
                  {t("resendEarlier")}
                </Button>
              ) : undefined
            }
          >
            {unknown && <p>{describe(save.error)}</p>}
            <p>{unknown ? t("unknownBody") : earlierStored ? t("earlierBody") : t("heldBody")}</p>
            {heldText && <p className="font-medium">{heldText}</p>}
          </Notice>
        )}
        <Select
          label={t("worker")}
          required
          placeholder={t("workerChoose")}
          value={form.worker_id}
          onChange={(ev) => set("worker_id", ev.target.value)}
          options={(workers.data ?? []).map((w) => ({ value: String(w.id), label: `${isolate(w.display_name)} · ${w.employee_no}` }))}
          error={fieldError("worker_id", "workerRequired")}
        />
        <Select
          label={t("period")}
          required
          value={form.period}
          onChange={(ev) => set("period", ev.target.value)}
          options={adjustmentPeriods().map((p) => ({ value: p, label: wt.month(p) }))}
          error={fieldError("period", "periodInvalid")}
          hint={t("periodHint")}
        />
        <MoneyField label={t("amount")} required value={form.amount} onChange={(ev) => set("amount", ev.target.value)} error={rangeError ?? fieldError("amount", "amountInvalid")} hint={t("amountHint")} />
        <TextArea label={t("reason")} required rows={2} maxLength={500} value={form.reason} onChange={(ev) => set("reason", ev.target.value)} error={fieldError("reason", "reasonLength")} />
        <Select
          label={t("corrects")}
          placeholder={t("correctsNone")}
          value={form.corrects_posting_id}
          onChange={(ev) => set("corrects_posting_id", ev.target.value)}
          options={earlier.map((p) => ({ value: String(p.id), label: `${p.reference} · ${wt.month(p.period.start.slice(0, 7))}` }))}
          hint={t("correctsHint")}
        />
        {shownError && <Notice tone="danger">{describe(shownError)}</Notice>}
      </form>
    </Dialog>
  );
}

/** Deletes an open adjustment (If-Match); one that was posted is final. */
export function DeleteAdjustmentDialog({ adjustment, live, onClose }: { adjustment: IncentiveAdjustment; live: IncentiveAdjustment | null; onClose: () => void }) {
  const t = useTranslations("admin.incentives.adjustment");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useIncentiveRefresh();
  const seen = useSeenRecord(live ?? adjustment);
  const record = seen.record;
  const remove = useMutation({
    mutationFn: () => deleteAdjustment(record.id, record.version),
    onSuccess: () => {
      refresh();
      toast.success(t("deleted"));
      onClose();
    },
    onError: (error) => {
      refresh();
      if (error instanceof AdminApiError && (error.code === "STALE_VERSION" || error.code === "INVALID_STATE")) seen.moved();
    },
  });
  const gone = live === null;
  const stale = seen.waiting || seen.renewed;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteTitle", { name: isolate(record.worker.display_name) })}
      description={t("deleteBody", { amount: wt.moneyText(record.amount_fils), month: wt.month(record.period) })}
      confirmLabel={t("delete")}
      tone="danger"
      pending={remove.isPending}
      onConfirm={() => {
        if (gone || seen.waiting) return;
        seen.seen();
        remove.mutate();
      }}
    >
      {gone && <Notice tone="danger">{t("gone")}</Notice>}
      {stale && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
      {remove.error && !stale && <Notice tone="danger">{describe(remove.error)}</Notice>}
    </ConfirmDialog>
  );
}
