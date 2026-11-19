"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, EmptyState, ErrorState, LoadingBlock, Notice, StatusBadge } from "@/components/admin";
import { fetchPayment } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { canRefund } from "@/lib/admin/finance/refund";
import { refundKeysFor } from "@/lib/admin/finance/refundKeys";
import type { IdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { BILLING_REFUSALS_PATH, INVOICES_PATH, PAYMENTS_PATH, RECONCILIATION_PATH } from "@/lib/admin/nav";
import { itemTone } from "@/lib/admin/finance/reconciliation";
import { useAdminSession } from "@/lib/admin/session";
import type { AdminPaymentDetail, AdminRefund, InvoiceStatus, PaymentEvent } from "@/lib/admin/types";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { paymentTone } from "../../../bookings/_components/bookingText";
import { BackLink, Code, CreditNoteNumber, Fact, Facts, Money, PayableRef, RefundContextLabel, RefundDestination, ReviewBadge, TotalRow } from "../../_components/FinanceParts";
import { invoiceTone, refundTone, useFinanceText } from "../../_components/financeText";
import { ClearReviewDialog } from "../../_components/ClearReviewDialog";
import { useReconText } from "../../reconciliation/_components/ReconParts";
import { RefundDialog } from "./RefundDialog";

/**
 * A09 payment page (spec §10.4, §17 "payment detail with event log"; payments.view): what it paid for (the booking's
 * reference), amounts (captured, refunded and what is left to refund), the provider's details and status, the refunds
 * with the provider's status and credit note each, its tax invoice, and every gateway call and webhook with its
 * scrubbed payload. Review and release reasons are the API's words, the code kept as detail. A refund needs
 * refunds.create.
 */
export function PaymentDetailScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={["payments.view"]}>
      {/* Keyed by id: another payment's page never inherits this one's refund key or dialog. */}
      <PaymentDetailContent key={id} id={id} />
    </RequirePermission>
  );
}

