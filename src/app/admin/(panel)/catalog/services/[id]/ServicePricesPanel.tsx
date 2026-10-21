"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  MoneyField,
  Notice,
  Select,
  Switch,
  TextArea,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import {
  createServicePrice,
  deleteServicePrice,
  previewCatalog,
  updateServicePrice,
  type ServicePricePayload,
} from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { REASON_MAX, checkReason } from "@/lib/admin/catalog/fields";
import { PRICE_UNITS, WEEKDAYS, priceFormSchema, priceToFormValues } from "@/lib/admin/catalog/forms";
import { buildPriceDeletePreviewRequest, buildPricePreviewRequest } from "@/lib/admin/catalog/preview";
import type { CatalogService, ServicePrice } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";
import { AsyncOptionsSelect, FormErrorNotice, ReasonField, StaleDialog, useCatalogInvalidate } from "../../_components/CatalogFields";
import { PreviewPanel } from "../../_components/PreviewPanel";
import { useCatalogText, useFieldError, useFieldMessageList, useZoneOptions } from "../../_components/catalogText";

/**
 * Prices tab: the service's price matrix rows (spec §6.3: zone or all zones, weekday or any, validity, unit, amount,
 * VAT-inclusive flag, priority; the most specific row wins). Rows are created, edited (If-Match) and soft-deleted with
 * a reason; each change can be previewed as customers would see it before saving.
 */
