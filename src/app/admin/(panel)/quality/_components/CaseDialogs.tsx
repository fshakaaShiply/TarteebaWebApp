"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Dialog, Notice, Select, TextArea, useToast } from "@/components/admin";
import { cancelCompensation, updateCase } from "@/lib/admin/quality/endpoints";
import { useQualityError } from "@/lib/admin/quality/errors";
import { NOTE_MAX, buildClose, buildReopen, closeReasonsFor, type FormError } from "@/lib/admin/quality/forms";
import { useQualityText } from "@/lib/admin/quality/labels";
import type { AdminCaseDetail, Compensation } from "@/lib/admin/quality/types";
import { isStaleVersion, useCaseRefresh } from "./useCaseRefresh";

/** A compensation of the case that was given but has not reached the customer yet (the API refuses to close over it). */
export function unsettledCompensation(c: Pick<AdminCaseDetail, "compensations">): Compensation | null {
  return c.compensations.find((x) => x.status === "executed" && !x.settled_at) ?? null;
}

function StaleNotice({ stale }: { stale: boolean }) {
  const t = useTranslations("admin.quality.case");
  return stale ? (
    <Notice tone="warning" title={t("staleTitle")}>
      {t("staleBody")}
    </Notice>
  ) : null;
}

/**
 * Closes a case (complaints.manage). An active case is closed as a duplicate, merged or not actionable (a compensation
 * still waiting for approval is withdrawn with it); a resolved one is closed as resolved, which the API refuses while an
 * executed compensation has not reached the customer (409 COMPENSATION_NOT_FINAL): the button is then off, with the
 * reason in words.
 */
