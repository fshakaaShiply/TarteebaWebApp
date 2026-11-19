"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Button, CustomerLink, Dialog, Notice, TextArea, useToast } from "@/components/admin";
import { Ltr } from "../../bookings/_components/BookingBits";
import { AdminApiError } from "@/lib/admin/client";
import { keepsIdempotencyKey, useIdempotencyKeys } from "@/lib/admin/idempotency";
import { approveCompensation, rejectCompensation } from "@/lib/admin/quality/endpoints";
import { useQualityError } from "@/lib/admin/quality/errors";
import { NOTE_MAX, buildReason, type FormError } from "@/lib/admin/quality/forms";
import { useQualityText } from "@/lib/admin/quality/labels";
import type { Compensation } from "@/lib/admin/quality/types";
import { useAdminSession } from "@/lib/admin/session";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";
import { isStaleVersion, useCaseRefresh } from "./useCaseRefresh";

/*
 * The accountant's two decisions on a compensation that waits for approval (compensation.approve; a refund also needs
 * refunds.create, 403 REFUND_PERMISSION_REQUIRED). Both work on a copy of the compensation (useSeenRecord): the facts
 * and the version the person read are what is sent as If-Match. A 409 STALE_VERSION, or a compensation that is no longer
 * waiting, says nothing was saved and shows the new facts to check; a refused version is never resent. Approving shows
 * the exact amount in a second step and sends it as `expected_amount_fils`: 409 TERMS_CHANGED puts the API's amount on
 * screen, marks it, and asks again with a new Idempotency-Key.
 */

type Props = {
  /** The compensation as the page holds it now (the queue's row, or the case's, read again after a 409). */
  compensation: Compensation;
  onClose: () => void;
};

function Facts({ k, amount }: { k: Compensation; amount?: number }) {
  const t = useTranslations("admin.quality.compensation");
  const text = useQualityText();
  return (
    <dl className="flex flex-col gap-2 rounded-md bg-ivory-50 p-4 text-sm">
      <div className="flex justify-between gap-3 text-base font-bold text-ink-900">
        <dt>{text.compensationType(k.type, k.type_label)}</dt>
        <dd>{k.type === "free_visit" ? "—" : text.money(amount ?? k.amount_fils)}</dd>
      </div>
      {k.case && (
        <div className="flex justify-between gap-3">
          <dt>{t("case")}</dt>
          <dd className="text-end">
            <Link href={`/admin/quality/${k.case.id}`} className="font-medium">
              <Ltr>{k.case.reference}</Ltr>
            </Link>{" "}
            · {text.category(k.case.category)}
          </dd>
        </div>
      )}
      {k.customer && (
        <div className="flex justify-between gap-3">
          <dt>{t("customer")}</dt>
          <dd className="text-end">
            <CustomerLink customer={k.customer} />
          </dd>
        </div>
      )}
      {k.destination && (
        <div className="flex justify-between gap-3">
          <dt>{t("goesTo")}</dt>
          <dd className="text-end">{t(`destination.${k.destination}`)}</dd>
        </div>
      )}
      {k.proposed_by && (
        <div className="flex justify-between gap-3">
          <dt>{t("proposer")}</dt>
          <dd className="text-end">{t("proposedBy", { name: k.proposed_by.name, time: text.dateTime(k.proposed_at) })}</dd>
        </div>
      )}
      {k.note && (
        <div className="flex flex-col gap-1">
          <dt>{t("note")}</dt>
          <dd className="text-ink-900">“{k.note}”</dd>
        </div>
      )}
    </dl>
  );
}

function MovedNotice({ waiting, renewed, applies }: { waiting: boolean; renewed: boolean; applies: boolean }) {
  const t = useTranslations("admin.quality.decision");
  if (!waiting && !renewed) return null;
  return (
    <Notice tone={renewed && !applies ? "info" : "warning"} title={t("movedTitle")} role="status">
      {waiting ? t("movedWaiting") : applies ? t("movedRenewed") : t("movedNoLonger")}
    </Notice>
  );
}

/** The `compensation` a 409 TERMS_CHANGED names: the amount and version it has now. */
export function termsChanged(error: unknown): { amount_fils: number; version: number } | null {
  if (!(error instanceof AdminApiError) || error.code !== "TERMS_CHANGED") return null;
  const k = error.details.compensation as { amount_fils?: unknown; version?: unknown } | undefined;
  return typeof k?.amount_fils === "number" && typeof k.version === "number" ? { amount_fils: k.amount_fils, version: k.version } : null;
}

