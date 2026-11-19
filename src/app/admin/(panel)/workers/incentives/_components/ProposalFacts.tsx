"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Notice, StatusBadge, type StatusTone } from "@/components/admin";
import { bpText, hoursText, isStale, SCORE_KEYS, starsText } from "@/lib/admin/workforce/incentives";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { IncentiveProposal, IncentiveStatus } from "@/lib/admin/workforce/types";
import { useAdminSession } from "@/lib/admin/session";

export const incentiveTone: Record<IncentiveStatus, StatusTone> = { proposed: "pending", approved: "confirmed", rejected: "danger", posted: "success" };

/**
 * One proposal's facts (workforce §4.2, §4.3): the amount and its status, the score and the four components (a component
 * with no data is dropped and the others share the weight), the gates that sent it to zero, and the month's figures the
 * score came from. An upheld complaint is shown beside the proposal and is not in the formula (P5-W28).
 */
export function ProposalFacts({ proposal }: { proposal: IncentiveProposal }) {
  const t = useTranslations("admin.incentives.facts");
  const wt = useWorkforceText();
  const locale = useLocale();
  const { can } = useAdminSession();
  const m = proposal.metrics_summary;
  const ruleName = proposal.rule.name ? (locale === "ar" ? proposal.rule.name.ar : proposal.rule.name.en) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={incentiveTone[proposal.status]}>{wt.incentiveStatus(proposal.status)}</StatusBadge>
        {isStale(proposal) && <StatusBadge tone="pending">{t("stale")}</StatusBadge>}
        {proposal.locked_attendance && <StatusBadge tone="neutral">{t("attendanceLocked")}</StatusBadge>}
      </div>
      {isStale(proposal) && <Notice tone="warning">{t("staleBody")}</Notice>}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-ink-600">{t("proposed")}</dt>
          <dd className="font-latin font-bold text-ink-900">{wt.money(proposal.proposed_fils)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-600">{t("approvedAmount")}</dt>
          <dd className="font-latin font-bold text-ink-900">{proposal.approved_fils === null ? "—" : wt.money(proposal.approved_fils)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-600">{t("score")}</dt>
          <dd className="font-latin text-ink-900">{bpText(proposal.score_bp)}%</dd>
        </div>
        {ruleName && (
          <div>
            <dt className="text-xs text-ink-600">{t("rule")}</dt>
            <dd className="text-ink-900">{t("ruleValue", { name: ruleName, version: proposal.rule.version })}</dd>
          </div>
        )}
      </dl>

      {proposal.gates.length > 0 && (
        <Notice tone="warning" title={t("gatesTitle")}>
          <ul className="list-disc ps-5">
            {proposal.gates.map((g) => (
              <li key={g}>{wt.gate(g)}</li>
            ))}
          </ul>
        </Notice>
      )}

      <section className="flex flex-col gap-1.5">
        <h4 className="text-sm font-bold text-ink-900">{t("scoresTitle")}</h4>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {SCORE_KEYS.map((key) => {
            const value = proposal.scores[key];
            return (
              <li key={key} className="flex items-center justify-between gap-2 rounded-md bg-neutral-100 px-3 py-1.5 text-sm">
                <span className="text-ink-900">{wt.score(key)}</span>
                {typeof value === "number" ? <span className="font-latin font-bold">{bpText(value)}%</span> : <span className="text-xs text-ink-600">{t("dropped")}</span>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-ink-600">{t("droppedNote")}</p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h4 className="text-sm font-bold text-ink-900">{t("metricsTitle")}</h4>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Fact label={t("hours")} value={t("hoursValue", { hours: hoursText(m.worked_minutes), visits: m.completed_visits })} />
          <Fact label={t("rating")} value={m.rating_avg_x100 === null ? t("ratingNone", { count: m.ratings_count ?? 0 }) : t("ratingValue", { average: starsText(m.rating_avg_x100), count: m.ratings_count ?? 0 })} />
          <Fact label={t("attendance")} value={t("attendanceValue", { absent: m.absent_days, late: m.late_days })} />
          <Fact label={t("requested")} value={m.requested_percent === null ? "—" : `${m.requested_percent}%`} />
          <Fact label={t("complaints")} value={m.complaints_upheld === null ? "—" : String(m.complaints_upheld)} />
        </dl>
      </section>

      {proposal.approved && (
        <p className="text-sm text-ink-600">
          {t("approvedBy", { name: proposal.approved.by?.name ?? t("system"), time: wt.dateTime(proposal.approved.at) })}
          {proposal.approved.adjust_reason ? ` · ${t("adjustReason", { reason: proposal.approved.adjust_reason })}` : ""}
        </p>
      )}
      {proposal.rejected && (
        <p className="text-sm text-ink-600">
          {proposal.rejected.code === "below_threshold" ? t("rejectedBelow") : t("rejectedBy", { name: proposal.rejected.by?.name ?? t("system"), time: wt.dateTime(proposal.rejected.at) })}
          {proposal.rejected.reason ? ` · ${proposal.rejected.reason}` : ""}
        </p>
      )}
      {proposal.posting && (
        <p className="text-sm text-ink-900">
          {t("postedIn")}{" "}
          {can("incentives.approve") || can("incentives.view") ? (
            <Link href={`/admin/finance/incentive-postings/${proposal.posting.id}`} className="font-bold">
              <bdi dir="ltr" className="font-latin">
                {proposal.posting.reference}
              </bdi>
            </Link>
          ) : (
            <bdi dir="ltr" className="font-latin">
              {proposal.posting.reference}
            </bdi>
          )}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-ink-600">{label}</dt>
      <dd className="text-ink-900">{value}</dd>
    </div>
  );
}
