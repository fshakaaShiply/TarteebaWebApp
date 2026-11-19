"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog, Notice, TextArea, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { isolate } from "@/lib/admin/format";
import { bulkApprove, bulkReject } from "@/lib/admin/workforce/endpoints";
import { useWorkforceError } from "@/lib/admin/workforce/errors";
import { approveLines, changedLineKeys, lineKey, readIds, readTermsChanged, totalOf } from "@/lib/admin/workforce/incentives";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { ExpectedLine, IncentiveProposal } from "@/lib/admin/workforce/types";
import { RecomputeButton, useIncentiveRefresh } from "./ProposalDialogs";

/** The lines the dialog shows: each worker and the amount, the ones that changed marked, and the total. */
export function LinesTable({ lines, names, changed, showTotal = true }: { lines: readonly ExpectedLine[]; names: ReadonlyMap<number, string>; changed: ReadonlySet<string>; showTotal?: boolean }) {
  const t = useTranslations("admin.incentives.lines");
  const wt = useWorkforceText();
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("caption")}</caption>
        <tbody className="divide-y divide-line">
          {lines.map((line) => {
            const key = lineKey(line);
            const isChanged = changed.has(key);
            return (
              <tr key={key} className={isChanged ? "bg-apricot-100" : undefined}>
                <th scope="row" className="py-1.5 pe-2 text-start font-medium text-ink-900">
                  <bdi>{names.get(line.id) ?? t("unknown", { id: line.id })}</bdi>
                  {line.kind === "adjustment" && <span className="ms-2 text-xs font-normal text-ink-600">{t("adjustment")}</span>}
                  {isChanged && <span className="ms-2 text-xs font-bold text-warning-700">{t("changed")}</span>}
                </th>
                <td className="py-1.5 text-end font-latin" dir="ltr">
                  {wt.money(line.amount_fils)}
                </td>
              </tr>
            );
          })}
        </tbody>
        {showTotal && (
        <tfoot>
          <tr className="border-t border-line-strong">
            <th scope="row" className="py-2 pe-2 text-start font-bold text-ink-900">
              {t("total", { count: lines.length })}
            </th>
            <td className="py-2 text-end font-latin font-bold" dir="ltr">
              {wt.money(totalOf(lines))}
            </td>
          </tr>
        </tfoot>
        )}
      </table>
    </div>
  );
}

const nameMap = (proposals: readonly IncentiveProposal[]) => new Map(proposals.map((p) => [p.id, p.worker.display_name] as const));

/**
 * Approves the selected proposals, each at the amount it was proposed. The dialog sends the lines it showed and their
 * total (`expected_lines`, `expected_total_fils`): when any line differs under the API's locks the answer is 409
 * TERMS_CHANGED, the new lines replace the old with the changes marked, and a fresh confirm is needed. A 409 METRICS_STALE
 * names the proposals whose month changed after they were computed: each has its recompute button right here.
 */
export function BulkApproveDialog({ proposals, live, onClose }: { proposals: IncentiveProposal[]; live: readonly IncentiveProposal[]; onClose: () => void }) {
  const t = useTranslations("admin.incentives.bulkApprove");
  const toast = useToast();
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useIncentiveRefresh();
  const names = nameMap(proposals);
  const [lines, setLines] = useState<ExpectedLine[]>(() => approveLines(proposals));
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [staleIds, setStaleIds] = useState<number[]>([]);

  const approve = useMutation({
    mutationFn: () => bulkApprove({ proposal_ids: lines.map((l) => l.id), expected_lines: lines, expected_total_fils: totalOf(lines) }),
    onSuccess: (result) => {
      refresh();
      toast.success(t("done", { count: result.approved, total: wt.money(result.total_fils) }));
      onClose();
    },
    onError: (error) => {
      refresh();
      setStaleIds([]);
      const terms = readTermsChanged(error);
      if (terms) {
        setChanged(changedLineKeys(lines, terms.lines));
        setLines(terms.lines);
        return;
      }
      if (error instanceof AdminApiError && error.code === "METRICS_STALE") setStaleIds(readIds(error));
    },
  });
  const terms = approve.error ? readTermsChanged(approve.error) : null;
  const liveById = new Map(live.map((p) => [p.id, p] as const));

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("title", { count: lines.length })}
      description={t("body")}
      confirmLabel={terms ? t("confirmNew") : t("confirm")}
      size="lg"
      pending={approve.isPending}
      onConfirm={() => {
        setChanged(new Set());
        approve.mutate();
      }}
    >
      {terms && (
        <Notice tone="warning" title={t("termsChangedTitle")}>
          {t("termsChanged", { total: wt.money(terms.total) })}
        </Notice>
      )}
      <LinesTable lines={lines} names={names} changed={changed} />
      {staleIds.length > 0 && (
        <Notice tone="warning" title={describe(approve.error)}>
          <ul className="flex flex-col gap-1.5">
            {staleIds.map((id) => {
              const row = liveById.get(id);
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2">
                  <bdi>{names.get(id) ?? isolate(String(id), "ltr")}</bdi>
                  {row && <RecomputeButton proposal={row} />}
                </li>
              );
            })}
          </ul>
        </Notice>
      )}
      {approve.error && !terms && staleIds.length === 0 && <Notice tone="danger">{describe(approve.error)}</Notice>}
    </ConfirmDialog>
  );
}

/** Rejects the selected proposals with one reason (HR's decision, at least 3 characters). */
export function BulkRejectDialog({ proposals, onClose }: { proposals: IncentiveProposal[]; onClose: () => void }) {
  const t = useTranslations("admin.incentives.bulkReject");
  const e = useTranslations("admin.incentives.errors");
  const toast = useToast();
  const describe = useWorkforceError();
  const refresh = useIncentiveRefresh();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const reject = useMutation({
    mutationFn: () => bulkReject({ proposal_ids: proposals.map((p) => p.id), reason: reason.trim() }),
    onSuccess: (result) => {
      refresh();
      toast.success(t("done", { count: result.rejected }));
      onClose();
    },
    onError: () => refresh(),
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("title", { count: proposals.length })}
      description={t("body")}
      confirmLabel={t("confirm")}
      tone="danger"
      pending={reject.isPending}
      onConfirm={() => {
        if (reason.trim().length < 3) return setProblem(e("reasonRequired"));
        setProblem(null);
        reject.mutate();
      }}
    >
      <ul className="flex flex-wrap gap-1.5 text-sm">
        {proposals.map((p) => (
          <li key={p.id} className="rounded-pill bg-neutral-100 px-2.5 py-0.5">
            <bdi>{p.worker.display_name}</bdi>
          </li>
        ))}
      </ul>
      <TextArea label={t("reason")} required rows={2} maxLength={500} value={reason} onChange={(ev) => { setReason(ev.target.value); setProblem(null); }} error={problem} />
      {reject.error && <Notice tone="danger">{describe(reject.error)}</Notice>}
    </ConfirmDialog>
  );
}
