"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  ChipsInput,
  Dialog,
  MoneyField,
  Notice,
  Select,
  Switch,
  TextArea,
  TextField,
  useToast,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { updateSetting } from "@/lib/admin/endpoints";
import { useOpsText } from "../_ops/opsText";
import { useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { readShortfalls } from "@/lib/admin/ops/capacity";
import { validateWeeklyDraft, type WeeklyHoursDraft, type WeeklyHoursError } from "@/lib/admin/ops/weeklyHours";
import { WEEK_ORDER } from "@/lib/admin/ops/weeklyHours";
import {
  INT_LIST_SETTINGS,
  INT_RANGES,
  QUARTER_HOUR_TIME_SETTINGS,
  SLA_TARGET_RANGE,
  SETTING_OPTIONS,
  editorKind,
  isBilingualDraft,
  parseDraft,
  toDraft,
  type EditorKind,
  type PrioritiesDraft,
  type QuietHoursDraft,
  type SettingDraft,
  type SettingDraftError,
  type SlaTargetsDraft,
} from "@/lib/admin/settings";
import type { Setting } from "@/lib/admin/types";
import { ShortfallTable } from "../_ops/Shortfall";
import { ChoicesEditor, PrioritiesEditor, QuietHoursEditor, SlaTargetsEditor } from "./StructuredEditors";
import { HolidaysEditor, WeeklyHoursEditor } from "./WeeklyHoursEditor";
import { useSettingText } from "./settingText";

const REASON_MAX = 500;

/**
 * Edits one setting: a type-aware editor, a required audit reason, and the loaded version sent as If-Match
 * (P1-04). A 409 STALE_VERSION closes this dialog and asks the admin to reload.
 */
export function SettingEditDialog({
  setting,
  onClose,
  onStale,
}: {
  setting: Setting;
  onClose: () => void;
  onStale: () => void;
}) {
  const t = useTranslations("admin.settings");
  const text = useSettingText();
  const describe = useAdminErrorMessage();
  const serverMessage = useServerFieldMessage();
  const errorsT = useTranslations("admin.errors");
  const toast = useToast();
  const queryClient = useQueryClient();
  const formId = useId();

  const kind = editorKind(setting);
  const options = SETTING_OPTIONS[setting.key]?.values;
  const enumValues =
    options && typeof setting.value === "string" && !options.includes(setting.value) ? [...options, setting.value] : options;

  const [draft, setDraft] = useState<SettingDraft>(() => toDraft(kind, setting.value));
  const [reason, setReason] = useState("");
  const [valueError, setValueError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [dayErrors, setDayErrors] = useState<Partial<Record<number, WeeklyHoursError>>>({});

  const save = useMutation({
    mutationFn: ({ value }: { value: unknown }) => updateSetting(setting.key, value, reason.trim(), setting.version),
    onSuccess: (updated) => {
      queryClient.setQueryData<Setting[]>(adminKeys.settings(), (list) =>
        list?.map((s) => (s.key === updated.key ? { ...s, value: updated.value, version: updated.version } : s)),
      );
      void queryClient.invalidateQueries({ queryKey: adminKeys.settings() });
      toast.success(t("saved", { name: text.label(setting) }));
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof AdminApiError)) return;
      if (error.code === "STALE_VERSION") onStale();
      else if (error.code === "INVALID_SETTING_VALUE") setValueError(describe(error));
      else if (error.code === "VALIDATION_FAILED") {
        const fields = error.fieldErrors;
        if (fields.value?.[0]) setValueError(serverMessage(fields.value[0], errorsT("fieldInvalid")));
        if (fields.reason?.[0]) setReasonError(serverMessage(fields.reason[0], errorsT("fieldInvalid")));
      }
    },
  });

  const range = INT_RANGES[setting.key];
  const listRule = INT_LIST_SETTINGS[setting.key];
  // A key with a range refuses null (Phase 5), even when an old row still holds one.
  const allowNull = setting.value === null && !range;
  const draftMessage = (error: SettingDraftError) =>
    t(`errors.${error}`, {
      min: range?.[0] ?? listRule?.min ?? SLA_TARGET_RANGE[0],
      max: range?.[1] ?? listRule?.max ?? SLA_TARGET_RANGE[1],
      count: listRule?.maxItems ?? 0,
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (kind === "weekly_hours") setDayErrors(validateWeeklyDraft(draft as WeeklyHoursDraft));
    const parsed = parseDraft(kind, draft, {
      allowNull,
      options: enumValues,
      range,
      key: setting.key,
    });
    const trimmedReason = reason.trim();
    setValueError(parsed.ok ? null : draftMessage(parsed.error));
    setReasonError(trimmedReason === "" ? t("errors.reason") : trimmedReason.length > REASON_MAX ? t("errors.reasonLength") : null);
    if (!parsed.ok || trimmedReason === "" || trimmedReason.length > REASON_MAX) return;
    save.mutate({ value: parsed.value });
  };

  const shortfalls = readShortfalls(save.error);
  const otherError =
    save.error &&
    !shortfalls &&
    !(save.error instanceof AdminApiError && ["STALE_VERSION", "INVALID_SETTING_VALUE", "VALIDATION_FAILED"].includes(save.error.code));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("editTitle", { name: text.label(setting) })}
      description={text.description(setting) ?? undefined}
      dismissible={!save.isPending}
      size={kind === "weekly_hours" || kind === "sla_targets" || kind === "priorities" ? "lg" : "md"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <ValueEditor
          kind={kind}
          settingKey={setting.key}
          draft={draft}
          onChange={(d) => {
            setDraft(d);
            setValueError(null);
            if (kind === "weekly_hours" && Object.keys(dayErrors).length > 0) setDayErrors(validateWeeklyDraft(d as WeeklyHoursDraft));
          }}
          error={valueError}
          dayErrors={dayErrors}
          allowNull={allowNull}
          enumValues={enumValues ?? []}
        />
        <TextArea
          label={t("reason")}
          hint={t("reasonHint")}
          required
          rows={2}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(null);
          }}
          error={reasonError}
        />
        {shortfalls && (
          <Notice tone="danger" title={describe(save.error)}>
            <p>{t("shortfall")}</p>
          </Notice>
        )}
        {shortfalls && shortfalls.length > 0 && <ShortfallTable shortfalls={shortfalls} />}
        {otherError && <Notice tone="danger">{describe(save.error)}</Notice>}
      </form>
    </Dialog>
  );
}

