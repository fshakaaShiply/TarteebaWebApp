"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, EmptyState, ErrorState, LoadingBlock, Notice, SlaChip, StatusBadge } from "@/components/admin";
import { Ltr } from "../bookings/_components/BookingBits";
import { useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { AdminApiError } from "@/lib/admin/client";
import { fetchAssignees, fetchCase } from "@/lib/admin/quality/endpoints";
import { qualityKeys } from "@/lib/admin/quality/keys";
import { priorityTone, statusTone, useQualityText } from "@/lib/admin/quality/labels";
import type { AdminCaseDetail, Compensation } from "@/lib/admin/quality/types";
import { QUALITY_READ } from "@/lib/admin/nav";
import { RequirePermission } from "../../_components/RequirePermission";
import { AssignControl, CaseSettings } from "./_components/CaseControls";
import { CaseFacts, CaseRatingCard, CompensationSummary } from "./_components/CaseFacts";
import { CaseThread } from "./_components/CaseThread";
import { CloseCaseDialog, ReopenCaseDialog, WithdrawCompensationDialog } from "./_components/CaseDialogs";
import { ApproveCompensationDialog, RejectCompensationDialog } from "./_components/CompensationDialogs";
import { ReplyComposer } from "./_components/ReplyComposer";
import { ResolveDialog } from "./_components/ResolveDialog";

/** How often an open case is read again in the background (D-11: the inbox is live). */
export const CASE_REFRESH_MS = 20_000;

/**
 * A10 case page (spec §17 A10; design AdminQuality.dc.html; complaints.manage to work it, compensation.approve to read
 * it and decide a compensation): the page of /admin/quality/{id}, and the side pane of the inbox (`compact`).
 */
export function ComplaintCaseScreen({ id }: { id: string }) {
  const t = useTranslations("admin.quality.case");
  return (
    <RequirePermission anyOf={QUALITY_READ}>
      <Link href="/admin/quality" className="inline-flex w-fit items-center gap-1 text-sm font-medium">
        <ChevronRight aria-hidden className="size-4 ltr:rotate-180" />
        {t("back")}
      </Link>
      <CaseView id={id} />
    </RequirePermission>
  );
}

type Dialog =
  | { kind: "resolve" }
  | { kind: "close" }
  | { kind: "reopen" }
  | { kind: "withdraw"; compensationId: number }
  | { kind: "approve"; compensationId: number }
  | { kind: "reject"; compensationId: number };

/** The case read by its number, kept fresh, with every state: loading, error with retry, not found, denied. */
export function CaseView({ id, compact = false, onClose }: { id: string; compact?: boolean; onClose?: () => void }) {
  const t = useTranslations("admin.quality.case");
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: qualityKeys.case(numericId ?? 0),
    queryFn: () => fetchCase(numericId as number),
    enabled: numericId !== null,
    refetchOnWindowFocus: true,
  });
  useBackgroundRefresh(qualityKeys.case(numericId ?? 0), () => fetchCase(numericId as number, { background: true }), { everyMs: CASE_REFRESH_MS, enabled: numericId !== null });
  const notFound = numericId === null || (detail.error instanceof AdminApiError && detail.error.status === 404);

  if (notFound) {
    return (
      <Card>
        <EmptyState title={t("notFound")} />
      </Card>
    );
  }
  if (detail.isPending) return <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />;
  if (detail.isError && !detail.data) {
    return (
      <Card>
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </Card>
    );
  }
  return (
    <CaseBody
      c={detail.data}
      compact={compact}
      onClose={onClose}
      fetching={detail.isFetching}
      refreshFailed={detail.isError}
      onReload={() => void queryClient.invalidateQueries({ queryKey: qualityKeys.case(detail.data.id) })}
    />
  );
}

