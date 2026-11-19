"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Eye, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ButtonLink, Card, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, LoadingBlock, Notice, PageHeader, Select, StatusBadge, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { INCENTIVE_PROPOSALS_PATH } from "@/lib/admin/nav";
import { activateRule, deactivateRule, deleteRule, fetchRules, previewRule } from "@/lib/admin/workforce/endpoints";
import { useWorkforceError } from "@/lib/admin/workforce/errors";
import { bpText, closedPeriods, hoursText, SCORE_KEYS, starsText } from "@/lib/admin/workforce/incentives";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { IncentiveRule } from "@/lib/admin/workforce/types";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { useSeenRecord } from "../../../finance/_components/useSeenRecord";
import { useIncentiveRefresh } from "../_components/ProposalDialogs";
import { RuleFormDialog } from "./RuleForm";

type DialogState = { kind: "form"; rule: IncentiveRule | null } | { kind: "toggle" | "delete" | "preview"; rule: IncentiveRule };

/**
 * A05 incentive rules (incentives.approve, workforce §3.4): the scheme that turns a month's hours, rating, punctuality
 * and repeat requests into an amount. One rule is active; activating another switches the first off. Past proposals keep
 * the rule they were computed with. "Preview a month" shows what a rule would give each worker and stores nothing.
 */
export function IncentiveRulesScreen() {
  return (
    <RequirePermission anyOf={["incentives.approve"]}>
      <RulesPage />
    </RequirePermission>
  );
}

function RulesPage() {
  const t = useTranslations("admin.incentives.rules");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const query = useQuery({ queryKey: workforceKeys.rules(), queryFn: fetchRules });
  const liveOf = (rule: IncentiveRule): IncentiveRule | null => (query.data ? (query.data.find((r) => r.id === rule.id) ?? null) : rule);
  const close = () => setDialog(null);
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <ButtonLink href={INCENTIVE_PROPOSALS_PATH} variant="ghost" icon={<ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />}>
              {t("back")}
            </ButtonLink>
            <Button onClick={() => setDialog({ kind: "form", rule: null })} icon={<Plus aria-hidden className="size-4" />}>
              {t("create")}
            </Button>
          </>
        }
      />
      {query.isPending && <LoadingBlock lines={6} className="rounded-lg bg-surface p-5 shadow-card" />}
      {query.isError && (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      )}
      {query.data && query.data.length === 0 && (
        <Card>
          <EmptyState title={t("empty")} body={t("emptyBody")} />
        </Card>
      )}
      {query.data && query.data.length > 0 && !query.data.some((r) => r.is_active) && <Notice tone="warning">{t("noneActive")}</Notice>}
      {query.data?.map((rule) => <RuleCard key={rule.id} rule={rule} onEdit={() => setDialog({ kind: "form", rule })} onToggle={() => setDialog({ kind: "toggle", rule })} onDelete={() => setDialog({ kind: "delete", rule })} onPreview={() => setDialog({ kind: "preview", rule })} />)}
      {dialog?.kind === "form" && <RuleFormDialog rule={dialog.rule} live={dialog.rule ? liveOf(dialog.rule) : null} onClose={close} />}
      {dialog?.kind === "toggle" && <ToggleRuleDialog rule={dialog.rule} live={liveOf(dialog.rule)} onClose={close} />}
      {dialog?.kind === "delete" && <DeleteRuleDialog rule={dialog.rule} live={liveOf(dialog.rule)} onClose={close} />}
      {dialog?.kind === "preview" && <PreviewDialog rule={dialog.rule} onClose={close} />}
    </>
  );
}

function RuleCard({ rule, onEdit, onToggle, onDelete, onPreview }: { rule: IncentiveRule; onEdit: () => void; onToggle: () => void; onDelete: () => void; onPreview: () => void }) {
  const t = useTranslations("admin.incentives.rules");
  const wt = useWorkforceText();
  const locale = useLocale();
  const name = locale === "ar" ? rule.name.ar : rule.name.en;
  const th = rule.thresholds;
  return (
    <Card
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <bdi>{name}</bdi>
          {rule.is_active ? <StatusBadge tone="success">{t("active")}</StatusBadge> : <StatusBadge tone="neutral">{t("inactive")}</StatusBadge>}
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" icon={<Eye aria-hidden className="size-4" />} onClick={onPreview} aria-label={t("previewLabel", { name })}>
            {t("preview")}
          </Button>
          <Button variant="outline" size="sm" icon={<Pencil aria-hidden className="size-4" />} onClick={onEdit} aria-label={t("editLabel", { name })}>
            {t("edit")}
          </Button>
          <Button variant="outline" size="sm" icon={<Power aria-hidden className="size-4" />} onClick={onToggle} aria-label={t(rule.is_active ? "deactivateLabel" : "activateLabel", { name })}>
            {rule.is_active ? t("deactivate") : t("activate")}
          </Button>
          {!rule.is_active && (
            <Button variant="outline" size="sm" className="text-danger-700" icon={<Trash2 aria-hidden className="size-4" />} onClick={onDelete} aria-label={t("deleteLabel", { name })}>
              {t("delete")}
            </Button>
          )}
        </div>
      }
    >
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-600">{t("summary.weights")}</dt>
          <dd className="text-ink-900">{SCORE_KEYS.map((k) => `${wt.score(k)} ${rule.weights[k]}`).join(t("summary.separator"))}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-600">{t("summary.hours")}</dt>
          <dd className="text-ink-900">{t("summary.hoursValue", { target: hoursText(th.hours_target_minutes), min: hoursText(th.min_hours_minutes) })}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-600">{t("summary.ratings")}</dt>
          <dd className="text-ink-900">{t("summary.ratingsValue", { floor: starsText(th.rating_floor_x100), count: th.min_ratings })}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-600">{t("summary.absent")}</dt>
          <dd className="text-ink-900">{th.max_absent_days === null ? t("summary.noLimit") : t("summary.absentValue", { count: th.max_absent_days })}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-ink-600">{t("summary.tiers")}</dt>
          <dd className="text-ink-900">{rule.amounts.map((a) => t("summary.tier", { score: bpText(a.min_score_bp), amount: wt.money(a.amount_fils) })).join(t("summary.separator"))}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-600">{t("snapshotNote")}</p>
    </Card>
  );
}

