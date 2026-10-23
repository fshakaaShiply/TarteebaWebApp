"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { emptyFilters, filtersFromParams, filtersToParams, hasFilters, type FilterSpec, type ListFilters } from "@/lib/admin/finance/filters";

/**
 * A09 list filters in the page URL (lib/admin/finance/filters.ts). Changes use history.replaceState, which Next keeps
 * in step with useSearchParams, so filtering never makes a server round trip; any change but the page starts on
 * page 1.
 */
export function useUrlFilters<S extends FilterSpec>(spec: S) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => filtersFromParams(spec, searchParams), [spec, searchParams]);

  const write = useCallback(
    (next: ListFilters<S>) => {
      const query = filtersToParams(spec, next).toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [spec, pathname],
  );

  const set = useCallback((changes: Partial<Record<keyof S, string>>) => write({ ...filters, ...changes, page: 1 }), [filters, write]);
  const setPage = useCallback((page: number) => write({ ...filters, page }), [filters, write]);
  const reset = useCallback(() => write(emptyFilters(spec)), [spec, write]);

  return { filters, set, setPage, reset, filtered: hasFilters(spec, filters) };
}
