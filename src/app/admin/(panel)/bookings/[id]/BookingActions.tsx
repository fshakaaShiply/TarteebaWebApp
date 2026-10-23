"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClock, Check, Link2, Plus, Trash2, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useForm, useWatch, type Path } from "react-hook-form";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  LoadingBlock,
  MoneyField,
  Notice,
  Select,
  TextArea,
  TextField,
  useToast,
  type FocusTarget,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import {
  CANCEL_PARTIES,
  CANCEL_REASONS,
  REJECT_REASONS,
  optionIndexOf,
  priceHigherDetails,
  reasonTextRequired,
  refundableOf,
  type BookingAction,
} from "@/lib/admin/bookings/actions";
import {
  MAX_ALTERNATIVES,
  cancelSchema,
  customerNoteSchema,
  proposeSchema,
  rejectSchema,
  rescheduleSchema,
  type CancelValues,
  type ProposeValues,
  type RejectValues,
  type RescheduleValues,
} from "@/lib/admin/bookings/forms";
import {
  cancelBooking,
  confirmBooking,
  createPaymentLink,
  declineCancelReview,
  previewCancellation,
  proposeAlternatives,
  rejectBooking,
  rescheduleBooking,
} from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { addDaysIso, businessToday } from "@/lib/admin/format";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { CAPACITY_OVERRIDE_PERMISSION } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingDetail, CancelPreview } from "@/lib/admin/types";
import { filsToAedInput } from "@/lib/money";
import { FormErrorNotice } from "../../catalog/_components/CatalogFields";
import { useBookingFocusFallback } from "../_components/focus";
import { PaymentLinkBox } from "../_components/PaymentLinkBox";
import { errorCode, isStaleVersion, useBookingRefresh } from "../_components/refresh";
import { SlotSelect, useChosenSlotUnavailable, useSlotChoices } from "../_components/SlotSelect";
import { useBookingText } from "../_components/bookingText";

/*
 * A03 booking actions (spec §7.1, §10, §11.4, §14.3; design AdminSchedule.dc.html "review booking"): each opens a
 * confirmation with what will happen and maps the API's answers to our copy. Money routes carry an Idempotency-Key
 * (one per intent, kept for a retry after a lost answer); edits send the version the dialog opened with as If-Match,
 * and 409 STALE_VERSION asks to reload (onStale).
 *
 * A dialog works on the booking as it was when it opened (a snapshot): a refetch underneath (window focus, another
 * action's refresh) never swaps the version or the cancellation preview the user is deciding on, so a change made
 * meanwhile answers STALE_VERSION instead of being accepted silently; the dialog says the booking changed.
 */

type ActionProps = {
  /** The booking as it was when the dialog opened. */
  booking: BookingDetail;
  onClose: () => void;
  onStale: () => void;
  /** The booking changed since the dialog opened (a newer version was loaded). */
  changed?: boolean;
  /** Focus target when the button that opened the dialog is gone after it (see _components/focus). */
  returnFocusTo?: FocusTarget;
};

const BAR_ACTIONS = ["confirm", "propose", "reschedule", "reject", "cancel", "paymentLink"] as const;
type BarAction = (typeof BAR_ACTIONS)[number];

