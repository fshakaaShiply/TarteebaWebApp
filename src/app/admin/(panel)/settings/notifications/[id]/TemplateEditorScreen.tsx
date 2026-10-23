"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Save } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  StatusBadge,
  Switch,
  TextArea,
  TextField,
  useToast,
  useUnsavedChanges,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import {
  fetchNotificationTemplate,
  fetchNotificationTemplates,
  previewNotificationTemplate,
  updateNotificationTemplate,
  type TemplatePreviewInput,
} from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { NOTIFICATION_TEMPLATES_PATH } from "@/lib/admin/nav";
import {
  REASON_MAX,
  SUBJECT_MAX,
  bodyLimit,
  hasSubject,
  insertToken,
  normalizeBody,
  samplePayload,
  templateChanges,
  templateFormSchema,
  templateFormValues,
  unknownPlaceholders,
  type SampleDraft,
  type TemplateFormError,
  type TemplateFormValues,
} from "@/lib/admin/notifications/templates";
import type { NotificationTemplate, RenderedTemplate, TemplatePreview } from "@/lib/admin/types";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { StaleDialog } from "../../../catalog/_components/CatalogFields";
import { BackLink } from "../../../finance/_components/FinanceParts";
import { useTemplateText } from "../templateText";

/**
 * A11 notification template editor (spec §12, §17 "ar/en with preview"; settings.manage): subject (not for SMS),
 * body with the event's placeholders as chips that insert at the caret, whether it is sent, an optional audit reason;
 * a preview of the draft with sample values in Arabic and English (POST …/preview, nothing saved). Saving sends only
 * what changed with the loaded version as If-Match; a 409 STALE_VERSION asks to reload.
 */
export function TemplateEditorScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={["settings.manage"]}>
      <TemplateEditorContent id={id} />
    </RequirePermission>
  );
}

