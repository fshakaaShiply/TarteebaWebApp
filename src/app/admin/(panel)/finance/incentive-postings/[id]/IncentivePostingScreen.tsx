"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ButtonLink, Card, DataTable, EmptyState, ErrorState, LoadingBlock, PageHeader, SignedFileLink, StatusBadge } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { INCENTIVE_POSTINGS_PATH, INCENTIVES_READ } from "@/lib/admin/nav";
import { fetchPosting, fetchPostingFile } from "@/lib/admin/workforce/endpoints";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { IncentivePosting } from "@/lib/admin/workforce/types";
import { RequirePermission } from "../../../../_components/RequirePermission";

type Line = NonNullable<IncentivePosting["lines"]>[number];

/**
 * One incentive posting (A09, incentives.approve or incentives.view): who it covers and the amounts, each line an
 * incentive or an adjustment, and the CSV accounting downloads. The file link is a fresh signed URL each time.
 */
export function IncentivePostingScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={INCENTIVES_READ}>
      <Posting id={/^\d+$/.test(id) ? Number(id) : null} />
    </RequirePermission>
  );
}

function BackLink() {
  const t = useTranslations("admin.incentives.postings");
  return (
    <ButtonLink href={INCENTIVE_POSTINGS_PATH} variant="ghost" size="sm" className="self-start" icon={<ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />}>
      {t("back")}
    </ButtonLink>
  );
}

function Posting({ id }: { id: number | null }) {
  const t = useTranslations("admin.incentives.postings");
  const wt = useWorkforceText();
  const locale = useLocale();
  const query = useQuery({ queryKey: workforceKeys.posting(id ?? 0), queryFn: () => fetchPosting(id as number), enabled: id !== null });
  if (id === null) {
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState error={new AdminApiError(404, { code: "NOT_FOUND", message: "", details: {} })} />
        </Card>
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        <BackLink />
        <LoadingBlock lines={6} className="rounded-lg bg-surface p-5 shadow-card" />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </>
    );
  }
  const posting = query.data;
  const lines = posting.lines ?? [];
  const columns = [
    {
      id: "worker",
      header: t("lineColumns.worker"),
      cell: (l: Line) => (
        <span className="flex flex-col">
          <bdi className="font-bold text-ink-900">{locale === "ar" ? l.worker.full_name.ar : l.worker.full_name.en}</bdi>
          <bdi dir="ltr" className="font-latin text-xs text-ink-600">
            {l.worker.employee_no}
          </bdi>
        </span>
      ),
    },
    { id: "kind", header: t("lineColumns.kind"), cell: (l: Line) => <StatusBadge tone={l.kind === "adjustment" ? "pending" : "confirmed"}>{t(`kind.${l.kind}`)}</StatusBadge> },
    {
      id: "amount",
      header: t("lineColumns.amount"),
      className: "text-end",
      cell: (l: Line) => (
        <span className="font-latin font-bold" dir="ltr">
          {wt.money(l.amount_fils)}
        </span>
      ),
    },
  ];
  return (
    <>
      <BackLink />
      <PageHeader
        title={
          <bdi dir="ltr" className="font-latin">
            {posting.reference}
          </bdi>
        }
        subtitle={t("detailSubtitle", { month: wt.month(posting.period.start.slice(0, 7)), by: posting.posted_by?.name ?? t("unknownUser"), time: wt.dateTime(posting.posted_at) })}
        actions={<SignedFileLink load={() => fetchPostingFile(posting.id)} label={t("downloadCsv")} subject={posting.reference} download />}
      />
      <Card title={t("linesTitle")}>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-600">{t("columns.period")}</dt>
            <dd className="text-ink-900">{wt.month(posting.period.start.slice(0, 7))}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-600">{t("columns.lines")}</dt>
            <dd className="font-latin text-ink-900">{posting.lines_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-600">{t("columns.total")}</dt>
            <dd className="font-latin font-bold text-ink-900" dir="ltr">
              {wt.money(posting.total_fils)}
            </dd>
          </div>
        </dl>
        <DataTable caption={t("linesCaption")} columns={columns} rows={lines} getRowId={(l) => `${l.kind}-${l.proposal_id ?? l.adjustment_id}`} empty={<EmptyState title={t("noLines")} />} minWidth={520} />
        <p className="text-xs text-ink-600">{t("finalNote")}</p>
      </Card>
    </>
  );
}
