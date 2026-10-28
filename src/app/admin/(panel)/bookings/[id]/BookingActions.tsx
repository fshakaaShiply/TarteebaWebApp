"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
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
  cancelTermsOf,
  optionFieldErrors,
  optionIndexOf,
  priceHigherDetails,
  reasonTextRequired,
  refundableOf,
  rescheduleTermsOf,
  slotUnavailable,
  visitStatusOf,
  type BookingAction,
  type TermsChanged,
} from "@/lib/admin/bookings/actions";
import {
  MAX_ALTERNATIVES,
  cancelSchema,
  customerNoteSchema,
  duplicateOptionIndexes,
  proposalCheckBody,
  proposeSchema,
  rejectSchema,
  rescheduleSchema,
  resolveReviewSchema,
  type CancelValues,
  type ProposeValues,
  type RejectValues,
  type RescheduleValues,
  type ResolveValues,
} from "@/lib/admin/bookings/forms";
import {
  cancelBooking,
  confirmBooking,
  createPaymentLink,
  declineCancelReview,
  previewAlternatives,
  previewCancellation,
  previewReschedule,
  proposeAlternatives,
  rejectBooking,
  rescheduleBooking,
  resolveCancelReview,
  type ProposeInput,
  type RescheduleInput,
} from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { addDaysIso, businessToday, isIsoDate } from "@/lib/admin/format";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { keepsIdempotencyKey, useIdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { CAPACITY_OVERRIDE_PERMISSION } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { AlternativeOptionPreview, BookingDetail, CancelPreview, ReschedulePreview } from "@/lib/admin/types";
import { filsToAedInput } from "@/lib/money";
import { FormErrorNotice } from "../../catalog/_components/CatalogFields";
import { useBookingFocusFallback } from "../_components/focus";
import { PaymentLinkBox } from "../_components/PaymentLinkBox";
import { errorCode, isStaleVersion, useBookingRefresh } from "../_components/refresh";
import { SlotSelect, slotsForKind, useBookingServiceKind, useSlotTemplatePickList } from "../_components/SlotSelect";
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
 *
 * Cancel and reschedule send back the amounts their preview showed (expected_*). When the terms moved since (409
 * TERMS_CHANGED, nothing done), the dialog shows the new preview from the error's details with the changed amounts
 * marked, and only a fresh confirm sends them: a new body, so a new Idempotency-Key (the 409 was a stored answer).
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

/**
 * Dry runs are not retried and not refreshed on focus; their keys sit outside ["admin", "bookings"], so an action's
 * refresh does not send them again either (adminKeys.reschedulePreview, alternativesPreview).
 */
const DRY_RUN = { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } as const;

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

/** One amount of a preview; an amount a TERMS_CHANGED moved is marked (and named for screen readers). */
function TermsRow({ label, value, changed }: { label: ReactNode; value: ReactNode; changed?: boolean }) {
  const t = useTranslations("admin.bookings.actions");
  return (
    <>
      <dt className="text-ink-600">{label}</dt>
      <dd className={clsx("font-latin text-ink-900", changed && "w-fit rounded-sm bg-apricot-100 px-1 font-bold")} data-changed={changed ? "true" : undefined}>
        {value}
        {changed && <span className="sr-only"> {t("changedMark")}</span>}
      </dd>
    </>
  );
}

/** 409 TERMS_CHANGED: nothing was done; the new amounts are on screen and need a fresh confirm. */
function TermsChangedNotice({ body }: { body: string }) {
  const t = useTranslations("admin.bookings.actions");
  return (
    <Notice tone="warning" title={t("termsChangedTitle")} role="alert">
      {body}
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
/** A refusal of a whole option (`options.N`, e.g. the same date and time twice) lands on its time. */
const PROPOSE_FIELD_MAP = Object.fromEntries([0, 1, 2].map((i) => [`options.${i}`, `options.${i}.slot_template_id`])) as Record<string, Path<ProposeValues>>;

/**
 * 1–3 other times for a pending request (spec §7.1). Each option is checked as it is entered (POST
 * …/propose-alternative/preview): its price, the difference to the booking, and why it can't be offered; Send is
 * offered only when every option can be (`can_send`), and the dialog says until when the customer may answer.
 */
export function ProposeAlternativesDialog({ booking, onClose, onStale, changed, returnFocusTo }: ActionProps) {
  const t = useTranslations("admin.bookings.propose");
  const f = useTranslations("admin.bookings.formErrors");
  const text = useBookingText();
  const toast = useToast();
  const refresh = useBookingRefresh();
  const formId = useId();
  const serviceKind = useBookingServiceKind(booking);
  const tomorrow = addDaysIso(businessToday(), 1);
  const form = useForm<ProposeValues>({
    resolver: zodResolver(proposeSchema) as never,
    defaultValues: { options: [{ service_date: tomorrow, slot_template_id: "", note: "" }], note: "" },
  });
  const options = useFieldArray({ control: form.control, name: "options" });
  const values = useWatch({ control: form.control, name: "options" });
  const serverMessage = useServerFieldMessage();

  // The same date and time twice is marked here (the API refuses it with 422 on `options.N`) and never checked.
  const duplicates = duplicateOptionIndexes(values);
  const check = proposalCheckBody(values);
  const debouncedCheck = useDebouncedValue(check, 400);
  const preview = useQuery({
    queryKey: adminKeys.alternativesPreview(booking.id, booking.version, debouncedCheck),
    queryFn: () => previewAlternatives(booking.id, JSON.parse(debouncedCheck) as ProposeInput),
    enabled: debouncedCheck !== "" && debouncedCheck === check,
    ...DRY_RUN,
  });
  /** The preview of exactly the options on screen (none while they change or load). */
  const current = check !== "" && debouncedCheck === check ? preview.data : undefined;
  const previewError = check !== "" && debouncedCheck === check && preview.isError ? preview.error : null;
  const checking = check !== "" && !current && !previewError;
  const canSend = current?.can_send === true;
  /** A 422 of the check: the same options can't pass again, so its messages go on the options (no "Check again"). */
  const previewRefused = errorCode(previewError) === "VALIDATION_FAILED";

  const mutation = useMutation({
    mutationFn: (input: ProposeInput) => proposeAlternatives(booking.id, input, booking.version),
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
      applyFieldErrors(error, form.setError, PROPOSE_FIELDS, PROPOSE_FIELD_MAP);
      if (isStaleVersion(error)) {
        onClose();
        onStale();
      }
    },
  });

  const authorized = current?.authorized_fils ?? booking.payment?.amount_fils ?? booking.total_fils;
  const higher = priceHigherDetails(mutation.error);
  const failedIndex = optionIndexOf(mutation.error);
  const errors = form.formState.errors;
  /** A form error: our key, "optionProblem", or the API's own message (type "server"). */
  const formError = (e: { message?: string; type?: string } | undefined) =>
    !e?.message ? undefined : e.message === "optionProblem" ? t("optionProblem") : e.type === "server" ? e.message : f(e.message);

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
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={!canSend}>
            {t("submit")}
          </Button>
        </>
      }
    >
      <ChangedNotice changed={changed} />
      <Notice tone="info">
        <p>{t("priceRule", { amount: text.money(authorized) })}</p>
        <p>
          {current
            ? t("deadline", { time: text.dateTime(current.expires_at), hours: current.answer_window_hours })
            : t("deadlineRule")}
        </p>
      </Notice>
      <form
        id={formId}
        noValidate
        onSubmit={form.handleSubmit((v) => {
          // Only what the preview accepted goes out (the API checks every option again).
          if (canSend) mutation.mutate(v as unknown as ProposeInput);
        })}
        className="flex flex-col gap-4"
      >
        {options.fields.map((field, i) => {
          const rowErrors = errors.options?.[i];
          // The form's own errors first (a refused Send), then a repeated time, then the check's 422 on this option.
          const checkErrors = optionFieldErrors(previewError, i);
          const dateError = formError(rowErrors?.service_date) ?? (checkErrors.date ? serverMessage(checkErrors.date, t("optionProblem")) : undefined);
          const slotError =
            formError(rowErrors?.slot_template_id) ??
            (duplicates.has(i) ? f("duplicateOption") : checkErrors.slot ? serverMessage(checkErrors.slot, t("optionProblem")) : undefined);
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
                  error={dateError}
                  {...form.register(`options.${i}.service_date`)}
                />
                <SlotSelect label={t("slot")} required serviceKind={serviceKind} error={slotError} {...form.register(`options.${i}.slot_template_id`)} />
              </div>
              <OptionCheck number={i + 1} result={current?.options.find((o) => o.index === i)} checking={checking} />
              <TextField label={t("optionNote")} maxLength={200} error={formError(rowErrors?.note)} {...form.register(`options.${i}.note`)} />
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
      {check === "" ? (
        duplicates.size === 0 && <p className="text-sm text-ink-600">{t("previewHint")}</p>
      ) : previewRefused ? (
        <FormErrorNotice error={previewError} fieldsApplied={false} />
      ) : previewError ? (
        <Notice
          tone="danger"
          action={
            <Button variant="secondary" size="sm" className="self-start" onClick={() => void preview.refetch()}>
              {t("retryPreview")}
            </Button>
          }
        >
          <ActionErrorText error={previewError} />
        </Notice>
      ) : null}
      {/* Whether Send is open, said once for the whole dialog once the check answers (shown only when it is not). */}
      <p role="status" aria-live="polite" aria-atomic="true" className={current && !current.can_send ? "text-sm font-medium text-danger-700" : "sr-only"}>
        {current ? (current.can_send ? t("canSend") : t("cannotSend")) : ""}
      </p>
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

/**
 * One option's check: its price and difference, or why it can't be offered (the API's message). One live region per
 * option stays mounted, so "Checking…" and then the answer are both announced.
 */
function OptionCheck({ number, result, checking }: { number: number; result: AlternativeOptionPreview | undefined; checking: boolean }) {
  const t = useTranslations("admin.bookings.propose");
  const text = useBookingText();
  const diff = result?.price_diff_fils ?? null;
  const price = !result
    ? ""
    : result.total_fils === null
      ? t("noPrice")
      : t("optionPrice", {
          total: text.money(result.total_fils),
          diff: diff === null || diff === 0 ? t("samePrice") : diff < 0 ? t("cheaper", { amount: text.money(-diff) }) : t("dearer", { amount: text.money(diff) }),
        });
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={result || checking ? "flex flex-col gap-0.5 text-sm" : "sr-only"}
      data-option-check={result?.index}
    >
      {result ? (
        <>
          <span className="sr-only">{t("option", { number })}: </span>
          <p className="font-latin text-ink-900">{price}</p>
          {result.problem ? (
            <p className="font-medium text-danger-700">{result.problem.message}</p>
          ) : (
            <p className="font-medium text-success-700">{t("optionAllowed")}</p>
          )}
        </>
      ) : checking ? (
        <p className="text-ink-600">{t("checking")}</p>
      ) : null}
    </div>
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
 *
 * The chosen date and time are checked first (POST …/reschedule/preview): the new total and any refund of the
 * difference, whether the slot can take the team (an override otherwise), or why the move can't be made (409
 * RESCHEDULE_PENDING: a customer request waits). Those terms go back with the move (expected_*).
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
  const serviceKind = useBookingServiceKind(booking);
  const { query: slotList } = useSlotTemplatePickList();
  const form = useForm<RescheduleValues>({
    resolver: zodResolver(rescheduleSchema) as never,
    defaultValues: { service_date: initial?.service_date ?? booking.service_date, slot_template_id: "", reason: "", override: false },
  });
  const [date, slotId, override] = useWatch({ control: form.control, name: ["service_date", "slot_template_id", "override"] });
  // The pre-filled time is chosen once the slots have loaded (an option that is not there yet cannot be selected).
  const initialSlot = initial?.slot_template_id ? String(initial.slot_template_id) : "";
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !initialSlot || !slotsForKind(slotList.data, serviceKind).some((s) => String(s.id) === initialSlot)) return;
    prefilled.current = true;
    form.setValue("slot_template_id", initialSlot);
  }, [slotList.data, serviceKind, initialSlot, form]);

  const target = isIsoDate(date) && slotId ? { service_date: date, slot_template_id: Number(slotId) } : null;
  const preview = useQuery({
    queryKey: adminKeys.reschedulePreview(booking.id, booking.version, date, Number(slotId) || 0),
    queryFn: () => previewReschedule(booking.id, target as { service_date: string; slot_template_id: number }),
    enabled: target !== null,
    ...DRY_RUN,
  });
  /** The terms a 409 TERMS_CHANGED answered for this date and time (newer than the preview). */
  const [updated, setUpdated] = useState<{ date: string; slotId: string; terms: TermsChanged<ReschedulePreview> } | null>(null);
  const fresh = updated && updated.date === date && updated.slotId === slotId ? updated.terms : null;
  const terms: ReschedulePreview | undefined = fresh ?? (target ? preview.data : undefined);
  /** The check of the chosen time failed (no amounts will come for it): RESCHEDULE_PENDING, SAME_SLOT, offline … */
  const previewFailed = target !== null && !fresh && preview.isError;
  const [termsMissing, setTermsMissing] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: RescheduleInput) => rescheduleBooking(booking.id, input, booking.version, keys.keyFor({ reschedule: booking.id, ...input })),
    onSuccess: ({ booking: updatedBooking }) => {
      keys.settle();
      refresh(updatedBooking);
      toast.success(t("done", { reference: booking.reference }));
      onClose();
    },
    onError: (error, input) => {
      keys.settle(error);
      const next = rescheduleTermsOf(error);
      if (next) setUpdated({ date: input.service_date, slotId: String(input.slot_template_id), terms: next });
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

  const submit = form.handleSubmit((values) => {
    const input = values as unknown as RescheduleInput;
    // The move goes out with the terms on screen; without them there is nothing to confirm yet.
    if (!terms) {
      setTermsMissing(true);
      return;
    }
    setTermsMissing(false);
    mutation.mutate({ ...input, expected_fee_fils: terms.fee_fils, expected_new_total_fils: terms.new_total_fils });
  });

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
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
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
          <SlotSelect label={t("slot")} required serviceKind={serviceKind} error={fieldError(errors.slot_template_id)} {...form.register("slot_template_id")} />
        </div>
        <RescheduleTerms
          booking={booking}
          chosen={target !== null}
          terms={terms}
          changedFields={fresh?.changed ?? []}
          pending={target !== null && !fresh && preview.isPending}
          error={target !== null && !fresh ? preview.error : null}
          onRetry={() => void preview.refetch()}
        />
        {terms && slotUnavailable(terms.availability) && !override && (
          <Notice tone="warning">{canOverride ? t("fullCanOverride") : t("fullNoOverride")}</Notice>
        )}
        {canOverride && <Checkbox label={t("override")} description={t("overrideHint")} {...form.register("override")} />}
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
      {fresh && <TermsChangedNotice body={t("termsChangedBody")} />}
      {termsMissing && !terms && (
        // Pressed before the terms are on screen: wait while they load; a failed check points at the problem instead.
        <Notice tone="warning" role="alert">
          {previewFailed ? (errorCode(preview.error) === "RESCHEDULE_PENDING" ? t("pendingFirst") : t("previewFailedHint")) : t("termsMissing")}
        </Notice>
      )}
      {(code === "SLOT_FULL" || code === "SLOT_CLOSED") && canOverride && !override ? (
        <Notice tone="danger" title={t("slotUnavailableTitle")}>
          {t("fullCanOverride")}
        </Notice>
      ) : code === "TERMS_CHANGED" || (mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED") ? null : (
        <ActionError error={mutation.error} />
      )}
    </Dialog>
  );
}