export function ApproveCompensationDialog({ compensation: live, onClose }: Props) {
  const t = useTranslations("admin.quality.approve");
  const text = useQualityText();
  const describe = useQualityError();
  const toast = useToast();
  const refresh = useCaseRefresh();
  const { can } = useAdminSession();
  const keys = useIdempotencyKeys();
  const seen = useSeenRecord(live);
  const k = seen.record;
  const applies = k.status === "pending_approval";
  const needsRefundRight = k.type === "refund" && !can("refunds.create");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [confirming, setConfirming] = useState<{ amount: number; version: number } | null>(null);
  const [changed, setChanged] = useState<{ from: number; to: number } | null>(null);
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) summary.current?.focus();
  }, [confirming]);

  const send = useMutation({
    mutationFn: (plan: { amount: number; version: number }) => {
      const body = { expected_amount_fils: plan.amount, ...(note.trim() ? { note: note.trim() } : {}) };
      return approveCompensation(k.id, body, plan.version, keys.keyFor({ compensation: k.id, version: plan.version, ...body }));
    },
    onSuccess: (answer) => {
      keys.settle();
      refresh(answer.case);
      toast.success(t(`done.${k.type}`, { amount: text.money(answer.data.amount_fils) }));
      onClose();
    },
    onError: (e, plan) => {
      keys.settle(e);
      refresh();
      const terms = termsChanged(e);
      if (terms) {
        // The amount changed under the page: shown as it is now, and the person confirms it again.
        setChanged({ from: plan.amount, to: terms.amount_fils });
        setConfirming({ amount: terms.amount_fils, version: terms.version });
        return;
      }
      if (isStaleVersion(e)) {
        setChanged(null);
        setConfirming(null);
        seen.moved();
      }
    },
  });

  const review = () => {
    if (note.trim().length > NOTE_MAX) return setNoteError(true);
    setNoteError(false);
    setChanged(null);
    send.reset();
    seen.seen();
    setConfirming({ amount: k.amount_fils, version: k.version });
  };
  const confirm = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1 || !confirming) return;
    send.mutate(confirming);
  };

  const unknown = send.isError && keepsIdempotencyKey(send.error);
  const shownError = send.isError && !unknown && termsChanged(send.error) === null && !isStaleVersion(send.error) ? send.error : null;
  const confirmAmount = confirming?.amount ?? k.amount_fils;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      closeOnOutsideClick={false}
      title={confirming ? t("confirmTitle") : t("title")}
      description={confirming ? undefined : t("description")}
      footer={
        confirming ? (
          <>
            <Button key="back" variant="outline" onClick={() => setConfirming(null)} disabled={send.isPending}>
              {t("back")}
            </Button>
            <Button key="confirm" onClick={confirm} loading={send.isPending}>
              {k.type === "free_visit" ? t("confirmFree") : t(`confirm.${k.type}`, { amount: text.money(confirmAmount) })}
            </Button>
          </>
        ) : (
          <>
            <Button key="cancel" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button key="review" onClick={review} disabled={seen.waiting || !applies || needsRefundRight}>
              {t("review")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Facts k={k} amount={confirming?.amount} />
        <MovedNotice waiting={seen.waiting} renewed={seen.renewed} applies={applies} />
        {needsRefundRight && <Notice tone="warning">{t("needsRefundRight")}</Notice>}
        {changed && (
          <Notice tone="warning" title={t("termsChangedTitle")}>
            {t("termsChanged", { from: text.money(changed.from), to: text.money(changed.to) })}
          </Notice>
        )}
        {confirming ? (
          <div ref={summary} tabIndex={-1} className="flex flex-col gap-3 outline-none">
            <Notice tone="warning">{t(`confirmNote.${k.type}`)}</Notice>
            {note.trim() && (
              <p className="text-sm">
                <span className="text-ink-600">{t("yourNote")}: </span>“{note.trim()}”
              </p>
            )}
          </div>
        ) : (
          <TextArea label={t("noteField")} hint={t("noteHint")} rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} error={noteError ? t("noteTooLong") : undefined} />
        )}
        {unknown ? (
          <Notice tone="warning" title={t("unknownTitle")}>
            <p>{describe(send.error)}</p>
            <p>{t("unknownBody")}</p>
          </Notice>
        ) : shownError ? (
          <Notice tone="danger">{describe(shownError)}</Notice>
        ) : null}
      </div>
    </Dialog>
  );
}

export function RejectCompensationDialog({ compensation: live, onClose }: Props) {
  const t = useTranslations("admin.quality.reject");
  const describe = useQualityError();
  const toast = useToast();
  const refresh = useCaseRefresh();
  const keys = useIdempotencyKeys();
  const seen = useSeenRecord(live);
  const k = seen.record;
  const applies = k.status === "pending_approval";
  const [reason, setReason] = useState("");
  const [error, setError] = useState<FormError | null>(null);

  const send = useMutation({
    mutationFn: (body: { reason: string }) => rejectCompensation(k.id, body.reason, k.version, keys.keyFor({ compensation: k.id, version: k.version, ...body })),
    onSuccess: () => {
      keys.settle();
      refresh();
      toast.success(t("done"));
      onClose();
    },
    onError: (e) => {
      keys.settle(e);
      refresh();
      if (isStaleVersion(e)) seen.moved();
    },
  });

  const submit = () => {
    const built = buildReason(reason);
    if (!built.ok) return setError(built.error);
    setError(null);
    send.reset();
    seen.seen();
    send.mutate(built.body);
  };

  const unknown = send.isError && keepsIdempotencyKey(send.error);
  const shownError = send.isError && !unknown && !isStaleVersion(send.error) ? send.error : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      closeOnOutsideClick={false}
      title={t("title")}
      description={t("description")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            {t("cancel")}
          </Button>
          <Button variant="danger" onClick={submit} loading={send.isPending} disabled={seen.waiting || !applies}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Facts k={k} />
        <MovedNotice waiting={seen.waiting} renewed={seen.renewed} applies={applies} />
        <TextArea
          label={t("reason")}
          hint={t("reasonHint")}
          required
          rows={3}
          maxLength={NOTE_MAX}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={error ? t(`errors.${error}`) : undefined}
        />
        {unknown ? (
          <Notice tone="warning" title={t("unknownTitle")}>
            <p>{describe(send.error)}</p>
            <p>{t("unknownBody")}</p>
          </Notice>
        ) : shownError ? (
          <Notice tone="danger">{describe(shownError)}</Notice>
        ) : null}
      </div>
    </Dialog>
  );
}
