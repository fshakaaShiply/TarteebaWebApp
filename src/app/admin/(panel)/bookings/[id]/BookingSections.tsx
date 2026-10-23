"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Dog, KeyRound, ParkingSquare, SprayCan, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button, Card, Checkbox, ConfirmDialog, Notice, StatusBadge, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { NOTE_PERMISSIONS } from "@/lib/admin/bookings/actions";
import { NOTE_MAX, approveRequestSchema, customerNoteSchema, internalNoteSchema, type ApproveValues } from "@/lib/admin/bookings/forms";
import {
  addBookingNote,
  approveRescheduleRequest,
  fetchBookingNotifications,
  fetchRefundsByPhone,
  rejectRescheduleRequest,
} from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { CAPACITY_OVERRIDE_PERMISSION } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingDetail, BookingHistoryRow, RescheduleRequest } from "@/lib/admin/types";
import { FormErrorNotice } from "../../catalog/_components/CatalogFields";
import { DeadlineCountdown, Ltr, SlotLabel } from "../_components/BookingBits";
import { useBookingFocusFallback } from "../_components/focus";
import { errorCode, useBookingRefresh } from "../_components/refresh";
import { paymentTone, proposalTone, requestTone, useBookingText } from "../_components/bookingText";
import { CancelBookingDialog, DeclineReviewDialog } from "./BookingActions";

/** A label and its value in a two-column list. */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-sm text-ink-600 sm:w-40">{label}</dt>
      <dd className="min-w-0 text-sm text-ink-900">{children}</dd>
    </div>
  );
}

// ---- Customer, address and flags ------------------------------------------------------------------------------------

export function CustomerCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.detail");
  return (
    <Card title={t("customerTitle")}>
      <dl className="flex flex-col gap-2">
        <Fact label={t("customerName")}>{booking.customer.name || t("noName")}</Fact>
        <Fact label={t("phone")}>
          <a href={`tel:${booking.customer.phone}`}>
            <Ltr>{booking.customer.phone}</Ltr>
          </a>
        </Fact>
      </dl>
    </Card>
  );
}

function Flag({ on, icon, label }: { on: boolean | undefined; icon: ReactNode; label: string }) {
  const t = useTranslations("admin.bookings.detail");
  return (
    <li className={clsx("flex items-center gap-2 text-sm", on ? "text-ink-900" : "text-ink-600")}>
      <span aria-hidden className={clsx("flex size-7 items-center justify-center rounded-pill", on ? "bg-apricot-100 text-warning-700" : "bg-neutral-100")}>
        {icon}
      </span>
      <span>{label}</span>
      <span className="ms-auto inline-flex items-center gap-1 text-xs font-medium">
        {on ? <Check aria-hidden className="size-3.5" /> : <X aria-hidden className="size-3.5" />}
        {on ? t("yes") : t("no")}
      </span>
    </li>
  );
}

export function AddressCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.detail");
  const text = useBookingText();
  const a = booking.address;
  if (!a) {
    return (
      <Card title={t("addressTitle")}>
        <p className="text-sm text-ink-600">{t("noAddress")}</p>
      </Card>
    );
  }
  const line = [a.building, a.unit_number ? t("unit", { unit: a.unit_number }) : null, a.street, a.area].filter(Boolean).join(t("listSeparator"));
  return (
    <Card title={t("addressTitle")}>
      <dl className="flex flex-col gap-2">
        <Fact label={t("addressLabel")}>{a.label || "—"}</Fact>
        <Fact label={t("propertyType")}>{a.property_type ? text.propertyType(String(a.property_type)) : "—"}</Fact>
        <Fact label={t("addressLine")}>{line || "—"}</Fact>
        <Fact label={t("zone")}>{text.name(booking.zone.name)}</Fact>
        {typeof a.lat === "number" && typeof a.lng === "number" && (
          <Fact label={t("location")}>
            <a href={`https://www.google.com/maps?q=${a.lat},${a.lng}`} target="_blank" rel="noopener noreferrer">
              <Ltr>{`${a.lat}, ${a.lng}`}</Ltr>
            </a>
          </Fact>
        )}
        {a.access_instructions && <Fact label={t("access")}>{a.access_instructions}</Fact>}
      </dl>
      <ul className="flex flex-col gap-2 border-t border-line pt-3">
        <Flag on={a.has_pets} icon={<Dog className="size-4" />} label={a.has_pets && a.pets_note ? t("petsWithNote", { note: a.pets_note }) : t("pets")} />
        <Flag on={a.parking_available} icon={<ParkingSquare className="size-4" />} label={t("parking")} />
        <Flag on={a.entry_permit_required} icon={<KeyRound className="size-4" />} label={t("permit")} />
        <Flag on={a.cleaning_materials_available} icon={<SprayCan className="size-4" />} label={t("materialsAtHome")} />
      </ul>
    </Card>
  );
}

