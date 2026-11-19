"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ConfirmDialog, MoneyField, Notice, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { isolate } from "@/lib/admin/format";
import { bpText, validateApproval } from "@/lib/admin/workforce/incentives";
import { approveProposal, recomputeProposal, rejectProposal, reopenProposal } from "@/lib/admin/workforce/endpoints";
import { useWorkforceError } from "@/lib/admin/workforce/errors";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { IncentiveProposal } from "@/lib/admin/workforce/types";
import { filsToAedInput } from "@/lib/money";
import { useSeenRecord } from "../../../finance/_components/useSeenRecord";

/**
 * After a decision on a proposal: the proposals, the adjustments and the posting lists (an approval locks the month's
 * attendance and changes the totals), the worker's attendance months and her stats.
 */
export function useIncentiveRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: workforceKeys.incentives() });
    void queryClient.invalidateQueries({ queryKey: workforceKeys.attendanceAll() });
    void queryClient.invalidateQueries({ queryKey: ["admin", "workers", "attendance"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "workers", "stats"] });
  };
}

/** Recomputes one proposal's figures from the month as it stands now (If-Match), clearing "the figures changed". */
export function RecomputeButton({ proposal, onDone, variant = "outline" }: { proposal: IncentiveProposal; onDone?: (p: IncentiveProposal) => void; variant?: "outline" | "ghost" | "secondary" }) {
  const t = useTranslations("admin.incentives.proposal");
  const toast = useToast();
  const describe = useWorkforceError();
  const refresh = useIncentiveRefresh();
  const recompute = useMutation({
    mutationFn: () => recomputeProposal(proposal.id, proposal.version),
    onSuccess: (saved) => {
      refresh();
      toast.success(t("recomputed"));
      onDone?.(saved);
    },
    onError: (error) => {
      refresh();
      toast.error(describe(error));
    },
  });
  return (
    <Button variant={variant} size="sm" onClick={() => recompute.mutate()} loading={recompute.isPending} icon={<RotateCw aria-hidden className="size-4" />}>
      {t("recompute")}
    </Button>
  );
}

type DialogProps = { proposal: IncentiveProposal; live: IncentiveProposal | null; onClose: () => void };

/**
 * Approves one proposal at its proposed amount or at an edited one with a reason (workforce §3.3, §4.4). The amount is
 * what the person typed, in AED, converted to fils without float math; the API holds the range. The dialog works on a
 * copy (useSeenRecord): after a 409 STALE_VERSION it shows the proposal as saved now and asks again; a 409 METRICS_STALE
 * says the month's figures changed and offers the recompute right here.
 */
