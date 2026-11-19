"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Button, Dialog, MoneyField, Notice, Select, TextArea, useToast } from "@/components/admin";
import { addDaysIso, businessToday } from "@/lib/admin/format";
import { keepsIdempotencyKey, useIdempotencyKeys } from "@/lib/admin/idempotency";
import { fetchFreeVisitAvailability, resolveCase, type ResolveBody } from "@/lib/admin/quality/endpoints";
import { useQualityError } from "@/lib/admin/quality/errors";
import { NOTE_MAX, RESOLUTION_MAX, buildResolve, emptyResolve, needsOutcome, type ResolveField, type ResolveSummary, type ResolveValues, type FormError } from "@/lib/admin/quality/forms";
import { qualityKeys } from "@/lib/admin/quality/keys";
import { useQualityText } from "@/lib/admin/quality/labels";
import { CASE_OUTCOMES, COMPENSATION_TYPES, type AdminCaseDetail, type CompensationType } from "@/lib/admin/quality/types";
import { useAdminSession } from "@/lib/admin/session";
import { useSeenRecord } from "../../finance/_components/useSeenRecord";
import { isStaleVersion, useCaseRefresh } from "./useCaseRefresh";

/*
 * Resolving a case (complaints.manage; A10 design, quality §3.2 and §4, contract A3 §5.1). Two steps: the form, then a
 * summary with the exact words and money to confirm. A compensation is "money back or a free re-clean" and the
 * accountant approves all money: a refund or a credit is only PROPOSED here (the case resolves when it is approved, and
 * the customer's reply waits with it), a free visit is booked at once and needs bookings.create_manual. Each type is
 * offered only when the case's own `compensation_options` say it is available, with the reason when it is not; the
 * amount is capped by `max_fils`, which the server computes (the per-visit remainder). The dialog acts on its copy of
 * the case (the facts and version it was opened with): a 409 STALE_VERSION says nothing was saved and takes the page's
 * newer read as the copy, to be checked and confirmed again. The Idempotency-Key is one per body and version.
 */

type Step = "form" | "confirm";

const SLOT_OFFERED = new Set(["available", "limited"]);

