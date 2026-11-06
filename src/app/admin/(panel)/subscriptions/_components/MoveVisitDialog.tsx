"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Checkbox, ConfirmDialog, LoadingBlock, Notice, TextArea, TextField } from "@/components/admin";
import { businessToday, isIsoDate } from "@/lib/admin/format";
import { CAPACITY_OVERRIDE, codeOf } from "@/lib/admin/subscriptions/actions";
import { previewVisitMove, writeVisit } from "@/lib/admin/subscriptions/endpoints";
import { useSubscriptionErrorMessage } from "@/lib/admin/subscriptions/errors";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { SubscriptionOccurrence } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { useAdminSession } from "@/lib/admin/session";
import { SlotSelect } from "../../bookings/_components/SlotSelect";
import { ChangedNotice, DRY_RUN, ErrorNotice, PreviewBox, TermsRow, hasFieldErrors, useDialogMutation, useFieldError, type SubscriptionDialogProps } from "./kit";

const OVERRIDE_REASON_MIN = 10;

/**
 * "Edit this visit": move one visit to another date and time (scope this). Booking's staff rules: no fee, no approval,
 * no weekly limit; the capacity decides, and "full" or "closed" can be passed only by staff with capacity.override, with
 * a reason of at least 10 characters (P2-16). The preview (the same check, nothing kept) says whether the time fits.
 * The visit keeps its place in the series and is marked as an exception; the period follows the served dates. The
 * preview's blockers (Booking's codes policy, slot, price) are shown in our own words, with the API's explanation (in
 * the UI language: the request carries it), and a full or closed time says why (the Scheduling reason, P4-245).
 * `initial` is the date and time a card was dropped on in A04: the board hands a series visit's move over to here.
 */
