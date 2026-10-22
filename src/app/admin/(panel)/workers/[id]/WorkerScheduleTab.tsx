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
import { useWorkerCache } from "./workerShared";

type ShiftsInput = { shifts: ShiftRow[]; weekly_rest_day: number };

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
  const guard = useShortfallGuard<ShiftsInput>();
  const [initial, setInitial] = useState(() => ({ draft: toShiftDraft(worker.shifts), restDay: worker.weekly_rest_day }));
  const [draft, setDraft] = useState<ShiftDraft>(initial.draft);
  const [restDay, setRestDay] = useState(initial.restDay);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<number, string>>>({});
  const [stale, setStale] = useState(false);

  const dirty =
    restDay !== initial.restDay || JSON.stringify(serializeShifts(draft)) !== JSON.stringify(serializeShifts(initial.draft));
  useUnsavedChanges(dirty);
  const errors: Partial<Record<number, ShiftError>> = attempted ? validateShifts(draft, restDay) : {};
  const noWorkingDay = Object.values(draft).every((row) => !row.working);

  const load = (w: Worker) => {
    const next = { draft: toShiftDraft(w.shifts), restDay: w.weekly_rest_day };
    setInitial(next);
    setDraft(next.draft);
    setRestDay(next.restDay);
    setAttempted(false);
    setServerErrors({});
  };

  const save = useMutation({
    mutationFn: ({ input, force }: { input: ShiftsInput; force?: ForceInput }) =>
      updateWorkerShifts(worker.id, input, cache.version(worker), force),
    onSuccess: (saved) => {
      cache.saved(saved);
      load(saved);
      guard.clear();
      toast.success(t("saved", { name: saved.display_name }));
    },
    onError: (error, vars) => {
      if (guard.capture(error, vars.input)) return;
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
    save.mutate({ input: { shifts: serializeShifts(draft), weekly_rest_day: restDay } });
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
          setDraft(next);
          setServerErrors({});
        }}
        onRestDayChange={(day) => {
          setRestDay(day);
          setServerErrors({});
        }}
        errors={errors}
        serverErrors={serverErrors}
      />
      {otherError ? <Notice tone="danger">{describe(save.error)}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => load(worker)}>
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
          onForce={(force) => save.mutate({ input: pending.vars, force })}
        />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void cache.reload(worker.id).then(load);
        }}
      />
    </Card>
  );
}
