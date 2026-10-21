"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import clsx from "clsx";
import {
  Button,
  Card,
  IconButton,
  Notice,
  Select,
  Switch,
  TextField,
  controlClasses,
  useToast,
  useUnsavedChanges,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { previewCatalog, updateService } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { checkReason } from "@/lib/admin/catalog/fields";
import {
  MATERIALS_MODES,
  serviceFormSchema,
  serviceToFormValues,
  type ServiceFormOutput,
  type ServiceFormValues,
} from "@/lib/admin/catalog/forms";
import { buildServicePreviewRequest } from "@/lib/admin/catalog/preview";
import type { CatalogService } from "@/lib/admin/types";
import {
  BilingualFields,
  FormErrorNotice,
  PolicySelect,
  ReasonField,
  SectionTitle,
  StaleDialog,
  useCatalogInvalidate,
} from "../../_components/CatalogFields";
import { PreviewPanel } from "../../_components/PreviewPanel";
import { useCatalogText, useFieldError, useFieldMessageList } from "../../_components/catalogText";

const FIELDS = [
  "name",
  "name.ar",
  "name.en",
  "description",
  "description.ar",
  "description.en",
  "includes",
  "excludes",
  "duration_minutes",
  "min_workers",
  "max_workers",
  "team_size_default",
  "requires_equipment",
  "materials_mode",
  "is_active",
  "is_bookable_online",
  "sort_order",
  "cancellation_policy_id",
  "reschedule_policy_id",
  "refund_policy_id",
  "reason",
] as const;

/**
 * General tab: bilingual texts, includes/excludes, booking rules, visibility and policies. Save sends the loaded version
 * (If-Match) with a required reason; Preview sends the same unsaved values to POST /admin/catalog/preview.
 */
export function ServiceGeneralForm({ service, onReload }: { service: CatalogService; onReload: () => void }) {
  const t = useTranslations("admin.catalog.serviceForm");
  const text = useCatalogText();
  const fieldError = useFieldError();
  const fieldMessages = useFieldMessageList();
  const toast = useToast();
  const queryClient = useQueryClient();
  const invalidate = useCatalogInvalidate();
  const [stale, setStale] = useState(false);
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [previewedAt, setPreviewedAt] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: serviceToFormValues(service),
  });
  const watched = useWatch({ control });
  // Unsaved edits survive tab switches (the panel stays mounted); leaving the page or reloading asks first.
  useUnsavedChanges(isDirty);

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: Parameters<typeof updateService>[1]; reason: string }) =>
      updateService(service.id, { ...payload, reason }, service.version),
    onSuccess: (updated) => {
      // The PATCH answer has no prices / packages / plans: keep the loaded ones until the refetch lands.
      queryClient.setQueryData<CatalogService>(adminKeys.service(service.id), (old) => (old ? { ...old, ...updated } : updated));
      invalidate();
      toast.success(t("saved", { name: text.name(updated.name) }));
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else setFieldsApplied(applyFieldErrors(error, setError, FIELDS));
    },
  });

  const preview = useMutation({
    mutationFn: previewCatalog,
    onError: (error) => applyFieldErrors(error, setError, FIELDS, {}, { prefix: "service" }),
  });

  const onSave = handleSubmit(({ payload, reason }) => {
    const reasonError = checkReason(reason);
    if (reasonError) {
      setError("reason", { message: reasonError });
      return;
    }
    save.mutate({ payload, reason: reason.trim() });
  });

  const onPreview = handleSubmit(() => {
    const values = getValues();
    const built = buildServicePreviewRequest(service.code, values);
    if (!built.ok) return;
    setPreviewedAt(JSON.stringify(values));
    preview.mutate(built.request);
  });

  const outdated = preview.data !== undefined && previewedAt !== null && previewedAt !== JSON.stringify(watched);
  const previewMessages = preview.error ? fieldMessages(preview.error) : [];
  const numeric = { inputMode: "numeric" as const, dir: "ltr" as const, className: "font-latin text-start" };

  return (
    <>
      <Card>
        <form noValidate onSubmit={onSave} className="flex flex-col gap-5">
          <SectionTitle description={t("textsHint")}>{t("texts")}</SectionTitle>
          <BilingualFields
            label={t("name")}
            required
            ar={register("name.ar")}
            en={register("name.en")}
            errorAr={fieldError(errors.name?.ar ?? errors.name)}
            errorEn={fieldError(errors.name?.en)}
          />
          <BilingualFields
            label={t("description")}
            multiline
            ar={register("description.ar")}
            en={register("description.en")}
            errorAr={fieldError(errors.description?.ar ?? errors.description)}
            errorEn={fieldError(errors.description?.en)}
          />
          <div className="grid gap-5 xl:grid-cols-2">
            <BilingualListEditor
              control={control}
              register={register}
              errors={errors}
              name="includes"
              label={t("includes")}
              hint={t("includesHint")}
            />
            <BilingualListEditor
              control={control}
              register={register}
              errors={errors}
              name="excludes"
              label={t("excludes")}
              hint={t("excludesHint")}
            />
          </div>

          <SectionTitle description={t("rulesHint")}>{t("rules")}</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label={t("duration")} hint={t("durationHint")} required error={fieldError(errors.duration_minutes)} {...numeric} {...register("duration_minutes")} />
            <TextField label={t("minWorkers")} required error={fieldError(errors.min_workers)} {...numeric} {...register("min_workers")} />
            <TextField label={t("maxWorkers")} required error={fieldError(errors.max_workers)} {...numeric} {...register("max_workers")} />
            <TextField
              label={t("teamSize")}
              hint={t("teamSizeHint")}
              error={fieldError(errors.team_size_default)}
              {...numeric}
              {...register("team_size_default")}
            />
            <Select
              label={t("materials")}
              hint={t("materialsHint")}
              options={MATERIALS_MODES.map((m) => ({ value: m, label: text.materials(m) }))}
              error={fieldError(errors.materials_mode)}
              {...register("materials_mode")}
            />
            <TextField label={t("sortOrder")} hint={t("sortOrderHint")} required error={fieldError(errors.sort_order)} {...numeric} {...register("sort_order")} />
          </div>
          <Controller
            control={control}
            name="requires_equipment"
            render={({ field }) => (
              <Switch label={t("requiresEquipment")} description={t("requiresEquipmentHint")} checked={field.value} onCheckedChange={field.onChange} />
            )}
          />

          <SectionTitle>{t("visibility")}</SectionTitle>
          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <Switch label={t("active")} description={t("activeHint")} checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
          <Controller
            control={control}
            name="is_bookable_online"
            render={({ field }) => (
              <Switch label={t("bookableOnline")} description={t("bookableOnlineHint")} checked={field.value} onCheckedChange={field.onChange} />
            )}
          />

          <SectionTitle description={t("policiesHint")}>{t("policies")}</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-3">
            <PolicySelect type="cancellation" control={control} name="cancellation_policy_id" error={fieldError(errors.cancellation_policy_id)} />
            <PolicySelect type="reschedule" control={control} name="reschedule_policy_id" error={fieldError(errors.reschedule_policy_id)} />
            <PolicySelect type="refund" control={control} name="refund_policy_id" error={fieldError(errors.refund_policy_id)} />
          </div>

          <SectionTitle>{t("publish")}</SectionTitle>
          <ReasonField registration={register("reason")} error={fieldError(errors.reason)} />
          <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} />
          {preview.error && !(preview.error instanceof AdminApiError && preview.error.code === "VALIDATION_FAILED") && (
            <FormErrorNotice error={preview.error} fieldsApplied={false} />
          )}
          {previewMessages.length > 0 && (
            <Notice tone="danger" title={t("previewInvalid")}>
              <ul className="list-disc ps-5">
                {previewMessages.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={save.isPending} disabled={!isDirty}>
              {t("save")}
            </Button>
            <Button variant="secondary" onClick={() => void onPreview()} loading={preview.isPending} icon={<Eye aria-hidden className="size-4" />}>
              {t("preview")}
            </Button>
            <p className="text-xs text-ink-600">{t("auditNote")}</p>
          </div>
        </form>
      </Card>

      {preview.data && <PreviewPanel preview={preview.data} outdated={outdated} onClose={() => preview.reset()} />}

      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          onReload();
        }}
      />
    </>
  );
}

