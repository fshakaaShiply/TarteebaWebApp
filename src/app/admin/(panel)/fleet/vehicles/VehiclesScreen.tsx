"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  StatusBadge,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createVehicle, fetchVehicles, updateVehicle } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import type { ForceInput } from "@/lib/admin/ops/capacity";
import {
  MAX_SEATS,
  VEHICLE_STATUSES,
  usualDriverChoices,
  vehicleFormSchema,
  vehicleToFormValues,
  type VehiclePayload,
} from "@/lib/admin/ops/fleet";
import { useAdminSession } from "@/lib/admin/session";
import type { Vehicle, VehicleStatus } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { AsyncOptionsSelect, EditorShell, FormErrorNotice, StaleDialog } from "../../catalog/_components/CatalogFields";
import { ExpiryDate } from "../../_ops/OpsFields";
import { ShortfallDialog, useShortfallGuard } from "../../_ops/Shortfall";
import { useOpsInvalidate } from "../../_ops/invalidate";
import { useDriverOptions, useZoneChoices } from "../../_ops/options";
import { useOpsFieldError, useOpsText, vehicleTone } from "../../_ops/opsText";

const PER_PAGE = 25;

/**
 * A06 vehicles (spec §6.8): seats, zone, usual driver, insurance and registration expiry ("expires soon" within 30
 * days) and status. fleet.manage edits; schedule.view reads (seats per zone for the schedule).
 */
