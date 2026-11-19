"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, ConfirmDialog, Dialog, MoneyField, Notice, Select, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { businessToday, isolate } from "@/lib/admin/format";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { fetchAllWorkers } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { createAdjustment, deleteAdjustment, fetchPostings } from "@/lib/admin/workforce/endpoints";
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
 * to fils without float math; the API holds the range. The Idempotency-Key stays for a retry of the same body.
 */
export function AdjustmentDialog({ defaultPeriod, onClose }: { defaultPeriod: string; onClose: () => void }) {
  const t = useTranslations("admin.incentives.adjustment");
  const e = useTranslations("admin.incentives.errors");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useIncentiveRefresh();
  const keys = useIdempotencyKeys();
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
    mutationFn: () => {
      const checked = validateAdjustment(form);
      if (!checked.ok) throw new FormProblem(checked.errors);
      return createAdjustment(checked.input, keys.keyFor(checked.input));
    },
    onSuccess: (saved) => {
      keys.settle();
      refresh();
      toast.success(t("saved", { name: isolate(saved.worker.display_name) }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof FormProblem) return setErrors(error.errors);
      keys.settle(error);
      refresh();
    },
  });
  const apiField = useApiFieldMessage(save.error);
  const fieldError = (field: keyof AdjustmentForm, fallbackKey: string) => (errors[field] ? e(errors[field]!) : apiField(field === "amount" ? "amount_fils" : field, e(fallbackKey)));
  const rangeError = save.error instanceof AdminApiError && save.error.code === "AMOUNT_OUT_OF_RANGE" ? describe(save.error) : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={t("title")}
      description={t("body")}
      dismissible={!save.isPending}
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
      <form id={formId} noValidate onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }} className="flex flex-col gap-4">
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
        {save.error && !(save.error instanceof FormProblem) && !rangeError && <Notice tone="danger">{describe(save.error)}</Notice>}
      </form>
    </Dialog>
  );
}

class FormProblem extends Error {
  constructor(readonly errors: AdjustmentErrors) {
    super("form");
  }
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
      description={t("deleteBody", { amount: wt.money(record.amount_fils), month: wt.month(record.period) })}
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
