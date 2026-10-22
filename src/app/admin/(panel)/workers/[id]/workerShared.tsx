"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Notice } from "@/components/admin";
import { fetchWorker } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { Worker } from "@/lib/admin/types";
import { useOpsInvalidate } from "../../_ops/invalidate";

/**
 * Worker tabs share one cached profile: a save puts the returned worker (with its new version) in the cache and then
 * refreshes the lists and the capacity view. Which version a tab sends as If-Match is decided by editVersion() below.
 */
export function useWorkerCache() {
  const queryClient = useQueryClient();
  const invalidate = useOpsInvalidate();
  const saved = useCallback(
    (worker: Worker) => {
      queryClient.setQueryData(adminKeys.worker(worker.id), worker);
      invalidate(["admin", "workers", "list"], ["admin", "workers", "leaves", worker.id]);
    },
    [queryClient, invalidate],
  );
  /** After 409 STALE_VERSION: the latest profile from the API (also refreshes the cache). */
  const reload = useCallback(
    (id: number) => queryClient.fetchQuery({ queryKey: adminKeys.worker(id), queryFn: () => fetchWorker(id), staleTime: 0 }),
    [queryClient],
  );
  return { saved, reload };
}

export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The If-Match a worker tab sends (decision P1-04). The tabs stay mounted, and one version covers the whole profile
 * (fields, shifts, services, skills), so a tab must not send the latest cached version with values it loaded earlier:
 * it would pass the lock and write those stale values back (e.g. the rest day, which Info and Schedule both carry).
 *
 * `base` is the profile the tab's unsaved edits started from (null: no edits, the tab shows the cached profile), and
 * `read` picks the tab's own fields.
 *   - no edits: the cached version;
 *   - edits, and the tab's own fields are unchanged in the cached profile (another tab saved something else): the
 *     cached version, since the edits still apply on top;
 *   - edits, and the tab's own fields changed underneath (another tab, a leave decision or a refresh): `conflict`, and
 *     the version the edits started from, so the API answers 409 STALE_VERSION and the tab offers a reload.
 */
export function editVersion<T>(
  worker: Worker,
  base: Worker | null,
  read: (w: Worker) => T,
  same: (a: T, b: T) => boolean = sameJson,
): { version: number; conflict: boolean } {
  if (base === null) return { version: worker.version, conflict: false };
  if (worker.version <= base.version) return { version: base.version, conflict: false };
  if (same(read(base), read(worker))) return { version: worker.version, conflict: false };
  return { version: base.version, conflict: true };
}

/**
 * Local edits of one slice of the worker (`read`) for the tabs that keep their draft in state. Without edits the tab
 * shows the cached profile, so it follows saves made in other tabs; the first edit remembers the profile it started
 * from, which editVersion() compares with the cache when saving. Editing back to the starting values ends the edit.
 */
export function useWorkerDraft<T>(worker: Worker, read: (w: Worker) => T, same: (a: T, b: T) => boolean = sameJson) {
  const [edit, setEdit] = useState<{ value: T; base: Worker } | null>(null);
  const editing = edit !== null && !same(edit.value, read(edit.base)) ? edit : null;
  const value = editing ? editing.value : read(worker);
  const { version, conflict } = editVersion(worker, editing?.base ?? null, read, same);
  return {
    value,
    dirty: editing !== null,
    /** Unsaved edits whose fields changed elsewhere meanwhile: saving them answers STALE_VERSION. */
    conflict,
    /** If-Match for saving `value`. */
    version,
    set: (next: T) => setEdit({ value: next, base: editing?.base ?? worker }),
    /** Drops the edits (after a save, a discard or a reload): the tab shows the cached profile again. */
    reset: () => setEdit(null),
  };
}

/** Shown while a tab's unsaved edits are based on fields that changed elsewhere (editVersion's `conflict`). */
export function ChangedElsewhereNotice({ show }: { show: boolean }) {
  const t = useTranslations("admin.workers.detail");
  if (!show) return null;
  return <Notice tone="warning">{t("changedElsewhere")}</Notice>;
}
