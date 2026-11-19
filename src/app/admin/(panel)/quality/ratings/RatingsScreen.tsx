"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Checkbox, CustomerLink, DataTable, Drawer, EmptyState, ErrorState, FilterBar, LoadingBlock, Notice, PageHeader, SearchField, Select, StarRating, StatusBadge, type Column } from "@/components/admin";
import { Ltr } from "../../bookings/_components/BookingBits";
import { dateRangeValid, filterKey } from "@/lib/admin/finance/filters";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { fetchRating, fetchRatings } from "@/lib/admin/quality/endpoints";
import { RATING_FILTERS, RATING_KINDS, ratingQuery } from "@/lib/admin/quality/filters";
import { qualityKeys } from "@/lib/admin/quality/keys";
import { useQualityText } from "@/lib/admin/quality/labels";
import type { RatingRow } from "@/lib/admin/quality/types";
import { useAdminSession } from "@/lib/admin/session";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useUrlFilters } from "../../finance/_components/useUrlFilters";
import { AttachmentList } from "../_components/AttachmentLink";
import { ExcludeRatingDialog } from "./ExcludeRatingDialog";

const PER_PAGE = 25;

/**
 * A10 ratings (spec §17 A10; complaints.manage): every rating with the cleaners it counts for. The average on top leaves
 * out the ratings staff excluded (REQ line 97: a rating is only acted on after management review, and it never docks a
 * cleaner's pay by itself). A row opens a drawer with the whole comment, the photos and the exclusion.
 */