export function ServicePricesPanel({ service, onReload }: { service: CatalogService; onReload: () => void }) {
  const t = useTranslations("admin.catalog.prices");
  const locale = useLocale();
  const text = useCatalogText();
  const zones = useZoneOptions();
  const [editing, setEditing] = useState<ServicePrice | "new" | null>(null);
  const [deleting, setDeleting] = useState<ServicePrice | null>(null);
  const [stale, setStale] = useState(false);
  const zoneName = (id: number | null) => {
    if (id === null) return t("allZones");
    const zone = zones.data?.find((z) => z.id === id);
    return zone ? `${text.name(zone.name)}${zone.is_active ? "" : ` (${t("zoneInactive")})`}` : `#${id}`;
  };

  const columns: Column<ServicePrice>[] = [
    { id: "zone", header: t("columns.zone"), cell: (p) => zoneName(p.zone_id) },
    { id: "day", header: t("columns.day"), cell: (p) => (p.day_of_week === null ? t("anyDay") : text.weekday(p.day_of_week)) },
    {
      id: "validity",
      header: t("columns.validity"),
      cell: (p) =>
        p.valid_from || p.valid_to ? (
          <bdi dir="ltr" className="font-latin text-sm">
            {p.valid_from ?? "…"} – {p.valid_to ?? "…"}
          </bdi>
        ) : (
          t("always")
        ),
    },
    { id: "unit", header: t("columns.unit"), cell: (p) => text.unit(p.unit) },
    {
      id: "amount",
      header: t("columns.amount"),
      cell: (p) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink-900">
            {formatAed(p.amount_fils, locale)} <span className="text-xs font-normal text-ink-600">{p.vat_inclusive ? t("vatIncl") : t("vatExcl")}</span>
          </span>
          <span className="text-xs text-ink-600">
            {t("breakdown", {
              gross: formatAed(p.unit_breakdown.gross_fils, locale),
              net: formatAed(p.unit_breakdown.net_fils, locale),
              vat: formatAed(p.unit_breakdown.vat_fils, locale),
            })}
          </span>
        </div>
      ),
    },
    { id: "priority", header: t("columns.priority"), cell: (p) => <span className="font-latin">{p.priority}</span> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(p)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { zone: zoneName(p.zone_id) })}>
            {t("edit")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-700 hover:bg-danger-50 hover:text-danger-700"
            onClick={() => setDeleting(p)}
            icon={<Trash2 aria-hidden className="size-4" />}
            aria-label={t("deleteLabel", { zone: zoneName(p.zone_id) })}
          >
            {t("delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card
      title={t("title")}
      actions={
        <Button onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
          {t("add")}
        </Button>
      }
    >
      <p className="text-sm/6 text-ink-600">{t("intro")}</p>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={service.prices ?? []}
        getRowId={(p) => p.id}
        empty={<EmptyState title={t("empty")} body={t("emptyBody")} />}
        minWidth={860}
      />
      {editing && (
        <PriceDialog
          service={service}
          price={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onStale={() => {
            setEditing(null);
            setStale(true);
          }}
        />
      )}
      {deleting && (
        <DeletePriceDialog
          service={service}
          price={deleting}
          label={zoneName(deleting.zone_id)}
          onClose={() => setDeleting(null)}
          onStale={() => {
            setDeleting(null);
            setStale(true);
          }}
        />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          onReload();
        }}
      />
    </Card>
  );
}

const PRICE_FIELDS = [
  "zone_id",
  "day_of_week",
  "valid_from",
  "valid_to",
  "unit",
  "amount",
  "vat_inclusive",
  "priority",
  "reason",
] as const;

function PriceDialog({
  service,
  price,
  onClose,
  onStale,
}: {
  service: CatalogService;
  price: ServicePrice | null;
  onClose: () => void;
  onStale: () => void;
}) {
  const t = useTranslations("admin.catalog.prices");
  const common = useTranslations("admin.catalog.common");
  const text = useCatalogText();
  const fieldError = useFieldError();
  const fieldMessages = useFieldMessageList();
  const toast = useToast();
  const invalidate = useCatalogInvalidate();
  const queryClient = useQueryClient();
  const zones = useZoneOptions();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [previewedAt, setPreviewedAt] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(priceFormSchema),
    defaultValues: priceToFormValues(price, service.kind),
  });
  const watched = useWatch({ control });

  // amount_fils is the API name of the form's "amount" (AED) field.
  const fieldMap = { amount_fils: "amount" } as const;

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: ServicePricePayload; reason: string }) =>
      price
        ? updateServicePrice(price.id, { ...payload, reason }, price.version)
        : createServicePrice({ ...payload, service_id: service.id, reason }),
    onSuccess: (saved) => {
      queryClient.setQueryData<typeof service>(adminKeys.service(service.id), (old) =>
        old
          ? {
              ...old,
              prices: price
                ? (old.prices ?? []).map((p) => (p.id === saved.id ? saved : p))
                : [...(old.prices ?? []), saved],
            }
          : old,
      );
      invalidate();
      toast.success(price ? t("updated") : t("created"));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") onStale();
      else setFieldsApplied(applyFieldErrors(error, setError, PRICE_FIELDS, fieldMap));
    },
  });

  const preview = useMutation({
    mutationFn: previewCatalog,
    onError: (error) => applyFieldErrors(error, setError, PRICE_FIELDS, fieldMap, { prefix: "prices.0" }),
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
    const built = buildPricePreviewRequest(service.code, price?.id ?? null, values);
    if (!built.ok) return;
    setPreviewedAt(JSON.stringify(values));
    preview.mutate(built.request);
  });

  const outdated = preview.data !== undefined && previewedAt !== null && previewedAt !== JSON.stringify(watched);
  const previewMessages = preview.error ? fieldMessages(preview.error) : [];
  const zoneOptions = (zones.data ?? []).map((z) => ({
    value: String(z.id),
    label: `${text.name(z.name)} (${z.code})${z.is_active ? "" : ` · ${t("zoneInactive")}`}`,
  }));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={price ? t("editTitle") : t("addTitle")}
      description={t("dialogBody", { service: text.name(service.name) })}
      dismissible={!save.isPending}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => void onPreview()} loading={preview.isPending} icon={<Eye aria-hidden className="size-4" />}>
            {t("preview")}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {t("save")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
        <AsyncOptionsSelect
          control={control}
          name="zone_id"
          label={t("columns.zone")}
          placeholder={t("allZones")}
          loadingLabel={common("loadingOptions")}
          options={zoneOptions}
          loading={zones.isPending}
          failed={zones.isError}
          hint={t("zoneHint")}
          error={fieldError(errors.zone_id)}
        />
        <Select
          label={t("columns.day")}
          placeholder={t("anyDay")}
          options={WEEKDAYS.map((d) => ({ value: String(d), label: text.weekday(d) }))}
          error={fieldError(errors.day_of_week)}
          {...register("day_of_week")}
        />
        <TextField type="date" label={t("validFrom")} hint={t("validHint")} dir="ltr" className="font-latin text-start" error={fieldError(errors.valid_from)} {...register("valid_from")} />
        <TextField type="date" label={t("validTo")} dir="ltr" className="font-latin text-start" error={fieldError(errors.valid_to)} {...register("valid_to")} />
        <Select
          label={t("columns.unit")}
          options={PRICE_UNITS.map((u) => ({ value: u, label: text.unit(u) }))}
          error={fieldError(errors.unit)}
          {...register("unit")}
        />
        <MoneyField label={t("amount")} required hint={t("amountHint")} error={fieldError(errors.amount)} {...register("amount")} />
        <Controller
          control={control}
          name="vat_inclusive"
          render={({ field }) => (
            <Switch label={t("vatInclusive")} description={t("vatInclusiveHint")} checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
        <TextField
          label={t("columns.priority")}
          hint={t("priorityHint")}
          inputMode="numeric"
          dir="ltr"
          className="font-latin text-start"
          required
          error={fieldError(errors.priority)}
          {...register("priority")}
        />
        <div className="sm:col-span-2">
          <ReasonField registration={register("reason")} error={fieldError(errors.reason)} />
        </div>
        <div className="flex flex-col gap-3 sm:col-span-2">
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
        </div>
      </form>
      {preview.data && <PreviewPanel preview={preview.data} outdated={outdated} onClose={() => preview.reset()} />}
    </Dialog>
  );
}

/**
 * What customers would see after deleting `price` (preview with {id, delete: true}), loaded when the confirmation
 * opens: a warning when the service would show no "from" price any more, and the full public preview on request.
 */
function DeletePreview({
  service,
  price,
  open,
  onOpenChange,
}: {
  service: CatalogService;
  price: ServicePrice;
  /** The full public preview is shown. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.catalog.prices");
  const customer = useTranslations("admin.catalog.customer");
  const text = useCatalogText();
  const locale = useLocale();
  const preview = useQuery({
    queryKey: adminKeys.priceDeletePreview(price.id, price.version),
    queryFn: () => previewCatalog(buildPriceDeletePreviewRequest(service.code, price.id)),
    staleTime: 0,
  });

  if (preview.isPending) {
    return (
      <p role="status" className="text-sm text-ink-600">
        {t("deletePreviewLoading")}
      </p>
    );
  }
  if (preview.isError) return <Notice tone="warning">{t("deletePreviewFailed")}</Notice>;

  const after = locale === "ar" ? preview.data.payload.ar : preview.data.payload.en;
  const losesPrice = after.price_from_fils === null || after.price_unit === null;
  return (
    <div className="flex flex-col gap-3">
      {losesPrice ? (
        <Notice tone="warning" title={t("deleteLosesPriceTitle")}>
          {t("deleteLosesPrice", { service: text.name(service.name) })}
        </Notice>
      ) : (
        <p className="text-sm text-ink-900">
          {t("deleteKeepsPrice", {
            price: customer("priceFrom", { price: formatAed(after.price_from_fils ?? 0, locale), unit: customer(`unit.${after.price_unit}`) }),
          })}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        icon={<Eye aria-hidden className="size-4" />}
      >
        {open ? t("hideDeletePreview") : t("showDeletePreview")}
      </Button>
      {open && <PreviewPanel preview={preview.data} title={t("deletePreviewTitle")} intro={t("deletePreviewIntro")} />}
    </div>
  );
}

function DeletePriceDialog({
  service,
  price,
  label,
  onClose,
  onStale,
}: {
  service: CatalogService;
  price: ServicePrice;
  label: string;
  onClose: () => void;
  onStale: () => void;
}) {
  const t = useTranslations("admin.catalog.prices");
  const errorsT = useTranslations("admin.catalog.errors");
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const invalidate = useCatalogInvalidate();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => deleteServicePrice(price.id, price.version, reason.trim()),
    onSuccess: () => {
      queryClient.setQueryData<CatalogService>(adminKeys.service(price.service_id), (old) =>
        old ? { ...old, prices: (old.prices ?? []).filter((p) => p.id !== price.id) } : old,
      );
      invalidate();
      toast.success(t("deleted"));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") onStale();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("deleteTitle")}
      description={t("deleteBody", { zone: label, amount: formatAed(price.amount_fils, locale) })}
      confirmLabel={t("delete")}
      tone="danger"
      size={previewOpen ? "lg" : "md"}
      pending={remove.isPending}
      onConfirm={() => {
        const error = checkReason(reason);
        if (error) {
          setReasonError(errorsT(error));
          return;
        }
        remove.mutate();
      }}
    >
      <DeletePreview service={service} price={price} open={previewOpen} onOpenChange={setPreviewOpen} />
      <TextArea
        label={t("reason")}
        required
        rows={3}
        maxLength={REASON_MAX}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setReasonError(null);
        }}
        error={reasonError}
      />
      {remove.error && !(remove.error instanceof AdminApiError && remove.error.code === "STALE_VERSION") && (
        <Notice tone="danger">{describe(remove.error)}</Notice>
      )}
    </ConfirmDialog>
  );
}