/** The buttons a booking offers (by status and permission) and the dialog that is open. */
export function BookingActionBar({
  booking,
  actions,
  onStale,
}: {
  booking: BookingDetail;
  actions: Set<BookingAction>;
  onStale: () => void;
}) {
  const t = useTranslations("admin.bookings.actions");
  const fallback = useBookingFocusFallback();
  const [open, setOpen] = useState<{ action: BarAction; booking: BookingDetail } | null>(null);
  const start = (action: BarAction) => setOpen({ action, booking });
  const shown = BAR_ACTIONS.filter((a) => actions.has(a));
  const props = open
    ? { booking: open.booking, onClose: () => setOpen(null), onStale, changed: open.booking.version !== booking.version, returnFocusTo: fallback }
    : null;

  return (
    <>
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.has("confirm") && (
            <Button onClick={() => start("confirm")} icon={<Check aria-hidden className="size-4" />}>
              {t("confirm")}
            </Button>
          )}
          {actions.has("propose") && (
            <Button variant="secondary" onClick={() => start("propose")} icon={<CalendarClock aria-hidden className="size-4" />}>
              {t("propose")}
            </Button>
          )}
          {actions.has("reschedule") && (
            <Button variant="secondary" onClick={() => start("reschedule")} icon={<CalendarClock aria-hidden className="size-4" />}>
              {t("reschedule")}
            </Button>
          )}
          {actions.has("paymentLink") && (
            <Button variant="secondary" onClick={() => start("paymentLink")} icon={<Link2 aria-hidden className="size-4" />}>
              {t("paymentLink")}
            </Button>
          )}
          {actions.has("reject") && (
            <Button variant="outline" onClick={() => start("reject")} icon={<X aria-hidden className="size-4" />}>
              {t("reject")}
            </Button>
          )}
          {actions.has("cancel") && (
            <Button variant="outline" className="text-danger-700" onClick={() => start("cancel")} icon={<Trash2 aria-hidden className="size-4" />}>
              {t("cancel")}
            </Button>
          )}
        </div>
      )}
      {/* An open dialog stays when a newer booking no longer offers its action: it says the booking changed. */}
      {props && open?.action === "confirm" && <ConfirmBookingDialog {...props} />}
      {props && open?.action === "reject" && <RejectBookingDialog {...props} />}
      {props && open?.action === "propose" && <ProposeAlternativesDialog {...props} />}
      {props && open?.action === "reschedule" && <RescheduleBookingDialog {...props} />}
      {props && open?.action === "cancel" && <CancelBookingDialog {...props} />}
      {props && open?.action === "paymentLink" && <PaymentLinkDialog {...props} />}
    </>
  );
}

/** Errors that are not field errors; STALE_VERSION has its own dialog. */
function ActionError({ error }: { error: unknown }) {
  if (!error || isStaleVersion(error)) return null;
  return <FormErrorNotice error={error} fieldsApplied={false} />;
}

/** The booking was updated while the dialog was open: what is sent is still checked against the version it opened with. */
function ChangedNotice({ changed }: { changed?: boolean }) {
  const t = useTranslations("admin.bookings.actions");
  if (!changed) return null;
  return (
    <Notice tone="warning" title={t("changedTitle")}>
      {t("changedBody")}
    </Notice>
  );
}

// ---- Confirm --------------------------------------------------------------------------------------------------------

/**
 * Confirm = capture (spec §10.2). 502 PAYMENT_RESULT_UNKNOWN: the bank did not answer; the booking stays pending and
 * confirming again is safe (the same intent, the same Idempotency-Key).
 */
export function ConfirmBookingDialog({ booking, onClose, onStale, changed, returnFocusTo }: ActionProps) {
  const t = useTranslations("admin.bookings.confirm");
  const text = useBookingText();
  const toast = useToast();
  const refresh = useBookingRefresh();
  const keys = useIdempotencyKeys();
  const mutation = useMutation({
    mutationFn: () => confirmBooking(booking.id, booking.version, keys.keyFor({ confirm: booking.id })),
    onSuccess: (updated) => {
      keys.settle();
      refresh(updated);
      toast.success(t("done", { reference: booking.reference }));
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      refresh();
      if (isStaleVersion(error)) {
        onClose();
        onStale();
      }
    },
  });
  const unknown = errorCode(mutation.error) === "PAYMENT_RESULT_UNKNOWN";
  const amount = booking.payment?.amount_fils ?? booking.total_fils;

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: booking.reference })}
      description={t("body", { amount: text.money(amount) })}
      confirmLabel={unknown ? t("retry") : t("submit")}
      pending={mutation.isPending}
      onConfirm={() => mutation.mutate()}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      {booking.capture_unknown_at && !mutation.error && <Notice tone="warning">{t("captureUnknown")}</Notice>}
      {unknown ? (
        <Notice tone="warning" title={t("unknownTitle")}>
          {t("unknownBody")}
        </Notice>
      ) : (
        <ActionError error={mutation.error} />
      )}
      <p className="text-sm text-ink-600">{t("assignHint")}</p>
    </ConfirmDialog>
  );
}