// ---- Request details and price --------------------------------------------------------------------------------------

export function RequestCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.detail");
  const text = useBookingText();
  return (
    <Card title={t("requestTitle")}>
      <dl className="flex flex-col gap-2">
        <Fact label={t("service")}>{text.name(booking.service.name)}</Fact>
        <Fact label={t("teamSize")}>{t("workers", { count: booking.workers_count })}</Fact>
        <Fact label={t("when")}>
          {text.date(booking.service_date)} · <SlotLabel name={booking.slot.name} start={booking.slot.start} end={booking.slot.end} />
        </Fact>
        <Fact label={t("materials")}>{text.materials(booking.materials_by)}</Fact>
        <Fact label={t("preferredWorker")}>
          {booking.preferred_worker ? (
            <span className="flex flex-col">
              <span>{booking.preferred_worker.display_name}</span>
              <span className="text-xs text-ink-600">{t("preferredNote")}</span>
            </span>
          ) : (
            t("noPreference")
          )}
        </Fact>
        <Fact label={t("priorities")}>{booking.priorities.length ? booking.priorities.map((p) => text.area(p)).join(t("listSeparator")) : "—"}</Fact>
        <Fact label={t("instructions")}>{booking.instructions ? <span className="whitespace-pre-line">{booking.instructions}</span> : "—"}</Fact>
        <Fact label={t("source")}>{text.source(booking.source, booking.source_label)}</Fact>
        <Fact label={t("created")}>{text.dateTime(booking.created_at)}</Fact>
      </dl>
      {booking.photos.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-medium text-ink-900">{t("photos", { count: booking.photos.length })}</p>
          <ul className="flex flex-wrap gap-2">
            {booking.photos.map((p, i) => {
              const url = typeof p.url === "string" ? p.url : null;
              const thumb = typeof p.thumbnail_url === "string" ? p.thumbnail_url : url;
              return (
                <li key={typeof p.id === "string" ? p.id : i}>
                  {url && thumb ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t("photoLabel", { number: i + 1 })}>
                      {/* Temporary signed URLs of private photos: plain <img>, not next/image. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb} alt="" className="size-20 rounded-md object-cover" />
                    </a>
                  ) : (
                    <span className="text-xs text-ink-600">{t("photoUnavailable")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function PriceCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.detail");
  const text = useBookingText();
  const a = booking.amounts;
  return (
    <Card title={t("priceTitle")}>
      {booking.lines && booking.lines.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {booking.lines.map((line, i) => (
            <li key={`${line.code}-${i}`} className="flex items-start justify-between gap-3">
              <span>
                {text.name(line.description)}
                {line.quantity > 1 && <span className="text-ink-600"> × <Ltr>{line.quantity}</Ltr></span>}
              </span>
              <span className="font-latin whitespace-nowrap">{text.money(line.gross_fils)}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
        <PriceRow label={t("subtotal")} value={text.money(a.subtotal_fils)} />
        {a.addons_fils > 0 && <PriceRow label={t("addons")} value={text.money(a.addons_fils)} />}
        {a.discount_fils > 0 && (
          <PriceRow label={booking.coupon ? t("discountCoupon", { code: booking.coupon.code }) : t("discount")} value={`-${text.money(a.discount_fils)}`} />
        )}
        <PriceRow label={t("net")} value={text.money(a.net_fils)} />
        <PriceRow label={t("vat", { rate: (a.vat_rate_bp / 100).toString() })} value={text.money(a.vat_fils)} />
        <PriceRow label={t("total")} value={text.money(a.total_fils)} strong />
        {booking.reschedule_fee_fils > 0 && <PriceRow label={t("rescheduleFee")} value={text.money(booking.reschedule_fee_fils)} />}
      </dl>
    </Card>
  );
}

function PriceRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={clsx("flex justify-between gap-3", strong && "text-base font-bold text-ink-900")}>
      <dt>{label}</dt>
      <dd className="font-latin whitespace-nowrap">{value}</dd>
    </div>
  );
}

// ---- Payment and refunds --------------------------------------------------------------------------------------------

export function PaymentCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.payment");
  const text = useBookingText();
  const { canAny } = useAdminSession();
  const p = booking.payment;
  const seesRefunds = canAny(["payments.view", "refunds.create"]);
  // Any money taken may have refunds, also ones still processing or failed (refunded_fils counts only those the
  // provider confirmed): a reschedule's price difference, money the booking never accepted, a cancellation.
  const mayHaveRefunds = !!p && (p.captured_fils > 0 || p.refunded_fils > 0 || (booking.cancellation.refund_fils ?? 0) > 0);
  const refunds = useQuery({
    queryKey: adminKeys.bookingRefunds(booking.id),
    queryFn: () => fetchRefundsByPhone(booking.customer.phone),
    enabled: seesRefunds && mayHaveRefunds,
    select: (rows) =>
      rows.filter((r) => r.payment && (r.payment.ulid === p?.id || (r.payment.payable_id === booking.id && (r.payment.payable_type ?? "").includes("booking")))),
  });

  return (
    <Card title={t("title")}>
      {!p ? (
        <p className="text-sm text-ink-600">{t("none")}</p>
      ) : (
        <dl className="flex flex-col gap-2">
          <Fact label={t("status")}>
            <StatusBadge tone={paymentTone[p.status] ?? "neutral"}>{text.payment(p.status, p.status_label)}</StatusBadge>
          </Fact>
          <Fact label={t("amount")}>{text.money(p.amount_fils)}</Fact>
          {p.captured_fils > 0 && <Fact label={t("captured")}>{text.money(p.captured_fils)}</Fact>}
          {p.refunded_fils > 0 && <Fact label={t("refunded")}>{text.money(p.refunded_fils)}</Fact>}
          {p.method && <Fact label={t("method")}>{t.has(`methods.${p.method}`) ? t(`methods.${p.method}`) : p.method}</Fact>}
          {p.gateway_payment_ref && (
            <Fact label={t("reference")}>
              <Ltr className="text-xs">{p.gateway_payment_ref}</Ltr>
            </Fact>
          )}
          <Fact label={t("attempts")}>
            <Ltr>{p.attempts}</Ltr>
          </Fact>
          {p.failure_code && (
            <Fact label={t("failure")}>
              <Ltr className="text-xs">{p.failure_code}</Ltr>
            </Fact>
          )}
        </dl>
      )}
      {p?.needs_review && <Notice tone="warning">{t("needsReview")}</Notice>}
      {p?.status === "verifying" && <Notice tone="info">{t("verifying")}</Notice>}
      {booking.status === "cancelled" && booking.cancellation.party && (
        <dl className="flex flex-col gap-2 border-t border-line pt-3">
          <Fact label={t("cancelledBy")}>{text.party(booking.cancellation.party)}</Fact>
          {booking.cancel_reason_code && <Fact label={t("cancelReason")}>{text.cancelReason(booking.cancel_reason_code)}</Fact>}
          {booking.cancellation.fee_fils !== null && <Fact label={t("cancelFee")}>{text.money(booking.cancellation.fee_fils)}</Fact>}
          {booking.cancellation.refund_fils !== null && <Fact label={t("cancelRefund")}>{text.money(booking.cancellation.refund_fils)}</Fact>}
        </dl>
      )}
      {refunds.data && refunds.data.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-bold text-ink-900">{t("refundsTitle")}</p>
          <ul className="flex flex-col gap-2">
            {refunds.data.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-latin font-bold">{text.money(r.amount_fils)}</span>
                  <StatusBadge tone={r.status === "succeeded" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{text.name(r.status_label)}</StatusBadge>
                </span>
                <span className="text-xs text-ink-600">
                  {text.name(r.reason_label)} · {text.dateTime(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!seesRefunds && booking.cancellation.refund_fils !== null && booking.cancellation.refund_fils > 0 && (
        <p className="text-xs text-ink-600">{t("refundStatusFinance")}</p>
      )}
    </Card>
  );
}

// ---- Cancellation review task ---------------------------------------------------------------------------------------

/**
 * A customer's cancellation waiting for staff (spec §10.4): cancel with a refund decision, or keep the booking.
 *
 * Deciding the refund takes bookings.cancel and refunds.create together; under the seeded roles only a system admin
 * holds both (coordinators cancel, accountants decide refunds), so the note names who can act (backend request: let
 * the finance role resolve these reviews).
 */
export function CancelReviewTask({ booking, onStale }: { booking: BookingDetail; onStale: () => void }) {
  const t = useTranslations("admin.bookings.review");
  const text = useBookingText();
  const { can } = useAdminSession();
  const fallback = useBookingFocusFallback();
  // The booking as it was when a dialog opened (its version is the If-Match); the dialog stays while the review closes.
  const [open, setOpen] = useState<{ action: "cancel" | "decline"; booking: BookingDetail } | null>(null);
  const review = booking.cancellation.review;
  const changed = open !== null && open.booking.version !== booking.version;
  const dialogs = (
    <>
      {open?.action === "cancel" && <CancelBookingDialog booking={open.booking} changed={changed} returnFocusTo={fallback} onClose={() => setOpen(null)} onStale={onStale} />}
      {open?.action === "decline" && <DeclineReviewDialog booking={open.booking} changed={changed} returnFocusTo={fallback} onClose={() => setOpen(null)} onStale={onStale} />}
    </>
  );
  if (!booking.cancellation.review_requested_at) return dialogs;
  const canCancel = can("bookings.cancel");
  const decidesRefund = can("refunds.create");

  return (
    <Notice
      tone="warning"
      title={t("taskTitle")}
      action={
        canCancel ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="danger" onClick={() => setOpen({ action: "cancel", booking })}>
              {t("cancelWithRefund")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen({ action: "decline", booking })}>
              {t("keep")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <p>{t("taskBody", { time: text.dateTime(booking.cancellation.review_requested_at) })}</p>
      {review?.reason_code && <p>{t("reason", { reason: text.cancelReason(review.reason_code) })}</p>}
      {review?.reason_text && <p className="whitespace-pre-line">“{review.reason_text}”</p>}
      {canCancel && !decidesRefund && <p>{t("needsRefundDecider")}</p>}
      {!canCancel && decidesRefund && <p>{t("needsCancelPermission")}</p>}
      {!canCancel && !decidesRefund && <p>{t("needsBoth")}</p>}
      {dialogs}
    </Notice>
  );
}

// ---- Alternative proposals ------------------------------------------------------------------------------------------

export function ProposalsCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.proposals");
  const text = useBookingText();
  if (booking.alternative_proposals.length === 0) return null;
  return (
    <Card title={t("title")}>
      <ul className="flex flex-col gap-3">
        {booking.alternative_proposals.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={proposalTone[p.status] ?? "neutral"}>{text.proposal(p.status, p.status_label)}</StatusBadge>
              <span className="text-xs text-ink-600">{t("sent", { time: text.dateTime(p.created_at) })}</span>
              {p.is_open && (
                <span className="flex items-center gap-1 text-xs text-ink-600">
                  {t("answerBy", { time: text.dateTime(p.expires_at) })}
                  <DeadlineCountdown deadline={p.expires_at} />
                </span>
              )}
            </div>
            <ol className="flex flex-col gap-1 text-sm">
              {p.options.map((o) => (
                <li key={o.index} className={clsx("flex flex-wrap items-center justify-between gap-2 rounded-sm px-2 py-1", p.accepted_option === o.index && "bg-sage-100")}>
                  <span>
                    {t("option", { number: o.index + 1 })}: {text.dateShort(o.service_date)} · <SlotLabel name={o.slot.name} start={o.slot.start} end={o.slot.end} />
                    {o.note && <span className="text-ink-600"> · {o.note}</span>}
                  </span>
                  <span className="font-latin text-xs text-ink-600">
                    {text.money(o.total_fils)} ·{" "}
                    {o.price_diff_fils === 0 ? t("samePrice") : o.price_diff_fils < 0 ? t("cheaper", { amount: text.money(-o.price_diff_fils) }) : t("dearer", { amount: text.money(o.price_diff_fils) })}
                    {p.accepted_option === o.index && ` · ${t("accepted")}`}
                  </span>
                </li>
              ))}
            </ol>
            {p.note && <p className="text-sm text-ink-600">{t("note", { note: p.note })}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---- Customer reschedule requests ----------------------------------------------------------------------------------

export function RescheduleRequestsCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.requests");
  const text = useBookingText();
  const { can } = useAdminSession();
  const [deciding, setDeciding] = useState<{ request: RescheduleRequest; action: "approve" | "reject" } | null>(null);
  const fallback = useBookingFocusFallback();
  const requests = booking.reschedule_requests;
  if (requests.length === 0) return null;
  const canDecide = can("bookings.reschedule");

  return (
    <Card title={t("title")}>
      <ul className="flex flex-col gap-3">
        {requests.map((r) => (
          <li key={r.id} className={clsx("flex flex-col gap-2 rounded-md border p-3", r.status === "pending" ? "border-apricot-400" : "border-line")}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={requestTone[r.status] ?? "neutral"}>{text.request(r.status, r.status_label)}</StatusBadge>
              <span className="text-xs text-ink-600">
                {t(r.requested_by_type === "staff" ? "byStaff" : "byCustomer", { time: text.dateTime(r.created_at) })}
              </span>
            </div>
            <p className="text-sm">
              {t("move", {
                from: `${text.dateShort(r.from.service_date)} ${r.from.slot.start ?? ""}`.trim(),
                to: `${text.dateShort(r.to.service_date)} ${r.to.slot.start ?? ""}`.trim(),
              })}
            </p>
            <p className="text-xs text-ink-600">
              {t("money", { fee: text.money(r.fee_fils), diff: text.money(r.price_diff_fils), total: text.money(r.new_total_fils) })}
            </p>
            {r.reason && <p className="text-sm text-ink-600">{t("reason", { reason: r.reason })}</p>}
            {r.decision_note && <p className="text-sm text-ink-600">{t("decisionNote", { note: r.decision_note })}</p>}
            {r.status === "pending" && canDecide && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDeciding({ request: r, action: "approve" })}>
                  {t("approve")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeciding({ request: r, action: "reject" })}>
                  {t("reject")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {deciding?.action === "approve" && <ApproveRequestDialog request={deciding.request} returnFocusTo={fallback} onClose={() => setDeciding(null)} />}
      {deciding?.action === "reject" && <RejectRequestDialog request={deciding.request} returnFocusTo={fallback} onClose={() => setDeciding(null)} />}
    </Card>
  );
}

function ApproveRequestDialog({ request, onClose, returnFocusTo }: { request: RescheduleRequest; onClose: () => void; returnFocusTo: HTMLElement | null }) {
  const t = useTranslations("admin.bookings.requests");
  const f = useTranslations("admin.bookings.formErrors");
  const toast = useToast();
  const refresh = useBookingRefresh();
  const keys = useIdempotencyKeys();
  const { can } = useAdminSession();
  const canOverride = can(CAPACITY_OVERRIDE_PERMISSION);
  const form = useForm<ApproveValues>({ resolver: zodResolver(approveRequestSchema) as never, defaultValues: { note: "", override: false, reason: "" } });
  const override = useWatch({ control: form.control, name: "override" });
  const mutation = useMutation({
    mutationFn: (input: { note: string | null; override?: boolean; reason?: string }) =>
      approveRescheduleRequest(request.id, input, keys.keyFor({ approve: request.id, ...input })),
    onSuccess: () => {
      keys.settle();
      refresh();
      toast.success(t("approved"));
      onClose();
    },
    onError: (error) => {
      keys.settle(error);
      applyFieldErrors(error, form.setError, ["note", "reason"]);
    },
  });
  const errors = form.formState.errors;
  const code = errorCode(mutation.error);
  const msg = (e: { message?: string; type?: string } | undefined) => (e?.message ? (e.type === "server" ? e.message : f(e.message)) : undefined);

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("approveTitle")}
      description={t("approveBody")}
      confirmLabel={t("approve")}
      pending={mutation.isPending}
      returnFocusTo={returnFocusTo}
      onConfirm={() => void form.handleSubmit((v) => mutation.mutate(v as never))()}
    >
      <TextArea label={t("note")} hint={t("noteHint")} rows={2} maxLength={1000} error={msg(errors.note)} {...form.register("note")} />
      {(code === "SLOT_FULL" || code === "SLOT_CLOSED") && (
        <Notice tone="danger" title={t("fullTitle")}>
          {canOverride ? t("fullOverride") : t("fullNoOverride")}
        </Notice>
      )}
      {canOverride && (
        <>
          <Checkbox label={t("override")} {...form.register("override")} />
          {override && (
            <TextArea label={t("overrideReason")} hint={t("overrideReasonHint")} required rows={2} maxLength={1000} error={msg(errors.reason)} {...form.register("reason")} />
          )}
        </>
      )}
      {code !== "SLOT_FULL" && code !== "SLOT_CLOSED" && !(mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED") && (
        <FormErrorNotice error={mutation.error} fieldsApplied={false} />
      )}
    </ConfirmDialog>
  );
}

function RejectRequestDialog({ request, onClose, returnFocusTo }: { request: RescheduleRequest; onClose: () => void; returnFocusTo: HTMLElement | null }) {
  const t = useTranslations("admin.bookings.requests");
  const f = useTranslations("admin.bookings.formErrors");
  const toast = useToast();
  const refresh = useBookingRefresh();
  const form = useForm<{ note: string }>({ resolver: zodResolver(customerNoteSchema) as never, defaultValues: { note: "" } });
  const mutation = useMutation({
    mutationFn: (note: string) => rejectRescheduleRequest(request.id, note),
    onSuccess: () => {
      refresh();
      toast.success(t("rejected"));
      onClose();
    },
    onError: (error) => applyFieldErrors(error, form.setError, ["note"]),
  });
  const error = form.formState.errors.note;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("rejectTitle")}
      description={t("rejectBody")}
      confirmLabel={t("reject")}
      tone="danger"
      pending={mutation.isPending}
      returnFocusTo={returnFocusTo}
      onConfirm={() => void form.handleSubmit((note) => mutation.mutate(note as unknown as string))()}
    >
      <TextArea
        label={t("rejectNote")}
        hint={t("rejectNoteHint")}
        required
        rows={3}
        maxLength={1000}
        error={error?.message ? (error.type === "server" ? error.message : f(error.message)) : undefined}
        {...form.register("note")}
      />
      {!(mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED") && <FormErrorNotice error={mutation.error} fieldsApplied={false} />}
    </ConfirmDialog>
  );
}

// ---- Internal notes -------------------------------------------------------------------------------------------------

/** Staff-only notes (never shown to customers): list, and add with any booking-operations permission. */
export function NotesCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.notes");
  const f = useTranslations("admin.bookings.formErrors");
  const text = useBookingText();
  const toast = useToast();
  const refresh = useBookingRefresh();
  const { canAny } = useAdminSession();
  const canAdd = canAny(NOTE_PERMISSIONS);
  const form = useForm<{ body: string }>({ resolver: zodResolver(internalNoteSchema) as never, defaultValues: { body: "" } });
  const mutation = useMutation({
    mutationFn: (body: string) => addBookingNote(booking.id, body),
    onSuccess: () => {
      form.reset({ body: "" });
      refresh();
      toast.success(t("added"));
    },
    onError: (error) => applyFieldErrors(error, form.setError, ["body"]),
  });
  const error = form.formState.errors.body;
  const describe = useAdminErrorMessage();

  return (
    <Card title={t("title")}>
      <p className="text-xs text-ink-600">{t("private")}</p>
      {booking.notes.length === 0 ? (
        <p className="text-sm text-ink-600">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {booking.notes.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 rounded-md bg-neutral-100 p-3">
              <span className="text-xs text-ink-600">
                {n.author.name} · {text.dateTime(n.created_at)}
              </span>
              <p className="text-sm/6 whitespace-pre-line text-ink-900">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form noValidate onSubmit={form.handleSubmit((body) => mutation.mutate(body as unknown as string))} className="flex flex-col gap-2">
          <TextArea
            label={t("add")}
            rows={2}
            maxLength={NOTE_MAX}
            error={error?.message ? (error.type === "server" ? error.message : f(error.message)) : undefined}
            {...form.register("body")}
          />
          <Button type="submit" size="sm" variant="secondary" className="self-start" loading={mutation.isPending}>
            {t("save")}
          </Button>
          {mutation.error && !(mutation.error instanceof AdminApiError && mutation.error.code === "VALIDATION_FAILED") ? (
            <Notice tone="danger">{describe(mutation.error)}</Notice>
          ) : null}
        </form>
      )}
    </Card>
  );
}

// ---- Notifications sent ---------------------------------------------------------------------------------------------

/**
 * The booking's delivery log (spec §17 A03 "notifications sent log"): what went to the customer and staff, on which
 * channel, and the delivery status. Loaded when opened. The API never sends the destination, only the text and codes.
 */
export function NotificationsCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.deliveries");
  const text = useBookingText();
  const describe = useAdminErrorMessage();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: adminKeys.bookingNotifications(booking.id, page),
    queryFn: () => fetchBookingNotifications(booking.id, page),
    enabled: open,
  });
  return (
    <Card>
      <details onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-lg/7 font-bold text-ink-900">{t("title")}</summary>
        <div className="mt-3 flex flex-col gap-3">
          {log.isPending ? (
            <p className="text-sm text-ink-600">{t("loading")}</p>
          ) : log.isError ? (
            <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={() => void log.refetch()}>{t("retry")}</Button>}>
              {describe(log.error)}
            </Notice>
          ) : log.data.data.length === 0 ? (
            <p className="text-sm text-ink-600">{t("empty")}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {log.data.data.map((n) => (
                  <li key={n.id} className="flex flex-col gap-0.5 rounded-md border border-line px-3 py-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink-900">{n.event_label}</span>
                      <StatusBadge tone={n.status === "failed" ? "danger" : n.status === "delivered" || n.status === "read" ? "success" : "neutral"}>
                        {n.status_label}
                      </StatusBadge>
                    </span>
                    <span className="text-xs text-ink-600">
                      {t("line", {
                        channel: n.channel_label,
                        recipient: n.recipient.name ?? (n.recipient.type === "customer" ? t("customer") : t("staff")),
                        time: text.dateTime(n.created_at),
                      })}
                      {n.error ? ` · ${n.error}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {log.data.meta.last_page > 1 && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    {t("newer")}
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= log.data.meta.last_page} onClick={() => setPage((p) => p + 1)}>
                    {t("older")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </details>
    </Card>
  );
}

// ---- History --------------------------------------------------------------------------------------------------------

export function HistoryCard({ booking }: { booking: BookingDetail }) {
  const t = useTranslations("admin.bookings.history");
  const text = useBookingText();
  const status = (row: BookingHistoryRow, value: string | null) =>
    value === null ? "—" : row.scope === "visit" ? text.visit(value) : text.status(value);
  // Reason codes: our labels for the history's own reasons, else a rejection or cancellation reason, else the code.
  const reason = (code: string | null) => (code ? (t.has(`reasons.${code}`) ? t(`reasons.${code}`) : text.cancelReason(code)) : null);

  return (
    <Card title={t("title")}>
      {booking.history.length === 0 ? (
        <p className="text-sm text-ink-600">{t("empty")}</p>
      ) : (
        <ol className="flex flex-col">
          {booking.history.map((row) => (
            <li key={row.id} className="relative flex gap-3 pb-4 last:pb-0">
              <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-pill bg-petrol-700" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm text-ink-900">
                  <span className="font-medium">{row.scope === "visit" ? t("visit") : t("booking")}</span>
                  {": "}
                  {row.from_status === row.to_status ? reason(row.reason) ?? status(row, row.to_status) : t("change", { from: status(row, row.from_status), to: status(row, row.to_status) })}
                </p>
                <p className="text-xs text-ink-600">
                  {text.dateTime(row.created_at)} · {t.has(`actors.${row.actor_type}`) ? t(`actors.${row.actor_type}`) : row.actor_type}
                  {row.from_status !== row.to_status && reason(row.reason) ? ` · ${reason(row.reason)}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
