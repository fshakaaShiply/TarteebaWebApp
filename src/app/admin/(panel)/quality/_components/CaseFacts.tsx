"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, CustomerLink, StarRating, StatusBadge } from "@/components/admin";
import { Ltr } from "../../bookings/_components/BookingBits";
import { PAYMENTS_PATH, SUBSCRIPTIONS_PATH, SUBSCRIPTIONS_READ } from "@/lib/admin/nav";
import { compensationTone, useQualityText } from "@/lib/admin/quality/labels";
import type { AdminCaseDetail, Compensation } from "@/lib/admin/quality/types";
import { useAdminSession } from "@/lib/admin/session";
import { AttachmentList } from "./AttachmentLink";

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className="min-w-0 text-ink-900 sm:text-end">{children}</dd>
    </div>
  );
}

/**
 * A09 for the case's payment. The API's `link` (payments.view only) is `/admin/finance/payments/{ulid}`, but the payment
 * page is addressed by number, so the payments list is opened on that one payment: its `reference` filter matches the
 * payment's own ULID or the provider's reference (PaymentFilters), never the booking's or the series' reference.
 */
function casePaymentHref(link: string | null): string | null {
  const ulid = link?.match(/\/payments\/([0-9a-z]{26})\/?$/i)?.[1];
  return ulid ? `${PAYMENTS_PATH}?reference=${encodeURIComponent(ulid)}` : null;
}

/** What the case is about: the customer, the booking and its visit, the series, the money and the workers named. */
export function CaseFacts({ c }: { c: AdminCaseDetail }) {
  const t = useTranslations("admin.quality.facts");
  const text = useQualityText();
  const { can, canAny } = useAdminSession();
  const b = c.booking;
  const p = c.payment;
  const paymentHref = p ? casePaymentHref(p.link) : null;
  return (
    <Card title={t("title")}>
      <dl className="flex flex-col gap-2 text-sm">
        <Fact label={t("customer")}>
          <CustomerLink customer={c.customer} />
          {c.customer.phone && (
            <span className="block text-xs text-ink-600">
              <Ltr>{c.customer.phone}</Ltr>
            </span>
          )}
          {(c.customer.status === "pending_deletion" || c.customer.status === "deleted") && (
            <span className="mt-0.5 block">
              <StatusBadge tone="danger">{t(`customerStatus.${c.customer.status}`)}</StatusBadge>
            </span>
          )}
        </Fact>
        <Fact label={t("source")}>{text.source(c.source, c.source_label)}</Fact>
        {!c.customer_visible && <Fact label={t("visibility")}>{t("hiddenFromCustomer")}</Fact>}
        {b ? (
          <>
            <Fact label={t("booking")}>
              {can("bookings.view") ? (
                <Link href={`/admin/bookings/${b.id}`} className="font-medium">
                  <Ltr>{b.reference}</Ltr>
                </Link>
              ) : (
                <Ltr>{b.reference}</Ltr>
              )}
              <span className="block text-xs text-ink-600">
                {text.kind(b.kind, b.kind_label)} · {text.name(b.status_label)}
              </span>
            </Fact>
            <Fact label={t("visit")}>
              {text.date(b.service_date)} · {text.name(b.slot.name)} <Ltr>{`${b.slot.start}–${b.slot.end}`}</Ltr>
              <span className="block text-xs text-ink-600">{text.name(b.service.name)}</span>
            </Fact>
            {c.visit && (
              <Fact label={t("visitStatus")}>
                {text.name(c.visit.status_label)}
                {c.visit.late_minutes ? <span className="block text-xs text-ink-600">{t("late", { minutes: c.visit.late_minutes })}</span> : null}
              </Fact>
            )}
          </>
        ) : (
          <Fact label={t("booking")}>{t("noBooking")}</Fact>
        )}
        {c.subscription && (
          <Fact label={t("subscription")}>
            {canAny([...SUBSCRIPTIONS_READ]) ? (
              <Link href={`${SUBSCRIPTIONS_PATH}/${c.subscription.id}`} className="font-medium">
                <Ltr>{c.subscription.reference}</Ltr>
              </Link>
            ) : (
              <Ltr>{c.subscription.reference}</Ltr>
            )}
          </Fact>
        )}
        {c.workers.length > 0 && <Fact label={t("workers")}>{text.list(c.workers.map((w) => w.name))}</Fact>}
        {c.driver && <Fact label={t("driver")}>{c.driver.name ?? `#${c.driver.id}`}</Fact>}
        {c.merged_into && <Fact label={t("mergedInto")}>{c.merged_into.reference}</Fact>}
      </dl>
      {p && (
        <section aria-labelledby={`case-payment-${c.id}`} className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 id={`case-payment-${c.id}`} className="text-sm font-bold text-ink-900">
            {t("payment")}
          </h3>
          <dl className="flex flex-col gap-2 text-sm">
            <Fact label={t("paymentStatus")}>{text.name(p.status_label)}</Fact>
            {p.payable_reference && (
              <Fact label={t("payable")}>
                <Ltr>{p.payable_reference}</Ltr>
              </Fact>
            )}
            <Fact label={t("captured")}>{text.money(p.captured_fils)}</Fact>
            <Fact label={t("refunded")}>{text.money(p.refunded_fils)}</Fact>
            {p.disputed_fils > 0 && <Fact label={t("disputed")}>{text.money(p.disputed_fils)}</Fact>}
            <Fact label={t("refundable")}>{text.money(p.refundable_fils)}</Fact>
            <Fact label={t("refundTo")}>{t(`destination.${p.destination}`)}</Fact>
          </dl>
          {paymentHref && (
            <Link href={paymentHref} className="w-fit text-sm font-bold">
              {t("openPayment")}
            </Link>
          )}
        </section>
      )}
    </Card>
  );
}

