"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Controller, type Control, type FieldPath, type FieldValues, type UseFormRegisterReturn } from "react-hook-form";
import { Button, Dialog, Drawer, Notice, Select, StatusBadge, TextArea, TextField } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { REASON_MAX } from "@/lib/admin/catalog/fields";
import type { PolicyType } from "@/lib/admin/types";
import { useCatalogText, useFieldMessageList, usePolicyOptions } from "./catalogText";

/** Two inputs for a translatable field ({ar, en}); the English one is left-to-right. */
export function BilingualFields({
  label,
  ar,
  en,
  errorAr,
  errorEn,
  required,
  multiline,
  hint,
}: {
  label: string;
  ar: UseFormRegisterReturn;
  en: UseFormRegisterReturn;
  errorAr?: string;
  errorEn?: string;
  required?: boolean;
  multiline?: boolean;
  hint?: ReactNode;
}) {
  const t = useTranslations("admin.catalog.common");
  const arLabel = t("inArabic", { label });
  const enLabel = t("inEnglish", { label });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {multiline ? (
        <>
          <TextArea label={arLabel} required={required} dir="rtl" lang="ar" rows={3} error={errorAr} hint={hint} {...ar} />
          <TextArea label={enLabel} required={required} dir="ltr" lang="en" rows={3} className="text-start" error={errorEn} {...en} />
        </>
      ) : (
        <>
          <TextField label={arLabel} required={required} dir="rtl" lang="ar" error={errorAr} hint={hint} {...ar} />
          <TextField label={enLabel} required={required} dir="ltr" lang="en" className="text-start" error={errorEn} {...en} />
        </>
      )}
    </div>
  );
}

/** Record codes (fixed after creation): left-to-right, Latin font. */
export function CodeField({
  registration,
  error,
  disabled,
  hint,
  label,
}: {
  registration: UseFormRegisterReturn;
  error?: string;
  disabled?: boolean;
  hint?: ReactNode;
  label?: string;
}) {
  const t = useTranslations("admin.catalog.common");
  return (
    <TextField
      label={label ?? t("code")}
      required={!disabled}
      readOnly={disabled}
      dir="ltr"
      autoComplete="off"
      spellCheck={false}
      className="font-latin text-start uppercase"
      hint={hint ?? (disabled ? t("codeFixed") : t("codeHint"))}
      error={error}
      {...registration}
    />
  );
}

/** The audit reason every catalog change carries (spec §15: before/after + reason in the audit log). */
export function ReasonField({ registration, error }: { registration: UseFormRegisterReturn; error?: string }) {
  const t = useTranslations("admin.catalog.common");
  return (
    <TextArea
      label={t("reason")}
      hint={t("reasonHint")}
      required
      rows={2}
      maxLength={REASON_MAX}
      error={error}
      {...registration}
    />
  );
}

/** Status pill: success = active, neutral = inactive / draft. */
export function ActiveBadge({ active }: { active: boolean }) {
  const t = useTranslations("admin.catalog.common");
  return active ? <StatusBadge tone="success">{t("active")}</StatusBadge> : <StatusBadge tone="neutral">{t("inactive")}</StatusBadge>;
}

/** 409 STALE_VERSION: someone else saved the record first. */
export function StaleDialog({ open, onReload, onClose }: { open: boolean; onReload: () => void; onClose: () => void }) {
  const t = useTranslations("admin.catalog.common");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("stale.title")}
      description={t("stale.body")}
      size="sm"
      footer={
        <Button onClick={onReload} icon={<RefreshCw aria-hidden className="size-4" />}>
          {t("stale.reload")}
        </Button>
      }
    />
  );
}

/**
 * Errors not shown on a field: anything but VALIDATION_FAILED / STALE_VERSION, and validation messages for fields
 * this form has no input for.
 */
