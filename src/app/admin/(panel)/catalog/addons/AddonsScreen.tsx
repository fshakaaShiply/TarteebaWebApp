"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  LtrText,
  MoneyField,
  Notice,
  PageHeader,
  Select,
  Switch,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createAddon, fetchAddons, updateAddon, type AddonPayload } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { checkReason } from "@/lib/admin/catalog/fields";
import { ADDON_PERS, addonFormSchema, addonToFormValues } from "@/lib/admin/catalog/forms";
import type { Addon } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";
import { RequirePermission } from "../../../_components/RequirePermission";
import {
  ActiveBadge,
  BilingualFields,
  CodeField,
  EditorShell,
  FormErrorNotice,
  ReasonField,
  StaleDialog,
  useCatalogInvalidate,
} from "../_components/CatalogFields";
import { useCatalogText, useFieldError } from "../_components/catalogText";

const PER_PAGE = 25;

/** A11 add-ons, e.g. company cleaning materials (spec §6.3; P1-02: the MATERIALS add-on is the materials fee). */
export function AddonsScreen() {
  const t = useTranslations("admin.catalog.addons");
  const [editing, setEditing] = useState<Addon | "new" | null>(null);
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
      <AddonsTable onEdit={setEditing} />
      {editing && <AddonEditor addon={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

function AddonsTable({ onEdit }: { onEdit: (addon: Addon) => void }) {
  const t = useTranslations("admin.catalog.addons");
  const locale = useLocale();
  const text = useCatalogText();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: adminKeys.addonList({ page, perPage: PER_PAGE, active: status }),
    queryFn: () => fetchAddons({ page, perPage: PER_PAGE, isActive: status === "" ? undefined : status === "active" }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Addon>[] = [
    {
      id: "addon",
      header: t("columns.addon"),
      cell: (a) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{text.name(a.name)}</span>
          <LtrText className="text-xs text-ink-600">{a.code}</LtrText>
        </div>
      ),
    },
    {
      id: "amount",
      header: t("columns.amount"),
      cell: (a) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink-900">{formatAed(a.amount_fils, locale)}</span>
          <span className="text-xs text-ink-600">{a.vat_inclusive ? t("vatIncl") : t("vatExcl")}</span>
        </div>
      ),
    },
    { id: "per", header: t("columns.per"), cell: (a) => text.per(a.per) },
    { id: "status", header: t("columns.status"), cell: (a) => <ActiveBadge active={a.is_active} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (a) => (
        <Button variant="ghost" size="sm" onClick={() => onEdit(a)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { name: text.name(a.name) })}>
          {t("edit")}
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <Notice tone="info">{t("materialsNote")}</Notice>
      <FilterBar
        canReset={status !== ""}
        onReset={() => {
          setStatus("");
          setPage(1);
        }}
      >
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
        getRowId={(a) => a.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={status ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={640}
      />
    </Card>
  );
}

const FIELDS = ["code", "name", "name.ar", "name.en", "vat_inclusive", "per", "is_active", "sort_order", "reason", "amount"] as const;

function AddonEditor({ addon, onClose }: { addon: Addon | null; onClose: () => void }) {
  const mode = addon ? "edit" : "create";
  const t = useTranslations("admin.catalog.addons");
  const text = useCatalogText();
  const fieldError = useFieldError();
  const toast = useToast();
  const invalidate = useCatalogInvalidate();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(addonFormSchema(mode)), defaultValues: addonToFormValues(addon) });

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: AddonPayload; reason: string }) =>
      addon ? updateAddon(addon.id, { ...payload, reason }, addon.version) : createAddon({ ...payload, reason }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(addon ? t("updated", { name: text.name(saved.name) }) : t("created", { name: text.name(saved.name) }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else setFieldsApplied(applyFieldErrors(error, setError, FIELDS, { amount_fils: "amount" }));
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

  return (
    <>
      <EditorShell
        mode={mode}
        title={addon ? t("editTitle", { name: text.name(addon.name) }) : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <CodeField registration={register("code")} disabled={mode === "edit"} error={fieldError(errors.code)} />
          <Select
            label={t("per")}
            options={ADDON_PERS.map((p) => ({ value: p, label: text.per(p) }))}
            error={fieldError(errors.per)}
            {...register("per")}
          />
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
          <MoneyField label={t("amount")} required error={fieldError(errors.amount)} {...register("amount")} />
          <Controller
            control={control}
            name="vat_inclusive"
            render={({ field }) => (
              <Switch label={t("vatInclusive")} description={t("vatInclusiveHint")} checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
          <TextField
            label={t("sortOrder")}
            required
            inputMode="numeric"
            dir="ltr"
            className="font-latin text-start"
            error={fieldError(errors.sort_order)}
            {...register("sort_order")}
          />
          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <Switch label={t("active")} description={t("activeHint")} checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
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
