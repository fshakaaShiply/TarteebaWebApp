"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import {
  Button,
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
import { useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import {
  SETTING_OPTIONS,
  editorKind,
  parseDraft,
  toDraft,
  type EditorKind,
  type SettingDraft,
  type SettingDraftError,
} from "@/lib/admin/settings";
import type { Setting } from "@/lib/admin/types";
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

  const draftMessage = (error: SettingDraftError) => t(`errors.${error}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseDraft(kind, draft, { allowNull: setting.value === null, options: enumValues });
    const trimmedReason = reason.trim();
    setValueError(parsed.ok ? null : draftMessage(parsed.error));
    setReasonError(trimmedReason === "" ? t("errors.reason") : trimmedReason.length > REASON_MAX ? t("errors.reasonLength") : null);
    if (!parsed.ok || trimmedReason === "" || trimmedReason.length > REASON_MAX) return;
    save.mutate({ value: parsed.value });
  };

  const otherError =
    save.error &&
    !(save.error instanceof AdminApiError && ["STALE_VERSION", "INVALID_SETTING_VALUE", "VALIDATION_FAILED"].includes(save.error.code));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("editTitle", { name: text.label(setting) })}
      description={text.description(setting) ?? undefined}
      dismissible={!save.isPending}
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
          }}
          error={valueError}
          allowNull={setting.value === null}
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
  allowNull,
  enumValues,
}: {
  kind: EditorKind;
  settingKey: string;
  draft: SettingDraft;
  onChange: (draft: SettingDraft) => void;
  error: string | null;
  allowNull: boolean;
  enumValues: readonly string[];
}) {
  const t = useTranslations("admin.settings");
  const text = useSettingText();
  const label = t("value");

  switch (kind) {
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
          hint={allowNull ? t("hints.intNullable") : t("hints.int")}
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