// ---- Reject ---------------------------------------------------------------------------------------------------------

export function RejectBookingDialog({ booking, onClose, onStale, changed, returnFocusTo }: ActionProps) {
  const t = useTranslations("admin.bookings.reject");
  const f = useTranslations("admin.bookings.formErrors");
  const text = useBookingText();
  const toast = useToast();
  const refresh = useBookingRefresh();
  const keys = useIdempotencyKeys();
  const form = useForm<RejectValues>({ resolver: zodResolver(rejectSchema) as never, defaultValues: { reason_code: "", reason_text: "" } });
  const code = useWatch({ control: form.control, name: "reason_code" });
  const mutation = useMutation({
    mutationFn: (input: { reason_code: string; reason_text: string | null }) =>
      rejectBooking(booking.id, input, booking.version, keys.keyFor({ reject: booking.id, ...input })),
    onSuccess: (updated) => {
      keys.settle();
      refresh(updated);
      toast.success(t("done", { reference: booking.reference }));
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      applyFieldErrors(error, form.setError, ["reason_code", "reason_text"]);
      if (isStaleVersion(error)) {
        onClose();
        onStale();
      }
    },
  });
  const errors = form.formState.errors;

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: booking.reference })}
      description={t("body")}
      confirmLabel={t("submit")}
      tone="danger"
      pending={mutation.isPending}
      onConfirm={() => void form.handleSubmit((values) => mutation.mutate(values as never))()}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <Select
        label={t("reason")}
        required
        placeholder={t("chooseReason")}
        options={REJECT_REASONS.map((r) => ({ value: r, label: text.rejectReason(r) }))}
        error={errors.reason_code?.message ? f(errors.reason_code.message) : undefined}
        {...form.register("reason_code")}
      />
      <TextArea
        label={t("details")}
        hint={t("detailsHint")}
        required={reasonTextRequired(code)}
        rows={3}
        maxLength={500}
        error={errors.reason_text?.message ? (errors.reason_text.type === "server" ? errors.reason_text.message : f(errors.reason_text.message)) : undefined}
        {...form.register("reason_text")}
      />
      <ActionError error={mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED" ? null : mutation.error} />
    </ConfirmDialog>
  );
}

// ---- Propose alternatives -------------------------------------------------------------------------------------------

/** VALIDATION_FAILED fields of ProposeAlternativesRequest that have an input here. */
const PROPOSE_FIELDS = [
  "note",
  ...[0, 1, 2].flatMap((i) => [`options.${i}.service_date`, `options.${i}.slot_template_id`, `options.${i}.note`] as const),
] as Path<ProposeValues>[];

