"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, ErrorState, LoadingBlock, Notice, Select, StatusBadge, TextField } from "@/components/admin";
import { businessToday } from "@/lib/admin/format";
import { useAdminSession } from "@/lib/admin/session";
import { fetchProposal, fetchWorkerStats } from "@/lib/admin/workforce/endpoints";
import { canApprove, isStale } from "@/lib/admin/workforce/incentives";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { percentText, presetRange, rangeProblem, STATS_PRESETS, type Range, type StatsPreset } from "@/lib/admin/workforce/stats";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { WorkerStats } from "@/lib/admin/workforce/types";
import type { Worker } from "@/lib/admin/types";
import { starsText } from "@/lib/admin/workforce/incentives";
import { ApproveProposalDialog, ReasonDecisionDialog, RecomputeButton } from "../incentives/_components/ProposalDialogs";
import { ProposalFacts } from "../incentives/_components/ProposalFacts";

/**
 * Performance and incentives tab (design «الأداء والحوافز», workforce §4.1, §5.5): the figures of a period (visits and
 * hours, how often she was asked for by name, her rating, upheld complaints, attendance, the team's arrivals which are
 * the transport's, substitutions) and, for incentives.approve, the month's incentive proposal with its score breakdown
 * and the decisions. Fields the API holds back for the viewer's permissions are simply absent. A rating never changes
 * pay automatically.
 */
export function WorkerPerformanceTab({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.performance");
  const today = businessToday();
  const [preset, setPreset] = useState<StatsPreset>("thisMonth");
  const [custom, setCustom] = useState<Range>({ from: `${today.slice(0, 7)}-01`, to: today });
  const range = presetRange(preset, today) ?? custom;
  const problem = rangeProblem(range, today);
  const stats = useQuery({
    queryKey: workforceKeys.stats(worker.id, range.from, range.to),
    queryFn: () => fetchWorkerStats(worker.id, range.from, range.to),
    enabled: problem === null,
  });

  return (
    <div className="flex flex-col gap-5">
      <Card title={t("title")}>
        <div className="flex flex-wrap items-end gap-3">
          <Select label={t("period")} value={preset} onChange={(e) => setPreset(e.target.value as StatsPreset)} options={STATS_PRESETS.map((p) => ({ value: p, label: t(`presets.${p}`) }))} containerClassName="min-w-[200px]" />
          {preset === "custom" && (
            <>
              <TextField label={t("from")} type="date" dir="ltr" max={today} value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <TextField label={t("to")} type="date" dir="ltr" max={today} value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          )}
        </div>
        {problem && <Notice tone="warning">{t(`problems.${problem}`)}</Notice>}
        {!problem && stats.isPending && <LoadingBlock lines={5} />}
        {!problem && stats.isError && <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />}
        {!problem && stats.data && <StatsCards stats={stats.data} />}
      </Card>
      {stats.data?.incentive && <IncentiveCard proposalId={stats.data.incentive.proposal_id} />}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-neutral-100 px-3 py-2">
      <span className="text-xs font-medium text-ink-600">{label}</span>
      <span className="font-bold text-ink-900">{value}</span>
      {hint && <span className="text-xs text-ink-600">{hint}</span>}
    </div>
  );
}

function StatsCards({ stats }: { stats: WorkerStats }) {
  const t = useTranslations("admin.workers.performance");
  const wt = useWorkforceText();
  const a = stats.attendance;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label={t("visits")} value={t("visitsValue", { visits: stats.visits.completed, hours: wt.hours(stats.hours.worked_minutes) })} hint={t("visitsHint", { planned: wt.hours(stats.hours.planned_minutes), noShow: stats.visits.no_show })} />
        <Metric
          label={t("requested")}
          value={stats.requested_by_name.percent === null ? "—" : `${stats.requested_by_name.percent}%`}
          hint={t("requestedHint", { visits: stats.requested_by_name.visits, eligible: stats.requested_by_name.eligible })}
        />
        <Metric
          label={t("rating")}
          value={stats.rating === null ? t("unavailable") : stats.rating.average === null ? t("noRatings") : `★ ${starsText(Math.round(stats.rating.average * 100))}`}
          hint={stats.rating ? t("ratingHint", { count: stats.rating.count, low: stats.rating.low_count }) : undefined}
        />
        <Metric
          label={t("complaints")}
          value={stats.complaints === null ? t("unavailable") : String(stats.complaints.upheld)}
          hint={stats.complaints ? t("complaintsHint", { partial: stats.complaints.partial, notUpheld: stats.complaints.not_upheld, open: stats.complaints.open }) : undefined}
        />
        <Metric label={t("teamArrivals")} value={stats.team_arrivals.percent === null ? "—" : `${stats.team_arrivals.percent}%`} hint={t("teamArrivalsHint", { onTime: stats.team_arrivals.on_time, recorded: stats.team_arrivals.recorded })} />
        <Metric
          label={t("substitutions")}
          value={String(stats.substitutions.replaced_unavailable + stats.substitutions.replaced_late + stats.substitutions.reassigned)}
          hint={t("substitutionsHint", { unavailable: stats.substitutions.replaced_unavailable, late: stats.substitutions.replaced_late, reassigned: stats.substitutions.reassigned, covered: stats.substitutions.covered })}
        />
      </div>
      {a && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label={t("attendanceDays")} value={t("attendanceValue", { present: a.present_days, expected: a.expected_days })} hint={t("attendancePercent", { percent: percentText(a.present_days, a.expected_days) })} />
          <Metric label={t("absentDays")} value={String(a.absent_days)} />
          <Metric label={t("lateHalf")} value={t("lateHalfValue", { late: a.late_days, half: a.half_days })} />
          <Metric label={t("unrecordedLeave")} value={t("unrecordedLeaveValue", { unrecorded: a.unrecorded_days, leave: a.leave_days })} />
        </div>
      )}
      <p className="text-xs text-ink-600">{t("teamArrivalsNote")}</p>
    </div>
  );
}