/** What the move does to the money: the new total, the difference and any refund of it (changed amounts marked). */
function RescheduleTerms({
  booking,
  chosen,
  terms,
  changedFields,
  pending,
  error,
  onRetry,
}: {
  booking: BookingDetail;
  chosen: boolean;
  terms: ReschedulePreview | undefined;
  changedFields: string[];
  pending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const t = useTranslations("admin.bookings.reschedule");
  const text = useBookingText();
  const describe = useAdminErrorMessage();
  const diff = terms?.price_diff_fils ?? 0;
  const difference = diff === 0 ? t("samePrice") : diff < 0 ? t("cheaper", { amount: text.money(-diff) }) : t("dearer", { amount: text.money(diff) });
  // One live region stays mounted with the dialog: "Checking…" (shown) once a date and time are chosen, then the amounts
  // for screen readers (shown below as a list). Error and waiting-request notices carry their own roles.
  const spoken = !chosen || !terms
    ? ""
    : [
        t("termsAnnounce", { label: t("newTotal"), value: text.money(terms.new_total_fils) }),
        t("termsAnnounce", { label: t("difference"), value: difference }),
        terms.refund_fils > 0 ? t("termsAnnounce", { label: t("refund"), value: text.money(terms.refund_fils) }) : null,
        terms.fee_fils > 0 ? t("termsAnnounce", { label: t("fee"), value: text.money(terms.fee_fils) }) : null,
        terms.blockers.includes("price") ? t("priceBlocked") : null,
      ]
        .filter(Boolean)
        .join(" ");
  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" className={chosen && pending ? "text-sm text-ink-600" : "sr-only"}>
        {chosen && pending ? t("checking") : spoken}
      </p>
      {!chosen ? (
        <p className="text-sm text-ink-600">{t("chooseToSee")}</p>
      ) : !pending && !terms ? (
        errorCode(error) === "RESCHEDULE_PENDING" ? (
          <Notice tone="warning" title={t("pendingTitle")}>
            {t("pendingBody")}
          </Notice>
        ) : (
          <Notice
            tone="danger"
            action={
              <Button variant="secondary" size="sm" className="self-start" onClick={onRetry}>
                {t("retryPreview")}
              </Button>
            }
          >
            {describe(error)}
          </Notice>
        )
      ) : null}
      {chosen && !pending && terms && (
        <section aria-label={t("termsTitle")} className="flex flex-col gap-2 rounded-md bg-neutral-100 p-4 text-sm">
          <p className="font-bold text-ink-900">{t("termsTitle")}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <TermsRow label={t("currentTotal")} value={text.money(booking.total_fils)} />
            <TermsRow label={t("newTotal")} value={text.money(terms.new_total_fils)} changed={changedFields.includes("new_total_fils")} />
            <TermsRow label={t("difference")} value={difference} />
            {terms.refund_fils > 0 && <TermsRow label={t("refund")} value={text.money(terms.refund_fils)} changed={changedFields.includes("refund_fils")} />}
            {(terms.fee_fils > 0 || changedFields.includes("fee_fils")) && (
              <TermsRow label={t("fee")} value={text.money(terms.fee_fils)} changed={changedFields.includes("fee_fils")} />
            )}
            {terms.kept_fees_fils > 0 && <TermsRow label={t("keptFees")} value={text.money(terms.kept_fees_fils)} />}
          </dl>
          {terms.blockers.includes("price") && <p className="font-medium text-danger-700">{t("priceBlocked")}</p>}
        </section>
      )}
    </>
  );
}