export function ProposeAlternativesDialog({ booking, onClose, onStale, changed, returnFocusTo }: ActionProps) {
  const t = useTranslations("admin.bookings.propose");
  const f = useTranslations("admin.bookings.formErrors");
  const text = useBookingText();
  const toast = useToast();
  const refresh = useBookingRefresh();
  const formId = useId();
  const tomorrow = addDaysIso(businessToday(), 1);
  const form = useForm<ProposeValues>({
    resolver: zodResolver(proposeSchema) as never,
    defaultValues: { options: [{ service_date: tomorrow, slot_template_id: "", note: "" }], note: "" },
  });
  const options = useFieldArray({ control: form.control, name: "options" });
  const values = useWatch({ control: form.control, name: "options" });
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof proposeAlternatives>[1]) => proposeAlternatives(booking.id, input, booking.version),
    onSuccess: ({ booking: updated }) => {
      refresh(updated);
      toast.success(t("done", { reference: booking.reference }));
      onClose();
    },
    onError: (error) => {
      const index = optionIndexOf(error);
      if (index !== null && index < options.fields.length) {
        form.setError(`options.${index}.slot_template_id`, { type: "server", message: "optionProblem" });
      }
      applyFieldErrors(error, form.setError, PROPOSE_FIELDS);
      if (isStaleVersion(error)) {
        onClose();
        onStale();
      }
    },
  });

  const authorized = booking.payment?.amount_fils ?? booking.total_fils;
  const higher = priceHigherDetails(mutation.error);
  const failedIndex = optionIndexOf(mutation.error);
  const errors = form.formState.errors;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !mutation.isPending && onClose()}
      title={t("title", { reference: booking.reference })}
      description={t("body")}
      size="lg"
      dismissible={!mutation.isPending}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            {t("submit")}
          </Button>
        </>
      }
    >
      <ChangedNotice changed={changed} />
      <Notice tone="info">
        <p>{t("priceRule", { amount: text.money(authorized) })}</p>
        <p>{t("deadlineRule")}</p>
      </Notice>
      <form id={formId} noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v as never))} className="flex flex-col gap-4">
        {options.fields.map((field, i) => {
          const rowErrors = errors.options?.[i];
          const slotError = rowErrors?.slot_template_id?.message;
          return (
            <fieldset key={field.id} className="flex flex-col gap-3 rounded-md border border-line p-4">
              <legend className="px-1 text-sm font-bold text-ink-900">{t("option", { number: i + 1 })}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  type="date"
                  label={t("date")}
                  required
                  dir="ltr"
                  className="font-latin text-start"
                  min={businessToday()}
                  error={rowErrors?.service_date?.message ? f(rowErrors.service_date.message) : undefined}
                  {...form.register(`options.${i}.service_date`)}
                />
                <SlotSelect
                  label={t("slot")}
                  required
                  date={values?.[i]?.service_date ?? ""}
                  zoneId={booking.zone.id}
                  serviceId={booking.service.id}
                  workers={booking.workers_count}
                  error={slotError ? (slotError === "optionProblem" ? t("optionProblem") : f(slotError)) : undefined}
                  {...form.register(`options.${i}.slot_template_id`)}
                />
              </div>
              <TextField
                label={t("optionNote")}
                maxLength={200}
                error={rowErrors?.note?.message ? f(rowErrors.note.message) : undefined}
                {...form.register(`options.${i}.note`)}
              />
              {options.fields.length > 1 && (
                <Button variant="ghost" size="sm" className="self-start" onClick={() => options.remove(i)} icon={<Undo2 aria-hidden className="size-4" />}>
                  {t("removeOption", { number: i + 1 })}
                </Button>
              )}
            </fieldset>
          );
        })}
        {options.fields.length < MAX_ALTERNATIVES && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => options.append({ service_date: tomorrow, slot_template_id: "", note: "" })}
            icon={<Plus aria-hidden className="size-4" />}
          >
            {t("addOption")}
          </Button>
        )}
        <TextArea label={t("note")} hint={t("noteHint")} rows={2} maxLength={500} {...form.register("note")} />
      </form>
      {higher ? (
        <Notice tone="danger" title={t("priceHigherTitle", { number: (failedIndex ?? 0) + 1 })}>
          {t("priceHigherBody", { diff: text.money(higher.priceDiffFils), amount: text.money(higher.authorizedFils) })}
        </Notice>
      ) : failedIndex !== null ? (
        <Notice tone="danger" title={t("optionFailed", { number: failedIndex + 1 })}>
          <ActionErrorText error={mutation.error} />
        </Notice>
      ) : (
        <ActionError error={mutation.error} />
      )}
    </Dialog>
  );
}

function ActionErrorText({ error }: { error: unknown }) {
  const describe = useAdminErrorMessage();
  return <>{describe(error)}</>;
}

