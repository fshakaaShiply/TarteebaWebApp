"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { MoneyField, Notice, Select, StatusBadge, Switch, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createLiveOutPlan, updateLiveOutPlan, type LiveOutPlanPayload } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { checkReason } from "@/lib/admin/catalog/fields";
import { PLAN_KINDS, liveOutPlanFormSchema, planToFormValues } from "@/lib/admin/catalog/forms";
import type { LiveOutPlan } from "@/lib/admin/types";
import {
  BilingualFields,
  CodeField,
  EditorShell,
  FormErrorNotice,
  ReasonField,
  SectionTitle,
  StaleDialog,
  useCatalogInvalidate,
} from "../_components/CatalogFields";
import { useCatalogText, useFieldError, useServiceOptions } from "../_components/catalogText";

/** "3 / 5" read left to right inside a sentence in either language (the label stays outside the isolate). */
const contractFigures = (chunks: ReactNode) => (
  <bdi dir="ltr" className="font-latin font-medium">
    {chunks}
  </bdi>
);

const FIELDS = [
  "service_id",
  "code",
  "name",
  "name.ar",
  "name.en",
  "kind",
  "service_days_per_month",
  "rest_days_per_week",
  "work_hours",
  "break_minutes",
  "window_start",
  "window_end",
  "vat_inclusive",
  "max_active_contracts",
  "is_active",
  "sort_order",
  "reason",
] as const;

/**
 * Create (dialog) or edit (drawer) a Live-out plan (spec §6.3, §11.3): trial day or monthly, service days, rest days,
 * the daily window (work hours + break must fit), price and contract cap. A plan without a price stays hidden from
 * customers (D-03).
 */