function ValueEditor({
  kind,
  settingKey,
  draft,
  onChange,
  error,
  dayErrors,
  allowNull,
  enumValues,
}: {
  kind: EditorKind;
  settingKey: string;
  draft: SettingDraft;
  onChange: (draft: SettingDraft) => void;
  error: string | null;
  dayErrors: Partial<Record<number, WeeklyHoursError>>;
  allowNull: boolean;
  enumValues: readonly string[];
}) {
  const t = useTranslations("admin.settings");
  const text = useSettingText();
  const days = useOpsText();
  const label = t("value");
  const intRange = INT_RANGES[settingKey];
  const listRule = INT_LIST_SETTINGS[settingKey];

  switch (kind) {
    case "weekly_hours":
      return (
        <div className="flex flex-col gap-1.5">
          <WeeklyHoursEditor draft={draft as WeeklyHoursDraft} onChange={onChange} errors={dayErrors} />
          {error && Object.keys(dayErrors).length === 0 && <p className="text-xs font-medium text-danger-700">{error}</p>}
        </div>
      );
    case "dates":
      return <HolidaysEditor dates={Array.isArray(draft) ? draft : []} onChange={onChange} error={error} />;
    case "bool":
      return (
        <div className="flex flex-col gap-1.5">
          <Switch
            label={label}
            checked={draft === true}
            onCheckedChange={onChange}
            stateLabel={draft === true ? t("on") : t("off")}
          />
          {error && <p className="text-xs font-medium text-danger-700">{error}</p>}
        </div>
      );
    case "int":
      return (
        <TextField
          label={label}
          inputMode="numeric"
          dir="ltr"
          className="text-start font-latin"
          value={String(draft)}
          onChange={(e) => onChange(e.target.value)}
          hint={
            intRange ? t("hints.intRange", { min: intRange[0], max: intRange[1] }) : allowNull ? t("hints.intNullable") : t("hints.int")
          }
          error={error}
        />
      );
    case "money":
      return (
        <MoneyField
          label={label}
          value={String(draft)}
          onChange={(e) => onChange(e.target.value)}
          hint={allowNull ? t("hints.moneyNullable") : t("hints.money")}
          error={error}
        />
      );
    case "enum":
      return (
        <Select
          label={label}
          value={String(draft)}
          onChange={(e) => onChange(e.target.value)}
          options={enumValues.map((v) => ({ value: v, label: text.option(settingKey, v) }))}
          error={error}
        />
      );
    case "string":
      return (
        <TextField label={label} dir="auto" value={String(draft)} onChange={(e) => onChange(e.target.value)} error={error} />
      );
    case "time":
      return (
        <TextField
          label={label}
          type="time"
          step={60}
          dir="ltr"
          className="text-start font-latin"
          value={String(draft)}
          onChange={(e) => onChange(e.target.value)}
          hint={QUARTER_HOUR_TIME_SETTINGS.includes(settingKey) ? t("hints.timeQuarter") : t("hints.time")}
          error={error}
        />
      );
    case "bilingual": {
      const text = isBilingualDraft(draft) ? draft : { ar: "", en: "" };
      return (
        <fieldset className="flex flex-col gap-3" aria-describedby={error ? `${settingKey}-bilingual-error` : undefined}>
          <legend className="mb-1 text-sm font-medium text-ink-900">{label}</legend>
          <TextField
            label={t("bilingual.ar")}
            dir="rtl"
            lang="ar"
            value={text.ar}
            onChange={(e) => onChange({ ar: e.target.value, en: text.en })}
            aria-invalid={error && text.ar.trim() === "" ? true : undefined}
          />
          <TextField
            label={t("bilingual.en")}
            dir="ltr"
            lang="en"
            value={text.en}
            onChange={(e) => onChange({ ar: text.ar, en: e.target.value })}
            aria-invalid={error && text.en.trim() === "" ? true : undefined}
          />
          {error ? (
            <p id={`${settingKey}-bilingual-error`} className="text-xs font-medium text-danger-700">
              {error}
            </p>
          ) : (
            <p className="text-xs text-ink-600">{t("hints.bilingual")}</p>
          )}
        </fieldset>
      );
    }
    case "int_list":
      return (
        <ChipsInput
          label={label}
          value={Array.isArray(draft) ? draft : []}
          onChange={onChange}
          valueDir="ltr"
          hint={
            listRule
              ? t(listRule.order === "desc" ? "hints.intListDesc" : "hints.intList", { min: listRule.min, max: listRule.max, count: listRule.maxItems })
              : t("hints.list")
          }
          error={error}
        />
      );
    case "weekdays": {
      const chosen = Array.isArray(draft) ? draft : [];
      return (
        <CheckboxGroup legend={label} hint={t("hints.weekdays")} error={error}>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {WEEK_ORDER.map((day) => (
              <Checkbox
                key={day}
                label={days.weekday(day)}
                checked={chosen.includes(String(day))}
                onChange={(e) =>
                  onChange(e.target.checked ? [...chosen, String(day)] : chosen.filter((d) => d !== String(day)))
                }
              />
            ))}
          </div>
        </CheckboxGroup>
      );
    }
    case "sla_targets":
      return <SlaTargetsEditor draft={draft as SlaTargetsDraft} onChange={onChange} error={error} />;
    case "priorities":
      return <PrioritiesEditor draft={draft as PrioritiesDraft} onChange={onChange} error={error} />;
    case "quiet_hours":
      return <QuietHoursEditor draft={draft as QuietHoursDraft} onChange={onChange} error={error} />;
    case "choices":
      return (
        <ChoicesEditor
          settingKey={settingKey}
          values={SETTING_OPTIONS[settingKey]?.values ?? []}
          draft={Array.isArray(draft) ? draft : []}
          onChange={onChange}
          error={error}
        />
      );
    case "chips":
      return (
        <ChipsInput
          label={label}
          value={Array.isArray(draft) ? draft : []}
          onChange={onChange}
          valueDir="ltr"
          hint={t("hints.list")}
          error={error}
        />
      );
    default:
      return (
        <TextArea
          label={label}
          dir="ltr"
          rows={kind === "json-list" ? 8 : 6}
          spellCheck={false}
          className="text-start font-mono text-[13px]"
          value={String(draft)}
          onChange={(e) => onChange(e.target.value)}
          hint={kind === "time_range" ? t("hints.timeRange") : kind === "json-list" ? t("hints.jsonList") : t("hints.json")}
          error={error}
        />
      );
  }
}