// ---- Reschedule (staff) ---------------------------------------------------------------------------------------------

/**
 * `initial` pre-fills the new date and time, e.g. where a card was dropped on the A04 schedule board (a move to another
 * day or time is a reschedule, USE_RESCHEDULE); `note` is shown first (what such a drop does not carry over).
 */
export function RescheduleBookingDialog({
  booking,
  onClose,
  onStale,
  changed,
  returnFocusTo,
  initial,
  note,
}: ActionProps & { initial?: { service_date?: string; slot_template_id?: number | null }; note?: ReactNode }) {
  const t = useTranslations("admin.bookings.reschedule");
  const f = useTranslations("admin.bookings.formErrors");
  const toast = useToast();
  const refresh = useBookingRefresh();
  const keys = useIdempotencyKeys();
  const { can } = useAdminSession();
  const canOverride = can(CAPACITY_OVERRIDE_PERMISSION);
  const formId = useId();
  const form = useForm<RescheduleValues>({
    resolver: zodResolver(rescheduleSchema) as never,
    defaultValues: { service_date: initial?.service_date ?? booking.service_date, slot_template_id: "", reason: "", override: false },
  });
  const [date, slotId, override] = useWatch({ control: form.control, name: ["service_date", "slot_template_id", "override"] });
  const unavailable = useChosenSlotUnavailable({ date, zoneId: booking.zone.id, serviceId: booking.service.id, workers: booking.workers_count, slotId });
  // The pre-filled time is chosen once the date's slots have loaded (an option that is not there yet cannot be selected).
  const { choices } = useSlotChoices({ date, zoneId: booking.zone.id, serviceId: booking.service.id, workers: booking.workers_count });
  const initialSlot = initial?.slot_template_id ? String(initial.slot_template_id) : "";
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !initialSlot || !choices.some((c) => String(c.slot.slot_template_id) === initialSlot)) return;
    prefilled.current = true;
    form.setValue("slot_template_id", initialSlot);
  }, [choices, initialSlot, form]);
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof rescheduleBooking>[1]) =>
      rescheduleBooking(booking.id, input, booking.version, keys.keyFor({ reschedule: booking.id, ...input })),
    onSuccess: ({ booking: updated }) => {
      keys.settle();
      refresh(updated);
      toast.success(t("done", { reference: booking.reference }));
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      applyFieldErrors(error, form.setError, ["service_date", "slot_template_id", "reason"]);
      if (isStaleVersion(error)) {
        onClose();
        onStale();
      }
    },
  });
  const errors = form.formState.errors;
  const code = errorCode(mutation.error);
  const fieldError = (e: { message?: string; type?: string } | undefined) => (e?.message ? (e.type === "server" ? e.message : f(e.message)) : undefined);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !mutation.isPending && onClose()}
      title={t("title", { reference: booking.reference })}
      description={t("body")}
      dismissible={!mutation.isPending}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            {t("submit")}
          </Button>
        </>
      }
    >
      <ChangedNotice changed={changed} />
      {note}
      <form id={formId} noValidate onSubmit={form.handleSubmit((v) => mutation.mutate(v as never))} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            type="date"
            label={t("date")}
            required
            dir="ltr"
            className="font-latin text-start"
            error={fieldError(errors.service_date)}
            {...form.register("service_date")}
          />
          <SlotSelect
            label={t("slot")}
            required
            date={date}
            zoneId={booking.zone.id}
            serviceId={booking.service.id}
            workers={booking.workers_count}
            error={fieldError(errors.slot_template_id)}
            {...form.register("slot_template_id")}
          />
        </div>
        {unavailable && !override && <Notice tone="warning">{canOverride ? t("fullCanOverride") : t("fullNoOverride")}</Notice>}
        {canOverride && (
          <Checkbox label={t("override")} description={t("overrideHint")} {...form.register("override")} />
        )}
        <TextArea
          label={t("reason")}
          hint={override ? t("reasonHintOverride") : t("reasonHint")}
          required
          rows={2}
          maxLength={1000}
          error={fieldError(errors.reason)}
          {...form.register("reason")}
        />
      </form>
      {(code === "SLOT_FULL" || code === "SLOT_CLOSED") && canOverride && !override ? (
        <Notice tone="danger" title={t("slotUnavailableTitle")}>
          {t("fullCanOverride")}
        </Notice>
      ) : (
        <ActionError error={mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED" ? null : mutation.error} />
      )}
    </Dialog>
  );
}

