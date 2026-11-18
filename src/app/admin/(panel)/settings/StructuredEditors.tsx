"use client";

import { useTranslations } from "next-intl";
import { Checkbox, CheckboxGroup, Select, TextField } from "@/components/admin";
import {
  COMPLAINT_PRIORITIES,
  COMPLAINT_PRIORITY_KEYS,
  SLA_TARGET_RANGE,
  type PrioritiesDraft,
  type QuietHoursDraft,
  type SlaTargetsDraft,
} from "@/lib/admin/settings";
import { useSettingText } from "./settingText";

/*
 * Editors of the Phase 5 settings that are more than one number (design section 6.2): the complaint deadlines per
 * priority, the starting priority per category, a subset of compensation options and the waitlist's quiet hours. Each
 * draft is plain text, checked again by parseDraft before saving.
 */

/** complaint.sla_targets: four rows, each with the first-reply and resolution minutes. */
export function SlaTargetsEditor({
  draft,
  onChange,
  error,
}: {
  draft: SlaTargetsDraft;
  onChange: (draft: SlaTargetsDraft) => void;
  error: string | null;
}) {
  const t = useTranslations("admin.settings");
  const set = (priority: (typeof COMPLAINT_PRIORITIES)[number], field: "first_response" | "resolution", value: string) =>
    onChange({ ...draft, [priority]: { ...draft[priority], [field]: value } });
  return (
    <fieldset className="flex flex-col gap-3" aria-describedby="sla-targets-note">
      <legend className="mb-1 text-sm font-medium text-ink-900">{t("value")}</legend>
      {COMPLAINT_PRIORITIES.map((priority) => (
        <div key={priority} role="group" aria-label={t(`priorities.${priority}`)} className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem_1fr_1fr] sm:items-end">
          <span className="text-sm font-bold text-ink-900 sm:pb-3">{t(`priorities.${priority}`)}</span>
          <TextField
            label={t("slaTargets.firstResponse")}
            inputMode="numeric"
            dir="ltr"
            className="text-start font-latin"
            value={draft[priority].first_response}
            onChange={(e) => set(priority, "first_response", e.target.value)}
            suffix={t("slaTargets.minutes")}
          />
          <TextField
            label={t("slaTargets.resolution")}
            inputMode="numeric"
            dir="ltr"
            className="text-start font-latin"
            value={draft[priority].resolution}
            onChange={(e) => set(priority, "resolution", e.target.value)}
            suffix={t("slaTargets.minutes")}
          />
        </div>
      ))}
      {error ? (
        <p role="alert" id="sla-targets-note" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : (
        <p id="sla-targets-note" className="text-xs text-ink-600">
          {t("hints.slaTargets", { min: SLA_TARGET_RANGE[0], max: SLA_TARGET_RANGE[1] })}
        </p>
      )}
    </fieldset>
  );
}

/** complaint.default_priorities: one select per category and low rating. */
export function PrioritiesEditor({
  draft,
  onChange,
  error,
}: {
  draft: PrioritiesDraft;
  onChange: (draft: PrioritiesDraft) => void;
  error: string | null;
}) {
  const t = useTranslations("admin.settings");
  const options = COMPLAINT_PRIORITIES.map((p) => ({ value: p, label: t(`priorities.${p}`) }));
  return (
    <fieldset className="flex flex-col gap-3" aria-describedby="priorities-note">
      <legend className="mb-1 text-sm font-medium text-ink-900">{t("value")}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {COMPLAINT_PRIORITY_KEYS.map((key) => (
          <Select
            key={key}
            label={t(`categories.${key}`)}
            placeholder={t("priorities.choose")}
            options={options}
            value={draft[key] ?? ""}
            onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
            aria-invalid={error && !draft[key] ? true : undefined}
          />
        ))}
      </div>
      {error ? (
        <p role="alert" id="priorities-note" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : (
        <p id="priorities-note" className="text-xs text-ink-600">
          {t("hints.priorities")}
        </p>
      )}
    </fieldset>
  );
}

/** compensation.types: the options offered, any subset (none is allowed and offers no compensation). */
export function ChoicesEditor({
  settingKey,
  values,
  draft,
  onChange,
  error,
}: {
  settingKey: string;
  values: readonly string[];
  draft: string[];
  onChange: (draft: string[]) => void;
  error: string | null;
}) {
  const t = useTranslations("admin.settings");
  const text = useSettingText();
  return (
    <CheckboxGroup legend={t("value")} hint={t("hints.choices")} error={error}>
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {values.map((value) => (
          <Checkbox
            key={value}
            label={text.option(settingKey, value)}
            checked={draft.includes(value)}
            onChange={(e) => onChange(e.target.checked ? [...draft, value] : draft.filter((v) => v !== value))}
          />
        ))}
      </div>
    </CheckboxGroup>
  );
}

/** waitlist.quiet_hours: two times; the window may cross midnight and equal times mean none. */
export function QuietHoursEditor({
  draft,
  onChange,
  error,
}: {
  draft: QuietHoursDraft;
  onChange: (draft: QuietHoursDraft) => void;
  error: string | null;
}) {
  const t = useTranslations("admin.settings");
  const invalid = (value: string) => (error && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? true : undefined);
  return (
    <fieldset className="flex flex-col gap-3" aria-describedby="quiet-hours-note">
      <legend className="mb-1 text-sm font-medium text-ink-900">{t("value")}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label={t("quiet.from")}
          type="time"
          step={60}
          dir="ltr"
          className="text-start font-latin"
          value={draft.from}
          onChange={(e) => onChange({ ...draft, from: e.target.value })}
          aria-invalid={invalid(draft.from)}
        />
        <TextField
          label={t("quiet.to")}
          type="time"
          step={60}
          dir="ltr"
          className="text-start font-latin"
          value={draft.to}
          onChange={(e) => onChange({ ...draft, to: e.target.value })}
          aria-invalid={invalid(draft.to)}
        />
      </div>
      {error ? (
        <p role="alert" id="quiet-hours-note" className="text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : (
        <p id="quiet-hours-note" className="text-xs text-ink-600">
          {t("hints.quietHours")}
        </p>
      )}
    </fieldset>
  );
}
