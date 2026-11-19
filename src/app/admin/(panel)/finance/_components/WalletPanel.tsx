"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MinusCircle, PlusCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button, Card, DataTable, EmptyState, Notice, StatusBadge, type Column } from "@/components/admin";
import { ExportButton } from "@/components/admin/ExportButton";
import { exportFilters } from "@/lib/admin/exports";
import { fetchCustomerWallet } from "@/lib/admin/finance/endpoints";
import type { WalletTransaction } from "@/lib/admin/finance/wallet";
import { walletKeysFor } from "@/lib/admin/finance/walletKeys";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import { Code, Money } from "./FinanceParts";
import { useFinanceText } from "./financeText";
import { WalletAdjustDialog } from "./WalletAdjustDialog";

const PER_PAGE = 25;

/**
 * The customer's balance for staff (finance §7.1; the A07 profile mounts it as its "Balance" tab when the balance is on
 * or there is still money in it). The balance is the spendable one: a credit past its expiry is left out before the
 * nightly job books it. Free credits expire (shown with their date); the ledger lists every movement, newest first, with
 * who made it and the staff note. "Add credit" and "Correct balance" need refunds.create. The balance is switched off for
 * customers by the owner's ruling: while it is off no credit can be added, and what is left can only be corrected.
 */
export function WalletPanel({ customerUlid }: { customerUlid: string }) {
  const t = useTranslations("admin.finance.wallet");
  const text = useFinanceText();
  const { can } = useAdminSession();
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<"credit" | "debit" | null>(null);
  const wallet = useQuery({
    queryKey: adminKeys.customerWallet(customerUlid, page),
    queryFn: () => fetchCustomerWallet(customerUlid, { page, perPage: PER_PAGE }),
    placeholderData: keepPreviousData,
  });
  const info = wallet.data?.data;
  const mayAdjust = can("refunds.create");
  /*
   * The adjustments' Idempotency-Keys belong to the panel, not to the dialog: one store per movement type, kept in this
   * tab (walletKeysFor). The route has no If-Match and no expected balance, so a credit whose answer was lost, sent again
   * from a dialog closed and opened again, must carry the same key for the API to replay it instead of booking it twice.
   */
  const adjustKeys = useMemo(() => ({ credit: walletKeysFor(customerUlid, "credit"), debit: walletKeysFor(customerUlid, "debit") }), [customerUlid]);

  const columns: Column<WalletTransaction>[] = [
    { id: "created", header: t("columns.created"), cell: (r) => <span className="whitespace-nowrap">{text.dateTime(r.created_at)}</span> },
    {
      id: "type",
      header: t("columns.type"),
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge tone={r.type === "credit" ? "success" : "neutral"}>{t(`types.${r.type}`)}</StatusBadge>
          <span className="text-xs text-ink-600">{text.name(r.source_label) || t(`sources.${r.source}`)}</span>
        </span>
      ),
    },
    {
      id: "amount",
      header: t("columns.amount"),
      cell: (r) => (
        <span className="whitespace-nowrap font-bold text-ink-900">
          <span aria-hidden>{r.type === "credit" ? "+" : "−"}</span>
          <span className="sr-only">{t(`signs.${r.type}`)} </span>
          <Money fils={r.amount_fils} />
        </span>
      ),
    },
    { id: "after", header: t("columns.balanceAfter"), cell: (r) => <Money fils={r.balance_after_fils} /> },
    {
      id: "remaining",
      header: t("columns.remaining"),
      cell: (r) => (r.remaining_fils === null ? <span className="text-ink-600">—</span> : <Money fils={r.remaining_fils} />),
    },
    {
      id: "expires",
      header: t("columns.expires"),
      // `expires_at` is an instant: the date it falls on in Dubai (a credit ending at 22:30 UTC ends the next day there).
      cell: (r) => (r.type === "credit" ? r.expires_at ? <span className="whitespace-nowrap text-sm">{text.instantDate(r.expires_at)}</span> : <span className="text-ink-600">{t("never")}</span> : <span className="text-ink-600">—</span>),
    },
    {
      id: "by",
      header: t("columns.by"),
      cell: (r) => (
        <span className="flex flex-col text-sm">
          <span>{r.created_by.type === "staff" ? (r.created_by.name ?? t("staff")) : t(`actors.${r.created_by.type}`)}</span>
          {r.context?.reference && <Code className="text-xs text-ink-600">{r.context.reference}</Code>}
          {r.note && <span className="text-xs text-ink-600">“{r.note}”</span>}
        </span>
      ),
    },
  ];

  return (
    <Card
      title={t("title")}
      actions={<ExportButton report="wallet_transactions" filters={exportFilters({ customer_id: customerUlid })} />}
    >
      {info && !info.enabled && info.balance_fils > 0 && <Notice tone="warning">{t("offWithBalance")}</Notice>}
      {info && !info.enabled && info.balance_fils === 0 && <Notice tone="neutral">{t("off")}</Notice>}
      {info && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-md bg-ivory-50 p-4">
            <span className="text-sm font-medium text-ink-600">{t("balance")}</span>
            <span className="font-latin text-2xl font-bold text-ink-900">{text.money(info.balance_fils)}</span>
            <span className="text-xs text-ink-600">{t("balanceNote")}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-md bg-ivory-50 p-4">
            <span className="text-sm font-medium text-ink-600">{t("expiring")}</span>
            <span className="font-latin text-2xl font-bold text-ink-900">{text.money(info.expiring_30d_fils)}</span>
            <span className="text-xs text-ink-600">{t("expiringNote")}</span>
          </div>
        </div>
      )}
      {info && mayAdjust && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col items-start gap-1">
            <Button onClick={() => setAdjusting("credit")} disabled={!info.enabled} icon={<PlusCircle aria-hidden className="size-4" />}>
              {t("addCredit")}
            </Button>
            {!info.enabled && <p className="max-w-xs text-xs text-ink-600">{t("addCreditOff")}</p>}
          </div>
          <div className="flex flex-col items-start gap-1">
            <Button variant="outline" onClick={() => setAdjusting("debit")} disabled={info.balance_fils <= 0} icon={<MinusCircle aria-hidden className="size-4" />}>
              {t("correct")}
            </Button>
            {info.balance_fils <= 0 && <p className="max-w-xs text-xs text-ink-600">{t("correctEmpty")}</p>}
          </div>
        </div>
      )}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={info?.transactions}
        getRowId={(r) => r.id}
        loading={wallet.isPending}
        fetching={wallet.isFetching && !wallet.isPending}
        error={wallet.error}
        onRetry={() => void wallet.refetch()}
        empty={<EmptyState title={t("empty")} body={t("emptyBody")} />}
        pagination={wallet.data ? { meta: wallet.data.meta, onPageChange: setPage } : undefined}
        minWidth={820}
      />
      {adjusting && info && (
        <WalletAdjustDialog customerUlid={customerUlid} type={adjusting} balanceFils={info.balance_fils} keys={adjustKeys[adjusting]} onClose={() => setAdjusting(null)} />
      )}
    </Card>
  );
}