// ---- Cancel ---------------------------------------------------------------------------------------------------------

/**
 * Cancel with the policy preview first (spec §10.4, §11.4): the fee and refund for the chosen party before anything
 * moves. When the policy cannot decide the amount (review required, or the visit has started) the refund must be
 * typed by someone with refunds.create; without it the dialog says so and sends nothing.
 */
export function CancelBookingDialog({ booking, onClose, onStale, changed, returnFocusTo }: ActionProps) {
  const t = useTranslations("admin.bookings.cancel");
  const f = useTranslations("admin.bookings.formErrors");
  const text = useBookingText();
  const toast = useToast();
  const refresh = useBookingRefresh();
  const keys = useIdempotencyKeys();
  const { can } = useAdminSession();
  const mayDecideRefund = can("refunds.create");
  const [party, setParty] = useState<"customer" | "company">(booking.cancellation.review?.party === "company" ? "company" : "customer");
  const [blockedTried, setBlockedTried] = useState(false);

  const preview = useQuery({
    queryKey: ["admin", "bookings", "cancel-preview", booking.id, booking.version, party],
    queryFn: () => previewCancellation(booking.id, party),
    retry: false,
  });
  const plan = preview.data;
  const decisionNeeded = !!plan && plan.mode !== "release" && (plan.requires_review || !plan.allowed);
  const refundMode: "hidden" | "optional" | "required" = !plan || plan.mode === "release" || !mayDecideRefund ? "hidden" : decisionNeeded ? "required" : "optional";

  const reviewCode = booking.cancellation.review?.reason_code ?? "";
  const form = useForm<CancelValues>({
    defaultValues: { party, reason_code: (CANCEL_REASONS as readonly string[]).includes(reviewCode) ? reviewCode : "", reason_text: "", refund: "" },
  });
  const code = useWatch({ control: form.control, name: "reason_code" });

  // The policy refund fills the amount field when it opens (staff with refunds.create may change it).
  useEffect(() => {
    if (refundMode !== "hidden" && plan?.refund_fils !== null && plan?.refund_fils !== undefined && form.getValues("refund") === "") {
      form.setValue("refund", filsToAedInput(plan.refund_fils));
    }
  }, [refundMode, plan, form]);

  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof cancelBooking>[1]) =>
      cancelBooking(booking.id, input, booking.version, keys.keyFor({ cancel: booking.id, ...input })),
    onSuccess: (result) => {
      keys.settle();
      refresh(result.booking);
      toast.success(
        result.refund_fils > 0
          ? t("doneRefund", { reference: booking.reference, amount: text.money(result.refund_fils) })
          : t("done", { reference: booking.reference }),
      );
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      refresh();
      applyFieldErrors(error, form.setError, ["reason_code", "reason_text"], { refund_fils: "refund" });
      if (isStaleVersion(error)) {
        onClose();
        onStale();
      }
    },
  });
  /** What may still be refunded: the API's figure after a refund error, else what was paid. */
  const refundable = refundableOf(mutation.error) ?? plan?.paid_fils ?? null;

  const errors = form.formState.errors;
  const fieldError = (e: { message?: string; type?: string } | undefined) => (e?.message ? (e.type === "server" ? e.message : f(e.message)) : undefined);
  const blocked = decisionNeeded && !mayDecideRefund;
  const errorCodeNow = errorCode(mutation.error);

  /** The checks depend on the preview (refund field shown or required), so they run here rather than in a resolver. */
  const submit = () => {
    if (blocked) {
      // Announce why nothing happens: the refund is for finance to decide.
      setBlockedTried(true);
      return;
    }
    if (!plan) return;
    const parsed = cancelSchema(refundMode, refundable).safeParse(form.getValues());
    form.clearErrors();
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof CancelValues;
        if (!form.getFieldState(field).error) form.setError(field, { type: "manual", message: issue.message }, { shouldFocus: true });
      }
      return;
    }
    mutation.mutate(parsed.data);
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: booking.reference })}
      description={t("body")}
      confirmLabel={errorCodeNow === "PAYMENT_RESULT_UNKNOWN" ? t("retry") : t("submit")}
      tone="danger"
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink-900">{t("party")}</legend>
        <div className="flex flex-wrap gap-4">
          {CANCEL_PARTIES.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cancel-party"
                value={p}
                checked={party === p}
                onChange={() => {
                  setParty(p);
                  form.setValue("party", p);
                  form.setValue("refund", "");
                }}
                className="size-4 accent-petrol-700"
              />
              {text.party(p)}
            </label>
          ))}
        </div>
      </fieldset>

      <CancelPreviewBox preview={preview.data} pending={preview.isPending} error={preview.error} onRetry={() => void preview.refetch()} />

      {plan?.requires_review && !mayDecideRefund && (
        <Notice tone={blockedTried ? "danger" : "warning"} title={t("reviewTaskTitle")}>
          {t("reviewTaskBody")}
        </Notice>
      )}
      {plan && !plan.allowed && plan.mode !== "release" && !mayDecideRefund && !plan.requires_review && (
        <Notice tone={blockedTried ? "danger" : "warning"} title={t("startedTitle")}>
          {t("startedNoPermission")}
        </Notice>
      )}
      {blockedTried && (
        <p role="alert" className="sr-only">
          {plan?.requires_review ? t("reviewTaskBody") : t("startedNoPermission")}
        </p>
      )}

      <Select
        label={t("reason")}
        required
        placeholder={t("chooseReason")}
        options={CANCEL_REASONS.map((r) => ({ value: r, label: text.cancelReason(r) }))}
        error={fieldError(errors.reason_code)}
        {...form.register("reason_code")}
      />
      <TextArea
        label={t("details")}
        required={reasonTextRequired(code)}
        rows={2}
        maxLength={1000}
        error={fieldError(errors.reason_text)}
        {...form.register("reason_text")}
      />
      {refundMode !== "hidden" && (
        <MoneyField
          label={t("refund")}
          hint={refundable !== null ? t("refundHint", { amount: text.money(refundable) }) : undefined}
          required={refundMode === "required"}
          error={fieldError(errors.refund)}
          {...form.register("refund")}
        />
      )}
      {errorCodeNow === "PAYMENT_RESULT_UNKNOWN" ? (
        <Notice tone="warning" title={t("unknownTitle")}>
          {t("unknownBody")}
        </Notice>
      ) : (
        <ActionError error={mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED" ? null : mutation.error} />
      )}
    </ConfirmDialog>
  );
}

