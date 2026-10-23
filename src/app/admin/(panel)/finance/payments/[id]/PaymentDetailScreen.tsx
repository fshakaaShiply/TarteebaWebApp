"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, EmptyState, ErrorState, LoadingBlock, Notice, StatusBadge } from "@/components/admin";
import { fetchInvoices, fetchPayment } from "@/lib/admin/endpoints";
import { canRefund } from "@/lib/admin/finance/refund";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { DOCUMENTS_READ, PAYMENTS_PATH } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { AdminPaymentDetail, AdminRefund, PaymentEvent } from "@/lib/admin/types";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { paymentTone } from "../../../bookings/_components/bookingText";
import { BackLink, Code, Fact, Facts, Money, ReviewBadge, TotalRow } from "../../_components/FinanceParts";
import { invoiceTone, refundTone, useFinanceText } from "../../_components/financeText";
import { RefundDialog } from "./RefundDialog";

/**
 * A09 payment page (spec §10.4, §17 "payment detail with event log"; payments.view): amounts (captured, refunded and
 * what is left to refund), the provider's details and status, the refunds with the provider's status each, the
 * invoice issued for it, and every gateway call and webhook with its scrubbed payload. A refund needs refunds.create.
 */
export function PaymentDetailScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={["payments.view"]}>
      <PaymentDetailContent id={id} />
    </RequirePermission>
  );
}

