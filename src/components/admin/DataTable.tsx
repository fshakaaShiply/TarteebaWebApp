"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { PageMeta } from "@/lib/admin/types";
import { Button } from "./Button";
import { EmptyState, ErrorState, Skeleton } from "./States";

export type Column<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  /** Accessible table name (visually hidden caption). */
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[] | undefined;
  getRowId: (row: T) => string | number;
  /** First load (no rows yet): skeleton rows. */
  loading?: boolean;
  /** Refetching with the previous page still shown. */
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  pagination?: { meta: PageMeta; onPageChange: (page: number) => void };
  minWidth?: number;
  className?: string;
};

/**
 * Admin table with server-side pagination (spec §17). Handles the loading, error (403 → permission denied) and empty
 * states itself, scrolls horizontally on small screens and keeps the previous page visible while the next loads.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  loading,
  fetching,
  error,
  onRetry,
  empty,
  pagination,
  minWidth = 720,
  className,
}: DataTableProps<T>) {
  const t = useTranslations("admin.ui");

  if (!rows && error) return <ErrorState error={error} onRetry={onRetry} />;

  const showSkeleton = loading && !rows;

  return (
    <div className={clsx("flex flex-col gap-3", className)}>
      <div className="overflow-x-auto" aria-busy={fetching || showSkeleton || undefined}>
        <table className={clsx("w-full border-collapse text-sm transition-opacity", fetching && "opacity-60")} style={{ minWidth }}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="text-ink-600">
              {columns.map((c) => (
                <th key={c.id} scope="col" className={clsx("px-2 py-2 text-start font-medium", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showSkeleton &&
              Array.from({ length: 5 }, (_, i) => (
                <tr key={`s${i}`} className="border-t border-line">
                  {columns.map((c) => (
                    <td key={c.id} className="px-2 py-3">
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))}
            {rows?.map((row) => (
              <tr key={getRowId(row)} className="border-t border-line align-middle">
                {columns.map((c) => (
                  <td key={c.id} className={clsx("px-2 py-2.5", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {showSkeleton && <span className="sr-only" role="status">{t("loading")}</span>}
      </div>

      {rows && rows.length === 0 && (empty ?? <EmptyState />)}

      {rows && rows.length > 0 && error ? <ErrorState error={error} onRetry={onRetry} className="py-4" /> : null}

      {pagination && rows && rows.length > 0 && <Pagination {...pagination} />}
    </div>
  );
}

export function Pagination({ meta, onPageChange }: { meta: PageMeta; onPageChange: (page: number) => void }) {
  const t = useTranslations("admin.ui");
  const from = (meta.current_page - 1) * meta.per_page + 1;
  const to = Math.min(meta.total, meta.current_page * meta.per_page);
  return (
    <nav aria-label={t("pagination")} className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-600">
      <p>{t("pageSummary", { from, to, total: meta.total })}</p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.current_page <= 1}
          onClick={() => onPageChange(meta.current_page - 1)}
          icon={<ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />}
        >
          {t("previous")}
        </Button>
        <span aria-current="page" className="px-1 font-medium text-ink-900">
          {t("pageOf", { page: meta.current_page, pages: Math.max(1, meta.last_page) })}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.current_page >= meta.last_page}
          onClick={() => onPageChange(meta.current_page + 1)}
          className="flex-row-reverse"
          icon={<ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />}
        >
          {t("next")}
        </Button>
      </div>
    </nav>
  );
}