function CancelPreviewBox({ preview, pending, error, onRetry }: { preview: CancelPreview | undefined; pending: boolean; error: unknown; onRetry: () => void }) {
  const t = useTranslations("admin.bookings.cancel");
  const text = useBookingText();
  const describe = useAdminErrorMessage();
  if (pending) return <LoadingBlock lines={3} />;
  if (!preview) {
    return (
      <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={onRetry}>{t("retryPreview")}</Button>}>
        {describe(error)}
      </Notice>
    );
  }
  return (
    <section aria-label={t("previewTitle")} className="flex flex-col gap-2 rounded-md bg-neutral-100 p-4 text-sm">
      <p className="font-bold text-ink-900">{t("previewTitle")}</p>
      <p className="text-ink-900">{text.name(preview.explanation)}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {preview.mode === "release" ? (
          <>
            <dt className="text-ink-600">{t("held")}</dt>
            <dd className="font-latin text-ink-900">{text.money(preview.held_fils)}</dd>
          </>
        ) : (
          <>
            <dt className="text-ink-600">{t("paid")}</dt>
            <dd className="font-latin text-ink-900">{text.money(preview.paid_fils)}</dd>
            <dt className="text-ink-600">{t("fee")}</dt>
            <dd className="font-latin text-ink-900">{preview.fee_fils === null ? t("toDecide") : text.money(preview.fee_fils)}</dd>
            <dt className="text-ink-600">{t("refundPlanned")}</dt>
            <dd className="font-latin text-ink-900">{preview.refund_fils === null ? t("toDecide") : text.money(preview.refund_fils)}</dd>
            {preview.kept_fees_fils > 0 && (
              <>
                <dt className="text-ink-600">{t("keptFees")}</dt>
                <dd className="font-latin text-ink-900">{text.money(preview.kept_fees_fils)}</dd>
              </>
            )}
          </>
        )}
      </dl>
      {preview.requires_review && <p className="font-medium text-warning-700">{t("reviewRequired")}</p>}
      <p className="text-xs text-ink-600">{t("providerNote")}</p>
    </section>
  );
}