function TemplateEditorContent({ id }: { id: string }) {
  const t = useTranslations("admin.notificationTemplates.editor");
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  const template = useQuery({
    queryKey: adminKeys.notificationTemplate(numericId ?? 0),
    queryFn: () => fetchNotificationTemplate(numericId as number),
    enabled: numericId !== null,
  });
  // A reload after a stale save remounts the form with the latest version.
  const [generation, setGeneration] = useState(0);

  return (
    <>
      <BackLink href={NOTIFICATION_TEMPLATES_PATH}>{t("back")}</BackLink>
      {numericId === null ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : template.isPending ? (
        <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : template.isError ? (
        <Card>
          <ErrorState error={template.error} onRetry={() => void template.refetch()} />
        </Card>
      ) : (
        <TemplateEditor
          key={`${template.data.id}:${generation}`}
          template={template.data}
          onReload={async () => {
            await template.refetch();
            setGeneration((g) => g + 1);
          }}
        />
      )}
    </>
  );
}

type FieldName = "subject" | "body";

function TemplateEditor({ template, onReload }: { template: NotificationTemplate; onReload: () => Promise<void> }) {
  const t = useTranslations("admin.notificationTemplates.editor");
  const list = useTranslations("admin.notificationTemplates");
  const text = useTemplateText();
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const formId = useId();
  const [original, setOriginal] = useState(template);
  const [stale, setStale] = useState(false);

  const allowed = useMemo(() => template.placeholders.map((p) => p.name), [template.placeholders]);
  const subjectShown = hasSubject(template.channel);
  const limit = bodyLimit(template.channel);
  const dir = template.locale === "ar" ? "rtl" : "ltr";

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema(template.channel, allowed)) as Resolver<TemplateFormValues>,
    defaultValues: templateFormValues(template),
  });
  const values = useWatch({ control: form.control }) as TemplateFormValues;
  const dirty = form.formState.isDirty;
  useUnsavedChanges(dirty);

  // Where a placeholder chip inserts: the field that had focus last (the body by default).
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const lastField = useRef<FieldName>("body");
  const subjectField = form.register("subject");
  const bodyField = form.register("body");

  const insert = (token: string) => {
    const field: FieldName = lastField.current === "subject" && subjectShown ? "subject" : "body";
    const element = field === "subject" ? subjectRef.current : bodyRef.current;
    const { value, caret } = insertToken(form.getValues(field), token, element?.selectionStart ?? null, element?.selectionEnd ?? null);
    form.setValue(field, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(caret, caret);
    });
  };

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof templateChanges>) => updateNotificationTemplate(original.id, input, original.version),
    onSuccess: (saved) => {
      setOriginal(saved);
      form.reset(templateFormValues(saved));
      queryClient.setQueryData(adminKeys.notificationTemplate(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: adminKeys.notificationTemplates() });
      toast.success(t("saved", { event: saved.event_label, language: text.language(saved.locale) }));
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else applyFieldErrors(error, form.setError, ["subject", "body", "is_active", "reason"]);
    },
  });

  const submit = form.handleSubmit((v) => {
    const changes = templateChanges(original, v);
    if (Object.keys(changes).length === 0) {
      toast.info(t("noChanges"));
      form.reset(templateFormValues(original));
      return;
    }
    save.mutate(changes);
  });

  const errors = form.formState.errors;
  const message = (code: string | undefined, field: FieldName | "reason") => {
    if (!code) return undefined;
    if (code === "unknown_placeholders") {
      const unknown = unknownPlaceholders(field === "subject" ? values.subject : values.body, allowed);
      return t("errors.unknown_placeholders", { names: unknown.map((n) => `{{${n}}}`).join(" ") });
    }
    if (code === "body_length") return t("errors.body_length", { max: limit });
    if (code === "subject_length") return t("errors.subject_length", { max: SUBJECT_MAX });
    return t.has(`errors.${code}`) ? t(`errors.${code as TemplateFormError}`) : code;
  };
  const bodyLength = [...normalizeBody(values.body ?? "")].length;
  const otherError = save.error && !(save.error instanceof AdminApiError && ["STALE_VERSION", "VALIDATION_FAILED"].includes(save.error.code)) ? save.error : null;

  return (
    <>
      <section aria-labelledby="template-title" className="flex flex-col gap-2 rounded-lg bg-surface p-5 shadow-card">
        <h1 id="template-title" className="text-[26px]/[34px] font-bold text-ink-900">
          {original.event_label}
        </h1>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone="confirmed">{text.audience(original.audience)}</StatusBadge>
          <StatusBadge tone="neutral">{original.channel_label || text.channel(original.channel)}</StatusBadge>
          <StatusBadge tone="neutral">{text.language(original.locale)}</StatusBadge>
          <StatusBadge tone={original.is_active ? "success" : "neutral"}>{original.is_active ? list("active") : list("inactive")}</StatusBadge>
        </span>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-ink-600">
          <code dir="ltr" className="font-latin">
            {original.event_key}
          </code>
          <span>{t("version", { version: original.version })}</span>
        </p>
        <Siblings template={original} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={t("editTitle")}>
          <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
            {subjectShown ? (
              <TextField
                label={t("subject")}
                required
                dir={dir}
                lang={original.locale}
                maxLength={SUBJECT_MAX}
                hint={t("subjectHint")}
                error={message(errors.subject?.message, "subject")}
                {...subjectField}
                ref={(element) => {
                  subjectField.ref(element);
                  subjectRef.current = element;
                }}
                onFocus={() => {
                  lastField.current = "subject";
                }}
              />
            ) : (
              <Notice tone="neutral">{t("noSubject")}</Notice>
            )}
            <TextArea
              label={t("body")}
              required
              dir={dir}
              lang={original.locale}
              rows={7}
              hint={t("bodyCount", { count: bodyLength, max: limit })}
              error={message(errors.body?.message, "body")}
              {...bodyField}
              ref={(element) => {
                bodyField.ref(element);
                bodyRef.current = element;
              }}
              onFocus={() => {
                lastField.current = "body";
              }}
            />
            <PlaceholderChips template={original} onInsert={insert} />
            <Switch
              label={t("active")}
              description={t("activeHint")}
              checked={values.is_active ?? false}
              onCheckedChange={(on) => form.setValue("is_active", on, { shouldDirty: true })}
              stateLabel={values.is_active ? list("active") : list("inactive")}
            />
            <TextArea
              label={t("reason")}
              hint={t("reasonHint")}
              rows={2}
              maxLength={REASON_MAX}
              error={message(errors.reason?.message, "reason")}
              {...form.register("reason")}
            />
            {otherError && <Notice tone="danger">{describe(otherError)}</Notice>}
            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
              <Button variant="outline" onClick={() => form.reset(templateFormValues(original))} disabled={!dirty || save.isPending}>
                {t("discard")}
              </Button>
              <Button type="submit" loading={save.isPending} disabled={!dirty} icon={<Save aria-hidden className="size-4" />}>
                {t("save")}
              </Button>
            </div>
          </form>
        </Card>

        <PreviewCard template={original} draft={{ subject: values.subject ?? "", body: values.body ?? "" }} />
      </div>

      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void onReload();
        }}
      />
    </>
  );
}