export function ApproveProposalDialog({ proposal, live, onClose, mode = "approve" }: DialogProps & { mode?: "approve" | "edit" }) {
  const t = useTranslations("admin.incentives.approve");
  const e = useTranslations("admin.incentives.errors");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useIncentiveRefresh();
  const seen = useSeenRecord(live ?? proposal);
  const record = seen.record;
  const [amount, setAmount] = useState(() => filsToAedInput(proposal.proposed_fils));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const gone = live === null;
  const stale = seen.waiting || seen.renewed;

  const approve = useMutation({
    mutationFn: async () => {
      const checked = validateApproval(record, amount, reason);
      if (!checked.ok) throw new FormProblem(checked.errors);
      seen.seen();
      return approveProposal(record.id, checked.input, record.version);
    },
    onSuccess: () => {
      refresh();
      toast.success(t("done", { name: isolate(record.worker.display_name) }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof FormProblem) return setErrors({ amount: error.errors.amount && e(error.errors.amount), reason: error.errors.reason && e(error.errors.reason) });
      refresh();
      if (error instanceof AdminApiError) {
        if (error.code === "STALE_VERSION" || error.code === "INVALID_STATE") seen.moved();
        if (error.code === "AMOUNT_OUT_OF_RANGE") setErrors({ amount: describe(error) });
        if (error.code === "REASON_REQUIRED") setErrors({ reason: e("reasonRequired") });
      }
    },
  });
  const edited = amount.trim() !== filsToAedInput(record.proposed_fils);
  const staleFigures = approve.error instanceof AdminApiError && approve.error.code === "METRICS_STALE";

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t(mode === "edit" ? "editTitle" : "title", { name: isolate(record.worker.display_name) })}
      description={t(mode === "edit" ? "editBody" : "body", { month: wt.month(record.period.start.slice(0, 7)) })}
      confirmLabel={t(mode === "edit" ? "confirmEdit" : "confirm")}
      pending={approve.isPending}
      onConfirm={() => {
        if (gone || seen.waiting) return;
        approve.mutate();
      }}
    >
      {gone && <Notice tone="danger">{t("gone")}</Notice>}
      {stale && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
      {record.metrics_stale_at !== null && <Notice tone="warning">{t("staleBanner")}</Notice>}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-ink-600">{t("proposed")}</dt>
          <dd className="font-latin font-bold text-ink-900">{wt.money(record.proposed_fils)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-600">{t("score")}</dt>
          <dd className="font-latin text-ink-900">{bpText(record.score_bp)}%</dd>
        </div>
      </dl>
      <MoneyField
        label={t("amount")}
        required
        value={amount}
        onChange={(ev) => {
          setAmount(ev.target.value);
          setErrors((x) => ({ ...x, amount: undefined }));
        }}
        error={errors.amount}
        hint={t("amountHint")}
      />
      <TextArea
        label={t("reason")}
        required={edited}
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(ev) => {
          setReason(ev.target.value);
          setErrors((x) => ({ ...x, reason: undefined }));
        }}
        error={errors.reason}
        hint={edited ? t("reasonRequiredHint") : t("reasonOptionalHint")}
      />
      {staleFigures && (
        <Notice tone="warning" action={<RecomputeButton proposal={record} onDone={() => seen.moved()} />}>
          {describe(approve.error)}
        </Notice>
      )}
      {approve.error && !(approve.error instanceof FormProblem) && !stale && !staleFigures && <Notice tone="danger">{describe(approve.error)}</Notice>}
    </ConfirmDialog>
  );
}

class FormProblem extends Error {
  constructor(readonly errors: { amount?: "amountInvalid" | "amountZero" | "reasonRequired"; reason?: "amountInvalid" | "amountZero" | "reasonRequired" }) {
    super("form");
  }
}

function useReasonDecision(kind: "reject" | "reopen") {
  return kind === "reject" ? rejectProposal : reopenProposal;
}

/** Rejects (HR's decision) or reopens (back to proposed, until posted) one proposal with a reason of at least 3 characters. */
export function ReasonDecisionDialog({ kind, proposal, live, onClose }: DialogProps & { kind: "reject" | "reopen" }) {
  const t = useTranslations(`admin.incentives.${kind}`);
  const e = useTranslations("admin.incentives.errors");
  const toast = useToast();
  const describe = useWorkforceError();
  const refresh = useIncentiveRefresh();
  const send = useReasonDecision(kind);
  const seen = useSeenRecord(live ?? proposal);
  const record = seen.record;
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const gone = live === null;
  const stale = seen.waiting || seen.renewed;
  const run = useMutation({
    mutationFn: () => send(record.id, reason.trim(), record.version),
    onSuccess: () => {
      refresh();
      toast.success(t("done", { name: isolate(record.worker.display_name) }));
      onClose();
    },
    onError: (error) => {
      refresh();
      if (error instanceof AdminApiError && (error.code === "STALE_VERSION" || error.code === "INVALID_STATE")) seen.moved();
    },
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("title", { name: isolate(record.worker.display_name) })}
      description={t("body")}
      confirmLabel={t("confirm")}
      tone={kind === "reject" ? "danger" : "primary"}
      pending={run.isPending}
      onConfirm={() => {
        if (gone || seen.waiting) return;
        if (reason.trim().length < 3) return setProblem(e("reasonRequired"));
        setProblem(null);
        seen.seen();
        run.mutate();
      }}
    >
      {gone && <Notice tone="danger">{t("gone")}</Notice>}
      {stale && !gone && <Notice tone="warning">{seen.renewed ? t("movedRenewed") : t("movedWaiting")}</Notice>}
      <TextArea label={t("reason")} required rows={2} maxLength={500} value={reason} onChange={(ev) => { setReason(ev.target.value); setProblem(null); }} error={problem} />
      {run.error && !stale && <Notice tone="danger">{describe(run.error)}</Notice>}
    </ConfirmDialog>
  );
}
