"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Card, DataTable, EmptyState, ErrorState, LoadingBlock, StatusBadge, useToast, type Column } from "@/components/admin";
import { emailInvoice, fetchInvoice, fetchInvoicePdf } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { DOCUMENTS_READ, INVOICES_PATH } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { AdminInvoiceDetail, InvoiceLine } from "@/lib/admin/types";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { paymentTone } from "../../../bookings/_components/bookingText";
import { BackLink, Code, Fact, Facts, Money, PdfDownload, SupplierCard, TotalRow } from "../../_components/FinanceParts";
import { invoiceTone, useFinanceText } from "../../_components/financeText";

/**
 * A09 invoice page (spec §9.3 contents of a UAE tax invoice, §17 "view/download/resend"; invoices.manage or
 * payments.view): supplier (R-16 placeholders marked), customer, numbers and dates, the lines with unit price excl.
 * VAT, discount, VAT rate and amount, the totals, its credit notes; Download PDF (signed URL) and, with
 * invoices.manage, Resend by e-mail to the customer's own address.
 */
export function InvoiceDetailScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={DOCUMENTS_READ}>
      <InvoiceDetailContent id={id} />
    </RequirePermission>
  );
}

function InvoiceDetailContent({ id }: { id: string }) {
  const t = useTranslations("admin.finance.invoice");
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  const invoice = useQuery({
    queryKey: adminKeys.invoice(numericId ?? 0),
    queryFn: () => fetchInvoice(numericId as number),
    enabled: numericId !== null,
    refetchOnWindowFocus: true,
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink href={INVOICES_PATH}>{t("back")}</BackLink>
        {invoice.data && (
          <Button variant="ghost" size="sm" onClick={() => void invoice.refetch()} loading={invoice.isFetching} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {numericId === null ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : invoice.isPending ? (
        <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : invoice.isError ? (
        <Card>
          <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />
        </Card>
      ) : (
        <InvoiceView invoice={invoice.data} />
      )}
    </>
  );
}

function InvoiceView({ invoice }: { invoice: AdminInvoiceDetail }) {
  const t = useTranslations("admin.finance.invoice");
  const text = useFinanceText();
  const { can } = useAdminSession();

  return (
    <>
      <section aria-labelledby="invoice-title" className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-sm font-medium text-ink-600">{t("documentTitle")}</p>
            <h1 id="invoice-title" className="text-[26px]/[34px] font-bold text-ink-900">
              <span className="sr-only">{t("titlePrefix")} </span>
              <Code>{invoice.number}</Code>
            </h1>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={invoiceTone[invoice.status] ?? "neutral"}>{text.invoice(invoice.status, invoice.status_label)}</StatusBadge>
            </span>
            <p className="text-sm text-ink-600">
              {t("summary", { total: text.money(invoice.total_fils), date: text.date(invoice.issue_date) })}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <PdfDownload load={() => fetchInvoicePdf(invoice.id)} documentNumber={invoice.number} />
            {can("invoices.manage") && <ResendButton invoice={invoice} />}
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
          <LinesCard invoice={invoice} />
          {invoice.credit_notes.length > 0 && <CreditNotesCard invoice={invoice} />}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Card title={t("details")}>
            <Facts className="sm:grid-cols-1">
              <Fact label={t("issueDate")}>{text.date(invoice.issue_date)}</Fact>
              <Fact label={t("supplyDate")}>{text.date(invoice.supply_date)}</Fact>
              <Fact label={t("issuedAt")}>{text.dateTime(invoice.issued_at)}</Fact>
              <Fact label={t("customer")}>
                <span className="flex flex-col">
                  <span>{invoice.customer.name || t("noName")}</span>
                  {invoice.customer.phone && <Code className="text-xs text-ink-600">{invoice.customer.phone}</Code>}
                </span>
              </Fact>
              {invoice.customer_trn && (
                <Fact label={t("customerTrn")}>
                  <Code>{invoice.customer_trn}</Code>
                </Fact>
              )}
              <Fact label={t("booking")}>
                {invoice.booking.reference ? (
                  invoice.booking.id !== null && can("bookings.view") ? (
                    <Link href={`/admin/bookings/${invoice.booking.id}`} className="font-medium">
                      <Code>{invoice.booking.reference}</Code>
                    </Link>
                  ) : (
                    <Code>{invoice.booking.reference}</Code>
                  )
                ) : (
                  "—"
                )}
              </Fact>
              <Fact label={t("payment")}>
                <span className="flex flex-wrap items-center gap-1.5">
                  {can("payments.view") ? (
                    <Link href={`/admin/finance/payments/${invoice.payment.id}`} className="font-medium">
                      <Code className="text-xs">{invoice.payment.gateway_payment_ref ?? invoice.payment.ulid}</Code>
                    </Link>
                  ) : (
                    <Code className="text-xs">{invoice.payment.gateway_payment_ref ?? invoice.payment.ulid}</Code>
                  )}
                  <StatusBadge tone={paymentTone[invoice.payment.status] ?? "neutral"}>{text.payment(invoice.payment.status)}</StatusBadge>
                </span>
              </Fact>
              <Fact label={t("emailedAt")}>{invoice.emailed_at ? text.dateTime(invoice.emailed_at) : t("notEmailed")}</Fact>
            </Facts>
          </Card>
          <SupplierCard supplier={invoice.supplier} />
        </div>
      </div>
    </>
  );
}

/** Resend by e-mail (invoices.manage): queued to the customer's own address; 422 EMAIL_MISSING when there is none. */
function ResendButton({ invoice }: { invoice: AdminInvoiceDetail }) {
  const t = useTranslations("admin.finance.invoice");
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: () => emailInvoice(invoice.id),
    onSuccess: () => {
      // The address is not shown: the customer's profile holds it.
      toast.success(t("resent", { number: invoice.number }));
      void queryClient.invalidateQueries({ queryKey: adminKeys.invoice(invoice.id) });
    },
    onError: (error) => toast.error(describe(error)),
  });
  return (
    <Button
      variant="outline"
      onClick={() => send.mutate()}
      loading={send.isPending}
      icon={<Mail aria-hidden className="size-4" />}
      aria-label={t("resendLabel", { number: invoice.number })}
    >
      {t("resend")}
    </Button>
  );
}

function LinesCard({ invoice }: { invoice: AdminInvoiceDetail }) {
  const t = useTranslations("admin.finance.invoice");
  const columns: Column<InvoiceLine & { index: number }>[] = [
    { id: "description", header: t("lines.description"), cell: (l) => <span className="text-ink-900">{l.description}</span> },
    { id: "quantity", header: t("lines.quantity"), cell: (l) => <Code>{l.quantity}</Code> },
    { id: "unit", header: t("lines.unitPrice"), cell: (l) => <Money fils={l.unit_price_excl_vat_fils} /> },
    {
      id: "discount",
      header: t("lines.discount"),
      cell: (l) => (l.discount_fils > 0 ? <Money fils={l.discount_fils} /> : <span className="text-ink-600">—</span>),
    },
    { id: "net", header: t("lines.net"), cell: (l) => <Money fils={l.net_fils} /> },
    { id: "rate", header: t("lines.vatRate"), cell: (l) => <Code>{l.vat_rate}</Code> },
    { id: "vat", header: t("lines.vat"), cell: (l) => <Money fils={l.vat_fils} /> },
    { id: "total", header: t("lines.total"), cell: (l) => <Money fils={l.total_fils} className="font-bold text-ink-900" /> },
  ];

  return (
    <Card title={t("lines.title")}>
      <DataTable
        caption={t("lines.caption", { number: invoice.number })}
        columns={columns}
        rows={invoice.lines.map((line, index) => ({ ...line, index }))}
        getRowId={(l) => l.index}
        minWidth={760}
      />
      <dl className="ms-auto flex w-full max-w-sm flex-col gap-2 border-t border-line pt-3">
        <TotalRow label={t("totals.subtotal")} fils={invoice.subtotal_fils} />
        {invoice.discount_fils > 0 && <TotalRow label={t("totals.discount")} fils={invoice.discount_fils} />}
        <TotalRow label={t("totals.net")} fils={invoice.net_fils} />
        <TotalRow label={t("totals.vat", { rate: invoice.vat_rate })} fils={invoice.vat_fils} />
        <TotalRow label={t("totals.total")} fils={invoice.total_fils} strong />
        {invoice.credited_fils > 0 && <TotalRow label={t("totals.credited")} fils={invoice.credited_fils} />}
      </dl>
    </Card>
  );
}

function CreditNotesCard({ invoice }: { invoice: AdminInvoiceDetail }) {
  const t = useTranslations("admin.finance.invoice");
  const text = useFinanceText();
  return (
    <Card title={t("creditNotes")}>
      <ul className="flex flex-col">
        {invoice.credit_notes.map((note) => (
          <li key={note.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 text-sm first:border-t-0 first:pt-0 last:pb-0">
            <span className="flex flex-col">
              <Link href={`/admin/finance/credit-notes/${note.id}`} className="font-bold">
                <Code>{note.number}</Code>
              </Link>
              <span className="text-xs text-ink-600">
                {text.date(note.issue_date)} · {text.reason(note.reason_code)}
              </span>
            </span>
            <Money fils={note.total_fils} className="font-bold text-ink-900" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
