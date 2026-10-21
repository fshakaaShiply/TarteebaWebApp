"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  DataTable,
  EmptyState,
  FilterBar,
  LoadingBlock,
  MoneyField,
  PageHeader,
  SearchField,
  Select,
  StatusBadge,
  Switch,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createCoupon, fetchCoupons, updateCoupon, type CouponPayload } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { checkReason } from "@/lib/admin/catalog/fields";
import { DISCOUNT_TYPES, couponFormSchema, couponToFormValues } from "@/lib/admin/catalog/forms";
import type { Coupon } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";
import { RequirePermission } from "../../../_components/RequirePermission";
import {
  ActiveBadge,
  CodeField,
  EditorShell,
  FormErrorNotice,
  ReasonField,
  SectionTitle,
  StaleDialog,
  useCatalogInvalidate,
} from "../_components/CatalogFields";
import { useCatalogText, useFieldError, usePackageOptions, useServiceOptions } from "../_components/catalogText";

const PER_PAGE = 25;

/** A11 coupons (spec §6.3, §9.1): percent 1..100 or a fixed net amount (R-07); codes are upper-case and unique. */
export function CouponsScreen() {
  const t = useTranslations("admin.catalog.coupons");
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
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
      <CouponsTable onEdit={setEditing} />
      {editing && <CouponEditor coupon={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

export function useCouponText() {
  const t = useTranslations("admin.catalog.coupons");
  const locale = useLocale();
  return {
    discount: (c: Pick<Coupon, "type" | "value">) =>
      c.type === "percent" ? t("percentValue", { value: c.value }) : t("fixedValue", { amount: formatAed(c.value, locale) }),
    appliesTo: (c: Coupon) => {
      const a = c.applies_to;
      const parts: string[] = [];
      if (a?.service_ids?.length) parts.push(t("appliesServices", { count: a.service_ids.length }));
      if (a?.package_ids?.length) parts.push(t("appliesPackages", { count: a.package_ids.length }));
      if (a?.first_booking_only) parts.push(t("firstBookingOnly"));
      return parts.length ? parts.join(t("listSeparator")) : t("appliesAll");
    },
  };
}

function CouponsTable({ onEdit }: { onEdit: (coupon: Coupon) => void }) {
  const t = useTranslations("admin.catalog.coupons");
  const text = useCouponText();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const list = useQuery({
    queryKey: adminKeys.couponList({ page, perPage: PER_PAGE, search: debouncedSearch, active: status }),
    queryFn: () =>
      fetchCoupons({
        page,
        perPage: PER_PAGE,
        search: debouncedSearch,
        isActive: status === "" ? undefined : status === "active",
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Coupon>[] = [
    {
      id: "code",
      header: t("columns.code"),
      cell: (c) => (
        <span dir="ltr" className="font-latin font-bold text-ink-900">
          {c.code}
        </span>
      ),
    },
    {
      id: "discount",
      header: t("columns.discount"),
      cell: (c) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink-900">{text.discount(c)}</span>
          {c.type === "fixed" && <span className="text-xs text-ink-600">{t("netNote")}</span>}
        </div>
      ),
    },
    {
      id: "validity",
      header: t("columns.validity"),
      cell: (c) =>
        c.valid_from || c.valid_to ? (
          <bdi dir="ltr" className="font-latin text-sm">
            {c.valid_from ?? "…"} – {c.valid_to ?? "…"}
          </bdi>
        ) : (
          t("noDates")
        ),
    },
    {
      id: "limits",
      header: t("columns.limits"),
      cell: (c) => (
        <span className="text-sm">
          {t("limitsValue", {
            total: c.usage_limit_total ?? t("unlimited"),
            perCustomer: c.usage_limit_per_customer ?? t("unlimited"),
          })}
        </span>
      ),
    },
    { id: "applies", header: t("columns.appliesTo"), cell: (c) => <span className="text-sm">{text.appliesTo(c)}</span> },
    { id: "status", header: t("columns.status"), cell: (c) => <ActiveBadge active={c.is_active} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (c) => (
        <Button variant="ghost" size="sm" onClick={() => onEdit(c)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { code: c.code })}>
          {t("edit")}
        </Button>
      ),
    },
  ];

  const filtered = search !== "" || status !== "";

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setSearch("");
          setStatus("");
          setPage(1);
        }}
      >
        <SearchField
          label={t("search")}
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
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
        getRowId={(c) => c.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={880}
      />
    </Card>
  );
}

const FIELDS = [
  "code",
  "type",
  "value",
  "valid_from",
  "valid_to",
  "usage_limit_total",
  "usage_limit_per_customer",
  "is_active",
  "reason",
] as const;

const FIELD_MAP = {
  max_discount_fils: "max_discount",
  min_order_fils: "min_order",
  "applies_to.service_ids": "service_ids",
  "applies_to.package_ids": "package_ids",
  "applies_to.first_booking_only": "first_booking_only",
} as const;

export function CouponEditor({ coupon, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const mode = coupon ? "edit" : "create";
  const t = useTranslations("admin.catalog.coupons");
  const text = useCatalogText();
  const fieldError = useFieldError();
  const toast = useToast();
  const invalidate = useCatalogInvalidate();
  const services = useServiceOptions();
  const packages = usePackageOptions();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(couponFormSchema(mode)), defaultValues: couponToFormValues(coupon) });
  const type = useWatch({ control, name: "type" });

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: CouponPayload; reason: string }) =>
      coupon ? updateCoupon(coupon.id, { ...payload, reason }, coupon.version) : createCoupon({ ...payload, reason }),
    onSuccess: (saved) => {
      invalidate();
      toast.success(coupon ? t("updated", { code: saved.code }) : t("created", { code: saved.code }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else {
        setFieldsApplied(
          applyFieldErrors(error, setError, [...FIELDS, "max_discount", "min_order", "service_ids", "package_ids", "first_booking_only"], FIELD_MAP),
        );
      }
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

  const numeric = { inputMode: "numeric" as const, dir: "ltr" as const, className: "font-latin text-start" };

  return (
    <>
      <EditorShell
        mode={mode}
        title={coupon ? t("editTitle", { code: coupon.code }) : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <CodeField
            registration={register("code")}
            disabled={mode === "edit"}
            hint={mode === "edit" ? undefined : t("codeHint")}
            error={fieldError(errors.code)}
          />
          <Select
            label={t("type")}
            options={DISCOUNT_TYPES.map((d) => ({ value: d, label: text.discountType(d) }))}
            error={fieldError(errors.type)}
            {...register("type")}
          />
          {type === "fixed" ? (
            <MoneyField label={t("amount")} required hint={t("fixedNetHint")} error={fieldError(errors.value)} {...register("value")} />
          ) : (
            <TextField label={t("percent")} required suffix="%" hint={t("percentHint")} error={fieldError(errors.value)} {...numeric} {...register("value")} />
          )}
          <MoneyField label={t("maxDiscount")} hint={t("optionalMoneyHint")} error={fieldError(errors.max_discount)} {...register("max_discount")} />
          <MoneyField label={t("minOrder")} hint={t("optionalMoneyHint")} error={fieldError(errors.min_order)} {...register("min_order")} />

          <div className="sm:col-span-2">
            <SectionTitle>{t("validityTitle")}</SectionTitle>
          </div>
          <TextField type="date" label={t("validFrom")} dir="ltr" className="font-latin text-start" error={fieldError(errors.valid_from)} {...register("valid_from")} />
          <TextField type="date" label={t("validTo")} dir="ltr" className="font-latin text-start" error={fieldError(errors.valid_to)} {...register("valid_to")} />
          <TextField label={t("usageTotal")} hint={t("unlimitedHint")} error={fieldError(errors.usage_limit_total)} {...numeric} {...register("usage_limit_total")} />
          <TextField
            label={t("usagePerCustomer")}
            hint={t("unlimitedHint")}
            error={fieldError(errors.usage_limit_per_customer)}
            {...numeric}
            {...register("usage_limit_per_customer")}
          />

          <div className="sm:col-span-2">
            <SectionTitle description={t("appliesHint")}>{t("appliesTitle")}</SectionTitle>
          </div>
          <Controller
            control={control}
            name="service_ids"
            render={({ field }) => (
              <IdCheckboxes
                legend={t("services")}
                loading={services.isPending}
                options={(services.data ?? []).map((s) => ({ id: s.id, label: `${text.name(s.name)} (${s.code})` }))}
                value={field.value}
                onChange={field.onChange}
                error={fieldError(errors.service_ids as { type?: string; message?: string } | undefined)}
              />
            )}
          />
          <Controller
            control={control}
            name="package_ids"
            render={({ field }) => (
              <IdCheckboxes
                legend={t("packages")}
                loading={packages.isPending}
                options={(packages.data ?? []).map((p) => ({ id: p.id, label: `${text.name(p.name)} (${p.code})` }))}
                value={field.value}
                onChange={field.onChange}
                error={fieldError(errors.package_ids as { type?: string; message?: string } | undefined)}
              />
            )}
          />
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="first_booking_only"
              render={({ field }) => (
                <Switch label={t("firstBookingOnly")} description={t("firstBookingHint")} checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="is_active"
              render={({ field }) => (
                <Switch label={t("active")} description={t("activeHint")} checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>
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

/** A list of records to tick (ids kept as strings in the form). */
function IdCheckboxes({
  legend,
  options,
  value,
  onChange,
  loading,
  error,
}: {
  legend: string;
  options: { id: number; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  loading: boolean;
  error?: string;
}) {
  const t = useTranslations("admin.catalog.coupons");
  return (
    <CheckboxGroup legend={legend} error={error} hint={t("noneMeansAll")}>
      {loading ? (
        <LoadingBlock lines={2} />
      ) : options.length === 0 ? (
        <StatusBadge tone="neutral" className="self-start">
          {t("nothingToPick")}
        </StatusBadge>
      ) : (
        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
          {options.map((o) => {
            const id = String(o.id);
            return (
              <Checkbox
                key={o.id}
                label={o.label}
                checked={value.includes(id)}
                onChange={(e) => onChange(e.target.checked ? [...value, id] : value.filter((v) => v !== id))}
              />
            );
          })}
        </div>
      )}
    </CheckboxGroup>
  );
}
