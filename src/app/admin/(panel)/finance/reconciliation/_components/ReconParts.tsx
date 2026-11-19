"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/admin";
import { checkTone, itemTone, runTone, type DocumentCheck, type ItemRow, type ItemStatus, type RunRow, type RunStatus } from "@/lib/admin/finance/reconciliation";
import { useAdminSession } from "@/lib/admin/session";
import type { Translatable } from "@/lib/admin/types";
import { Code } from "../../_components/FinanceParts";
import { useFinanceText } from "../../_components/financeText";

/** The API's bilingual label when it sent one, else our own (admin.finance.reconciliation.enums). */
export function useReconText() {
  const t = useTranslations("admin.finance.reconciliation.enums");
  const text = useFinanceText();
  const label = (group: string, value: string, api?: Translatable | null) => {
    const fromApi = api ? text.name(api) : "";
    if (fromApi) return fromApi;
    return t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value;
  };
  return {
    run: (status: RunStatus, api?: Translatable | null) => label("runStatus", status, api),
    item: (status: ItemStatus, api?: Translatable | null) => label("itemStatus", status, api),
    reason: (code: string, api?: Translatable | null) => label("reason", code, api),
    resolution: (code: string, api?: Translatable | null) => label("resolution", code, api),
    check: (code: string, api?: Translatable | null) => label("documentCheck", code, api),
    line: (code: string, api?: Translatable | null) => label("lineType", code, api),
  };
}

export function RunStatusChip({ run }: { run: Pick<RunRow, "status" | "status_label"> }) {
  const label = useReconText();
  return <StatusBadge tone={runTone[run.status] ?? "neutral"}>{label.run(run.status, run.status_label)}</StatusBadge>;
}

export function ItemStatusChip({ item }: { item: Pick<ItemRow, "status" | "status_label"> }) {
  const label = useReconText();
  return <StatusBadge tone={itemTone[item.status] ?? "neutral"}>{label.item(item.status, item.status_label)}</StatusBadge>;
}

export function DocumentCheckChip({ item }: { item: Pick<ItemRow, "document_check" | "document_check_label"> }) {
  const label = useReconText();
  if (!item.document_check) return <span className="text-ink-600">—</span>;
  return <StatusBadge tone={checkTone[item.document_check as DocumentCheck] ?? "neutral"}>{label.check(item.document_check, item.document_check_label)}</StatusBadge>;
}

/** A reference in Latin characters with a copy button (a provider reference is what the accountant looks up). */
export function CopyableRef({ value, label }: { value: string; label: string }) {
  const t = useTranslations("admin.finance.reconciliation");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // The reference stays selectable on screen.
    }
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Code wrap className="text-xs">
        {value}
      </Code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("copyRef", { label })}
        className="touch-target inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-600 hover:bg-neutral-100 hover:text-ink-900"
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
        <span role="status" className="sr-only">
          {copied ? t("copied") : ""}
        </span>
      </button>
    </span>
  );
}

/** Our record the line was matched to: the payment (or the refund's payment) and what it paid for. */
export function OurRecord({ item }: { item: Pick<ItemRow, "payment" | "refund"> }) {
  const t = useTranslations("admin.finance.reconciliation");
  const { can } = useAdminSession();
  const payment = item.payment;
  if (!payment && !item.refund) return <span className="text-ink-600">{t("noRecord")}</span>;
  const reference = payment?.reference ?? null;
  return (
    <span className="flex flex-col gap-0.5 text-sm">
      {payment &&
        (can("payments.view") ? (
          <Link href={`/admin/finance/payments/${payment.id}`} className="font-medium">
            {t("paymentLink")}
            {reference && (
              <>
                {" · "}
                <Code>{reference}</Code>
              </>
            )}
          </Link>
        ) : (
          <span>
            {t("paymentLink")}
            {reference && (
              <>
                {" · "}
                <Code>{reference}</Code>
              </>
            )}
          </span>
        ))}
      {item.refund && (
        <span className="text-xs text-ink-600">
          {can("payments.view") && payment ? (
            <Link href={`/admin/finance/refunds?payment_id=${payment.id}`}>{t("refundLink")}</Link>
          ) : (
            t("refundLink")
          )}
        </span>
      )}
      {payment?.customer?.name && <span className="text-xs text-ink-600">{payment.customer.name}</span>}
    </span>
  );
}