/** The event's placeholders as chips: a click inserts the token where the caret was (body by default). */
function PlaceholderChips({ template, onInsert }: { template: NotificationTemplate; onInsert: (token: string) => void }) {
  const t = useTranslations("admin.notificationTemplates.editor");
  if (template.placeholders.length === 0) return <p className="text-xs text-ink-600">{t("noPlaceholders")}</p>;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink-900">{t("placeholders")}</legend>
      <p className="text-xs text-ink-600">{t("placeholdersHint")}</p>
      <ul className="flex flex-wrap gap-1.5">
        {template.placeholders.map((p) => (
          <li key={p.name}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(p.token)}
              title={p.description}
              aria-label={t("insert", { token: p.token, description: p.description })}
              className="touch-target inline-flex items-center rounded-pill bg-petrol-50 px-2.5 py-1 font-latin text-[13px] font-medium text-petrol-700 hover:bg-petrol-100"
            >
              <bdi dir="ltr">{p.token}</bdi>
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** The other language's template of the same event, audience and channel. */
function Siblings({ template }: { template: NotificationTemplate }) {
  const t = useTranslations("admin.notificationTemplates.editor");
  const text = useTemplateText();
  const siblings = useQuery({
    queryKey: adminKeys.notificationTemplateSiblings(template.event_key, template.audience, template.channel),
    queryFn: () => fetchNotificationTemplates({ eventKey: template.event_key, audience: template.audience, channel: template.channel }),
    select: (rows) => rows.filter((row) => row.id !== template.id),
  });
  if (!siblings.data || siblings.data.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-3 text-sm">
      {siblings.data.map((row) => (
        <Link key={row.id} href={`/admin/settings/notifications/${row.id}`} className="font-medium">
          {t("otherLanguage", { language: text.language(row.locale) })}
        </Link>
      ))}
    </p>
  );
}

/**
 * Preview with sample values (the API's own samples, overridden by what the admin types for either language). The
 * draft replaces this language's saved text; the other language shows its saved text.
 */
function PreviewCard({ template, draft }: { template: NotificationTemplate; draft: { subject: string; body: string } }) {
  const t = useTranslations("admin.notificationTemplates.editor");
  const text = useTemplateText();
  const describe = useAdminErrorMessage();
  const [samples, setSamples] = useState<SampleDraft>({});
  // The preview runs for the saved text when the page opens, then for what the admin asked to preview.
  const [input, setInput] = useState<TemplatePreviewInput>({});
  const preview = useQuery({
    queryKey: [...adminKeys.notificationTemplate(template.id), "preview", template.version, input] as const,
    queryFn: () => previewNotificationTemplate(template.id, input),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const run = () =>
    setInput({
      ...(hasSubject(template.channel) ? { subject: draft.subject } : {}),
      body: draft.body,
      payload: samplePayload(samples),
    });

  const setSample = (name: string, locale: "ar" | "en", value: string) =>
    setSamples((current) => ({ ...current, [name]: { ar: current[name]?.ar ?? "", en: current[name]?.en ?? "", [locale]: value } }));

  return (
    <Card
      title={t("previewTitle")}
      actions={
        <Button variant="secondary" size="sm" onClick={run} loading={preview.isFetching} icon={<Eye aria-hidden className="size-4" />}>
          {t("preview")}
        </Button>
      }
    >
      <p className="text-xs text-ink-600">{t("previewHint", { language: text.language(template.locale) })}</p>
      {template.placeholders.length > 0 && (
        <details className="rounded-md border border-line px-3 py-2">
          <summary className="touch-target cursor-pointer text-sm font-medium text-petrol-700">{t("samples")}</summary>
          <p className="mt-1 text-xs text-ink-600">{t("samplesHint")}</p>
          <div className="mt-3 flex flex-col gap-3">
            {template.placeholders.map((p) => (
              <fieldset key={p.name} className="flex flex-col gap-1.5">
                <legend className="text-sm font-medium text-ink-900">
                  <bdi dir="ltr" className="font-latin">
                    {p.token}
                  </bdi>{" "}
                  <span className="font-normal text-ink-600">{p.description}</span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <TextField
                    label={t("sampleArabic")}
                    dir="rtl"
                    lang="ar"
                    value={samples[p.name]?.ar ?? ""}
                    onChange={(e) => setSample(p.name, "ar", e.target.value)}
                  />
                  <TextField
                    label={t("sampleEnglish")}
                    dir="ltr"
                    lang="en"
                    value={samples[p.name]?.en ?? ""}
                    onChange={(e) => setSample(p.name, "en", e.target.value)}
                  />
                </div>
              </fieldset>
            ))}
          </div>
        </details>
      )}
      {preview.isPending ? (
        <LoadingBlock lines={4} />
      ) : preview.isError ? (
        <Notice tone="danger">{describe(preview.error)}</Notice>
      ) : (
        <PreviewResult preview={preview.data} hasSubject={hasSubject(template.channel)} />
      )}
    </Card>
  );
}

function PreviewResult({ preview, hasSubject: subjectShown }: { preview: TemplatePreview; hasSubject: boolean }) {
  const t = useTranslations("admin.notificationTemplates.editor");
  const text = useTemplateText();
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      {preview.unknown.length > 0 && (
        <Notice tone="warning">{t("previewUnknown", { names: preview.unknown.map((n) => `{{${n}}}`).join(" ") })}</Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(["ar", "en"] as const).map((locale) => (
          <RenderedPanel key={locale} title={text.language(locale)} locale={locale} rendered={preview[locale]} subjectShown={subjectShown} />
        ))}
      </div>
    </div>
  );
}

function RenderedPanel({ title, locale, rendered, subjectShown }: { title: string; locale: "ar" | "en"; rendered: RenderedTemplate | null; subjectShown: boolean }) {
  const t = useTranslations("admin.notificationTemplates.editor");
  return (
    <section className="flex flex-col gap-1.5 rounded-md bg-ivory-50 p-3.5">
      <h3 className="text-xs font-bold text-ink-600">{title}</h3>
      {rendered ? (
        <div dir={locale === "ar" ? "rtl" : "ltr"} lang={locale} className="flex flex-col gap-1 text-sm">
          {subjectShown && <p className="font-bold text-ink-900">{rendered.subject || "—"}</p>}
          <p className="whitespace-pre-wrap text-ink-900">{rendered.body}</p>
        </div>
      ) : (
        <p className="text-sm text-ink-600">{t("previewMissing")}</p>
      )}
    </section>
  );
}
