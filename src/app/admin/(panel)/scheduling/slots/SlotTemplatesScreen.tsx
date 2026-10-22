"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  LtrText,
  Notice,
  PageHeader,
  Select,
  Switch,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { SERVICE_KINDS } from "@/lib/admin/catalog/forms";
import { createSlotTemplate, fetchSlotTemplates, updateSlotTemplate } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { slotTemplateFormSchema, slotTemplateToFormValues, type SlotTemplatePayload } from "@/lib/admin/ops/scheduling";
import type { SlotTemplate } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { ActiveBadge, BilingualFields, CodeField, EditorShell, FormErrorNotice, StaleDialog } from "../../catalog/_components/CatalogFields";
import { TimeSelect } from "../../_ops/OpsFields";
import { useOpsInvalidate } from "../../_ops/invalidate";
import { useOpsFieldError, useOpsText } from "../../_ops/opsText";

const PER_PAGE = 25;

/** A11 slot templates (spec §6.4): the daily windows customers book, per service kind. Permission catalog.manage. */
export function SlotTemplatesScreen() {
  const t = useTranslations("admin.scheduling.slots");
  const [editing, setEditing] = useState<SlotTemplate | "new" | null>(null);
  return (
    <RequirePermission anyOf={["catalog.manage"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
            {t("create")}
          </Button>
        }
      />
      <SlotTemplatesTable onEdit={setEditing} />
      {editing && <SlotTemplateEditor template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

function SlotTemplatesTable({ onEdit }: { onEdit: (template: SlotTemplate) => void }) {
  const t = useTranslations("admin.scheduling.slots");
  const text = useOpsText();
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: adminKeys.slotTemplateList({ page, kind, status }),
    queryFn: () =>
      fetchSlotTemplates({
        page,
        perPage: PER_PAGE,
        serviceKind: kind || undefined,
        isActive: status === "" ? undefined : status === "active",
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<SlotTemplate>[] = [
    {
      id: "slot",
      header: t("columns.slot"),
      cell: (s) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{text.name(s.name)}</span>
          <LtrText className="text-xs text-ink-600">{s.code}</LtrText>
        </div>
      ),
    },
    {
      id: "window",
      header: t("columns.window"),
      cell: (s) => (
        <bdi dir="ltr" className="font-latin font-medium">
          {s.start_time}–{s.end_time}
        </bdi>
      ),
    },
    { id: "kind", header: t("columns.kind"), cell: (s) => text.serviceKind(s.service_kind) },
    { id: "order", header: t("columns.order"), cell: (s) => <span className="font-latin">{s.sort_order}</span> },
    { id: "status", header: t("columns.status"), cell: (s) => <ActiveBadge active={s.is_active} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (s) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(s)}
          icon={<Pencil aria-hidden className="size-4" />}
          aria-label={t("editLabel", { name: text.name(s.name) })}
        >
          {t("edit")}
        </Button>
      ),
    },
  ];

  const filtered = kind !== "" || status !== "";

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setKind("");
          setStatus("");
          setPage(1);
        }}
      >
        <Select
          label={t("filters.kind")}
          placeholder={t("filters.allKinds")}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
          options={SERVICE_KINDS.map((k) => ({ value: k, label: text.serviceKind(k) }))}
          containerClassName="min-w-[180px]"
        />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "active", label: t("filters.active") },
            { value: "inactive", label: t("filters.inactive") },
          ]}
          containerClassName="min-w-[160px]"
        />
      </FilterBar>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(s) => s.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={680}
      />
    </Card>
  );
}

const FIELDS = ["code", "name", "name.ar", "name.en", "start_time", "end_time", "service_kind", "is_active", "sort_order"] as const;

function SlotTemplateEditor({ template, onClose }: { template: SlotTemplate | null; onClose: () => void }) {
  const mode = template ? "edit" : "create";
  const t = useTranslations("admin.scheduling.slots");
  const text = useOpsText();
  const fieldError = useOpsFieldError();
  const toast = useToast();
  const invalidate = useOpsInvalidate();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(slotTemplateFormSchema(mode)), defaultValues: slotTemplateToFormValues(template) });

  const save = useMutation({
    // The edit schema leaves the code out (it never changes after creation).
    mutationFn: (payload: SlotTemplatePayload) =>
      template ? updateSlotTemplate(template.id, payload, template.version) : createSlotTemplate(payload),
    onSuccess: (saved) => {
      invalidate(adminKeys.scheduling());
      toast.success(template ? t("updated", { name: text.name(saved.name) }) : t("created", { name: text.name(saved.name) }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else setFieldsApplied(applyFieldErrors(error, setError, FIELDS));
    },
  });

  const slotInUse = save.error instanceof AdminApiError && save.error.code === "SLOT_IN_USE" ? save.error : null;
  const holds = typeof slotInUse?.details.holds === "number" ? slotInUse.details.holds : 0;

  return (
    <>
      <EditorShell
        mode={mode}
        title={template ? t("editTitle", { name: text.name(template.name) }) : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={handleSubmit((payload) => save.mutate(payload))} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <CodeField registration={register("code")} disabled={mode === "edit"} error={fieldError(errors.code)} />
          </div>
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
          <Controller
            control={control}
            name="start_time"
            render={({ field }) => (
              <TimeSelect
                // The ref lets a failed submit focus this select when the time window is the only problem.
                ref={field.ref}
                kind="start"
                label={t("start")}
                required
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                name={field.name}
                error={fieldError(errors.start_time)}
              />
            )}
          />
          <Controller
            control={control}
            name="end_time"
            render={({ field }) => (
              <TimeSelect
                ref={field.ref}
                kind="end"
                label={t("end")}
                required
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                name={field.name}
                hint={t("endHint")}
                error={fieldError(errors.end_time)}
              />
            )}
          />
          <Select
            label={t("kind")}
            required
            options={SERVICE_KINDS.map((k) => ({ value: k, label: text.serviceKind(k) }))}
            error={fieldError(errors.service_kind)}
            {...register("service_kind")}
          />
          <TextField
            label={t("sortOrder")}
            inputMode="numeric"
            dir="ltr"
            className="font-latin text-start"
            hint={t("sortOrderHint")}
            error={fieldError(errors.sort_order)}
            {...register("sort_order")}
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
          {mode === "edit" && (
            <div className="sm:col-span-2">
              <Notice tone="info">{t("inUseHint")}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            {slotInUse ? (
              <Notice tone="danger" title={t("inUse.title")}>
                <p>{t("inUse.body", { count: holds })}</p>
              </Notice>
            ) : (
              <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} />
            )}
          </div>
        </form>
      </EditorShell>
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          invalidate(adminKeys.scheduling());
          onClose();
        }}
      />
    </>
  );
}