export function RatingsScreen() {
  const t = useTranslations("admin.quality.ratings");
  return (
    <RequirePermission anyOf={["complaints.manage"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Ratings />
    </RequirePermission>
  );
}

function Ratings() {
  const t = useTranslations("admin.quality.ratings");
  const f = useTranslations("admin.quality.filters");
  const text = useQualityText();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(RATING_FILTERS);
  const q = useDebouncedValue(filters.q.trim(), 300);
  const rangeValid = dateRangeValid(filters);
  const query = useMemo(() => ratingQuery(filters, q, PER_PAGE), [filters, q]);
  const list = useQuery({
    queryKey: qualityKeys.ratingList(filterKey(RATING_FILTERS, filters, { q, customer_id: filters.customer_id })),
    queryFn: () => fetchRatings(query),
    placeholderData: keepPreviousData,
    enabled: rangeValid,
  });
  const meta = list.data?.meta;
  useEffect(() => {
    if (meta && !list.isPlaceholderData && meta.current_page > Math.max(1, meta.last_page) && filters.page > 1) setPage(Math.max(1, meta.last_page));
  }, [meta, list.isPlaceholderData, filters.page, setPage]);

  const { can } = useAdminSession();
  const [openId, setOpenId] = useState<number | null>(null);

  const columns: Column<RatingRow>[] = [
    {
      id: "date",
      header: t("columns.visit"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          {can("bookings.view") ? (
            <Link href={`/admin/bookings/${r.booking.id}`} className="w-fit font-medium">
              <Ltr>{r.booking.reference}</Ltr>
            </Link>
          ) : (
            <Ltr>{r.booking.reference}</Ltr>
          )}
          <span className="text-xs text-ink-600">
            {text.date(r.service_date)} · {text.kind(r.booking.kind)}
          </span>
        </span>
      ),
    },
    { id: "customer", header: t("columns.customer"), cell: (r) => <CustomerLink customer={r.customer} /> },
    { id: "workers", header: t("columns.workers"), cell: (r) => (r.workers.length > 0 ? r.workers.map((w) => w.name).join("، ") : "—") },
    {
      id: "rating",
      header: t("columns.rating"),
      cell: (r) => (
        <span className="flex flex-col gap-1">
          <StarRating value={r.overall} size="sm" />
          <span className="flex flex-wrap gap-1">
            {r.is_low && <StatusBadge tone="danger">{t("low")}</StatusBadge>}
            {r.excluded && <StatusBadge tone="neutral">{t("excluded")}</StatusBadge>}
            {r.request_same_worker && <StatusBadge tone="confirmed">{t("sameWorker")}</StatusBadge>}
          </span>
        </span>
      ),
    },
    {
      id: "comment",
      header: t("columns.comment"),
      cell: (r) => (
        <span className="flex max-w-[280px] flex-col gap-0.5">
          {r.comment ? <span className="line-clamp-2 text-ink-900">“{r.comment}”</span> : <span className="text-ink-600">—</span>}
          {r.photos_count > 0 && <span className="text-xs text-ink-600">{t("photos", { count: r.photos_count })}</span>}
        </span>
      ),
    },
    {
      id: "case",
      header: t("columns.case"),
      cell: (r) =>
        r.case ? (
          <Link href={`/admin/quality/${r.case.id}`} className="font-medium">
            <Ltr>{r.case.reference}</Ltr>
          </Link>
        ) : (
          <span className="text-ink-600">—</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      cell: (r) => (
        <Button size="sm" variant="secondary" onClick={() => setOpenId(r.id)} aria-label={t("openLabel", { reference: r.booking.reference })}>
          {t("open")}
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-live="polite">
        {meta && (
          <>
            <span className="flex items-center gap-2 text-sm">
              <span className="text-ink-600">{t("average")}</span>
              <StarRating value={meta.average} showValue size="md" />
            </span>
            <span className="text-sm text-ink-600">{t("count", { count: meta.count })}</span>
          </>
        )}
      </div>
      <FilterBar canReset={filtered} onReset={reset}>
        <SearchField label={f("ratingSearch")} placeholder={f("ratingSearchPlaceholder")} value={filters.q} onChange={(v) => set({ q: v })} className="max-w-[240px]" />
        <Select label={f("kind")} placeholder={f("allKinds")} value={filters.kind} onChange={(e) => set({ kind: e.target.value })} options={RATING_KINDS.map((k) => ({ value: k, label: text.kind(k) }))} containerClassName="min-w-[190px]" />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ratings-from" className="text-sm font-medium text-ink-900">
            {f("visitFrom")}
          </label>
          <input id="ratings-from" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ratings-to" className="text-sm font-medium text-ink-900">
            {f("visitTo")}
          </label>
          <input id="ratings-to" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" />
        </div>
        <Checkbox label={f("lowOnly")} checked={filters.low === "1"} onChange={(e) => set({ low: e.target.checked ? "1" : "" })} className="self-center" />
        <Checkbox label={f("excludedOnly")} checked={filters.excluded === "1"} onChange={(e) => set({ excluded: e.target.checked ? "1" : "" })} className="self-center" />
        <Checkbox label={f("withComment")} checked={filters.has_comment === "1"} onChange={(e) => set({ has_comment: e.target.checked ? "1" : "" })} className="self-center" />
      </FilterBar>
      {(filters.worker_id !== "" || filters.customer_id !== "" || filters.zone_id !== "") && (
        <Notice
          tone="neutral"
          action={
            <button type="button" className="touch-target w-fit text-start text-sm font-bold text-petrol-700" onClick={() => set({ worker_id: "", customer_id: "", zone_id: "" })}>
              {f("clearScope")}
            </button>
          }
        >
          {filters.worker_id !== "" ? f("oneWorker", { id: filters.worker_id }) : filters.customer_id !== "" ? f("oneCustomer") : f("oneZone", { id: filters.zone_id })}
        </Notice>
      )}
      {!rangeValid && <Notice tone="warning">{f("rangeInvalid")}</Notice>}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(r) => r.id}
        loading={list.isPending && rangeValid}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? f("emptyFilteredBody") : undefined} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={980}
      />
      {openId !== null && <RatingDrawer id={openId} onClose={() => setOpenId(null)} />}
    </Card>
  );
}

function RatingDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const t = useTranslations("admin.quality.ratings");
  const text = useQualityText();
  const detail = useQuery({ queryKey: qualityKeys.rating(id), queryFn: () => fetchRating(id) });
  const [excluding, setExcluding] = useState(false);
  const r = detail.data;
  const parts = r ? (["quality", "punctuality", "conduct"] as const).filter((k) => r[k] !== null) : [];

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={r ? t("drawerTitle", { reference: r.booking.reference }) : t("drawerLoading")}
      description={r ? `${text.date(r.service_date)} · ${text.kind(r.booking.kind)}` : undefined}
      footer={
        r && (
          <Button variant={r.excluded ? "secondary" : "danger"} onClick={() => setExcluding(true)}>
            {r.excluded ? t("include") : t("exclude")}
          </Button>
        )
      }
    >
      {detail.isPending ? (
        <LoadingBlock lines={6} />
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        r && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <StarRating value={r.overall} showValue size="lg" />
              {r.is_low && <StatusBadge tone="danger">{t("low")}</StatusBadge>}
              {r.request_same_worker && <StatusBadge tone="confirmed">{t("sameWorker")}</StatusBadge>}
            </div>
            {parts.length > 0 && (
              <dl className="flex flex-col gap-1.5 text-sm">
                {parts.map((k) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <dt className="text-ink-600">{t(`scores.${k}`)}</dt>
                    <dd>
                      <StarRating value={r[k]} size="sm" />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-600">{t("columns.customer")}</dt>
                <dd>
                  <CustomerLink customer={r.customer} />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-600">{t("columns.workers")}</dt>
                <dd className="text-end">{r.workers.length > 0 ? r.workers.map((w) => w.name).join("، ") : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-600">{t("submitted")}</dt>
                <dd>{text.dateTime(r.created_at)}</dd>
              </div>
              {r.case && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-600">{t("columns.case")}</dt>
                  <dd>
                    <Link href={`/admin/quality/${r.case.id}`} className="font-medium">
                      <Ltr>{r.case.reference}</Ltr>
                    </Link>{" "}
                    · {text.status(r.case.status, r.case.status_label)}
                  </dd>
                </div>
              )}
            </dl>
            {r.comment ? <p className="whitespace-pre-wrap rounded-md bg-ivory-50 p-3 text-sm">“{r.comment}”</p> : <p className="text-sm text-ink-600">{t("noComment")}</p>}
            <AttachmentList files={r.photos} onRefresh={() => void detail.refetch()} refreshing={detail.isFetching} />
            {r.exclusion && (
              <Notice tone="neutral" title={t("excludedTitle")}>
                <span>{t("excludedBy", { name: r.exclusion.by?.name ?? t("someone"), time: text.dateTime(r.exclusion.at) })}</span>
                {r.exclusion.reason && <span className="block">“{r.exclusion.reason}”</span>}
              </Notice>
            )}
            {!r.excluded && <Notice tone="info">{t("excludeHint")}</Notice>}
          </div>
        )
      )}
      {excluding && r && <ExcludeRatingDialog rating={r} onClose={() => setExcluding(false)} />}
    </Drawer>
  );
}