function PaymentDetailContent({ id }: { id: string }) {
  const t = useTranslations("admin.finance.payment");
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  // No timed refresh (StaffIdleTimeout counts admin reads as activity): it refreshes on focus, after a refund and on demand.
  const payment = useQuery({
    queryKey: adminKeys.payment(numericId ?? 0),
    queryFn: () => fetchPayment(numericId as number),
    enabled: numericId !== null,
    refetchOnWindowFocus: true,
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink href={PAYMENTS_PATH}>{t("back")}</BackLink>
        {payment.data && (
          <Button variant="ghost" size="sm" onClick={() => void payment.refetch()} loading={payment.isFetching} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {numericId === null ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : payment.isPending ? (
        <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : payment.isError ? (
        <Card>
          <ErrorState error={payment.error} onRetry={() => void payment.refetch()} />
        </Card>
      ) : (
        // Keyed by payment: another payment's page never inherits this one's refund key or dialog.
        <PaymentView key={payment.data.id} payment={payment.data} />
      )}
    </>
  );
}

function PaymentView({ payment }: { payment: AdminPaymentDetail }) {
  const t = useTranslations("admin.finance.payment");
  const text = useFinanceText();
  const { can } = useAdminSession();
  const [refunding, setRefunding] = useState(false);
  const refundable = canRefund(payment);
  // One key store per payment page: a refund whose outcome is unknown keeps its key when the dialog is closed and opened
  // again, so a second try can never refund the customer twice (refunds have no If-Match).
  const refundKeys = useIdempotencyKeys({ holdAfterUnknown: true });

  return (
    <>
      <section aria-labelledby="payment-title" className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 id="payment-title" className="text-[26px]/[34px] font-bold text-ink-900">
              <span className="sr-only">{t("titlePrefix")} </span>
              <Code>{payment.gateway_payment_ref ?? payment.ulid}</Code>
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
          <Notice tone="warning" title={t("reviewTitle")}>
            {payment.review_reason && (
              <p>
                {t("reviewReason")} <Code className="text-xs">{payment.review_reason}</Code>
              </p>
            )}
          </Notice>
        )}
        {payment.status === "verifying" && (
          <Notice tone="info">{t("verifying", { since: text.dateTime(payment.verifying_since ?? payment.updated_at) })}</Notice>
        )}
        {payment.status === "failed" && (payment.failure_code || payment.failure_message) && (
          <Notice tone="danger" title={t("failedTitle")}>
            {payment.failure_message && <p>{payment.failure_message}</p>}
            {payment.failure_code && <Code className="text-xs">{payment.failure_code}</Code>}
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
          <InvoicesCard payment={payment} />
        </div>
      </div>

      {refunding && <RefundDialog payment={payment} keys={refundKeys} onClose={() => setRefunding(false)} />}
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
        <TotalRow label={t("refundable")} fils={payment.refundable_fils} strong />
        {payment.fee_fils !== null && <TotalRow label={t("fee")} fils={payment.fee_fils} />}
        {payment.net_settled_fils !== null && <TotalRow label={t("netSettled")} fils={payment.net_settled_fils} />}
      </dl>
      <p className="text-xs text-ink-600">{t("refundableNote")}</p>
    </Card>
  );
}

function PayerCard({ payment }: { payment: AdminPaymentDetail }) {
  const t = useTranslations("admin.finance.payment");
  const text = useFinanceText();
  const { can } = useAdminSession();
  return (
    <Card title={t("payer")}>
      <Facts className="sm:grid-cols-1">
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
          {payment.payable.type === "booking" && can("bookings.view") ? (
            <Link href={`/admin/bookings/${payment.payable.id}`} className="font-medium">
              {t("openBooking", { id: payment.payable.id })}
            </Link>
          ) : (
            <span>
              {text.payable(payment.payable.type)} <Code>#{payment.payable.id}</Code>
            </span>
          )}
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
      <Facts className="sm:grid-cols-1">
        <Fact label={t("gateway")}>
          <Code>{payment.gateway}</Code>
        </Fact>
        <Fact label={t("reference")}>
          <Code className="text-xs">{payment.gateway_payment_ref ?? "—"}</Code>
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
          <Code className="text-xs">{payment.ulid}</Code>
        </Fact>
        {payment.gateway_session_ref && (
          <Fact label={t("session")}>
            <Code className="text-xs">{payment.gateway_session_ref}</Code>
          </Fact>
        )}
        <Fact label={t("authorizedAt")}>{payment.authorized_at ? text.dateTime(payment.authorized_at) : "—"}</Fact>
        <Fact label={t("capturedAt")}>{payment.captured_at ? text.dateTime(payment.captured_at) : "—"}</Fact>
        {payment.voided_at && (
          <Fact label={t("voidedAt")}>
            {text.dateTime(payment.voided_at)}
            {payment.void_reason && (
              <>
                {" · "}
                <Code className="text-xs">{payment.void_reason}</Code>
              </>
            )}
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
  const { canAny } = useAdminSession();
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
            {text.reason(r.reason_code, r.reason_label)}
            {r.reason_text && <span className="text-ink-600"> · “{r.reason_text}”</span>}
          </span>
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
              <span className="text-ink-600">
                {t("providerRef")} <Code>{r.gateway_refund_ref}</Code>
              </span>
            )}
            {r.credit_note_id !== null && canAny(DOCUMENTS_READ) && (
              <Link href={`/admin/finance/credit-notes/${r.credit_note_id}`} className="font-medium">
                {t("creditNote")}
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Tax invoices issued for this payment (the customer's invoices, this payment's only). */
function InvoicesCard({ payment }: { payment: AdminPaymentDetail }) {
  const t = useTranslations("admin.finance.payment.invoices");
  const text = useFinanceText();
  const customerId = payment.customer?.id ?? null;
  const invoices = useQuery({
    queryKey: adminKeys.customerInvoices(customerId ?? 0),
    queryFn: () => fetchInvoices({ customerId: customerId as number, perPage: 100 }),
    enabled: customerId !== null && payment.captured_fils > 0,
    select: (page) => page.data.filter((invoice) => invoice.payment.id === payment.id),
  });

  return (
    <Card title={t("title")}>
      {payment.captured_fils === 0 ? (
        <p className="text-sm text-ink-600">{t("notCaptured")}</p>
      ) : invoices.isPending && customerId !== null ? (
        <LoadingBlock lines={2} />
      ) : invoices.isError ? (
        <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} className="py-4" />
      ) : !invoices.data || invoices.data.length === 0 ? (
        <p className="text-sm text-ink-600">{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {invoices.data.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap items-center gap-2">
              <Link href={`/admin/finance/invoices/${invoice.id}`} className="font-bold">
                <Code>{invoice.number}</Code>
              </Link>
              <StatusBadge tone={invoiceTone[invoice.status] ?? "neutral"}>{text.invoice(invoice.status, invoice.status_label)}</StatusBadge>
              <Money fils={invoice.total_fils} className="text-ink-600" />
            </li>
          ))}
        </ul>
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
                    <Code>{event.provider_event_id}</Code>
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