type Decision = "approve" | "edit" | "reject" | "reopen";

/** The month's proposal for incentives.approve: facts, the recompute when its figures changed, and the four decisions. */
function IncentiveCard({ proposalId }: { proposalId: number }) {
  const t = useTranslations("admin.workers.performance.incentive");
  const wt = useWorkforceText();
  const { can } = useAdminSession();
  const [decision, setDecision] = useState<Decision | null>(null);
  const query = useQuery({ queryKey: workforceKeys.proposal(proposalId), queryFn: () => fetchProposal(proposalId), enabled: can("incentives.approve") });
  if (!can("incentives.approve")) return null;
  const proposal = query.data;
  return (
    <Card title={proposal ? t("title", { month: wt.month(proposal.period.start.slice(0, 7)) }) : t("titlePlain")}>
      <p className="text-sm text-ink-600">{t("auto")}</p>
      <Notice tone="info">{t("ratingNote")}</Notice>
      {query.isPending && <LoadingBlock lines={4} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {proposal && (
        <>
          <ProposalFacts proposal={proposal} />
          <div className="flex flex-wrap items-center gap-2">
            {proposal.status === "proposed" && (
              <>
                <Button onClick={() => setDecision("approve")} disabled={!canApprove(proposal)}>
                  {t("approve")}
                </Button>
                <Button variant="outline" onClick={() => setDecision("edit")} disabled={!canApprove(proposal)}>
                  {t("edit")}
                </Button>
                <Button variant="outline" className="text-danger-700" onClick={() => setDecision("reject")}>
                  {t("reject")}
                </Button>
              </>
            )}
            {(proposal.status === "approved" || proposal.status === "rejected") && (
              <Button variant="outline" onClick={() => setDecision("reopen")}>
                {t("reopen")}
              </Button>
            )}
            {isStale(proposal) && proposal.status === "proposed" && <RecomputeButton proposal={proposal} />}
            {proposal.status === "posted" && <StatusBadge tone="success">{t("final")}</StatusBadge>}
            <Link href={`/admin/workers/incentives?period=${proposal.period.start.slice(0, 7)}`} className="touch-target text-sm font-bold">
              {t("openMonth")}
            </Link>
          </div>
          {(decision === "approve" || decision === "edit") && <ApproveProposalDialog proposal={proposal} live={proposal} mode={decision} onClose={() => setDecision(null)} />}
          {decision === "reject" && <ReasonDecisionDialog kind="reject" proposal={proposal} live={proposal} onClose={() => setDecision(null)} />}
          {decision === "reopen" && <ReasonDecisionDialog kind="reopen" proposal={proposal} live={proposal} onClose={() => setDecision(null)} />}
        </>
      )}
    </Card>
  );
}