export function ResolveDialog({ c: live, onClose }: { c: AdminCaseDetail; onClose: () => void }) {
  const t = useTranslations("admin.quality.resolve");
  const text = useQualityText();
  const describe = useQualityError();
  const toast = useToast();
  const refresh = useCaseRefresh();
  const { can } = useAdminSession();
  const keys = useIdempotencyKeys();
  const seen = useSeenRecord(live);
  const c = seen.record;
  const options = c.compensation_options;
  const mayFreeVisit = can("bookings.create_manual");

  const [values, setValues] = useState<ResolveValues>(emptyResolve);
  const [step, setStep] = useState<Step>("form");
  const [problem, setProblem] = useState<{ field: ResolveField; error: FormError } | null>(null);
  const [sending, setSending] = useState<{ body: ResolveBody; summary: ResolveSummary } | null>(null);
  const summaryBox = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ResolveValues>) => setValues((v) => ({ ...v, ...patch }));

  // The free visit's date strip: the next two weeks, read only while that option is chosen.
  const from = useMemo(() => businessToday(), []);
  const to = addDaysIso(from, 13);
  const availability = useQuery({
    queryKey: qualityKeys.freeVisit(c.id, from, to),
    queryFn: () => fetchFreeVisitAvailability(c.id, { from, to }),
    enabled: values.compensation === "free_visit" && step === "form",
    staleTime: 30_000,
  });
  const days = (availability.data?.data ?? []).filter((d) => d.slots.some((s) => SLOT_OFFERED.has(s.status)));
  const daySlots = (days.find((d) => d.date === values.freeDate)?.slots ?? []).filter((s) => SLOT_OFFERED.has(s.status));

  useEffect(() => {
    if (step === "confirm") summaryBox.current?.focus();
  }, [step]);

  const send = useMutation({
    mutationFn: (plan: { body: ResolveBody }) => resolveCase(c.id, plan.body, c.version, keys.keyFor({ case: c.id, version: c.version, ...plan.body })),
    onSuccess: (answer) => {
      keys.settle();
      refresh(answer.data);
      toast.success(answer.meta.result === "pending_approval" ? t("donePending") : t("done", { reference: c.reference }));
      onClose();
    },
    onError: (e) => {
      keys.settle(e);
      refresh();
      if (isStaleVersion(e)) {
        // Not the case that was shown: back to the form, which shows the case as read again.
        setStep("form");
        setSending(null);
        seen.moved();
      }
    },
  });

  const review = () => {
    const built = buildResolve(values, c);
    if (!built.ok) {
      setProblem({ field: built.field, error: built.error });
      return;
    }
    setProblem(null);
    send.reset();
    seen.seen();
    setSending({ body: built.body, summary: built.summary ?? { kind: "none" } });
    setStep("confirm");
  };
  const confirm = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1 || !sending) return;
    send.mutate({ body: sending.body });
  };

  const err = (field: ResolveField) => (problem?.field === field ? t(`errors.${problem.error}`) : undefined);
  const unknown = send.isError && keepsIdempotencyKey(send.error);
  const shownError = send.isError && !unknown && !isStaleVersion(send.error) ? send.error : null;
  const applies = c.actions.resolve;

  const confirmLabel = !sending
    ? ""
    : sending.summary.kind === "refund" || sending.summary.kind === "credit"
      ? t("confirmPropose", { what: `${text.compensationType(sending.summary.kind)} ${text.money(sending.summary.amount_fils)}` })
      : sending.summary.kind === "free_visit"
        ? t("confirmFree", { date: text.date(sending.summary.date) })
        : t("confirmResolve");

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      dismissible={!send.isPending}
      closeOnOutsideClick={false}
      title={step === "confirm" ? t("confirmTitle") : t("title", { reference: c.reference })}
      description={step === "confirm" ? undefined : t("description")}
      footer={
        step === "confirm" ? (
          <>
            <Button key="back" variant="outline" onClick={() => setStep("form")} disabled={send.isPending}>
              {t("back")}
            </Button>
            <Button key="confirm" onClick={confirm} loading={send.isPending}>
              {confirmLabel}
            </Button>
          </>
        ) : (
          <>
            <Button key="cancel" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button key="review" onClick={review} disabled={seen.waiting || !applies}>
              {t("review")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="info">{t("ratingNote")}</Notice>
        {(seen.waiting || seen.renewed) && (
          <Notice tone="warning" title={t("movedTitle")} role="status">
            {seen.waiting ? t("movedWaiting") : applies ? t("movedRenewed") : t("movedNoLonger")}
          </Notice>
        )}
        {step === "confirm" && sending ? (
          <div ref={summaryBox} tabIndex={-1} className="flex flex-col gap-3 outline-none">
            <dl className="flex flex-col gap-2 rounded-md bg-ivory-50 p-4 text-sm">
              {sending.body.outcome && (
                <div className="flex justify-between gap-3">
                  <dt>{t("outcome")}</dt>
                  <dd className="text-end font-medium text-ink-900">{text.outcome(sending.body.outcome)}</dd>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <dt>{c.customer_visible || sending.summary.kind !== "none" ? t("replyToCustomer") : t("replyHidden")}</dt>
                <dd className="whitespace-pre-wrap text-ink-900">{sending.body.resolution ? `“${sending.body.resolution}”` : t("noReply")}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>{t("compensation")}</dt>
                <dd className="text-end font-bold text-ink-900">
                  {sending.summary.kind === "none"
                    ? text.compensationType("none")
                    : sending.summary.kind === "free_visit"
                      ? `${text.compensationType("free_visit")} · ${text.date(sending.summary.date)}`
                      : `${text.compensationType(sending.summary.kind)} · ${text.money(sending.summary.amount_fils)}`}
                </dd>
              </div>
            </dl>
            <Notice tone="warning">
              {sending.summary.kind === "refund" || sending.summary.kind === "credit"
                ? t("confirmNoteMoney")
                : sending.summary.kind === "free_visit"
                  ? t("confirmNoteFree")
                  : t("confirmNoteNone")}
            </Notice>
          </div>
        ) : (
          <>
            {needsOutcome(c) && (
              <Select
                label={t("outcome")}
                required
                placeholder={t("chooseOutcome")}
                value={values.outcome}
                onChange={(e) => set({ outcome: e.target.value })}
                options={CASE_OUTCOMES.map((o) => ({ value: o, label: text.outcome(o) }))}
                error={err("outcome")}
              />
            )}
            <TextArea
              label={c.customer_visible || values.compensation !== "none" ? t("resolutionVisible") : t("resolutionHidden")}
              hint={c.customer_visible || values.compensation !== "none" ? t("resolutionHint") : t("resolutionHiddenHint")}
              required={c.customer_visible || values.compensation !== "none"}
              rows={4}
              maxLength={RESOLUTION_MAX}
              value={values.resolution}
              onChange={(e) => set({ resolution: e.target.value })}
              error={err("resolution")}
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink-900">{t("compensation")}</legend>
              {COMPENSATION_TYPES.map((type) => {
                const reason = unavailableReason(type, c, mayFreeVisit);
                return (
                  <label
                    key={type}
                    className="touch-target flex items-start gap-2.5 rounded-md border border-line px-3 py-2.5 text-sm has-[:checked]:border-petrol-700 has-[:checked]:bg-petrol-50 has-[:disabled]:opacity-60"
                  >
                    <input type="radio" name="resolve-compensation" className="mt-0.5" value={type} checked={values.compensation === type} disabled={reason !== null} onChange={() => set({ compensation: type })} />
                    <span className="flex flex-col">
                      <span className="font-medium text-ink-900">{text.compensationType(type)}</span>
                      <span className="text-xs text-ink-600">{reason ? t(`unavailable.${reason}`) : t(`typeHint.${type}`, { max: typeMax(type, c, text.money) })}</span>
                    </span>
                  </label>
                );
              })}
              {err("compensation") && <p className="text-xs font-medium text-danger-700">{err("compensation")}</p>}
            </fieldset>
            {(values.compensation === "refund" || values.compensation === "credit") && options && (
              <div className="flex flex-col gap-3">
                <MoneyField
                  label={t("amount")}
                  required
                  hint={t("amountHint", { max: text.money(options[values.compensation].max_fils) })}
                  value={values.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                  error={err("amount")}
                />
                {values.compensation === "refund" && options.refund.destination && (
                  <p className="text-sm text-ink-600">{t(`destination.${options.refund.destination}`)}</p>
                )}
                <TextArea label={t("note")} hint={t("noteHint")} rows={2} maxLength={NOTE_MAX} value={values.note} onChange={(e) => set({ note: e.target.value })} error={err("note")} />
                <Notice tone="info">{t("needsApproval")}</Notice>
              </div>
            )}
            {values.compensation === "free_visit" && (
              <div className="flex flex-col gap-3">
                {availability.isPending && <p className="text-sm text-ink-600">{t("loadingDates")}</p>}
                {availability.isError && (
                  <Notice tone="danger" action={<Button variant="secondary" size="sm" className="self-start" onClick={() => void availability.refetch()}>{t("retry")}</Button>}>
                    {describe(availability.error)}
                  </Notice>
                )}
                {availability.data && days.length === 0 && <Notice tone="warning">{t("noDates")}</Notice>}
                {days.length > 0 && (
                  <>
                    <Select
                      label={t("freeDate")}
                      required
                      placeholder={t("chooseDate")}
                      value={values.freeDate}
                      onChange={(e) => set({ freeDate: e.target.value, freeSlot: "" })}
                      options={days.map((d) => ({ value: d.date, label: text.date(d.date) }))}
                      error={err("freeDate")}
                    />
                    <Select
                      label={t("freeSlot")}
                      required
                      placeholder={t("chooseSlot")}
                      disabled={values.freeDate === ""}
                      value={values.freeSlot}
                      onChange={(e) => set({ freeSlot: e.target.value })}
                      options={daySlots.map((s) => ({
                        value: String(s.slot_template_id),
                        label: `${s.name} · ${s.start}–${s.end}${s.status === "limited" ? ` · ${t("limited")}` : ""}`,
                      }))}
                      error={err("freeSlot")}
                    />
                    {c.booking && c.booking.workers_count > 1 && (
                      <Select
                        label={t("freeWorkers")}
                        value={values.freeWorkers || String(c.booking.workers_count)}
                        onChange={(e) => set({ freeWorkers: e.target.value })}
                        options={Array.from({ length: c.booking.workers_count }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                      />
                    )}
                  </>
                )}
                <TextArea label={t("note")} hint={t("noteHint")} rows={2} maxLength={NOTE_MAX} value={values.note} onChange={(e) => set({ note: e.target.value })} error={err("note")} />
                <Notice tone="info">{t("freeVisitNote")}</Notice>
              </div>
            )}
          </>
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

/** Why a compensation type cannot be chosen: the case's own reason, the missing permission, or null when it can. */
export function unavailableReason(type: CompensationType, c: AdminCaseDetail, mayFreeVisit = true): string | null {
  if (type === "none") return null;
  const option = c.compensation_options?.[type];
  if (!option) return "disabled";
  if (!option.available) return option.reason ?? "disabled";
  if (type === "free_visit" && !mayFreeVisit) return "no_permission";
  return null;
}

function typeMax(type: CompensationType, c: AdminCaseDetail, money: (fils: number) => string): string {
  if (type === "refund" || type === "credit") {
    const max = c.compensation_options?.[type].max_fils;
    return max === undefined ? "" : money(max);
  }
  return "";
}