export function PlanEditor({ plan, serviceId, onClose }: { plan: LiveOutPlan | null; serviceId?: number; onClose: () => void }) {
  const mode = plan ? "edit" : "create";
  const t = useTranslations("admin.catalog.liveOut");
  const text = useCatalogText();
  const fieldError = useFieldError();
  const toast = useToast();
  const invalidate = useCatalogInvalidate();
  const services = useServiceOptions();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(liveOutPlanFormSchema(mode)),
    defaultValues: planToFormValues(plan, serviceId),
  });
  const price = useWatch({ control, name: "price" });
  const windowStart = useWatch({ control, name: "window_start" });
  const windowEnd = useWatch({ control, name: "window_end" });
  // P4-07: Live-out visits take their times from the plan window; the slot template is only the capacity pool, so a
  // window that differs from the slot's is a warning, not an error. The API's own answer covers the saved plan; the
  // watched fields cover what is being typed.
  const slot = plan?.slot_window ?? null;
  const windowDiffers = slot ? windowStart !== slot.start || windowEnd !== slot.end : false;

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: LiveOutPlanPayload; reason: string }) =>
      plan ? updateLiveOutPlan(plan.id, { ...payload, reason }, plan.version) : createLiveOutPlan({ ...payload, reason }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(plan ? t("updated", { name: text.name(saved.name) }) : t("created", { name: text.name(saved.name) }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else setFieldsApplied(applyFieldErrors(error, setError, [...FIELDS, "price"], { price_fils: "price" }));
    },
  });

  const submit = handleSubmit(({ payload, reason }) => {
    const reasonError = checkReason(reason);
    if (reasonError) {
      setError("reason", { message: reasonError });
      return;
    }
    save.mutate({ payload, reason: reason.trim() });
  });

  const liveOutServices = (services.data ?? []).filter((s) => s.kind === "live_out");
  const serviceLocked = mode === "edit" || serviceId !== undefined;
  const lockedId = plan?.service_id ?? serviceId;
  const lockedService = (services.data ?? []).find((s) => s.id === lockedId);
  const lockedServiceName = lockedService ? `${text.name(lockedService.name)} (${lockedService.code})` : lockedId ? `#${lockedId}` : "";
  const numeric = { inputMode: "numeric" as const, dir: "ltr" as const, className: "font-latin text-start" };

  return (
    <>
      <EditorShell
        mode={mode}
        title={plan ? t("editTitle", { name: text.name(plan.name) }) : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {serviceLocked ? (
            <TextField label={t("service")} readOnly value={lockedServiceName} hint={t("serviceFixed")} />
          ) : (
            <Select
              label={t("service")}
              required
              placeholder={services.isPending ? t("loadingServices") : t("chooseService")}
              options={liveOutServices.map((s) => ({ value: String(s.id), label: `${text.name(s.name)} (${s.code})` }))}
              hint={services.isError ? t("servicesFailed") : undefined}
              error={fieldError(errors.service_id)}
              {...register("service_id")}
            />
          )}
          <CodeField registration={register("code")} disabled={mode === "edit"} error={fieldError(errors.code)} />
          <div className="sm:col-span-2">
            <BilingualFields
              label={t("name")}
              required
              ar={register("name.ar")}
              en={register("name.en")}
              errorAr={fieldError(errors.name?.ar ?? errors.name)}
              errorEn={fieldError(errors.name?.en)}
            />
          </div>
          <Select
            label={t("kind")}
            options={PLAN_KINDS.map((k) => ({ value: k, label: text.planKind(k) }))}
            error={fieldError(errors.kind)}
            {...register("kind")}
          />
          <TextField label={t("sortOrder")} required error={fieldError(errors.sort_order)} {...numeric} {...register("sort_order")} />

          <div className="sm:col-span-2">
            <SectionTitle description={t("dayHint")}>{t("day")}</SectionTitle>
          </div>
          <TextField label={t("serviceDays")} required error={fieldError(errors.service_days_per_month)} {...numeric} {...register("service_days_per_month")} />
          <TextField label={t("restDays")} required error={fieldError(errors.rest_days_per_week)} {...numeric} {...register("rest_days_per_week")} />
          <TextField label={t("workHours")} required error={fieldError(errors.work_hours)} {...numeric} {...register("work_hours")} />
          <TextField label={t("breakMinutes")} required error={fieldError(errors.break_minutes)} {...numeric} {...register("break_minutes")} />
          <TextField
            type="time"
            label={t("windowStart")}
            required
            dir="ltr"
            className="font-latin text-start"
            error={fieldError(errors.window_start)}
            {...register("window_start")}
          />
          <TextField
            type="time"
            label={t("windowEnd")}
            required
            dir="ltr"
            className="font-latin text-start"
            hint={t("windowHint")}
            error={fieldError(errors.window_end)}
            {...register("window_end")}
          />

          {slot && windowDiffers && (
            <Notice tone="warning" className="sm:col-span-2">
              {t("windowSlotWarning", { start: slot.start, end: slot.end, code: slot.code })}
            </Notice>
          )}
          <div className="sm:col-span-2">
            <SectionTitle>{t("pricing")}</SectionTitle>
          </div>
          <MoneyField label={t("price")} hint={t("priceHint")} error={fieldError(errors.price)} {...register("price")} />
          <Controller
            control={control}
            name="vat_inclusive"
            render={({ field }) => (
              <Switch label={t("vatInclusive")} description={t("vatInclusiveHint")} checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
          {price.trim() === "" && (
            <Notice tone="warning" className="sm:col-span-2">
              {t("unpricedNotice")}
            </Notice>
          )}
          {plan && (
            <p className="text-sm text-ink-700 sm:col-span-2" data-testid="active-contracts">
              {/* Only the figures are isolated left to right ("3 / 5"); the label keeps the page's direction. */}
              {plan.max_active_contracts === null
                ? t.rich("contractsNoCap", { count: plan.active_contracts, ltr: contractFigures })
                : t.rich("contractsOfCap", { count: plan.active_contracts, cap: plan.max_active_contracts, ltr: contractFigures })}
              {plan.unavailable_reason === "cap_reached" && (
                <StatusBadge tone="danger" className="ms-2">
                  {t("capReached")}
                </StatusBadge>
              )}
            </p>
          )}
          <TextField
            label={t("maxContracts")}
            hint={t("maxContractsHint")}
            error={fieldError(errors.max_active_contracts)}
            {...numeric}
            {...register("max_active_contracts")}
          />
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="is_active"
              render={({ field }) => (
                <Switch label={t("active")} description={t("activeHint")} checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
          <div className="sm:col-span-2">
            <ReasonField registration={register("reason")} error={fieldError(errors.reason)} />
          </div>
          <div className="sm:col-span-2">
            <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} />
          </div>
        </form>
      </EditorShell>
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          invalidate();
          onClose();
        }}
      />
    </>
  );
}