/** includes / excludes: rows of Arabic + English text, reorderable. */
function BilingualListEditor({
  control,
  register,
  errors,
  name,
  label,
  hint,
}: {
  control: Control<ServiceFormValues, unknown, ServiceFormOutput>;
  register: UseFormRegister<ServiceFormValues>;
  errors: FieldErrors<ServiceFormValues>;
  name: "includes" | "excludes";
  label: string;
  hint: string;
}) {
  const t = useTranslations("admin.catalog.serviceForm");
  const common = useTranslations("admin.catalog.common");
  const fieldError = useFieldError();
  const idPrefix = useId();
  const { fields, append, remove, move } = useFieldArray({ control, name });
  const listError = errors[name];
  const rowErrors = Array.isArray(listError) ? listError : [];
  const ownError = !Array.isArray(listError) ? fieldError(listError as { type?: string; message?: string } | undefined) : undefined;
  const ownErrorId = `${idPrefix}-error`;

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={ownError ? ownErrorId : undefined}>
      <legend className="mb-1 text-sm font-medium text-ink-900">{label}</legend>
      <p className="text-xs text-ink-600">{hint}</p>
      {fields.length === 0 ? (
        <p className="text-sm text-ink-600">{t("noItems")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {fields.map((field, i) => {
            const rowError = rowErrors[i] as { ar?: { type?: string; message?: string }; en?: { type?: string; message?: string } } | undefined;
            const arError = fieldError(rowError?.ar);
            const enError = fieldError(rowError?.en);
            // Each input points at its own message (the same text is shown once when both say the same).
            const arErrorId = `${idPrefix}-${i}-ar-error`;
            const enErrorId = enError && enError === arError ? arErrorId : `${idPrefix}-${i}-en-error`;
            return (
              <li key={field.id} className="flex flex-col gap-1 rounded-md border border-line p-2">
                <div className="flex items-start gap-2">
                  <span aria-hidden className="mt-3 w-5 shrink-0 text-center font-latin text-xs text-ink-600">
                    {i + 1}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <input
                      dir="rtl"
                      lang="ar"
                      aria-label={t("itemAr", { label, n: i + 1 })}
                      aria-invalid={arError ? true : undefined}
                      aria-describedby={arError ? arErrorId : undefined}
                      className={clsx(controlClasses, "h-10")}
                      {...register(`${name}.${i}.ar`)}
                    />
                    <input
                      dir="ltr"
                      lang="en"
                      aria-label={t("itemEn", { label, n: i + 1 })}
                      aria-invalid={enError ? true : undefined}
                      aria-describedby={enError ? enErrorId : undefined}
                      className={clsx(controlClasses, "h-10 text-start")}
                      {...register(`${name}.${i}.en`)}
                    />
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton label={t("moveUp", { n: i + 1 })} disabled={i === 0} onClick={() => move(i, i - 1)}>
                      <ArrowUp aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton label={t("moveDown", { n: i + 1 })} disabled={i === fields.length - 1} onClick={() => move(i, i + 1)}>
                      <ArrowDown aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton label={t("removeItem", { n: i + 1 })} onClick={() => remove(i)} className="text-danger-700">
                      <Trash2 aria-hidden className="size-4" />
                    </IconButton>
                  </div>
                </div>
                {arError && (
                  <p id={arErrorId} className="ps-7 text-xs font-medium text-danger-700">
                    {arError}
                  </p>
                )}
                {enError && enErrorId !== arErrorId && (
                  <p id={enErrorId} className="ps-7 text-xs font-medium text-danger-700">
                    {enError}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {ownError && (
        <p id={ownErrorId} className="text-xs font-medium text-danger-700">
          {ownError}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={fields.length >= 30}
        onClick={() => append({ ar: "", en: "" })}
        icon={<Plus aria-hidden className="size-4" />}
      >
        {common("addItem")}
      </Button>
    </fieldset>
  );
}