// ---- Cancel ---------------------------------------------------------------------------------------------------------

/**
 * Cancel with the policy preview first (spec §10.4, §11.4): the fee and refund for the chosen party before anything
 * moves. When the policy cannot decide the amount (review required, or the visit has started) the refund must be
 * typed by someone with refunds.create; without it the dialog says so and sends nothing. The preview's fee and refund
 * go back as they were (expected_*, null for a review), also when a refund amount is typed.
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
  /** The plan a 409 TERMS_CHANGED answered for this party (newer than the preview). */
  const [updated, setUpdated] = useState<{ party: string; plan: TermsChanged<CancelPreview> } | null>(null);
  const fresh = updated && updated.party === party ? updated.plan : null;
  const plan = fresh ?? preview.data;
  const decisionNeeded = !!plan && plan.mode !== "release" && (plan.requires_review || !plan.allowed);
  const refundMode: "hidden" | "optional" | "required" = !plan || plan.mode === "release" || !mayDecideRefund ? "hidden" : decisionNeeded ? "required" : "optional";

  const reviewCode = booking.cancellation.review?.reason_code ?? "";
  const form = useForm<CancelValues>({
    defaultValues: { party, reason_code: (CANCEL_REASONS as readonly string[]).includes(reviewCode) ? reviewCode : "", reason_text: "", refund: "" },
  });
  const code = useWatch({ control: form.control, name: "reason_code" });

  // The policy refund fills the amount field when it opens (staff with refunds.create may change it).
  const prefilledRefund = useRef<string | null>(null);
  useEffect(() => {
    if (refundMode !== "hidden" && plan?.refund_fils !== null && plan?.refund_fils !== undefined && form.getValues("refund") === "") {
      const value = filsToAedInput(plan.refund_fils);
      form.setValue("refund", value);
      prefilledRefund.current = value;
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
    onError: (error, input) => {
      keys.settle(error);
      refresh();
      const next = cancelTermsOf(error);
      if (next) {
        // A refund still showing the old policy amount follows the new one; an amount typed by hand stays.
        if (prefilledRefund.current !== null && form.getValues("refund") === prefilledRefund.current) {
          form.setValue("refund", "");
          prefilledRefund.current = null;
        }
        setUpdated({ party: input.party, plan: next });
      }
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
  // Finance resolves only a customer's cancellation that waits for review (…/cancel-review/resolve answers 409
  // CANCEL_REVIEW_NOT_PENDING otherwise): any other review is for someone with both permissions.
  const reviewBody = booking.cancellation.review_requested_at && party === "customer" ? t("reviewTaskBody") : t("reviewNoRequestBody");

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
    // The policy terms as shown (null for a review), never the typed refund: the API compares them with its preview.
    mutation.mutate({ ...parsed.data, expected_fee_fils: plan.fee_fils, expected_refund_fils: plan.refund_fils });
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: booking.reference })}
      description={t("body")}
      confirmLabel={errorCodeNow === "PAYMENT_RESULT_UNKNOWN" ? t("retry") : fresh ? t("submitNewTerms") : t("submit")}
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
                  prefilledRefund.current = null;
                }}
                className="size-4 accent-petrol-700"
              />
              {text.party(p)}
            </label>
          ))}
        </div>
      </fieldset>

      <CancelPreviewBox
        preview={plan}
        changedFields={fresh?.changed ?? []}
        pending={!fresh && preview.isPending}
        error={preview.error}
        onRetry={() => void preview.refetch()}
      />
      {fresh && <TermsChangedNotice body={t("termsChangedBody")} />}

      {plan?.requires_review && !mayDecideRefund && (
        <Notice tone={blockedTried ? "danger" : "warning"} title={t("reviewTaskTitle")}>
          {reviewBody}
        </Notice>
      )}
      {plan && !plan.allowed && plan.mode !== "release" && !mayDecideRefund && !plan.requires_review && (
        <Notice tone={blockedTried ? "danger" : "warning"} title={t("startedTitle")}>
          {t("startedNoPermission")}
        </Notice>
      )}
      {blockedTried && (
        <p role="alert" className="sr-only">
          {plan?.requires_review ? reviewBody : t("startedNoPermission")}
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
      ) : errorCodeNow === "TERMS_CHANGED" ? null : (
        <ActionError error={mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED" ? null : mutation.error} />
      )}
    </ConfirmDialog>
  );
}

