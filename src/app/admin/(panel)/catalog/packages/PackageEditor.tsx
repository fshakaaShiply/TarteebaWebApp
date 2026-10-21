"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { MoneyField, Select, Switch, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createPackage, updatePackage, type PackagePayload } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { checkReason } from "@/lib/admin/catalog/fields";
import { DISCOUNT_TYPES, VISITS_PER_WEEK, packageFormSchema, packageToFormValues } from "@/lib/admin/catalog/forms";
import type { CatalogPackage } from "@/lib/admin/types";
import {
  BilingualFields,
  CodeField,
  EditorShell,
  FormErrorNotice,
  PolicySelect,
  ReasonField,
  SectionTitle,
  StaleDialog,
  useCatalogInvalidate,
} from "../_components/CatalogFields";
import { useCatalogText, useFieldError, useServiceOptions } from "../_components/catalogText";

const FIELDS = [
  "service_id",
  "code",
  "name",
  "name.ar",
  "name.en",
  "visits_per_week",
  "discount_type",
  "discount_value",
  "min_visits_for_discount",
  "auto_renew_allowed",
  "max_skips_per_month",
  "max_freeze_days",
  "is_active",
  "sort_order",
  "cancellation_policy_id",
  "reschedule_policy_id",
  "refund_policy_id",
  "reason",
] as const;

/** term_weeks / term_months errors belong to the single "term" input. */
const FIELD_MAP = { term_weeks: "term_value", term_months: "term_value" } as const;

/**
 * Create (dialog) or edit (drawer) a recurring package of standard visits (spec §6.3, REQ §4.4): visits per week
 * 1/2/3/4/6, a term in weeks or months, and a percent or fixed net discount (R-07).
 */
export function PackageEditor({
  pkg,
  serviceId,
  onClose,
}: {
  /** null = create. */
  pkg: CatalogPackage | null;
  /** Create from a service page: the service is fixed. */
  serviceId?: number;
  onClose: () => void;
}) {
  const mode = pkg ? "edit" : "create";
  const t = useTranslations("admin.catalog.packages");
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
    resolver: zodResolver(packageFormSchema(mode)),
    defaultValues: packageToFormValues(pkg, serviceId),
  });
  const discountType = useWatch({ control, name: "discount_type" });
  const termUnit = useWatch({ control, name: "term_unit" });

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: PackagePayload; reason: string }) =>
      pkg ? updatePackage(pkg.id, { ...payload, reason }, pkg.version) : createPackage({ ...payload, reason }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(pkg ? t("updated", { name: text.name(saved.name) }) : t("created", { name: text.name(saved.name) }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else setFieldsApplied(applyFieldErrors(error, setError, [...FIELDS, "term_value"], FIELD_MAP));
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

  const standardServices = (services.data ?? []).filter((s) => s.kind === "standard_visit");
  const numeric = { inputMode: "numeric" as const, dir: "ltr" as const, className: "font-latin text-start" };
  const serviceLocked = mode === "edit" || serviceId !== undefined;
  const lockedId = pkg?.service_id ?? serviceId;
  const lockedService = (services.data ?? []).find((s) => s.id === lockedId);
  const lockedServiceName = lockedService ? `${text.name(lockedService.name)} (${lockedService.code})` : lockedId ? `#${lockedId}` : "";

  return (
    <>
      <EditorShell
        mode={mode}
        title={pkg ? t("editTitle", { name: text.name(pkg.name) }) : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {serviceLocked ? (
            // Packages cannot move to another service; the stored service_id stays in the form values.
            <TextField label={t("service")} readOnly value={lockedServiceName} hint={t("serviceFixed")} />
          ) : (
            <Select
              label={t("service")}
              required
              placeholder={services.isPending ? t("loadingServices") : t("chooseService")}
              options={standardServices.map((s) => ({ value: String(s.id), label: `${text.name(s.name)} (${s.code})` }))}
              hint={services.isError ? t("servicesFailed") : t("serviceHint")}
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

          <div className="sm:col-span-2">
            <SectionTitle>{t("schedule")}</SectionTitle>
          </div>
          <Select
            label={t("visitsPerWeek")}
            options={VISITS_PER_WEEK.map((v) => ({ value: v, label: t("visitsOption", { count: Number(v) }) }))}
            error={fieldError(errors.visits_per_week)}
            {...register("visits_per_week")}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t("term")}
              required
              error={fieldError(errors.term_value)}
              hint={termUnit === "weeks" ? t("termWeeksHint") : t("termMonthsHint")}
              {...numeric}
              {...register("term_value")}
            />
            <Select
              label={t("termUnit")}
              options={[
                { value: "weeks", label: t("weeks") },
                { value: "months", label: t("months") },
              ]}
              {...register("term_unit")}
            />
          </div>
          <Controller
            control={control}
            name="auto_renew_allowed"
            render={({ field }) => <Switch label={t("autoRenew")} checked={field.value} onCheckedChange={field.onChange} />}
          />
          <TextField label={t("maxSkips")} hint={t("optionalHint")} error={fieldError(errors.max_skips_per_month)} {...numeric} {...register("max_skips_per_month")} />
          <TextField label={t("maxFreeze")} hint={t("optionalHint")} error={fieldError(errors.max_freeze_days)} {...numeric} {...register("max_freeze_days")} />

          <div className="sm:col-span-2">
            <SectionTitle description={t("discountHint")}>{t("discount")}</SectionTitle>
          </div>
          <Select
            label={t("discountType")}
            options={DISCOUNT_TYPES.map((d) => ({ value: d, label: text.discountType(d) }))}
            error={fieldError(errors.discount_type)}
            {...register("discount_type")}
          />
          {discountType === "fixed" ? (
            <MoneyField label={t("discountAmount")} hint={t("fixedNetHint")} error={fieldError(errors.discount_value)} {...register("discount_value")} />
          ) : (
            <TextField
              label={t("discountPercent")}
              suffix="%"
              hint={t("percentHint")}
              error={fieldError(errors.discount_value)}
              {...numeric}
              {...register("discount_value")}
            />
          )}
          <TextField
            label={t("minVisits")}
            hint={t("minVisitsHint")}
            error={fieldError(errors.min_visits_for_discount)}
            {...numeric}
            {...register("min_visits_for_discount")}
          />

          <div className="sm:col-span-2">
            <SectionTitle>{t("policies")}</SectionTitle>
          </div>
          <PolicySelect type="cancellation" control={control} name="cancellation_policy_id" error={fieldError(errors.cancellation_policy_id)} />
          <PolicySelect type="reschedule" control={control} name="reschedule_policy_id" error={fieldError(errors.reschedule_policy_id)} />
          <PolicySelect type="refund" control={control} name="refund_policy_id" error={fieldError(errors.refund_policy_id)} />
          <TextField label={t("sortOrder")} required error={fieldError(errors.sort_order)} {...numeric} {...register("sort_order")} />
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
