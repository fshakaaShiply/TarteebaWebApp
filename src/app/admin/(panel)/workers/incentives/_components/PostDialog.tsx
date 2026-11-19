"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Checkbox, Dialog, Notice, SignedFileLink } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { fetchPostingFile, postIncentives, type PostInput } from "@/lib/admin/workforce/endpoints";
import { useWorkforceError } from "@/lib/admin/workforce/errors";
import { changedLineKeys, postLines, readIds, readTermsChanged, totalOf } from "@/lib/admin/workforce/incentives";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { ExpectedLine, IncentiveAdjustment, IncentivePosting, IncentiveProposal } from "@/lib/admin/workforce/types";
import { LinesTable } from "./BulkDialogs";
import { useIncentiveRefresh } from "./ProposalDialogs";

/**
 * Posts approved incentives and open adjustments of one month as one posting (workforce §3.3, §4.4): final, with its CSV
 * stored for accounting. The dialog lists every line and the total and sends them back (`expected_lines`,
 * `expected_total_fils`), so the money posted is the money confirmed line by line; 409 TERMS_CHANGED puts the new lines on
 * screen with the changes marked and asks again with a new key. The Idempotency-Key is kept while an attempt may be
 * repeated: a 503 POSTING_BUSY (another post of the month holds the lock) or a lost answer is retried with the same key,
 * so a second posting is never made. The adjustments of the month are included (each can be left out for this posting).
 */
export function PostDialog({
  period,
  proposals,
  adjustments,
  onClose,
}: {
  period: string;
  proposals: IncentiveProposal[];
  adjustments: IncentiveAdjustment[];
  onClose: () => void;
}) {
  const t = useTranslations("admin.incentives.post");
  const describe = useWorkforceError();
  const wt = useWorkforceText();
  const refresh = useIncentiveRefresh();
  const keys = useIdempotencyKeys();
  const [included, setIncluded] = useState<ReadonlySet<number>>(() => new Set(adjustments.map((a) => a.id)));
  // After a TERMS_CHANGED the lines are the API's; until then they are what the screen showed.
  const [override, setOverride] = useState<ExpectedLine[] | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [posted, setPosted] = useState<IncentivePosting | null>(null);

  const chosenAdjustments = adjustments.filter((a) => included.has(a.id));
  const lines = override ?? postLines(proposals, chosenAdjustments);
  const names = new Map<number, string>();
  for (const p of proposals) names.set(p.id, p.worker.display_name);
  // Adjustment lines share ids with proposals in the table's key space only through `kind`, so name them apart.
  const lineNames = (kind: ExpectedLine["kind"]) => (kind === "adjustment" ? new Map(adjustments.map((a) => [a.id, a.worker.display_name] as const)) : names);

  const body = (): PostInput => ({
    period,
    proposal_ids: lines.filter((l) => l.kind !== "adjustment").map((l) => l.id),
    adjustment_ids: lines.filter((l) => l.kind === "adjustment").map((l) => l.id),
    expected_lines: lines,
    expected_total_fils: totalOf(lines),
  });

  const post = useMutation({
    mutationFn: () => {
      const input = body();
      return postIncentives(input, keys.keyFor(input));
    },
    onSuccess: (posting) => {
      keys.settle();
      refresh();
      setPosted(posting);
    },
    onError: (error) => {
      keys.settle(error);
      refresh();
      const terms = readTermsChanged(error);
      if (terms) {
        setChanged(changedLineKeys(lines, terms.lines));
        setOverride(terms.lines);
      }
    },
  });
  const terms = post.error ? readTermsChanged(post.error) : null;
  const busy = post.error instanceof AdminApiError && post.error.code === "POSTING_BUSY";
  const badIds = post.error instanceof AdminApiError && (post.error.code === "PERIOD_MISMATCH" || post.error.code === "INVALID_STATE") ? readIds(post.error) : [];

  if (posted) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()} title={t("postedTitle")} footer={<Button onClick={onClose}>{t("close")}</Button>}>
        <Notice tone="success">{t("postedBody", { reference: posted.reference, count: posted.lines_count, total: wt.money(posted.total_fils) })}</Notice>
        <div className="flex flex-wrap items-start gap-3">
          <SignedFileLink load={() => fetchPostingFile(posted.id)} label={t("downloadFile")} download />
          <Link href={`/admin/finance/incentive-postings/${posted.id}`} className="touch-target text-sm font-bold">
            {t("openPosting")}
          </Link>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !post.isPending && onClose()}
      title={t("title", { month: wt.month(period) })}
      description={t("body")}
      size="lg"
      dismissible={!post.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={post.isPending}>
            {t("cancel")}
          </Button>
          <Button onClick={() => post.mutate()} loading={post.isPending} disabled={lines.length === 0}>
            {busy ? t("tryAgain") : terms ? t("confirmNew") : t("confirm")}
          </Button>
        </>
      }
    >
      <Notice tone="warning">{t("final")}</Notice>
      {terms && (
        <Notice tone="warning" title={t("termsChangedTitle")}>
          {t("termsChanged", { total: wt.money(terms.total) })}
        </Notice>
      )}
      {adjustments.length > 0 && !override && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-ink-900">{t("adjustmentsTitle")}</legend>
          {adjustments.map((a) => (
            <Checkbox
              key={a.id}
              label={t("adjustmentLabel", { name: a.worker.display_name, amount: wt.money(a.amount_fils) })}
              description={a.reason}
              checked={included.has(a.id)}
              onChange={(ev) =>
                setIncluded((previous) => {
                  const next = new Set(previous);
                  if (ev.target.checked) next.add(a.id);
                  else next.delete(a.id);
                  return next;
                })
              }
              disabled={post.isPending}
            />
          ))}
        </fieldset>
      )}
      <PostLines lines={lines} names={lineNames} changed={changed} />
      {busy && <Notice tone="warning">{describe(post.error)}</Notice>}
      {badIds.length > 0 && (
        <Notice tone="danger">
          {describe(post.error)} {t("badIds", { count: badIds.length })}
        </Notice>
      )}
      {post.error && !terms && !busy && badIds.length === 0 && <Notice tone="danger">{describe(post.error)}</Notice>}
    </Dialog>
  );
}

/** The lines of a post, the incentives first and the adjustments after: each kind is named from its own list (their ids overlap). */
function PostLines({ lines, names, changed }: { lines: readonly ExpectedLine[]; names: (kind: ExpectedLine["kind"]) => ReadonlyMap<number, string>; changed: ReadonlySet<string> }) {
  const t = useTranslations("admin.incentives.lines");
  const wt = useWorkforceText();
  const incentives = lines.filter((l) => l.kind !== "adjustment");
  const adjustments = lines.filter((l) => l.kind === "adjustment");
  return (
    <div className="flex flex-col gap-3">
      {incentives.length > 0 && <LinesTable lines={incentives} names={names("incentive")} changed={changed} showTotal={false} />}
      {adjustments.length > 0 && <LinesTable lines={adjustments} names={names("adjustment")} changed={changed} showTotal={false} />}
      <p className="flex justify-between gap-2 border-t border-line-strong pt-2 text-sm font-bold text-ink-900">
        <span>{t("total", { count: lines.length })}</span>
        <span className="font-latin" dir="ltr">
          {wt.money(totalOf(lines))}
        </span>
      </p>
    </div>
  );
}