/** The rating behind a case (a low rating's follow-up, or a rating noted on a complaint). */
export function CaseRatingCard({ c, onRefreshFiles, refreshingFiles }: { c: AdminCaseDetail; onRefreshFiles: () => void; refreshingFiles?: boolean }) {
  const t = useTranslations("admin.quality.rating");
  const r = c.rating;
  if (!r) return null;
  const parts = (["quality", "punctuality", "conduct"] as const).filter((k) => r[k] !== null);
  return (
    <Card title={t("title")}>
      <div className="flex flex-wrap items-center gap-3">
        <StarRating value={r.overall} showValue size="lg" />
        {r.excluded && <StatusBadge tone="neutral">{t("excluded")}</StatusBadge>}
        {r.request_same_worker && <StatusBadge tone="confirmed">{t("sameWorker")}</StatusBadge>}
      </div>
      {parts.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {parts.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <dt className="text-ink-600">{t(`scores.${k}`)}</dt>
              <dd>
                <StarRating value={r[k]} size="sm" />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {r.comment ? <p className="whitespace-pre-wrap rounded-md bg-ivory-50 p-3 text-sm">“{r.comment}”</p> : <p className="text-sm text-ink-600">{t("noComment")}</p>}
      <AttachmentList files={r.photos} onRefresh={onRefreshFiles} refreshing={refreshingFiles} />
    </Card>
  );
}

/** One compensation as the case and the accountant's queue show it. */
export function CompensationSummary({ compensation: k, showCase = false }: { compensation: Compensation; showCase?: boolean }) {
  const t = useTranslations("admin.quality.compensation");
  const text = useQualityText();
  const { can } = useAdminSession();
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-ink-900">
          {text.compensationType(k.type, k.type_label)}
          {k.type !== "free_visit" && ` · ${text.money(k.amount_fils)}`}
        </span>
        <StatusBadge tone={compensationTone[k.status]}>{text.compensationStatus(k.status, k.status_label)}</StatusBadge>
        {k.destination && <span className="text-xs text-ink-600">{t(`destination.${k.destination}`)}</span>}
      </div>
      {showCase && k.case && (
        <p className="text-xs text-ink-600">
          <Link href={`/admin/quality/${k.case.id}`} className="font-medium">
            <Ltr>{k.case.reference}</Ltr>
          </Link>
          {" · "}
          {text.category(k.case.category)}
        </p>
      )}
      {k.note && <p className="text-ink-900">“{k.note}”</p>}
      <p className="text-xs text-ink-600">
        {k.proposed_by ? t("proposedBy", { name: k.proposed_by.name, time: text.dateTime(k.proposed_at) }) : text.dateTime(k.proposed_at)}
        {k.decided_by && k.decided_at ? ` · ${t("decidedBy", { name: k.decided_by.name, time: text.dateTime(k.decided_at) })}` : ""}
      </p>
      {k.decision_note && <p className="text-xs text-ink-600">{t("decisionNote", { note: k.decision_note })}</p>}
      {k.refund && (
        <p className="text-xs text-ink-600">{t("refund", { status: text.name(k.refund.status_label) })}</p>
      )}
      {k.recovery_booking && (
        <p className="text-xs text-ink-600">
          {t("recovery", { date: text.date(k.recovery_booking.service_date) })}{" "}
          {can("bookings.view") ? (
            <Link href={`/admin/bookings/${k.recovery_booking.id}`} className="font-medium">
              <Ltr>{k.recovery_booking.reference}</Ltr>
            </Link>
          ) : (
            <Ltr>{k.recovery_booking.reference}</Ltr>
          )}
        </p>
      )}
      {k.status === "executed" && !k.settled_at && <p className="text-xs text-warning-700">{t("notSettled")}</p>}
      {k.status === "failed" && k.failure_code && <p className="text-xs font-medium text-danger-700">{t(`failure.${k.failure_code}`)}</p>}
      {k.reinstated_at && <p className="text-xs text-ink-600">{t("reinstated", { time: text.dateTime(k.reinstated_at) })}</p>}
    </div>
  );
}