export function VehiclesScreen() {
  const t = useTranslations("admin.fleet.vehicles");
  const { can } = useAdminSession();
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);
  const manage = can("fleet.manage");
  return (
    <RequirePermission anyOf={["fleet.manage", "schedule.view"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          manage ? (
            <Button onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
              {t("create")}
            </Button>
          ) : undefined
        }
      />
      <VehiclesTable onEdit={manage ? setEditing : undefined} />
      {editing && manage && <VehicleEditor vehicle={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

function VehiclesTable({ onEdit }: { onEdit?: (vehicle: Vehicle) => void }) {
  const t = useTranslations("admin.fleet.vehicles");
  const text = useOpsText();
  const zones = useZoneChoices();
  const [filters, setFilters] = useState({ search: "", status: "", zone: "" });
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(filters.search.trim(), 300);
  const setFilter = (name: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
  };

  const list = useQuery({
    queryKey: adminKeys.vehicleList({ page, search, status: filters.status, zone: filters.zone }),
    queryFn: () =>
      fetchVehicles({
        page,
        perPage: PER_PAGE,
        search,
        status: filters.status as VehicleStatus | "",
        zoneId: filters.zone ? Number(filters.zone) : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Vehicle>[] = [
    {
      id: "vehicle",
      header: t("columns.vehicle"),
      cell: (v) => (
        <div className="flex flex-col">
          <bdi dir="ltr" className="self-start font-latin font-bold text-ink-900">
            {v.plate_no}
          </bdi>
          {v.model && <span className="text-xs text-ink-600">{v.model}</span>}
        </div>
      ),
    },
    { id: "seats", header: t("columns.seats"), cell: (v) => <span className="font-latin font-medium">{v.seats}</span> },
    { id: "zone", header: t("columns.zone"), cell: (v) => (v.zone ? text.name(v.zone.name) : <span className="text-ink-600">{t("noZone")}</span>) },
    {
      id: "driver",
      header: t("columns.driver"),
      cell: (v) => (v.default_driver ? v.default_driver.name : <span className="text-ink-600">{t("noDriver")}</span>),
    },
    { id: "insurance", header: t("columns.insurance"), cell: (v) => <ExpiryDate date={v.insurance_expires_at} /> },
    { id: "registration", header: t("columns.registration"), cell: (v) => <ExpiryDate date={v.registration_expires_at} /> },
    {
      id: "status",
      header: t("columns.status"),
      cell: (v) => <StatusBadge tone={vehicleTone[v.status] ?? "neutral"}>{text.vehicleStatus(v.status)}</StatusBadge>,
    },
    ...(onEdit
      ? [
          {
            id: "actions",
            header: <span className="sr-only">{t("columns.actions")}</span>,
            className: "text-end",
            cell: (v: Vehicle) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(v)}
                icon={<Pencil aria-hidden className="size-4" />}
                aria-label={t("editLabel", { plate: v.plate_no })}
              >
                {t("edit")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const filtered = Object.values(filters).some((v) => v !== "");

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setFilters({ search: "", status: "", zone: "" });
          setPage(1);
        }}
      >
        <SearchField label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} value={filters.search} onChange={(v) => setFilter("search", v)} />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value)}
          options={VEHICLE_STATUSES.map((s) => ({ value: s, label: text.vehicleStatus(s) }))}
          containerClassName="min-w-[150px]"
        />
        <Select
          label={t("filters.zone")}
          placeholder={t("filters.allZones")}
          value={filters.zone}
          onChange={(e) => setFilter("zone", e.target.value)}
          options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
          containerClassName="min-w-[170px]"
        />
      </FilterBar>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(v) => v.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={900}
      />
    </Card>
  );
}

const FIELDS = [
  "plate_no",
  "model",
  "seats",
  "status",
  "zone_id",
  "default_driver_id",
  "insurance_expires_at",
  "registration_expires_at",
] as const;

function VehicleEditor({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const mode = vehicle ? "edit" : "create";
  const t = useTranslations("admin.fleet.vehicles");
  const catalogT = useTranslations("admin.catalog.common");
  const text = useOpsText();
  const fieldError = useOpsFieldError();
  const toast = useToast();
  const invalidate = useOpsInvalidate();
  const zones = useZoneChoices();
  const drivers = useDriverOptions();
  const formId = useId();
  const guard = useShortfallGuard<VehiclePayload>();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(vehicleFormSchema()), defaultValues: vehicleToFormValues(vehicle) });

  const save = useMutation({
    mutationFn: ({ payload, force }: { payload: VehiclePayload; force?: ForceInput }) =>
      vehicle ? updateVehicle(vehicle.id, payload, vehicle.version, force) : createVehicle(payload),
    onSuccess: (saved) => {
      invalidate(adminKeys.fleet());
      guard.clear();
      toast.success(vehicle ? t("updated", { plate: saved.plate_no }) : t("created", { plate: saved.plate_no }));
      onClose();
    },
    onError: (error, vars) => {
      if (guard.capture(error, vars.payload)) return;
      if (vars.force) return;
      guard.clear();
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else setFieldsApplied(applyFieldErrors(error, setError, FIELDS));
    },
  });
  const pending = guard.state;

  return (
    <>
      <EditorShell
        mode={mode}
        title={vehicle ? t("editTitle", { plate: vehicle.plate_no }) : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending && !pending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={handleSubmit((payload) => save.mutate({ payload }))} className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("plate")}
            required
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            className="font-latin text-start uppercase"
            hint={t("plateHint")}
            error={fieldError(errors.plate_no)}
            {...register("plate_no")}
          />
          <TextField label={t("model")} dir="ltr" className="text-start" error={fieldError(errors.model)} {...register("model")} />
          <TextField
            label={t("seats")}
            required
            inputMode="numeric"
            dir="ltr"
            className="font-latin text-start"
            hint={t("seatsHint", { max: MAX_SEATS })}
            error={fieldError(errors.seats)}
            {...register("seats")}
          />
          <Select
            label={t("status")}
            options={VEHICLE_STATUSES.map((s) => ({ value: s, label: text.vehicleStatus(s) }))}
            hint={t("statusHint")}
            error={fieldError(errors.status)}
            {...register("status")}
          />
          <AsyncOptionsSelect
            control={control}
            name="zone_id"
            label={t("zone")}
            options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
            loading={zones.isPending}
            failed={zones.isError}
            placeholder={t("noZone")}
            loadingLabel={catalogT("loadingOptions")}
            hint={t("zoneHint")}
            error={fieldError(errors.zone_id)}
          />
          <AsyncOptionsSelect
            control={control}
            name="default_driver_id"
            label={t("driver")}
            options={usualDriverChoices(drivers.data ?? [], vehicle?.id ?? null).map((d) => ({
              value: String(d.id),
              label: `${d.staff_user?.name ?? `#${d.id}`}${d.status === "active" ? "" : ` · ${text.driverStatus(d.status)}`}`,
            }))}
            loading={drivers.isPending}
            failed={drivers.isError}
            placeholder={t("noDriver")}
            loadingLabel={catalogT("loadingOptions")}
            hint={t("driverHint")}
            error={fieldError(errors.default_driver_id)}
          />
          <TextField
            type="date"
            label={t("insurance")}
            dir="ltr"
            className="font-latin text-start"
            error={fieldError(errors.insurance_expires_at)}
            {...register("insurance_expires_at")}
          />
          <TextField
            type="date"
            label={t("registration")}
            dir="ltr"
            className="font-latin text-start"
            error={fieldError(errors.registration_expires_at)}
            {...register("registration_expires_at")}
          />
          <p className="text-xs text-ink-600 sm:col-span-2">{t("expiryHint")}</p>
          <div className="sm:col-span-2">
            {save.error && !pending ? <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} /> : null}
          </div>
        </form>
      </EditorShell>
      {pending && (
        <ShortfallDialog
          shortfalls={pending.shortfalls}
          pending={save.isPending}
          forceError={save.error && !(save.error instanceof AdminApiError && save.error.code === "CAPACITY_SHORTFALL") ? save.error : null}
          onClose={guard.clear}
          onForce={(force) => save.mutate({ payload: pending.vars, force })}
        />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          invalidate(adminKeys.fleet());
          onClose();
        }}
      />
    </>
  );
}