export function FormErrorNotice({ error, fieldsApplied }: { error: unknown; fieldsApplied: boolean }) {
  const describe = useAdminErrorMessage();
  const fieldMessages = useFieldMessageList();
  if (!error) return null;
  if (error instanceof AdminApiError) {
    if (error.code === "STALE_VERSION") return null;
    if (error.code === "VALIDATION_FAILED") {
      if (fieldsApplied) return null;
      const messages = fieldMessages(error);
      return (
        <Notice tone="danger" title={describe(error)}>
          {messages.length > 0 && (
            <ul className="list-disc ps-5">
              {messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </Notice>
      );
    }
  }
  return <Notice tone="danger">{describe(error)}</Notice>;
}

/**
 * Create in a dialog, edit in a side drawer (A11 pattern); the submit button sits in the footer and targets the form
 * by id.
 */
export function EditorShell({
  mode,
  title,
  description,
  formId,
  pending,
  onClose,
  children,
  wide,
  footerStart,
  submitDisabled,
}: {
  mode: "create" | "edit";
  title: ReactNode;
  description?: ReactNode;
  formId: string;
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Editors with previews or tables (policies, zones). */
  wide?: boolean;
  /** Extra buttons before Cancel (e.g. Preview). */
  footerStart?: ReactNode;
  /** Nothing can be saved yet (e.g. no record to link); the form explains why. */
  submitDisabled?: boolean;
}) {
  const t = useTranslations("admin.catalog.common");
  const footer = (
    <>
      {footerStart}
      <Button variant="outline" onClick={onClose} disabled={pending}>
        {t("cancel")}
      </Button>
      <Button type="submit" form={formId} loading={pending} disabled={submitDisabled}>
        {mode === "create" ? t("create") : t("save")}
      </Button>
    </>
  );
  if (mode === "create") {
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={title}
        description={description}
        dismissible={!pending}
        size="lg"
        footer={footer}
      >
        {children}
      </Dialog>
    );
  }
  return (
    <Drawer
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      title={title}
      description={description}
      size={wide ? "lg" : "md"}
      footer={footer}
    >
      {children}
    </Drawer>
  );
}

/**
 * A select whose options load after the form (policies, zones). It is controlled by the form value, so the stored id
 * stays selected once its option arrives; a registered (uncontrolled) select would show the placeholder and write ""
 * back on the next change or blur. A stored id that is not among the loaded options stays visible as "#id".
 */
export function AsyncOptionsSelect<T extends FieldValues, TOut = T>({
  control,
  name,
  label,
  options,
  loading,
  failed,
  placeholder,
  loadingLabel,
  hint,
  error,
}: {
  control: Control<T, unknown, TOut>;
  name: FieldPath<T>;
  label: string;
  options: readonly { value: string; label: string }[];
  loading: boolean;
  failed: boolean;
  /** The empty choice ("No policy", "All zones"). */
  placeholder: string;
  loadingLabel: string;
  hint?: ReactNode;
  error?: string;
}) {
  const t = useTranslations("admin.catalog.common");
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const value = typeof field.value === "string" ? field.value : field.value == null ? "" : String(field.value);
        const known = value === "" || options.some((o) => o.value === value);
        return (
          <Select
            label={label}
            placeholder={loading ? loadingLabel : placeholder}
            options={loading || known ? options : [...options, { value, label: `#${value}` }]}
            hint={failed ? t("optionsFailed") : hint}
            error={error}
            name={field.name}
            ref={field.ref}
            value={value}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
            disabled={loading}
            aria-busy={loading || undefined}
          />
        );
      }}
    />
  );
}

/** Cancellation / reschedule / refund policy of a service or package (only policies of that type). */
export function PolicySelect<T extends FieldValues, TOut = T>({
  type,
  control,
  name,
  error,
}: {
  type: PolicyType;
  control: Control<T, unknown, TOut>;
  name: FieldPath<T>;
  error?: string;
}) {
  const t = useTranslations("admin.catalog.common");
  const text = useCatalogText();
  const policies = usePolicyOptions();
  const options = (policies.data ?? [])
    .filter((p) => p.type === type)
    .map((p) => ({
      value: String(p.id),
      label: `${text.name(p.name)} (${p.code})${p.is_active ? "" : ` · ${t("inactive")}`}`,
    }));
  return (
    <AsyncOptionsSelect
      control={control}
      name={name}
      label={t(`policy.${type}`)}
      options={options}
      loading={policies.isPending}
      failed={policies.isError}
      placeholder={t("policy.none")}
      loadingLabel={t("loadingOptions")}
      error={error}
    />
  );
}

/** After any catalog write: refresh lists, details and the public "price from" figures. */
export function useCatalogInvalidate() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: adminKeys.catalog() });
}

export function SectionTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-base font-bold text-ink-900">{children}</h3>
      {description && <p className="text-sm text-ink-600">{description}</p>}
    </div>
  );
}
