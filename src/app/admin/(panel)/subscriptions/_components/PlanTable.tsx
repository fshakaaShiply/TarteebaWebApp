"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import type { CancelPlan } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { Ltr } from "./kit";

/**
 * The periods of a cancellation preview, one row per paid period (oldest first): what was paid, what can still be
 * refunded, the visits used and unused, the unused value, and what the rule takes (fee, package-discount clawback) and
 * gives back (refund). Every amount is the API's; the totals row is its `totals`. A figure a TERMS_CHANGED moved is marked.
 */
export function PeriodsTable({ plan, changed }: { plan: Pick<CancelPlan, "periods" | "totals" | "party">; changed?: (field: string) => boolean }) {
  const t = useTranslations("admin.subscriptions.cancel.table");
  const text = useSubscriptionText();
  const mark = (field: string) => (changed?.(field) ? "rounded-sm bg-apricot-100 px-1 font-bold" : undefined);
  if (plan.periods.length === 0) return <p className="text-ink-600">{t("none")}</p>;
  const cell = "px-2 py-1.5 text-end font-latin whitespace-nowrap";
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth: 640 }}>
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="text-ink-600">
            <th scope="col" className="px-2 py-1.5 text-start font-medium">{t("period")}</th>
            <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("paid")}</th>
            <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("refundable")}</th>
            <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("visits")}</th>
            <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("unused")}</th>
            <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("fee")}</th>
            <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("clawback")}</th>
            <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("refund")}</th>
          </tr>
        </thead>
        <tbody>
          {plan.periods.map((p) => (
            <tr key={p.ulid} className="border-t border-line">
              <th scope="row" className="px-2 py-1.5 text-start font-normal">
                <Ltr className="whitespace-nowrap">{`${text.dateShort(p.start)} – ${text.dateShort(p.end)}`}</Ltr>
              </th>
              <td className={cell}>{text.moneyFixed(p.paid_fils)}</td>
              <td className={cell}>{text.moneyFixed(p.refundable_fils)}</td>
              <td className={cell}>{t("visitsOf", { used: p.visits_consumed, unused: p.visits_unused })}</td>
              <td className={cell}>{text.moneyFixed(p.unused_value_fils)}</td>
              <td className={cell}>
                <span className={mark("fee_fils")}>{text.moneyFixed(p.fee_fils)}</span>
              </td>
              <td className={cell}>
                <span className={mark("clawback_fils")}>{text.moneyFixed(p.clawback_fils)}</span>
              </td>
              <td className={clsx(cell, "font-bold")}>
                <span className={mark("refund_fils")}>{text.moneyFixed(p.refund_fils)}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-bold text-ink-900">
            <th scope="row" className="px-2 py-1.5 text-start">{t("total")}</th>
            <td className={cell}>{text.moneyFixed(plan.totals.paid_fils)}</td>
            <td className={cell} />
            <td className={cell} />
            <td className={cell}>{text.moneyFixed(plan.totals.unused_value_fils)}</td>
            <td className={cell}>{text.moneyFixed(plan.totals.fee_fils)}</td>
            <td className={cell}>{text.moneyFixed(plan.totals.clawback_fils)}</td>
            <td className={cell}>{text.moneyFixed(plan.totals.refund_fils)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