function CaseBody({ c, compact, onClose, fetching, refreshFailed, onReload }: { c: AdminCaseDetail; compact: boolean; onClose?: () => void; fetching: boolean; refreshFailed: boolean; onReload: () => void }) {
  const t = useTranslations("admin.quality.case");
  const text = useQualityText();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const assignees = useQuery({ queryKey: qualityKeys.assignees(), queryFn: fetchAssignees, staleTime: 5 * 60_000, enabled: c.actions.assign });
  const staffName = (staffId: number) => assignees.data?.find((a) => a.id === staffId)?.name ?? null;
  const compensationOf = (compensationId: number): Compensation | undefined => c.compensations.find((k) => k.id === compensationId);
  const pending = c.compensations.find((k) => k.status === "pending_approval");
  const closeDialog = () => setDialog(null);
  const reload = () => onReload();
  const staffMayWork = c.actions.reply || c.actions.assign;
  const active = c.status !== "resolved" && c.status !== "closed";

  const dialogCompensation = dialog && "compensationId" in dialog ? compensationOf(dialog.compensationId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby={`case-title-${c.id}`} className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 id={`case-title-${c.id}`} className="text-[22px]/[30px] font-bold text-ink-900">
              <span className="sr-only">{t("titlePrefix")} </span>
              <Ltr>{c.reference}</Ltr>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone="confirmed">{text.type(c.type, c.type_label)}</StatusBadge>
              <StatusBadge tone="neutral">{text.category(c.category, c.category_label)}</StatusBadge>
              <StatusBadge tone={priorityTone[c.priority]}>{text.priority(c.priority, c.priority_label)}</StatusBadge>
              <StatusBadge tone={statusTone[c.status]}>{text.status(c.status, c.status_label)}</StatusBadge>
              <SlaChip sla={c.sla} />
              {c.customer_replied && <StatusBadge tone="pending">{t("customerReplied")}</StatusBadge>}
            </div>
            {c.status === "closed" && c.close_reason && (
              <p className="text-sm text-ink-600">{t("closedWith", { reason: text.closeReason(c.close_reason, c.close_reason_label), time: text.dateTime(c.closed_at) })}</p>
            )}
            {c.reopened_count > 0 && <p className="text-xs text-ink-600">{t("reopened", { count: c.reopened_count })}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reload} loading={fetching} icon={<RefreshCw aria-hidden className="size-4" />}>
              {t("refresh")}
            </Button>
            {c.actions.resolve && <Button onClick={() => setDialog({ kind: "resolve" })}>{t("resolve")}</Button>}
            {c.actions.reopen && (
              <Button variant="secondary" onClick={() => setDialog({ kind: "reopen" })}>
                {t("reopen")}
              </Button>
            )}
            {c.actions.close && (
              <Button variant="outline" onClick={() => setDialog({ kind: "close" })}>
                {t("close")}
              </Button>
            )}
            {compact && onClose && (
              <Button variant="ghost" size="sm" onClick={onClose} icon={<X aria-hidden className="size-4" />} aria-label={t("closePane")}>
                <span className="sr-only">{t("closePane")}</span>
              </Button>
            )}
          </div>
        </div>
        {refreshFailed && <Notice tone="warning">{t("refreshFailed")}</Notice>}
        {c.status === "resolved" && c.resolution && (
          <Notice tone="success" title={`${t("resolvedTitle")}${c.outcome ? ` · ${text.outcome(c.outcome, c.outcome_label)}` : ""}`}>
            <span className="whitespace-pre-wrap">{c.resolution}</span>
          </Notice>
        )}
        {!staffMayWork && c.status !== "closed" && <Notice tone="neutral">{t("readOnly")}</Notice>}
        {!c.customer_visible && <Notice tone="info">{t("hiddenFollowUp")}</Notice>}
      </section>

      <div className={compact ? "flex flex-col gap-5" : "grid gap-5 xl:grid-cols-3"}>
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-2">
          <Card title={t("conversation")}>
            <CaseThread c={c} onRefreshFiles={reload} refreshingFiles={fetching} staffName={staffName} />
          </Card>
          {c.actions.reply && (
            <Card title={t("reply")}>
              <ReplyComposer c={c} />
            </Card>
          )}
          {(c.compensations.length > 0 || c.pending_resolution) && (
            <Card title={t("compensations")}>
              {pending && c.pending_resolution && (
                <Notice tone="warning" title={t("waitingTitle")}>
                  {t("waitingBody")}
                  {c.pending_resolution.resolution && <span className="block whitespace-pre-wrap">“{c.pending_resolution.resolution}”</span>}
                </Notice>
              )}
              <ul className="flex flex-col divide-y divide-line">
                {c.compensations.map((k) => (
                  <li key={k.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <CompensationSummary compensation={k} />
                    {k.status === "pending_approval" && (
                      <div className="flex flex-wrap gap-2">
                        {c.actions.approve && (
                          <Button size="sm" onClick={() => setDialog({ kind: "approve", compensationId: k.id })}>
                            {t("approve")}
                          </Button>
                        )}
                        {c.actions.reject && (
                          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "reject", compensationId: k.id })}>
                            {t("reject")}
                          </Button>
                        )}
                        {c.actions.cancel_compensation && (
                          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "withdraw", compensationId: k.id })}>
                            {t("withdraw")}
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          {c.status !== "closed" && (
            <Card title={t("handling")}>
              <AssignControl c={c} />
              <CaseSettings c={c} />
            </Card>
          )}
          <Card title={t("timing")}>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-600">{t("created")}</dt>
                <dd>{text.dateTime(c.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-600">{t("firstReplyDue")}</dt>
                <dd className="text-end">
                  {text.dateTime(c.first_response_due_at)}
                  {c.first_responded_at && <span className="block text-xs text-ink-600">{t("answeredAt", { time: text.dateTime(c.first_responded_at) })}</span>}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-600">{t("resolutionDue")}</dt>
                <dd className="text-end">{c.resolution_due_at ? text.dateTime(c.resolution_due_at) : active ? t("paused") : "—"}</dd>
              </div>
              {c.resolved_at && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-600">{t("resolvedAt")}</dt>
                  <dd className="text-end">
                    {text.dateTime(c.resolved_at)}
                    {c.resolved_by && <span className="block text-xs text-ink-600">{c.resolved_by.name}</span>}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          <CaseFacts c={c} />
          <CaseRatingCard c={c} onRefreshFiles={reload} refreshingFiles={fetching} />
        </div>
      </div>

      {dialog?.kind === "resolve" && <ResolveDialog c={c} onClose={closeDialog} />}
      {dialog?.kind === "close" && <CloseCaseDialog c={c} onClose={closeDialog} />}
      {dialog?.kind === "reopen" && <ReopenCaseDialog c={c} onClose={closeDialog} />}
      {dialog?.kind === "withdraw" && dialogCompensation && <WithdrawCompensationDialog compensation={dialogCompensation} c={c} onClose={closeDialog} />}
      {dialog?.kind === "approve" && dialogCompensation && <ApproveCompensationDialog compensation={dialogCompensation} onClose={closeDialog} />}
      {dialog?.kind === "reject" && dialogCompensation && <RejectCompensationDialog compensation={dialogCompensation} onClose={closeDialog} />}
    </div>
  );
}
