"use client";

import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronRight, Download, FileText } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { Button, Card, Notice, StatusBadge, TextField } from "@/components/admin";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { useNow } from "@/lib/admin/hooks";
import type { DocumentUrl, SupplierBlock } from "@/lib/admin/types";
import { useFinanceText } from "./financeText";

/** A label and its value, in a two-column list that wraps on small screens. */
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={clsx("grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2", className)}>{children}</dl>;
}

export function Fact({ label, children, wide }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={clsx("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2")}>
      <dt className="text-xs font-medium text-ink-600">{label}</dt>
      <dd className="min-w-0 break-words text-ink-900">{children}</dd>
    </div>
  );
}

/** A reference, id or code in Latin characters, isolated so it keeps its order in Arabic text. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={clsx("font-latin", className)}>
      {children}
    </bdi>
  );
}

/** An amount in AED (integer fils in, Latin digits out). */
export function Money({ fils, className }: { fils: number | null | undefined; className?: string }) {
  const text = useFinanceText();
  return <span className={clsx("font-latin whitespace-nowrap", className)}>{text.money(fils)}</span>;
}

/** The provider flagged this for a person (needs_review). */
export function ReviewBadge() {
  const t = useTranslations("admin.finance");
  return <StatusBadge tone="pending">{t("needsReview")}</StatusBadge>;
}

/** "← Payments" above a detail page. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex w-fit items-center gap-1 text-sm font-medium">
      <ChevronRight aria-hidden className="size-4 ltr:rotate-180" />
      {children}
    </Link>
  );
}

/** From/to date pickers with the "end before start" message (the list waits until the range is valid). */
export function DateRangeFields({
  from,
  to,
  onChange,
  valid,
  fromLabel,
  toLabel,
}: {
  from: string;
  to: string;
  onChange: (changes: { from?: string; to?: string }) => void;
  valid: boolean;
  fromLabel: string;
  toLabel: string;
}) {
  const t = useTranslations("admin.finance.filters");
  return (
    <>
      <TextField
        type="date"
        label={fromLabel}
        value={from}
        onChange={(e) => onChange({ from: e.target.value })}
        dir="ltr"
        className="font-latin text-start"
        containerClassName="min-w-[160px]"
      />
      <TextField
        type="date"
        label={toLabel}
        value={to}
        onChange={(e) => onChange({ to: e.target.value })}
        dir="ltr"
        className="font-latin text-start"
        containerClassName="min-w-[160px]"
        error={valid ? undefined : t("rangeInvalid")}
      />
    </>
  );
}

/**
 * Download PDF: asks the API for a short-lived signed URL (the PDF is rendered on demand when it is not stored yet),
 * then offers that link and moves focus to it. The URL is never kept longer than it is valid.
 */
export function PdfDownload({ load, documentNumber }: { load: () => Promise<DocumentUrl>; documentNumber: string }) {
  const t = useTranslations("admin.finance.pdf");
  const text = useFinanceText();
  const describe = useAdminErrorMessage();
  const link = useRef<HTMLAnchorElement>(null);
  const fetchUrl = useMutation({ mutationFn: load });
  const now = useNow(30_000);
  // A link past its expiry would fail at the storage: ask for a new one instead.
  const ready = fetchUrl.data && Date.parse(fetchUrl.data.expires_at) > now ? fetchUrl.data : null;

  useEffect(() => {
    if (fetchUrl.data) link.current?.focus();
  }, [fetchUrl.data]);

  return (
    <div className="flex flex-col items-start gap-2">
      {ready ? (
        <a
          ref={link}
          href={ready.url}
          download={ready.file_name}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-petrol-700 px-4 text-sm font-bold text-white hover:bg-petrol-800 hover:text-white"
        >
          <Download aria-hidden className="size-4" />
          {t("open", { file: ready.file_name })}
        </a>
      ) : (
        <Button
          variant="secondary"
          onClick={() => fetchUrl.mutate()}
          loading={fetchUrl.isPending}
          icon={<FileText aria-hidden className="size-4" />}
          aria-label={t("getLabel", { number: documentNumber })}
        >
          {t("get")}
        </Button>
      )}
      {ready && <p className="text-xs text-ink-600">{t("validUntil", { time: text.dateTime(ready.expires_at) })}</p>}
      {fetchUrl.isError && (
        <Notice tone="danger" className="w-full">
          {describe(fetchUrl.error)}
        </Notice>
      )}
    </div>
  );
}

/** "To be confirmed" (R-16) in the danger colour and italics, as the printed invoice marks it. */
function SupplierValue({ value, placeholder }: { value: string; placeholder: boolean }) {
  return <span className={clsx(placeholder && "font-medium text-danger-700 italic")}>{value}</span>;
}

/** The supplier block of an invoice or credit note, as printed on the PDF (spec §9.3; R-16 placeholders marked). */
export function SupplierCard({ supplier, extra }: { supplier: SupplierBlock; extra?: ReactNode }) {
  const t = useTranslations("admin.finance.document");
  const placeholders = supplier.address_is_placeholder || supplier.trn_is_placeholder;
  return (
    <Card title={t("supplier")}>
      <Facts>
        <Fact label={t("supplierName")}>{supplier.name}</Fact>
        <Fact label={t("supplierTrn")}>
          <SupplierValue value={supplier.trn} placeholder={supplier.trn_is_placeholder} />
        </Fact>
        <Fact label={t("supplierAddress")} wide>
          <SupplierValue value={supplier.address} placeholder={supplier.address_is_placeholder} />
        </Fact>
        {extra}
      </Facts>
      {placeholders && <Notice tone="warning">{t("placeholderNote")}</Notice>}
    </Card>
  );
}

/** Totals rows (label start, amount end). */
export function TotalRow({ label, fils, strong }: { label: ReactNode; fils: number; strong?: boolean }) {
  return (
    <div className={clsx("flex justify-between gap-3 text-sm", strong && "text-base font-bold text-ink-900")}>
      <dt>{label}</dt>
      <dd>
        <Money fils={fils} />
      </dd>
    </div>
  );
}