function PaymentDetailContent({ id }: { id: string }) {
  const t = useTranslations("admin.finance.payment");
  const describe = useAdminErrorMessage();
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  // No timed refresh (StaffIdleTimeout counts admin reads as activity): it refreshes on focus, after a refund and on demand.
  const payment = useQuery({
    queryKey: adminKeys.payment(numericId ?? 0),
    queryFn: () => fetchPayment(numericId as number),
    enabled: numericId !== null,
    refetchOnWindowFocus: true,
  });
  /*
   * The refund key store lives above the loading/error switch, so a failed refresh (the refund's own refresh after a
   * lost answer, or one on window focus) never drops the key of a refund whose outcome is unknown. The attempt is also
   * kept for this tab (refundKeys.ts), so a reload offers the same refund again instead of a new one.
   */
  const [refundKeys] = useState(() => (numericId === null ? null : refundKeysFor(numericId)));
  const data = payment.data;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink href={PAYMENTS_PATH}>{t("back")}</BackLink>
        {data && (
          <Button variant="ghost" size="sm" onClick={() => void payment.refetch()} loading={payment.isFetching} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {numericId === null || refundKeys === null ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : data ? (
        <>
          {/* A refresh that failed keeps the page (and an open refund dialog) as last loaded. */}
          {payment.isError && (
            <Notice
              tone="danger"
              title={t("refreshFailed")}
              action={
                <Button variant="secondary" size="sm" className="self-start" onClick={() => void payment.refetch()} loading={payment.isFetching}>
                  {t("refreshRetry")}
                </Button>
              }
            >
              {describe(payment.error)}
            </Notice>
          )}
          <PaymentView payment={data} refundKeys={refundKeys} />
        </>
      ) : payment.isError ? (
        <Card>
          <ErrorState error={payment.error} onRetry={() => void payment.refetch()} />
        </Card>
      ) : (
        <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />
      )}
    </>
  );
}

function PaymentView({ payment, refundKeys }: { payment: AdminPaymentDetail; refundKeys: IdempotencyKeys }) {
  const t = useTranslations("admin.finance.payment");
  const text = useFinanceText();
  const { can } = useAdminSession();
  const [refunding, setRefunding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const refundable = canRefund(payment);
  const verifying = payment.status === "verifying";

  return (
    <>
      <section aria-labelledby="payment-title" className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            {/* A provider reference is one long word: it wraps instead of widening the page on a phone. */}
            <h1 id="payment-title" className="text-[26px]/[34px] font-bold text-ink-900">
              <span className="sr-only">{t("titlePrefix")} </span>
              <Code wrap>{payment.gateway_payment_ref ?? payment.ulid}</Code>
            </h1>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={paymentTone[payment.status] ?? "neutral"}>
                <span className="sr-only">{t("providerStatus")} </span>
                {text.payment(payment.status, payment.status_label)}
              </StatusBadge>
              {payment.needs_review && <ReviewBadge />}
            </span>
            <p className="text-sm text-ink-600">
              {t("summary", { amount: text.money(payment.amount_fils), date: text.dateTime(payment.created_at) })}
            </p>
            <p className="text-sm text-ink-900">
              <PayableRef payable={payment.payable} />
            </p>
          </div>
          {can("refunds.create") && (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={() => setRefunding(true)} disabled={!refundable} icon={<Undo2 aria-hidden className="size-4" />}>
                {t("refund")}
              </Button>
              {!refundable && <p className="max-w-xs text-end text-xs text-ink-600">{t("refundUnavailable")}</p>}
            </div>
          )}
        </div>
        {payment.needs_review && (
          <Notice
            tone="warning"
            title={t("reviewTitle")}
            action={
              // Closing the flag needs reconciliation.run; a payment the provider has not settled yet can't be closed.
              can("reconciliation.run") ? (
                <span className="flex flex-col items-start gap-1">
                  <Button variant="secondary" size="sm" onClick={() => setClearing(true)} disabled={verifying}>
                    {t("clearFlag")}
                  </Button>
                  {verifying && <span className="text-xs font-normal">{t("clearFlagVerifying")}</span>}
                </span>
              ) : undefined
            }
          >
            <p>
              {t("reviewReason")} {payment.review_reason_label ? text.name(payment.review_reason_label) : t("reviewReasonUnknown")}
            </p>
            {payment.review_reason && (
              <Code wrap className="text-xs font-normal opacity-80">
                {payment.review_reason}
              </Code>
            )}
          </Notice>
        )}
        {!payment.needs_review && payment.review?.cleared_at && (
          <Notice tone="neutral">
            {t("reviewCleared", { time: text.dateTime(payment.review.cleared_at) })}
            {typeof payment.review.cleared_by?.name === "string" && payment.review.cleared_by.name !== "" && <> · {payment.review.cleared_by.name}</>}
            {payment.review.note && <> · “{payment.review.note}”</>}
          </Notice>
        )}
        {payment.status === "verifying" && (
          <Notice tone="info">{t("verifying", { since: text.dateTime(payment.verifying_since ?? payment.updated_at) })}</Notice>
        )}
        {payment.status === "failed" && (payment.failure_code || payment.failure_message) && (
          <Notice tone="danger" title={t("failedTitle")}>
            {payment.failure_message && <p>{payment.failure_message}</p>}
            {payment.failure_code && (
              <Code wrap className="text-xs">
                {payment.failure_code}
              </Code>
            )}
          </Notice>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
          <AmountsCard payment={payment} />
          <RefundsCard refunds={payment.refunds} />
          <EventsCard events={payment.events} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <PayerCard payment={payment} />
          <ProviderCard payment={payment} />
          <ReconciliationCard payment={payment} />
          <InvoiceCard payment={payment} />
        </div>
      </div>

      {refunding && <RefundDialog payment={payment} keys={refundKeys} onClose={() => setRefunding(false)} />}
      {clearing && <ClearReviewDialog target={{ kind: "payment", id: payment.id, version: payment.version }} onClose={() => setClearing(false)} />}
    </>
  );
}

function AmountsCard({ payment }: { payment: AdminPaymentDetail }) {
  const t = useTranslations("admin.finance.payment.amounts");
  return (
    <Card title={t("title")}>
      <dl className="flex flex-col gap-2">
        <TotalRow label={t("net")} fils={payment.net_fils} />
        <TotalRow label={t("vat")} fils={payment.vat_fils} />
        {payment.discount_fils > 0 && <TotalRow label={t("discount")} fils={payment.discount_fils} />}
        <TotalRow label={t("amount")} fils={payment.amount_fils} strong />
      </dl>
      <dl className="flex flex-col gap-2 border-t border-line pt-3">
        <TotalRow label={t("captured")} fils={payment.captured_fils} />
        <TotalRow label={t("refunded")} fils={payment.refunded_fils} />
        {/* A chargeback the provider reported: held out of what can be refunded until it is reversed (P5-F59). */}
        {(payment.disputed_fils ?? 0) > 0 && <TotalRow label={t("disputed")} fils={payment.disputed_fils ?? 0} />}
        <TotalRow label={t("refundable")} fils={payment.refundable_fils} strong />
        {payment.fee_fils !== null && <TotalRow label={t("fee")} fils={payment.fee_fils} />}
        {payment.net_settled_fils !== null && <TotalRow label={t("netSettled")} fils={payment.net_settled_fils} />}
      </dl>
      <p className="text-xs text-ink-600">{(payment.disputed_fils ?? 0) > 0 ? t("refundableNoteDisputed") : t("refundableNote")}</p>
    </Card>
  );
}

/** Where this payment stands in the provider's settlement reports: each line of an active run that names it (at most 50). */
function ReconciliationCard({ payment }: { payment: AdminPaymentDetail }) {
  const t = useTranslations("admin.finance.payment.reconciliation");
  const text = useFinanceText();
  const label = useReconText();
  const { canAny } = useAdminSession();
  const rows = payment.reconciliation ?? [];
  if (rows.length === 0) return null;
  const linked = canAny(["reconciliation.run", "payments.view"]);
  return (
    <Card title={t("title")}>
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.item_id} className="flex flex-col gap-1 border-t border-line py-2.5 text-sm first:border-t-0 first:pt-0 last:pb-0">
            <span className="flex flex-wrap items-center gap-2">
              {linked ? (
                <Link href={`${RECONCILIATION_PATH}/${r.run_id}`} className="font-medium">
                  {t("run", { date: text.date(r.report_date) })}
                </Link>
              ) : (
                <span className="font-medium">{t("run", { date: text.date(r.report_date) })}</span>
              )}
              <StatusBadge tone={itemTone[r.status as keyof typeof itemTone] ?? "neutral"}>{label.item(r.status as never)}</StatusBadge>
            </span>
            <span className="text-xs text-ink-600">
              {label.line(r.line_type)} · {label.reason(r.reason_code)} · {r.resolved ? t("resolved") : r.status === "matched" ? t("matched") : t("needsAction")}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PayerCard({ payment }: { payment: AdminPaymentDetail }) {
  const t = useTranslations("admin.finance.payment");
  return (
    <Card title={t("payer")}>
      <Facts columns={1}>
        <Fact label={t("customer")}>
          {payment.customer ? (
            <span className="flex flex-col">
              <span>{payment.customer.name || t("noName")}</span>
              <Code className="text-xs text-ink-600">{payment.customer.phone}</Code>
            </span>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label={t("payable")}>
          <PayableRef payable={payment.payable} />
        </Fact>
      </Facts>
    </Card>
  );
}

function ProviderCard({ payment }: { payment: AdminPaymentDetail }) {
  const t = useTranslations("admin.finance.payment.provider");
  const text = useFinanceText();
  return (
    <Card title={t("title")}>
      <Facts columns={1}>
        <Fact label={t("gateway")}>
          <Code>{payment.gateway}</Code>
        </Fact>
        <Fact label={t("reference")}>
          <Code wrap className="text-xs">
            {payment.gateway_payment_ref ?? "—"}
          </Code>
        </Fact>
        <Fact label={t("method")}>
          {payment.card ? (
            <Code>{payment.card.label}</Code>
          ) : payment.method ? (
            t.has(`methods.${payment.method}`) ? t(`methods.${payment.method}`) : payment.method
          ) : (
            "—"
          )}
        </Fact>
        <Fact label={t("intent")}>{t.has(`intents.${payment.intent}`) ? t(`intents.${payment.intent}`) : payment.intent}</Fact>
        <Fact label={t("attempts")}>
          <Code>{payment.attempts}</Code>
        </Fact>
        {payment.three_ds_status && (
          <Fact label={t("threeDs")}>
            <Code>{payment.three_ds_status}</Code>
          </Fact>
        )}
        <Fact label={t("ulid")}>
          <Code wrap className="text-xs">
            {payment.ulid}
          </Code>
        </Fact>
        {payment.gateway_session_ref && (
          <Fact label={t("session")}>
            <Code wrap className="text-xs">
              {payment.gateway_session_ref}
            </Code>
          </Fact>
        )}
        <Fact label={t("authorizedAt")}>{payment.authorized_at ? text.dateTime(payment.authorized_at) : "—"}</Fact>
        <Fact label={t("capturedAt")}>{payment.captured_at ? text.dateTime(payment.captured_at) : "—"}</Fact>
        {payment.voided_at && (
          <Fact label={t("voidedAt")}>
            <span className="flex flex-col gap-0.5">
              <span>{text.dateTime(payment.voided_at)}</span>
              {payment.void_reason && (
                <>
                  {payment.void_reason_label && <span>{text.name(payment.void_reason_label)}</span>}
                  <Code wrap className="text-xs text-ink-600">
                    {payment.void_reason}
                  </Code>
                </>
              )}
            </span>
          </Fact>
        )}
      </Facts>
    </Card>
  );
}

/** Every refund of this payment, each with the provider's status, reason and credit note. */
function RefundsCard({ refunds }: { refunds: AdminRefund[] }) {
  const t = useTranslations("admin.finance.payment.refunds");
  return (
    <Card title={t("title")}>
      {refunds.length === 0 ? <p className="text-sm text-ink-600">{t("none")}</p> : <RefundList refunds={refunds} />}
    </Card>
  );
}

export function RefundList({ refunds }: { refunds: readonly AdminRefund[] }) {
  const t = useTranslations("admin.finance.refunds");
  const text = useFinanceText();
  return (
    <ul className="flex flex-col">
      {refunds.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 border-t border-line py-3 text-sm first:border-t-0 first:pt-0 last:pb-0">
          <span className="flex flex-wrap items-center gap-2">
            <Money fils={r.amount_fils} className="font-bold text-ink-900" />
            <StatusBadge tone={refundTone[r.status] ?? "neutral"}>
              <span className="sr-only">{t("providerStatus")} </span>
              {text.refund(r.status, r.status_label)}
            </StatusBadge>
            {r.needs_review && <ReviewBadge />}
          </span>
          <span className="text-ink-900">
            {text.reason(r.reason_label)}
            {r.reason_text && <span className="text-ink-600"> · “{r.reason_text}”</span>}
          </span>
          {(r.destination || r.context) && (
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
              {r.destination && <RefundDestination refund={r} />}
              {r.context && <RefundContextLabel context={r.context} />}
            </span>
          )}
          <span className="text-xs text-ink-600">
            {/* A Latin name next to an Arabic date keeps its own order. */}
            {t.rich("requestedBy", {
              name: r.requested_by.name ?? text.requester(r.requested_by.type),
              time: text.dateTime(r.created_at),
              who: (chunks) => <bdi>{chunks}</bdi>,
            })}
          </span>
          {r.status !== "succeeded" && r.status !== "failed" && text.either(r.estimated_arrival_text) && (
            <span className="text-xs text-ink-600">{t("estimate", { text: text.either(r.estimated_arrival_text) })}</span>
          )}
          {r.status === "succeeded" && r.succeeded_at && <span className="text-xs text-ink-600">{t("succeededAt", { time: text.dateTime(r.succeeded_at) })}</span>}
          {r.status === "failed" && (
            <span className="text-xs text-danger-700">
              {r.failure_message ?? t("failed")}
              {r.failure_code && (
                <>
                  {" "}
                  <Code>({r.failure_code})</Code>
                </>
              )}
            </span>
          )}
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {r.gateway_refund_ref && (
              <span className="min-w-0 text-ink-600">
                {t("providerRef")} <Code wrap>{r.gateway_refund_ref}</Code>
              </span>
            )}
            {r.credit_note && (
              <span className="text-ink-600">
                {t("creditNoteLabel")} <CreditNoteNumber note={r.credit_note} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The payment's tax invoice (its capture invoice, `payment.invoice`). None yet after the capture means Billing has not
 * issued it (still queued, or refused: the refused documents page, filtered to this payment, says why).
 */
function InvoiceCard({ payment }: { payment: AdminPaymentDetail }) {
  const t = useTranslations("admin.finance.payment.invoices");
  const text = useFinanceText();
  const invoice = payment.invoice;

  return (
    <Card title={t("title")}>
      {invoice ? (
        <>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/admin/finance/invoices/${invoice.id}`} className="min-w-0 font-bold">
              <Code wrap>{invoice.number}</Code>
            </Link>
            <StatusBadge tone={invoiceTone[invoice.status as InvoiceStatus] ?? "neutral"}>{text.invoice(invoice.status, invoice.status_label)}</StatusBadge>
          </span>
          <Facts columns={1}>
            <Fact label={t("issueDate")}>{text.date(invoice.issue_date)}</Fact>
            <Fact label={t("total")}>
              <Money fils={invoice.total_fils} />
            </Fact>
            {invoice.credited_fils > 0 && (
              <Fact label={t("credited")}>
                <Money fils={invoice.credited_fils} />
              </Fact>
            )}
          </Facts>
          <Link href={`${INVOICES_PATH}?payment_id=${payment.id}`} className="w-fit text-sm font-medium">
            {t("inList")}
          </Link>
        </>
      ) : payment.captured_fils === 0 ? (
        <p className="text-sm text-ink-600">{t("notCaptured")}</p>
      ) : (
        <p className="text-sm text-ink-600">
          {t("none")}{" "}
          <Link href={`${BILLING_REFUSALS_PATH}?payment_id=${payment.id}`} className="font-medium">
            {t("refusals")}
          </Link>
        </p>
      )}
    </Card>
  );
}

/** The newest gateway calls and webhooks first, each payload (already scrubbed by the API) on demand. */
function EventsCard({ events }: { events: PaymentEvent[] }) {
  const t = useTranslations("admin.finance.payment.events");
  const text = useFinanceText();
  return (
    <Card title={t("title")}>
      {events.length === 0 ? (
        <p className="text-sm text-ink-600">{t("none")}</p>
      ) : (
        <ol className="flex flex-col">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge tone={event.source === "webhook" ? "progress" : "neutral"}>{text.source(event.source)}</StatusBadge>
                <Code className="font-medium text-ink-900">{event.type}</Code>
                {event.outcome && <span className="text-xs text-ink-600">{t.has(`outcomes.${event.outcome}`) ? t(`outcomes.${event.outcome}`) : event.outcome}</span>}
                {event.signature_valid === false && <StatusBadge tone="danger">{t("signatureInvalid")}</StatusBadge>}
              </span>
              <span className="text-xs text-ink-600">
                {t("received", { time: text.dateTime(event.received_at) })}
                {event.provider_event_id && (
                  <>
                    {" · "}
                    <Code wrap>{event.provider_event_id}</Code>
                  </>
                )}
              </span>
              {event.payload !== null && event.payload !== undefined && (
                <details className="text-xs">
                  <summary className="touch-target w-fit cursor-pointer font-medium text-petrol-700">{t("payload")}</summary>
                  <pre dir="ltr" className="mt-1.5 max-h-80 overflow-auto rounded-sm bg-neutral-100 p-3 text-start font-mono text-[12px]/5 text-ink-900">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
