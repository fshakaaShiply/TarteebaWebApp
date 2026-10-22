"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, Notice, useToast, useUnsavedChanges } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { updateWorkerShifts } from "@/lib/admin/endpoints";
import { useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import type { ForceInput } from "@/lib/admin/ops/capacity";
import { serializeShifts, shiftErrorDay, toShiftDraft, validateShifts, type ShiftDraft, type ShiftError } from "@/lib/admin/ops/workforce";
import { useAdminSession } from "@/lib/admin/session";
import type { ShiftRow, Worker } from "@/lib/admin/types";
import { StaleDialog } from "../../catalog/_components/CatalogFields";
import { ShortfallDialog, useShortfallGuard } from "../../_ops/Shortfall";
import { ShiftEditor } from "./ShiftEditor";
import { ChangedElsewhereNotice, useWorkerCache, useWorkerDraft } from "./workerShared";

type ShiftsInput = { shifts: ShiftRow[]; weekly_rest_day: number };
type ScheduleDraft = { draft: ShiftDraft; restDay: number };

const readSchedule = (w: Worker): ScheduleDraft => ({ draft: toShiftDraft(w.shifts), restDay: w.weekly_rest_day });
// Hours of a day off do not count: compare what would be saved.
const sameSchedule = (a: ScheduleDraft, b: ScheduleDraft) =>
  a.restDay === b.restDay && JSON.stringify(serializeShifts(a.draft)) === JSON.stringify(serializeShifts(b.draft));

/**
 * Schedule tab: the weekly shift pattern and rest day (PUT /admin/workers/{id}/shifts, workers.manage). Both are saved
 * together, so moving the rest day and the shifts in one step is possible.
 */
export function WorkerScheduleTab({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.schedule");
  const { can } = useAdminSession();
  if (!can("workers.manage")) {
    return (
      <Card title={t("title")}>
        <ShiftEditor draft={toShiftDraft(worker.shifts)} restDay={worker.weekly_rest_day} readOnly />
      </Card>
    );
  }
  return <ScheduleForm worker={worker} />;
}

function ScheduleForm({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.schedule");
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const serverMessage = useServerFieldMessage();
  const errorsT = useTranslations("admin.catalog.errors");
  const cache = useWorkerCache();
  const guard = useShortfallGuard<{ input: ShiftsInput; version: number }>();
  // Without edits the editor shows the cached profile, so a rest day moved in the Info tab shows here too.
  const edit = useWorkerDraft(worker, readSchedule, sameSchedule);
  const { draft, restDay } = edit.value;
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<number, string>>>({});
  const [stale, setStale] = useState(false);

  useUnsavedChanges(edit.dirty);
  const errors: Partial<Record<number, ShiftError>> = attempted ? validateShifts(draft, restDay) : {};
  const noWorkingDay = Object.values(draft).every((row) => !row.working);

  const load = () => {
    edit.reset();
    setAttempted(false);
    setServerErrors({});
  };

  const save = useMutation({
    mutationFn: ({ input, version, force }: { input: ShiftsInput; version: number; force?: ForceInput }) =>
      updateWorkerShifts(worker.id, input, version, force),
    onSuccess: (saved) => {
      cache.saved(saved);
      load();
      guard.clear();
      toast.success(t("saved", { name: saved.display_name }));
    },
    onError: (error, vars) => {
      if (guard.capture(error, { input: vars.input, version: vars.version })) return;
      if (vars.force) return;
      guard.clear();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      if (error instanceof AdminApiError && error.code === "VALIDATION_FAILED") {
        const byDay: Partial<Record<number, string>> = {};
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const index = shiftErrorDay(field);
          if (index !== null && messages[0]) byDay[index] = serverMessage(messages[0], errorsT("invalid"));
        }
        setServerErrors(byDay);
      }
    },
  });

  const submit = () => {
    setAttempted(true);
    setServerErrors({});
    if (Object.keys(validateShifts(draft, restDay)).length > 0) return;
    save.mutate({ input: { shifts: serializeShifts(draft), weekly_rest_day: restDay }, version: edit.version });
  };

  const pending = guard.state;
  const otherError =
    save.error &&
    !pending &&
    !(save.error instanceof AdminApiError && ["STALE_VERSION", "CAPACITY_SHORTFALL"].includes(save.error.code)) &&
    !(save.error instanceof AdminApiError && save.error.code === "VALIDATION_FAILED" && Object.keys(serverErrors).length > 0);

  return (
    <Card title={t("title")}>
      <p className="text-sm/6 text-ink-600">{t("intro")}</p>
      {noWorkingDay && <Notice tone="warning">{t("noWorkingDay")}</Notice>}
      <ShiftEditor
        draft={draft}
        restDay={restDay}
        onChange={(next) => {
          edit.set({ draft: next, restDay });
          setServerErrors({});
        }}
        onRestDayChange={(day) => {
          edit.set({ draft, restDay: day });
          setServerErrors({});
        }}
        errors={errors}
        serverErrors={serverErrors}
      />
      {otherError ? <Notice tone="danger">{describe(save.error)}</Notice> : null}
      <ChangedElsewhereNotice show={edit.conflict} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={!edit.dirty || save.isPending} onClick={load}>
          {t("discard")}
        </Button>
        <Button onClick={submit} loading={save.isPending && !pending}>
          {t("save")}
        </Button>
      </div>
      {pending && (
        <ShortfallDialog
          shortfalls={pending.shortfalls}
          pending={save.isPending}
          forceError={save.error && !(save.error instanceof AdminApiError && save.error.code === "CAPACITY_SHORTFALL") ? save.error : null}
          onClose={guard.clear}
          onForce={(force) => save.mutate({ ...pending.vars, force })}
        />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void cache.reload(worker.id).then(() => load());
        }}
      />
    </Card>
  );
}