// ---- Cancellation review: keep the booking -------------------------------------------------------------------------

export function DeclineReviewDialog({ booking, onClose, onStale, changed, returnFocusTo }: ActionProps) {
  const t = useTranslations("admin.bookings.review");
  const f = useTranslations("admin.bookings.formErrors");
  const toast = useToast();
  const refresh = useBookingRefresh();
  const form = useForm<{ note: string }>({ resolver: zodResolver(customerNoteSchema) as never, defaultValues: { note: "" } });
  const mutation = useMutation({
    mutationFn: (note: string) => declineCancelReview(booking.id, note, booking.version),
    onSuccess: (updated) => {
      refresh(updated);
      toast.success(t("declined"));
      onClose();
    },
    onError: (error) => {
      applyFieldErrors(error, form.setError, ["note"]);
      if (isStaleVersion(error)) {
        onClose();
        onStale();
      }
    },
  });
  const error = form.formState.errors.note;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("declineTitle")}
      description={t("declineBody")}
      confirmLabel={t("declineSubmit")}
      pending={mutation.isPending}
      onConfirm={() => void form.handleSubmit((note) => mutation.mutate(note as unknown as string))()}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <TextArea
        label={t("note")}
        hint={t("noteHint")}
        required
        rows={3}
        maxLength={1000}
        error={error?.message ? (error.type === "server" ? error.message : f(error.message)) : undefined}
        {...form.register("note")}
      />
      <ActionError error={mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED" ? null : mutation.error} />
    </ConfirmDialog>
  );
}

// ---- Payment link (manual bookings) ---------------------------------------------------------------------------------

function PaymentLinkDialog({ booking, onClose, returnFocusTo }: ActionProps) {
  const t = useTranslations("admin.paymentLink");
  const refresh = useBookingRefresh();
  const mutation = useMutation({ mutationFn: () => createPaymentLink(booking.id), onSuccess: () => refresh() });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !mutation.isPending && onClose()}
      title={t("dialogTitle", { reference: booking.reference })}
      description={t("dialogBody")}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("close")}
          </Button>
          {!mutation.data && (
            <Button onClick={() => mutation.mutate()} loading={mutation.isPending} icon={<Link2 aria-hidden className="size-4" />}>
              {t("create")}
            </Button>
          )}
        </>
      }
    >
      {mutation.data && (
        <PaymentLinkBox
          link={mutation.data.payment_link}
          expiresAt={mutation.data.expires_at}
          phone={booking.customer.phone}
          customerName={booking.customer.name}
          customerLocale="ar"
          reference={booking.reference}
          serviceDate={booking.service_date}
        />
      )}
      <ActionError error={mutation.error} />
    </Dialog>
  );
}
