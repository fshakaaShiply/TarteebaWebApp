"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Drawer } from "@/components/admin";
import { isolate } from "@/lib/admin/format";
import { canApprove, canApproveAsProposed, isStale } from "@/lib/admin/workforce/incentives";
import type { IncentiveProposal } from "@/lib/admin/workforce/types";
import { ApproveProposalDialog, ReasonDecisionDialog, RecomputeButton } from "./ProposalDialogs";
import { ProposalFacts } from "./ProposalFacts";

type Decision = "approve" | "edit" | "reject" | "reopen";

/**
 * One proposal with its metrics and its own actions (row drawer of the proposals page): approve at the proposed amount or
 * an edited one with a reason, reject, reopen until posted, recompute when the month's figures changed, post. `proposal`
 * is the row the page holds now, so a decision shows its result at once; the dialogs keep their own copy.
 */
export function ProposalDrawer({
  proposal,
  onClose,
  onPost,
  canPost,
}: {
  proposal: IncentiveProposal;
  onClose: () => void;
  /** Opens the post dialog for this proposal (approved only). */
  onPost: (proposal: IncentiveProposal) => void;
  canPost: boolean;
}) {
  const t = useTranslations("admin.incentives.drawer");
  const [decision, setDecision] = useState<Decision | null>(null);
  const name = isolate(proposal.worker.display_name);
  return (
    <Drawer open onOpenChange={(open) => !open && onClose()} title={t("title", { name })} description={t("body", { employee: proposal.worker.employee_no })} size="md">
      <div className="flex flex-col gap-4">
        <ProposalFacts proposal={proposal} />
        <div className="flex flex-wrap items-center gap-2">
          {proposal.status === "proposed" && (
            <>
              {/* An AED 0.00 proposal cannot be approved as proposed (the API approves 1 fils or more): Edit or Reject. */}
              <Button onClick={() => setDecision("approve")} disabled={!canApproveAsProposed(proposal)}>
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
          {proposal.status === "approved" && canPost && <Button onClick={() => onPost(proposal)}>{t("post")}</Button>}
          {isStale(proposal) && proposal.status !== "posted" && <RecomputeButton proposal={proposal} />}
          <Link href={`/admin/workers/${proposal.worker.id}?tab=performance`} className="touch-target text-sm font-bold">
            {t("openWorker")}
          </Link>
        </div>
      </div>
      {(decision === "approve" || decision === "edit") && <ApproveProposalDialog proposal={proposal} live={proposal} mode={decision} onClose={() => setDecision(null)} />}
      {decision === "reject" && <ReasonDecisionDialog kind="reject" proposal={proposal} live={proposal} onClose={() => setDecision(null)} />}
      {decision === "reopen" && <ReasonDecisionDialog kind="reopen" proposal={proposal} live={proposal} onClose={() => setDecision(null)} />}
    </Drawer>
  );
}
