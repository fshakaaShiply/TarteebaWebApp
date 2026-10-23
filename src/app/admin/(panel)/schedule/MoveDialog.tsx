"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, Dialog, Notice, Select, TextArea, showFieldError } from "@/components/admin";
import { assignmentReasonSchema } from "@/lib/admin/bookings/forms";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { CAPACITY_OVERRIDE_PERMISSION, FORCE_REASON_MAX } from "@/lib/admin/ops/capacity";
import { moveTargets, type DragSource, type DropTarget } from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import type { ScheduleGrid } from "@/lib/admin/types";
import { Ltr, SlotLabel } from "../bookings/_components/BookingBits";
import { useBookingText } from "../bookings/_components/bookingText";
import { attemptMove, isStale, type MoveOutcome } from "./moveFlow";

/*
 * The keyboard way to move a card (spec §17 A04 drag and drop, without a mouse): choose another cleaner for the same
 * time, or another day or time (a reschedule, handed to the booking's reschedule dialog). The same dry run and move as a
 * drop; soft rules ask for an override (capacity.override, a reason of at least 10 characters, audited).
 */

type Mode = "worker" | "reschedule";

export function MoveDialog({
  board,
  source,
  target,
  outcome: initialOutcome,
  onClose,
  onSettled,
  onReschedule,
}: {
  board: ScheduleGrid;
  source: DragSource;
  /** A drop that needs an override opens here with its target and the dry run's answer. */
  target?: DropTarget;
  outcome?: MoveOutcome;
  onClose: () => void;
  /** A saved move, or an answer the board shows (a reschedule hand-off). */
  onSettled: (target: DropTarget, outcome: MoveOutcome) => void;
  onReschedule: () => void;
}) {
  const t = useTranslations("admin.schedule.moveDialog");
  const f = useTranslations("admin.bookings.formErrors");
  const rules = useTranslations("admin.bookings.assignment.rules");
  const text = useBookingText();
  const describe = useAdminErrorMessage();
  const formId = useId();
  const { can } = useAdminSession();
  const canOverride = can(CAPACITY_OVERRIDE_PERMISSION);
  const card = source.card;
  const fromName = source.fromWorkerId === null ? null : (board.rows.find((r) => r.worker.id === source.fromWorkerId)?.worker.display_name ?? `#${source.fromWorkerId}`);
  const options = moveTargets(board, card);

  const [mode, setMode] = useState<Mode>("worker");
  const [workerId, setWorkerId] = useState(target ? String(target.workerId) : "");
  const [outcome, setOutcome] = useState<MoveOutcome | null>(initialOutcome ?? null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ worker?: string; reason?: string }>({});
  const [pending, setPending] = useState(false);
  const [workerField, setWorkerField] = useState<HTMLSelectElement | null>(null);
  const [reasonField, setReasonField] = useState<HTMLTextAreaElement | null>(null);

  const overriding = outcome?.kind === "override";
  const ruleLabel = (code: string) => (rules.has(code) ? rules(code) : rules("unknown"));

  const submit = async () => {
    if (mode === "reschedule") {
      onReschedule();
      return;
    }
    if (!workerId) {
      showFieldError(() => setErrors({ worker: t("chooseWorkerError") }), workerField);
      return;
    }
    let override: { reason: string } | undefined;
    if (overriding) {
      if (!canOverride || !outcome.canOverride) return;
      const parsed = assignmentReasonSchema(true).safeParse({ reason });
      if (!parsed.success) {
        showFieldError(() => setErrors({ reason: f(parsed.error.issues[0]?.message ?? "reasonRequired") }), reasonField);
        return;
      }
      override = { reason: parsed.data };
    }
    setErrors({});
    const dropTarget: DropTarget = { workerId: Number(workerId), date: card.service_date, slotId: card.slot_template_id };
    setPending(true);
    const result = await attemptMove(source, dropTarget, override);
    setPending(false);
    if (result.kind === "saved" || result.kind === "reschedule") {
      onSettled(dropTarget, result);
      return;
    }
    setOutcome(result);
  };

  const submitLabel = mode === "reschedule" ? t("toReschedule") : overriding && canOverride && outcome.canOverride ? t("overrideSubmit") : t("submit");

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={t("title", { reference: card.booking.reference })}
      description={t("body")}
      dismissible={!pending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          {!(overriding && !(canOverride && outcome.canOverride) && mode === "worker") && (
            <Button type="submit" form={formId} loading={pending} variant={overriding && mode === "worker" ? "danger" : "primary"}>
              {submitLabel}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-ink-900">
        <Ltr>{card.booking.reference}</Ltr> · {text.dateShort(card.service_date)} · <SlotLabel start={card.start} end={card.end} />
      </p>
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) void submit();
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink-900">{t("modeLegend")}</legend>
          {(["worker", "reschedule"] as const).map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`${formId}-mode`}
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="mt-0.5 size-4 accent-petrol-700"
              />
              <span className="flex flex-col">
                <span className="font-medium text-ink-900">{m === "worker" ? t("modeWorker") : t("modeReschedule")}</span>
                <span className="text-xs text-ink-600">{m === "worker" ? t("modeWorkerHint") : t("modeRescheduleHint")}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {mode === "worker" && (
          <>
            <p className="text-sm text-ink-600">{fromName ? t("replacing", { name: fromName }) : t("adding", { count: card.missing })}</p>
            <Select
              ref={setWorkerField}
              label={fromName ? t("newWorker") : t("worker")}
              required
              placeholder={t("chooseWorker")}
              value={workerId}
              onChange={(e) => {
                setWorkerId(e.target.value);
                setOutcome(null);
                setErrors({});
              }}
              options={options.map((w) => ({ value: String(w.id), label: w.display_name }))}
              error={errors.worker}
            />
            {outcome?.kind === "conflicts" && (
              <Notice tone="danger" title={t("conflictsTitle")}>
                <ul className="list-inside list-disc">
                  {outcome.conflicts.map((c) => (
                    <li key={c.code}>{rules.has(c.code) ? rules(c.code) : c.message || rules("unknown")}</li>
                  ))}
                </ul>
                <p>{t("nothingSaved")}</p>
              </Notice>
            )}
            {outcome?.kind === "error" && (
              <Notice tone="danger" title={t("conflictsTitle")}>
                <p>{isStale(outcome.error) ? t("stale") : describe(outcome.error)}</p>
              </Notice>
            )}
            {overriding && (
              <Notice tone="warning" title={t("overrideTitle")}>
                <ul className="list-inside list-disc">
                  {outcome.rules.map((r) => (
                    <li key={r}>{ruleLabel(r)}</li>
                  ))}
                </ul>
                <p>{canOverride && outcome.canOverride ? t("overrideBody") : t("overrideNoPermission")}</p>
              </Notice>
            )}
            {overriding && canOverride && outcome.canOverride && (
              <TextArea
                ref={setReasonField}
                label={t("overrideReason")}
                hint={t("overrideReasonHint")}
                required
                rows={2}
                maxLength={FORCE_REASON_MAX}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setErrors((x) => ({ ...x, reason: undefined }));
                }}
                error={errors.reason}
              />
            )}
          </>
        )}
      </form>
    </Dialog>
  );
}