export function MoveVisitDialog({
  subscription,
  visit,
  initial,
  onClose,
  onStale,
  changed,
  returnFocusTo,
}: SubscriptionDialogProps & { visit: SubscriptionOccurrence; initial?: { date: string; slotId: number | null } }) {
  const t = useTranslations("admin.subscriptions.move");
  const text = useSubscriptionText();
  const describe = useSubscriptionErrorMessage();
  const fieldError = useFieldError();
  const { can } = useAdminSession();
  const canOverride = can(CAPACITY_OVERRIDE);
  const [date, setDate] = useState(initial?.date ?? visit.scheduled_date);
  const [slotId, setSlotId] = useState(initial?.slotId ? String(initial.slotId) : visit.slot ? String(visit.slot.id) : "");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const kind = subscription.type === "live_out" ? "live_out" : "standard_visit";
  const target = isIsoDate(date) && slotId ? { date, slot_template_id: Number(slotId) } : null;
  const overrideBody = override && canOverride ? { override: true, override_reason: overrideReason.trim() } : {};

  const unchanged = target !== null && date === visit.scheduled_date && Number(slotId) === visit.slot?.id;
  const preview = useQuery({
    queryKey: subscriptionKeys.preview("move", subscription.id, subscription.version, visit.ulid, date, slotId, override && canOverride),
    queryFn: () => previewVisitMove(subscription.id, visit.ulid, { scope: "this", ...(target as { date: string; slot_template_id: number }), ...(override && canOverride ? { override: true } : {}) }),
    enabled: target !== null && !unchanged,
    ...DRY_RUN,
  });

  const mutation = useDialogMutation({
    subscription,
    onClose,
    onStale,
    op: "move",
    send: (input: Record<string, unknown>, key) =>
      writeVisit(subscription.id, visit.ulid, { scope: "this", action: "move", ...input } as never, subscription.version, key),
    done: (result) => ({ detail: result.data, message: t("done", { date: text.dateShort(date) }) }),
  });

  const availability = preview.data?.availability;
  const full = availability?.status === "full" || availability?.status === "closed";
  // Booking's blocker codes (policy | slot | price) in our own words; "slot" is already said by the full/closed line.
  const blockers = [...new Set(preview.data?.blockers ?? [])].filter((b) => !(b === "slot" && full && !override));
  const code = codeOf(mutation.error);
  const slotUnavailable = code === "SLOT_FULL" || code === "SLOT_CLOSED";

  const submit = () => {
    if (!target) {
      setProblem(t("chooseTarget"));
      return;
    }
    if (unchanged) {
      setProblem(t("unchanged"));
      return;
    }
    if (override && canOverride && overrideReason.trim().length < OVERRIDE_REASON_MIN) {
      setProblem(t("overrideReasonShort", { min: OVERRIDE_REASON_MIN }));
      return;
    }
    setProblem(null);
    mutation.mutate({ ...target, ...overrideBody, ...(reason.trim() ? { reason: reason.trim() } : {}) });
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { date: text.dateShort(visit.scheduled_date) })}
      description={t("body")}
      confirmLabel={t("submit")}
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          type="date"
          label={t("date")}
          required
          value={date}
          min={businessToday()}
          dir="ltr"
          className="font-latin text-start"
          onChange={(e) => setDate(e.target.value)}
          error={fieldError(mutation.error, "date", t("dateInvalid"))}
        />
        <SlotSelect label={t("slot")} required serviceKind={kind} value={slotId} onChange={(e) => setSlotId(e.target.value)} error={fieldError(mutation.error, "slot_template_id", t("slotInvalid"))} />
      </div>

      {target === null || unchanged ? (
        <p className="text-sm text-ink-600">{unchanged ? t("unchanged") : t("chooseToSee")}</p>
      ) : preview.isPending ? (
        <LoadingBlock lines={2} />
      ) : preview.isError ? (
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
            <TermsRow
              label={t("availability")}
              value={[
                t.has(`availabilityStates.${availability?.status}` as never) ? t(`availabilityStates.${availability?.status}` as never) : (availability?.status ?? "—"),
                ...(availability?.reason ? [text.dateReason(availability.reason)] : []),
              ].join(" · ")}
            />
          </dl>
          {full && !override && <p className="font-medium text-warning-700">{canOverride ? t("fullCanOverride") : t("fullNoOverride")}</p>}
          {blockers.length > 0 && (
            <ul className="flex flex-col gap-0.5 font-medium text-danger-700">
              {blockers.map((b) => (
                <li key={b}>{t.has(`blockers.${b}` as never) ? t(`blockers.${b}` as never) : t("blockers.other")}</li>
              ))}
            </ul>
          )}
          {preview.data.explanation && <p className="text-ink-900">{preview.data.explanation}</p>}
          <p className="text-xs text-ink-600">{t("seriesNote")}</p>
        </PreviewBox>
      )}

      {canOverride && (
        <>
          <Checkbox label={t("override")} description={t("overrideHint")} checked={override} onChange={(e) => setOverride(e.target.checked)} />
          {override && (
            <TextArea
              label={t("overrideReason")}
              required
              rows={2}
              maxLength={500}
              hint={t("overrideReasonHint", { min: OVERRIDE_REASON_MIN })}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              error={fieldError(mutation.error, "override_reason", t("overrideReasonShort", { min: OVERRIDE_REASON_MIN }))}
            />
          )}
        </>
      )}
      <TextArea label={t("reason")} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint={t("reasonHint")} />

      {problem && (
        <Notice tone="warning" role="alert">
          {problem}
        </Notice>
      )}
      {slotUnavailable && canOverride && !override ? (
        <Notice tone="danger" title={t("slotUnavailableTitle")}>
          {t("fullCanOverride")}
        </Notice>
      ) : (
        <ErrorNotice error={mutation.error} hideCodes={hasFieldErrors(mutation.error, ["date", "slot_template_id", "override_reason"]) ? ["VALIDATION_FAILED"] : []} />
      )}
    </ConfirmDialog>
  );
}
