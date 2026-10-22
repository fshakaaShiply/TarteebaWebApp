"use client";

import { useTranslations } from "next-intl";
import { Controller, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { ChipsInput, Select, Switch, TextArea, TextField } from "@/components/admin";
import { EMPLOYMENT_STATUSES, WEEK_ORDER, type WorkerFormValues, type WorkerPayload } from "@/lib/admin/ops/workforce";
import { AsyncOptionsSelect, BilingualFields } from "../catalog/_components/CatalogFields";
import { useZoneChoices } from "../_ops/options";
import { useOpsFieldError, useOpsText } from "../_ops/opsText";

/** API field names of the worker form, for VALIDATION_FAILED messages (applyFieldErrors). */
export const WORKER_FIELDS = [
  "employee_no",
  "full_name",
  "full_name.ar",
  "full_name.en",
  "display_name",
  "phone",
  "nationality",
  "languages",
  "employment_status",
  "hired_at",
  "home_zone_id",
  "can_live_out",
  "weekly_rest_day",
  "notes",
] as const;

/**
 * The worker profile fields (A05 Info): both languages of the full name, the customer-facing display name, phone,
 * nationality, languages, status, hire date, home zone, weekly rest day, Live-out eligibility and internal notes.
 * `privateFields` hides phone and notes when the API sent the basic profile.
 */
export function WorkerFormFields({
  register,
  control,
  errors,
  privateFields,
}: {
  register: UseFormRegister<WorkerFormValues>;
  control: Control<WorkerFormValues, unknown, WorkerPayload>;
  errors: FieldErrors<WorkerFormValues>;
  privateFields: boolean;
}) {
  const t = useTranslations("admin.workers.fields");
  const catalogT = useTranslations("admin.catalog.common");
  const text = useOpsText();
  const fieldError = useOpsFieldError();
  const zones = useZoneChoices();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        label={t("employeeNo")}
        required
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        className="font-latin text-start uppercase"
        hint={t("employeeNoHint")}
        error={fieldError(errors.employee_no)}
        {...register("employee_no")}
      />
      <TextField
        label={t("displayName")}
        required
        dir="auto"
        hint={t("displayNameHint")}
        error={fieldError(errors.display_name)}
        {...register("display_name")}
      />
      <div className="sm:col-span-2">
        <BilingualFields
          label={t("fullName")}
          required
          ar={register("full_name.ar")}
          en={register("full_name.en")}
          errorAr={fieldError(errors.full_name?.ar ?? errors.full_name)}
          errorEn={fieldError(errors.full_name?.en)}
        />
      </div>
      {privateFields && (
        <TextField
          label={t("phone")}
          type="tel"
          dir="ltr"
          autoComplete="off"
          className="font-latin text-start"
          hint={t("phoneHint")}
          error={fieldError(errors.phone)}
          {...register("phone")}
        />
      )}
      <TextField
        label={t("nationality")}
        dir="ltr"
        autoComplete="off"
        maxLength={2}
        className="font-latin text-start uppercase"
        hint={t("nationalityHint")}
        error={fieldError(errors.nationality)}
        {...register("nationality")}
      />
      <div className="sm:col-span-2">
        <Controller
          control={control}
          name="languages"
          render={({ field }) => (
            <ChipsInput
              label={t("languages")}
              value={field.value}
              onChange={(v) => field.onChange(v.map((l) => l.trim().toLowerCase()))}
              valueDir="ltr"
              hint={t("languagesHint")}
              error={fieldError(errors.languages as { message?: string; type?: string } | undefined)}
            />
          )}
        />
      </div>
      <AsyncOptionsSelect
        control={control}
        name="home_zone_id"
        label={t("homeZone")}
        options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
        loading={zones.isPending}
        failed={zones.isError}
        placeholder={t("chooseZone")}
        loadingLabel={catalogT("loadingOptions")}
        error={fieldError(errors.home_zone_id)}
      />
      <Select
        label={t("restDay")}
        required
        options={WEEK_ORDER.map((d) => ({ value: String(d), label: text.weekday(d) }))}
        hint={t("restDayHint")}
        error={fieldError(errors.weekly_rest_day)}
        {...register("weekly_rest_day")}
      />
      <Select
        label={t("status")}
        options={EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: text.employmentStatus(s) }))}
        hint={t("statusHint")}
        error={fieldError(errors.employment_status)}
        {...register("employment_status")}
      />
      <TextField
        type="date"
        label={t("hiredAt")}
        dir="ltr"
        className="font-latin text-start"
        error={fieldError(errors.hired_at)}
        {...register("hired_at")}
      />
      <div className="sm:col-span-2">
        <Controller
          control={control}
          name="can_live_out"
          render={({ field }) => (
            <Switch label={t("canLiveOut")} description={t("canLiveOutHint")} checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
      </div>
      {privateFields && (
        <div className="sm:col-span-2">
          <TextArea label={t("notes")} hint={t("notesHint")} rows={3} maxLength={2000} error={fieldError(errors.notes)} {...register("notes")} />
        </div>
      )}
    </div>
  );
}