export function CloseCaseDialog({ c, onClose }: { c: AdminCaseDetail; onClose: () => void }) {
  const t = useTranslations("admin.quality.close");
  const text = useQualityText();
  const describe = useQualityError();
  const toast = useToast();
  const refresh = useCaseRefresh();
  const reasons = closeReasonsFor(c.status);
  const [reason, setReason] = useState(reasons.length === 1 ? reasons[0] : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ field: "reason" | "note"; error: FormError } | null>(null);
  const [stale, setStale] = useState(false);
  const unsettled = c.status === "resolved" ? unsettledCompensation(c) : null;
  const pending = c.compensations.find((x) => x.status === "pending_approval") ?? null;

  const close = useMutation({
    mutationFn: () => {
      const built = buildClose(reason, c.status, note);
      if (!built.ok) throw new Problem(built.field, built.error);
      return updateCase(c.id, built.body, c.version);
    },
    onSuccess: (answer) => {
      refresh(answer);
      toast.success(t("done", { reference: c.reference }));
      onClose();
    },
    onError: (e) => {
      if (e instanceof Problem) return setError({ field: e.field, error: e.error });
      if (isStaleVersion(e)) {
        setStale(true);
        refresh();
      }
    },
  });
  const shown = close.isError && !(close.error instanceof Problem) && !isStaleVersion(close.error) ? close.error : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !close.isPending && onClose()}
      dismissible={!close.isPending}
      title={t("title", { reference: c.reference })}
      description={c.status === "resolved" ? t("descriptionResolved") : t("description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={close.isPending}>
            {t("cancel")}
          </Button>
          <Button variant="danger" onClick={() => (setError(null), setStale(false), close.mutate())} loading={close.isPending} disabled={unsettled !== null}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {unsettled && (
          <Notice tone="warning" title={t("unsettledTitle")}>
            {t("unsettledBody", { what: text.compensationType(unsettled.type, unsettled.type_label), status: unsettled.refund ? text.name(unsettled.refund.status_label) : text.compensationStatus(unsettled.status, unsettled.status_label) })}
          </Notice>
        )}
        {pending && c.status !== "resolved" && <Notice tone="info">{t("pendingWithdrawn", { what: `${text.compensationType(pending.type, pending.type_label)} ${text.money(pending.amount_fils)}` })}</Notice>}
        <Select
          label={t("reason")}
          required
          placeholder={reasons.length === 1 ? undefined : t("chooseReason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          options={reasons.map((r) => ({ value: r, label: text.closeReason(r) }))}
          error={error?.field === "reason" ? t("errors.reason") : undefined}
        />
        <TextArea label={t("note")} hint={t("noteHint")} rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} error={error?.field === "note" ? t("errors.note") : undefined} />
        <StaleNotice stale={stale} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </Dialog>
  );
}

/** Reopens a resolved case with a reason (kept on the timeline); the clock restarts from now (API: REOPEN_REASON_REQUIRED). */
export function ReopenCaseDialog({ c, onClose }: { c: AdminCaseDetail; onClose: () => void }) {
  const t = useTranslations("admin.quality.reopen");
  const describe = useQualityError();
  const toast = useToast();
  const refresh = useCaseRefresh();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [stale, setStale] = useState(false);

  const reopen = useMutation({
    mutationFn: () => {
      const built = buildReopen(reason);
      if (!built.ok) throw new Problem("reason", built.error);
      return updateCase(c.id, built.body, c.version);
    },
    onSuccess: (answer) => {
      refresh(answer);
      toast.success(t("done", { reference: c.reference }));
      onClose();
    },
    onError: (e) => {
      if (e instanceof Problem) return setError(e.error);
      if (isStaleVersion(e)) {
        setStale(true);
        refresh();
      }
    },
  });
  const shown = reopen.isError && !(reopen.error instanceof Problem) && !isStaleVersion(reopen.error) ? reopen.error : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !reopen.isPending && onClose()}
      dismissible={!reopen.isPending}
      title={t("title", { reference: c.reference })}
      description={t("description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={reopen.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={() => (setError(null), setStale(false), reopen.mutate())} loading={reopen.isPending}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextArea label={t("reason")} required rows={3} maxLength={NOTE_MAX} value={reason} onChange={(e) => setReason(e.target.value)} error={error ? t(`errors.${error}`) : undefined} />
        <StaleNotice stale={stale} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </Dialog>
  );
}

/** Withdraws a compensation proposal that still waits for the accountant (complaints.manage); the held reply is kept as a note. */
export function WithdrawCompensationDialog({ compensation, c, onClose }: { compensation: Compensation; c: Pick<AdminCaseDetail, "reference">; onClose: () => void }) {
  const t = useTranslations("admin.quality.withdraw");
  const text = useQualityText();
  const describe = useQualityError();
  const toast = useToast();
  const refresh = useCaseRefresh();
  const [reason, setReason] = useState("");
  const [stale, setStale] = useState(false);

  const withdraw = useMutation({
    mutationFn: () => cancelCompensation(compensation.id, reason.trim() || undefined, compensation.version),
    onSuccess: () => {
      refresh();
      toast.success(t("done"));
      onClose();
    },
    onError: (e) => {
      if (isStaleVersion(e)) {
        setStale(true);
        refresh();
      }
    },
  });
  const shown = withdraw.isError && !isStaleVersion(withdraw.error) ? withdraw.error : null;
  const what = `${text.compensationType(compensation.type, compensation.type_label)} ${text.money(compensation.amount_fils)}`;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !withdraw.isPending && onClose()}
      dismissible={!withdraw.isPending}
      title={t("title")}
      description={t("description", { what, reference: c.reference })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={withdraw.isPending}>
            {t("keep")}
          </Button>
          <Button variant="danger" onClick={() => (setStale(false), withdraw.mutate())} loading={withdraw.isPending}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextArea label={t("reason")} hint={t("reasonHint")} rows={3} maxLength={NOTE_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
        <StaleNotice stale={stale} />
        {shown && <Notice tone="danger">{describe(shown)}</Notice>}
      </div>
    </Dialog>
  );
}

class Problem extends Error {
  constructor(
    readonly field: "reason" | "note",
    readonly error: FormError,
  ) {
    super(error);
  }
}
