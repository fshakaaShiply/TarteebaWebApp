"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Select, Switch, TextField, useToast } from "@/components/admin";
import { createService } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { checkReason } from "@/lib/admin/catalog/fields";
import { MATERIALS_MODES, SERVICE_KINDS, newServiceValues, serviceCreateSchema, type ServiceCreateValues } from "@/lib/admin/catalog/forms";
import {
  BilingualFields,
  CodeField,
  EditorShell,
  FormErrorNotice,
  ReasonField,
  useCatalogInvalidate,
} from "../_components/CatalogFields";
import { useCatalogText, useFieldError } from "../_components/catalogText";

const FIELDS = [
  "code",
  "kind",
  "name.ar",
  "name.en",
  "name",
  "duration_minutes",
  "min_workers",
  "max_workers",
  "materials_mode",
  "reason",
] as const;

/** New service: identity and essentials; prices, packages and texts follow on the service page. */
export function CreateServiceDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("admin.catalog.services");
  const f = useTranslations("admin.catalog.serviceForm");
  const text = useCatalogText();
  const fieldError = useFieldError();
  const toast = useToast();
  const router = useRouter();
  const invalidate = useCatalogInvalidate();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(serviceCreateSchema),
    defaultValues: newServiceValues() satisfies ServiceCreateValues,
  });

  const create = useMutation({
    mutationFn: createService,
    onSuccess: (service) => {
      invalidate();
      toast.success(t("created", { name: text.name(service.name) }));
      onClose();
      router.push(`/admin/catalog/services/${service.id}`);
    },
    onError: (error) => setFieldsApplied(applyFieldErrors(error, setError, FIELDS)),
  });

  const submit = handleSubmit(({ payload, reason }) => {
    const reasonError = checkReason(reason);
    if (reasonError) {
      setError("reason", { message: reasonError });
      return;
    }
    create.mutate({ ...payload, reason: reason.trim() });
  });

  return (
    <EditorShell
      mode="create"
      title={t("createTitle")}
      description={t("createBody")}
      formId={formId}
      pending={create.isPending}
      onClose={onClose}
    >
      <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <CodeField registration={register("code")} error={fieldError(errors.code)} />
        <Select
          label={f("kind")}
          required
          options={SERVICE_KINDS.map((k) => ({ value: k, label: text.kind(k) }))}
          error={fieldError(errors.kind)}
          {...register("kind")}
        />
        <div className="sm:col-span-2">
          <BilingualFields
            label={f("name")}
            required
            ar={register("name.ar")}
            en={register("name.en")}
            errorAr={fieldError(errors.name?.ar ?? errors.name)}
            errorEn={fieldError(errors.name?.en)}
          />
        </div>
        <TextField
          label={f("duration")}
          hint={f("durationHint")}
          inputMode="numeric"
          dir="ltr"
          className="font-latin text-start"
          required
          error={fieldError(errors.duration_minutes)}
          {...register("duration_minutes")}
        />
        <Select
          label={f("materials")}
          options={MATERIALS_MODES.map((m) => ({ value: m, label: text.materials(m) }))}
          error={fieldError(errors.materials_mode)}
          {...register("materials_mode")}
        />
        <TextField
          label={f("minWorkers")}
          inputMode="numeric"
          dir="ltr"
          className="font-latin text-start"
          required
          error={fieldError(errors.min_workers)}
          {...register("min_workers")}
        />
        <TextField
          label={f("maxWorkers")}
          inputMode="numeric"
          dir="ltr"
          className="font-latin text-start"
          required
          error={fieldError(errors.max_workers)}
          {...register("max_workers")}
        />
        <Controller
          control={control}
          name="is_bookable_online"
          render={({ field }) => (
            <Switch label={f("bookableOnline")} description={f("bookableOnlineHint")} checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
        <Controller
          control={control}
          name="is_active"
          render={({ field }) => (
            <Switch label={f("active")} description={f("activeCreateHint")} checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
        <div className="sm:col-span-2">
          <ReasonField registration={register("reason")} error={fieldError(errors.reason)} />
        </div>
        <div className="sm:col-span-2">
          <FormErrorNotice error={create.error} fieldsApplied={fieldsApplied} />
        </div>
      </form>
    </EditorShell>
  );
}
