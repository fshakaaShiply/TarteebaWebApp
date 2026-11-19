"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, StatusBadge } from "@/components/admin";
import { DOCUMENT_CHECKS, checkTone, type RunTotals as Totals } from "@/lib/admin/finance/reconciliation";
import { Code, Money } from "../../_components/FinanceParts";
import { useReconText } from "./ReconParts";

function Row({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-ink-600">{label}</dt>
      <dd className={clsx("text-end", tone === "danger" ? "font-bold text-danger-700" : "text-ink-900")}>{children}</dd>
    </div>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <h3 className="text-sm font-bold text-ink-900">{title}</h3>
      <dl className="flex flex-col gap-2">{children}</dl>
    </section>
  );
}

const count = (n: number, fils: number) => (
  <span className="flex flex-col items-end">
    <Money fils={fils} />
    <Code className="text-xs text-ink-600">×{n}</Code>
  </span>
);

/**
 * A completed run's totals in three columns: what the provider's report says, what our records say for the same
 * transactions, and what the tax documents of the matched lines say (AC6: the report carries no VAT or discount, the
 * documents prove them). The differences are the server's own figures, in the danger colour when they are not zero:
 * the page never works a difference out.
 */
export function RunTotals({ totals }: { totals: Totals }) {
  const t = useTranslations("admin.finance.reconciliation.totals");
  const label = useReconText();
  const { gateway: g, system: s, documents: d } = totals;
  const issues = DOCUMENT_CHECKS.filter((c) => c !== "ok" && c !== "not_applicable" && (d.checks[c] ?? 0) > 0);

  return (
    <Card title={t("title")}>
      <div className="grid gap-6 md:grid-cols-3">
        <Column title={t("provider")}>
          <Row label={t("lines")}>
            <Code>{g.lines}</Code>
          </Row>
          <Row label={t("charges")}>{count(g.charges.count, g.charges.amount_fils)}</Row>
          <Row label={t("refunds")}>{count(g.refunds.count, g.refunds.amount_fils)}</Row>
          <Row label={t("fees")}>
            <Money fils={g.fee_fils} />
          </Row>
          <Row label={t("net")}>
            <Money fils={g.net_fils} />
          </Row>
          <Row label={t("payout")}>
            <Money fils={g.payout_fils} />
          </Row>
          <Row label={t("payoutDifference")} tone={g.payout_difference_fils !== 0 ? "danger" : undefined}>
            <Money fils={g.payout_difference_fils} />
          </Row>
          {g.tolerance_difference_fils !== 0 && (
            <Row label={t("tolerance")} tone="danger">
              <Money fils={g.tolerance_difference_fils} />
            </Row>
          )}
        </Column>
        <Column title={t("ours")}>
          <Row label={t("expectedCharges")}>
            <Code>{s.expected.charges}</Code>
          </Row>
          <Row label={t("expectedRefunds")}>
            <Code>{s.expected.refunds}</Code>
          </Row>
          <Row label={t("matchedCharges")}>{count(s.matched.charges.count, s.matched.charges.amount_fils)}</Row>
          <Row label={t("matchedRefunds")}>{count(s.matched.refunds.count, s.matched.refunds.amount_fils)}</Row>
        </Column>
        <Column title={t("documents")}>
          <Row label={t("invoices")}>{count(d.invoices.count, d.invoices.total_fils)}</Row>
          <Row label={t("discount")}>
            <Money fils={d.invoices.discount_fils} />
          </Row>
          <Row label={t("vatInvoices")}>
            <Money fils={d.invoices.vat_fils} />
          </Row>
          <Row label={t("creditNotes")}>{count(d.credit_notes.count, d.credit_notes.total_fils)}</Row>
          <Row label={t("vatCreditNotes")}>
            <Money fils={d.credit_notes.vat_fils} />
          </Row>
          <Row label={t("netVat")}>
            <Money fils={d.net_vat_fils} />
          </Row>
          <Row label={t("chargesVsInvoices")} tone={d.charges_vs_invoices_fils !== 0 ? "danger" : undefined}>
            <Money fils={d.charges_vs_invoices_fils} />
          </Row>
          <Row label={t("refundsVsCreditNotes")} tone={d.refunds_vs_credit_notes_fils !== 0 ? "danger" : undefined}>
            <Money fils={d.refunds_vs_credit_notes_fils} />
          </Row>
        </Column>
      </div>
      {g.payouts.length > 0 && (
        <ul aria-label={t("payouts")} className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
          {g.payouts.map((p, i) => (
            <li key={`${p.ref ?? "payout"}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-ink-600">
                {t("payoutRef")} <Code>{p.ref ?? "—"}</Code>
              </span>
              <span className="flex flex-wrap items-baseline gap-3">
                <Money fils={p.amount_fils} className="text-ink-900" />
                {p.difference_fils !== null && p.difference_fils !== 0 && (
                  <span className="font-bold text-danger-700">
                    {t("payoutDiff")} <Money fils={p.difference_fils} />
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
          <span className="text-ink-600">{t("documentIssues")}</span>
          {issues.map((c) => (
            <StatusBadge key={c} tone={checkTone[c]}>
              {label.check(c)} · {d.checks[c]}
            </StatusBadge>
          ))}
        </div>
      )}
    </Card>
  );
}