function ToggleRuleDialog({ rule, live, onClose }: { rule: IncentiveRule; live: IncentiveRule | null; onClose: () => void }) {
  const t = useTranslations("admin.incentives.rules");
  const toast = useToast();
  const describe = useWorkforceError();
  const refresh = useIncentiveRefresh();
  const seen = useSeenRecord(live ?? rule);
  const record = seen.record;
  const activating = !record.is_active;
  const run = useMutation({
    mutationFn: () => (activating ? activateRule(record.id, record.version) : deactivateRule(record.id, record.version)),
    onSuccess: () => {
      refresh();
      toast.success(activating ? t("activated") : t("deactivated"));
      onClose();
    },
    onError: (error) => {
      refresh();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") seen.moved();
    },
  });
  const gone = live === null;
  const stale = seen.waiting || seen.renewed;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={activating ? t("activateTitle") : t("deactivateTitle")}
      description={activating ? t("activateBody") : t("deactivateBody")}
      confirmLabel={activating ? t("activate") : t("deactivate")}
      pending={run.isPending}
      onConfirm={() => {
        if (gone || seen.waiting) return;
        seen.seen();
        run.mutate();
      }}
    >
      {gone && <Notice tone="danger">{t("gone")}</Notice>}
      {stale && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
      {run.error && !stale && <Notice tone="danger">{describe(run.error)}</Notice>}
    </ConfirmDialog>
  );
}

function DeleteRuleDialog({ rule, live, onClose }: { rule: IncentiveRule; live: IncentiveRule | null; onClose: () => void }) {
  const t = useTranslations("admin.incentives.rules");
  const toast = useToast();
  const describe = useWorkforceError();
  const refresh = useIncentiveRefresh();
  const seen = useSeenRecord(live ?? rule);
  const record = seen.record;
  const run = useMutation({
    mutationFn: () => deleteRule(record.id, record.version),
    onSuccess: () => {
      refresh();
      toast.success(t("deleted"));
      onClose();
    },
    onError: (error) => {
      refresh();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") seen.moved();
    },
  });
  const gone = live === null;
  const stale = seen.waiting || seen.renewed;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteTitle")}
      description={t("deleteBody")}
      confirmLabel={t("delete")}
      tone="danger"
      pending={run.isPending}
      onConfirm={() => {
        if (gone || seen.waiting) return;
        seen.seen();
        run.mutate();
      }}
    >
      {gone && <Notice tone="danger">{t("gone")}</Notice>}
      {stale && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
      {run.error && !stale && <Notice tone="danger">{describe(run.error)}</Notice>}
    </ConfirmDialog>
  );
}

/** What a rule would give each worker for a month that has ended: nothing is stored or proposed. */
function PreviewDialog({ rule, onClose }: { rule: IncentiveRule; onClose: () => void }) {
  const t = useTranslations("admin.incentives.rules.previewDialog");
  const wt = useWorkforceText();
  const describe = useWorkforceError();
  const periods = closedPeriods(12);
  const [period, setPeriod] = useState(periods[0]);
  const run = useMutation({ mutationFn: () => previewRule(rule.id, period) });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t("title")} description={t("body")} size="lg" footer={<Button variant="outline" onClick={onClose}>{t("close")}</Button>}>
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t("month")} value={period} onChange={(e) => setPeriod(e.target.value)} options={periods.map((p) => ({ value: p, label: wt.month(p) }))} containerClassName="min-w-[200px]" />
        <Button onClick={() => run.mutate()} loading={run.isPending}>
          {t("run")}
        </Button>
      </div>
      {run.error && <Notice tone="danger">{describe(run.error)}</Notice>}
      {run.data && (
        <>
          <DataTable
            caption={t("caption", { month: wt.month(run.data.period) })}
            columns={[
              { id: "worker", header: t("columns.worker"), cell: (w) => <bdi className="font-bold">{w.worker.display_name}</bdi> },
              { id: "score", header: t("columns.score"), cell: (w) => <span className="font-latin">{bpText(w.score_bp)}%</span> },
              { id: "amount", header: t("columns.amount"), cell: (w) => <span className="font-latin font-bold" dir="ltr">{wt.money(w.proposed_fils)}</span> },
              { id: "gates", header: t("columns.gates"), cell: (w) => (w.gates.length > 0 ? w.gates.map((g) => wt.gate(g)).join(t("separator")) : <span className="text-ink-600">—</span>) },
            ]}
            rows={run.data.workers}
            getRowId={(w) => w.worker.id}
            empty={<EmptyState title={t("empty")} />}
            minWidth={520}
          />
          <p className="text-sm font-bold text-ink-900">{t("totals", { count: run.data.totals.count, total: wt.money(run.data.totals.fils) })}</p>
        </>
      )}
    </Dialog>
  );
}