function CancelPreviewBox({
  preview,
  changedFields,
  pending,
  error,
  onRetry,
}: {
  preview: CancelPreview | undefined;
  changedFields: string[];
  pending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
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
  const moved = (field: string) => changedFields.includes(field);
  return (
    <section aria-label={t("previewTitle")} className="flex flex-col gap-2 rounded-md bg-neutral-100 p-4 text-sm">
      <p className="font-bold text-ink-900">{t("previewTitle")}</p>
      <p className="text-ink-900">{text.name(preview.explanation)}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        {preview.mode === "release" ? (
          <TermsRow label={t("held")} value={text.money(preview.held_fils)} />
        ) : (
          <>
            <TermsRow label={t("paid")} value={text.money(preview.paid_fils)} />
            <TermsRow label={t("fee")} value={preview.fee_fils === null ? t("toDecide") : text.money(preview.fee_fils)} changed={moved("fee_fils")} />
            <TermsRow
              label={t("refundPlanned")}
              value={preview.refund_fils === null ? t("toDecide") : text.money(preview.refund_fils)}
              changed={moved("refund_fils")}
            />
            {preview.kept_fees_fils > 0 && <TermsRow label={t("keptFees")} value={text.money(preview.kept_fees_fils)} />}
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

// ---- Cancellation review: resolve with a refund (finance) ------------------------------------------------------------

/**
 * The accountant finishes a customer's cancellation that waits for review (POST …/cancel-review/resolve,
 * refunds.create, Idempotency-Key, If-Match): the booking is cancelled as the customer asked, the amount typed (up to
 * what is refundable) goes back, the rest is kept as the fee, and the note is the refund's note and the audit reason.
 * Once the crew is on the road (409 INVALID_STATE with the visit's status) it is operations' decision.
 */
export function ResolveReviewDialog({ booking, onClose, onStale, changed, returnFocusTo }: ActionProps) {
  const t = useTranslations("admin.bookings.resolve");
  const f = useTranslations("admin.bookings.formErrors");
  const text = useBookingText();
  const toast = useToast();
  const refresh = useBookingRefresh();
  const keys = useIdempotencyKeys();
  // What may still be refunded: the booking's own cap (refundable_fils, the figure the API checks the refund against),
  // until a 422 REFUND_AMOUNT_INVALID names a fresher one. null = nothing was taken, so no amount is asked and 0 is sent
  // (which the API always accepts). Not expected while a review waits: only taken money is reviewed, and the API settles
  // a lost capture before it asks for a review.
  const [apiCap, setApiCap] = useState<number | null>(null);
  const refundable = apiCap ?? booking.refundable_fils;
  const form = useForm<ResolveValues>({ defaultValues: { refund: "", note: "" } });
  const review = booking.cancellation.review;

  const mutation = useMutation({
    mutationFn: (input: { refund_fils: number; note: string }) =>
      resolveCancelReview(booking.id, input, booking.version, keys.keyFor({ resolve: booking.id, ...input })),
    onSuccess: (result) => {
      keys.settle();
      refresh(result.booking);
      toast.success(
        result.refund_fils > 0
          ? t("doneRefund", { reference: booking.reference, amount: text.money(result.refund_fils) })
          : t("doneKept", { reference: booking.reference }),
      );
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      applyFieldErrors(error, form.setError, ["note"], { refund_fils: "refund" });
      if (errorCode(error) === "REFUND_AMOUNT_INVALID") {
        // The API's own figure of what may still be refunded replaces ours, in the summary and on the field.
        const cap = refundableOf(error);
        if (cap !== null) setApiCap(cap);
        form.setError(
          "refund",
          cap !== null ? { type: "server", message: t("amountTooHigh", { amount: text.money(cap) }) } : { type: "manual", message: "refundTooHigh" },
          { shouldFocus: true },
        );
      }
      // No review waiting any more, or the crew left meanwhile: the page shows the booking as it now is.
      if (errorCode(error) === "CANCEL_REVIEW_NOT_PENDING" || errorCode(error) === "INVALID_STATE") refresh();
      if (isStaleVersion(error)) {
        onClose();
        onStale();
      }
    },
  });

  const submit = () => {
    const parsed = resolveReviewSchema(refundable).safeParse(form.getValues());
    form.clearErrors();
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof ResolveValues;
        if (!form.getFieldState(field).error) form.setError(field, { type: "manual", message: issue.message }, { shouldFocus: true });
      }
      return;
    }
    mutation.mutate(parsed.data);
  };

  const errors = form.formState.errors;
  const fieldError = (e: { message?: string; type?: string } | undefined) => (e?.message ? (e.type === "server" ? e.message : f(e.message)) : undefined);
  const code = errorCode(mutation.error);
  const crewStatus = visitStatusOf(mutation.error);
  const unknown = keepsIdempotencyKey(mutation.error);

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: booking.reference })}
      description={refundable === null ? t("bodyNothing") : t("body")}
      confirmLabel={unknown ? t("retry") : refundable === null ? t("submitNothing") : t("submit")}
      tone="danger"
      size="lg"
      pending={mutation.isPending}
      onConfirm={submit}
      returnFocusTo={returnFocusTo}
    >
      <ChangedNotice changed={changed} />
      <section aria-label={t("summaryTitle")} className="flex flex-col gap-2 rounded-md bg-neutral-100 p-4 text-sm">
        {review?.reason_code && <p className="text-ink-900">{t("customerReason", { reason: text.cancelReason(review.reason_code) })}</p>}
        {review?.reason_text && <p className="whitespace-pre-line text-ink-600">“{review.reason_text}”</p>}
        {refundable === null ? (
          <p className="font-medium text-ink-900">{t("nothingTaken")}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {booking.payment && <TermsRow label={t("paid")} value={text.money(booking.payment.captured_fils)} />}
            <TermsRow label={t("refundable")} value={text.money(refundable)} />
          </dl>
        )}
      </section>
      {refundable !== null && (
        <MoneyField
          label={t("amount")}
          hint={t("amountHint", { amount: text.money(refundable) })}
          required
          error={fieldError(errors.refund)}
          {...form.register("refund")}
        />
      )}
      <TextArea label={t("note")} hint={t("noteHint")} required rows={3} maxLength={1000} error={fieldError(errors.note)} {...form.register("note")} />
      {crewStatus ? (
        <Notice tone="danger" title={t("crewTitle")}>
          {t("crewBody", { status: text.visit(crewStatus) })}
        </Notice>
      ) : unknown ? (
        <Notice tone="warning" title={t("unknownTitle")}>
          {t("unknownBody")}
        </Notice>
      ) : code === "VALIDATION_FAILED" || code === "REFUND_AMOUNT_INVALID" ? null : (
        <ActionError error={mutation.error} />
      )}
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
