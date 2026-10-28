"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Card, DataTable, EmptyState, ErrorState, LoadingBlock, type Column } from "@/components/admin";
import { fetchCreditNote, fetchCreditNotePdf } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { CREDIT_NOTES_PATH, DOCUMENTS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { AdminCreditNoteDetail, CreditNoteLine } from "@/lib/admin/types";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { BackLink, Code, Fact, Facts, Money, PdfDownload, SupplierCard, TotalRow } from "../../_components/FinanceParts";
import { useFinanceText } from "../../_components/financeText";

/**
 * A09 credit note page (spec §9.3; invoices.manage or payments.view): the invoice it credits, why (the refund's reason
 * from the closed list), the lines and totals, the supplier block, and Download PDF (signed URL).
 */
export function CreditNoteDetailScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={DOCUMENTS_READ}>
      <CreditNoteDetailContent id={id} />
    </RequirePermission>
  );
}

function CreditNoteDetailContent({ id }: { id: string }) {
  const t = useTranslations("admin.finance.creditNote");
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  const note = useQuery({
    queryKey: adminKeys.creditNote(numericId ?? 0),
    queryFn: () => fetchCreditNote(numericId as number),
    enabled: numericId !== null,
    refetchOnWindowFocus: true,
  });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink href={CREDIT_NOTES_PATH}>{t("back")}</BackLink>
        {note.data && (
          <Button variant="ghost" size="sm" onClick={() => void note.refetch()} loading={note.isFetching} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {numericId === null ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : note.isPending ? (
        <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : note.isError ? (
        <Card>
          <ErrorState error={note.error} onRetry={() => void note.refetch()} />
        </Card>
      ) : (
        <CreditNoteView note={note.data} />
      )}
    </>
  );
}

function CreditNoteView({ note }: { note: AdminCreditNoteDetail }) {
  const t = useTranslations("admin.finance.creditNote");
  const text = useFinanceText();
  const { can } = useAdminSession();
  const columns: Column<CreditNoteLine>[] = [
    { id: "description", header: t("lines.description"), cell: (l) => <span className="text-ink-900">{l.description}</span> },
    { id: "net", header: t("lines.net"), cell: (l) => <Money fils={l.net_fils} /> },
    { id: "rate", header: t("lines.vatRate"), cell: (l) => <Code>{l.vat_rate}</Code> },
    { id: "vat", header: t("lines.vat"), cell: (l) => <Money fils={l.vat_fils} /> },
    { id: "total", header: t("lines.total"), cell: (l) => <Money fils={l.total_fils} className="font-bold text-ink-900" /> },
  ];

  return (
    <>
      <section aria-labelledby="credit-note-title" className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-sm font-medium text-ink-600">{t("documentTitle")}</p>
            <h1 id="credit-note-title" className="text-[26px]/[34px] font-bold text-ink-900">
              <span className="sr-only">{t("titlePrefix")} </span>
              <Code wrap>{note.number}</Code>
            </h1>
            <p className="text-sm text-ink-600">
              {t("summary", { total: text.money(note.total_fils), invoice: note.invoice.number, date: text.date(note.issue_date) })}
            </p>
          </div>
          <PdfDownload load={() => fetchCreditNotePdf(note.id)} documentNumber={note.number} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
          <Card title={t("lines.title")}>
            <DataTable caption={t("lines.caption", { number: note.number })} columns={columns} rows={note.lines} getRowId={(l) => l.line} minWidth={560} />
            <dl className="ms-auto flex w-full max-w-sm flex-col gap-2 border-t border-line pt-3">
              <TotalRow label={t("totals.net")} fils={note.net_fils} />
              <TotalRow label={t("totals.vat", { rate: note.vat_rate })} fils={note.vat_fils} />
              <TotalRow label={t("totals.total")} fils={note.total_fils} strong />
            </dl>
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Card title={t("details")}>
            <Facts columns={1}>
              <Fact label={t("invoice")}>
                <Link href={`/admin/finance/invoices/${note.invoice.id}`} className="font-medium">
                  <Code wrap>{note.invoice.number}</Code>
                </Link>
              </Fact>
              <Fact label={t("issueDate")}>{text.date(note.issue_date)}</Fact>
              <Fact label={t("issuedAt")}>{text.dateTime(note.issued_at)}</Fact>
              <Fact label={t("customer")}>{note.customer.name || t("noName")}</Fact>
              <Fact label={t("booking")}>{note.booking_reference ? <Code wrap>{note.booking_reference}</Code> : "—"}</Fact>
              <Fact label={t("reason")}>
                <span className="flex flex-col">
                  <span>{text.reason(note.reason_label)}</span>
                  {note.reason && <span className="text-xs text-ink-600">“{note.reason}”</span>}
                </span>
              </Fact>
              <Fact label={t("refund")}>
                {can("payments.view") ? (
                  <Link href={`/admin/finance/payments/${note.payment_id}`} className="font-medium">
                    {t("openPayment")}
                  </Link>
                ) : (
                  <Code>#{note.payment_id}</Code>
                )}
              </Fact>
            </Facts>
          </Card>
          <SupplierCard supplier={note.supplier} />
        </div>
      </div>
    </>
  );
}
