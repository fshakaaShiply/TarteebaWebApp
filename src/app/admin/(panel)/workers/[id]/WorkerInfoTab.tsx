"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, Card, Notice, StatusBadge, useToast, useUnsavedChanges } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { updateWorker } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import type { ForceInput } from "@/lib/admin/ops/capacity";
import { hasPrivateFields, workerFormSchema, workerToFormValues, type WorkerPayload } from "@/lib/admin/ops/workforce";
import { useAdminSession } from "@/lib/admin/session";
import type { Worker } from "@/lib/admin/types";
import { FormErrorNotice, StaleDialog } from "../../catalog/_components/CatalogFields";
import { InfoRow } from "../../_ops/OpsFields";
import { ShortfallDialog, useShortfallGuard } from "../../_ops/Shortfall";
import { employmentTone, useOpsText } from "../../_ops/opsText";
import { WORKER_FIELDS, WorkerFormFields } from "../WorkerFormFields";
import { useWorkerCache } from "./workerShared";

/** Info tab: the profile form for workers.manage; a read-only profile (only what the API sent) for everyone else. */
export function WorkerInfoTab({ worker }: { worker: Worker }) {
  const { can } = useAdminSession();
  return can("workers.manage") ? <WorkerInfoForm worker={worker} /> : <WorkerInfoView worker={worker} />;
}

function WorkerInfoForm({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.info");
  const toast = useToast();
  const cache = useWorkerCache();
  const privateFields = hasPrivateFields(worker);
  const guard = useShortfallGuard<WorkerPayload>();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(workerFormSchema({ privateFields })), defaultValues: workerToFormValues(worker) });
  useUnsavedChanges(isDirty);

  const save = useMutation({
    mutationFn: ({ payload, force }: { payload: WorkerPayload; force?: ForceInput }) =>
      updateWorker(worker.id, payload, cache.version(worker), force),
    onSuccess: (saved) => {
      cache.saved(saved);
      reset(workerToFormValues(saved));
      guard.clear();
      toast.success(t("saved", { name: saved.display_name }));
    },
    onError: (error, vars) => {
      if (guard.capture(error, vars.payload)) return;
      // A failed "save anyway" keeps the shortfall dialog open with its error.
      if (vars.force) return;
      guard.clear();
      if (!(error instanceof AdminApiError)) return;
      if (error.code === "STALE_VERSION") setStale(true);
      else if (error.code === "PHONE_INVALID") {
        setError("phone", { message: "phoneInvalid" });
        setFieldsApplied(true);
      } else if (error.code === "SHIFT_ON_REST_DAY") {
        setError("weekly_rest_day", { message: "restDayShift" });
        setFieldsApplied(true);
      } else setFieldsApplied(applyFieldErrors(error, setError, WORKER_FIELDS));
    },
  });

  const pending = guard.state;

  return (
    <Card title={t("title")}>
      <p className="text-sm/6 text-ink-600">{t("intro")}</p>
      <form noValidate onSubmit={handleSubmit((payload) => save.mutate({ payload }))} className="flex flex-col gap-4">
        <WorkerFormFields register={register} control={control} errors={errors} privateFields={privateFields} />
        {save.error && !guard.state ? <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} /> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={!isDirty || save.isPending} onClick={() => reset(workerToFormValues(worker))}>
            {t("discard")}
          </Button>
          <Button type="submit" loading={save.isPending && !guard.state}>
            {t("save")}
          </Button>
        </div>
      </form>
      {pending && (
        <ShortfallDialog
          shortfalls={pending.shortfalls}
          pending={save.isPending}
          forceError={save.error && !(save.error instanceof AdminApiError && save.error.code === "CAPACITY_SHORTFALL") ? save.error : null}
          onClose={guard.clear}
          onForce={(force) => save.mutate({ payload: pending.vars, force })}
        />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void cache.reload(worker.id).then((fresh) => reset(workerToFormValues(fresh)));
        }}
      />
    </Card>
  );
}

/** Read-only profile: only the fields the API returned (the basic view has no phone or notes). */
function WorkerInfoView({ worker }: { worker: Worker }) {
  const t = useTranslations("admin.workers.fields");
  const info = useTranslations("admin.workers.info");
  const text = useOpsText();
  return (
    <Card title={info("title")}>
      {!hasPrivateFields(worker) && <Notice tone="neutral">{info("basicView")}</Notice>}
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InfoRow label={t("employeeNo")}>
          <bdi dir="ltr" className="font-latin">
            {worker.employee_no}
          </bdi>
        </InfoRow>
        <InfoRow label={t("displayName")}>{worker.display_name}</InfoRow>
        <InfoRow label={info("fullNameAr")}>
          <span lang="ar" dir="rtl">
            {worker.full_name.ar}
          </span>
        </InfoRow>
        <InfoRow label={info("fullNameEn")}>
          <span lang="en" dir="ltr">
            {worker.full_name.en}
          </span>
        </InfoRow>
        {"phone" in worker && worker.phone && (
          <InfoRow label={t("phone")}>
            <bdi dir="ltr" className="font-latin">
              {worker.phone}
            </bdi>
          </InfoRow>
        )}
        {worker.nationality && (
          <InfoRow label={t("nationality")}>
            <bdi dir="ltr" className="font-latin">
              {worker.nationality}
            </bdi>
          </InfoRow>
        )}
        {worker.languages.length > 0 && (
          <InfoRow label={t("languages")}>
            <bdi dir="ltr" className="font-latin">
              {worker.languages.join(", ")}
            </bdi>
          </InfoRow>
        )}
        <InfoRow label={t("status")}>
          <StatusBadge tone={employmentTone[worker.employment_status] ?? "neutral"}>{text.employmentStatus(worker.employment_status)}</StatusBadge>
        </InfoRow>
        {worker.home_zone && <InfoRow label={t("homeZone")}>{text.name(worker.home_zone.name)}</InfoRow>}
        <InfoRow label={t("restDay")}>{text.weekday(worker.weekly_rest_day)}</InfoRow>
        <InfoRow label={t("canLiveOut")}>{worker.can_live_out ? info("yes") : info("no")}</InfoRow>
        {worker.hired_at && <InfoRow label={t("hiredAt")}>{text.date(worker.hired_at)}</InfoRow>}
        {"notes" in worker && worker.notes && (
          <InfoRow label={t("notes")} className="sm:col-span-2 lg:col-span-3">
            <span className="whitespace-pre-line">{worker.notes}</span>
          </InfoRow>
        )}
      </dl>
    </Card>
  );
}
