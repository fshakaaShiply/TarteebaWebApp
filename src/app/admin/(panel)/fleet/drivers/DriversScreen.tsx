"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  LtrText,
  PageHeader,
  SearchField,
  Select,
  StatusBadge,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createDriver, fetchDrivers, updateDriver } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { DRIVER_STATUSES, driverFormSchema, driverToFormValues, type DriverPayload } from "@/lib/admin/ops/fleet";
import { useAdminSession } from "@/lib/admin/session";
import type { Driver, DriverStatus } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { EditorShell, FormErrorNotice, StaleDialog } from "../../catalog/_components/CatalogFields";
import { ExpiryDate } from "../../_ops/OpsFields";
import { useOpsInvalidate } from "../../_ops/invalidate";
import { useDriverCandidates } from "../../_ops/options";
import { driverTone, useOpsFieldError, useOpsText } from "../../_ops/opsText";

const PER_PAGE = 25;

/** "•••• 0001": the licence number is never shown in full (DriverResource sends at most its last four characters). */
function MaskedLicence({ last4 }: { last4: string }) {
  const t = useTranslations("admin.fleet.drivers");
  if (!last4) return <span className="text-sm text-ink-600">{t("licenceHidden")}</span>;
  // aria-label is ignored on a generic element such as <bdi>: the spoken text is a visually hidden span instead.
  return (
    <>
      <span className="sr-only">{t("licenceEnding", { last4 })}</span>
      <bdi aria-hidden dir="ltr" className="font-latin text-sm text-ink-900">
        •••• {last4}
      </bdi>
    </>
  );
}

/** A06 drivers (spec §6.8): a staff account with the driver role, licence (last 4 only), expiry, phone, status. */
export function DriversScreen() {
  const t = useTranslations("admin.fleet.drivers");
  const [editing, setEditing] = useState<Driver | "new" | null>(null);
  return (
    <RequirePermission anyOf={["fleet.manage"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
            {t("create")}
          </Button>
        }
      />
      <DriversTable onEdit={setEditing} />
      {editing && <DriverEditor driver={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

function DriversTable({ onEdit }: { onEdit: (driver: Driver) => void }) {
  const t = useTranslations("admin.fleet.drivers");
  const text = useOpsText();
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(filters.search.trim(), 300);
  const setFilter = (name: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
  };

  const list = useQuery({
    queryKey: adminKeys.driverList({ page, search, status: filters.status }),
    queryFn: () => fetchDrivers({ page, perPage: PER_PAGE, search, status: filters.status as DriverStatus | "" }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Driver>[] = [
    {
      id: "driver",
      header: t("columns.driver"),
      cell: (d) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{d.staff_user?.name ?? `#${d.staff_user_id}`}</span>
          {d.staff_user && <LtrText className="text-xs text-ink-600">{d.staff_user.email}</LtrText>}
        </div>
      ),
    },
    {
      id: "phone",
      header: t("columns.phone"),
      cell: (d) =>
        d.phone ? (
          <bdi dir="ltr" className="font-latin text-sm">
            {d.phone}
          </bdi>
        ) : (
          <span className="text-sm text-ink-600">—</span>
        ),
    },
    {
      id: "licence",
      header: t("columns.licence"),
      cell: (d) => (
        <div className="flex flex-col gap-0.5">
          <MaskedLicence last4={d.license_no_last4} />
          <ExpiryDate date={d.license_expires_at} />
        </div>
      ),
    },
    {
      id: "vehicle",
      header: t("columns.vehicle"),
      cell: (d) =>
        d.vehicle ? (
          <bdi dir="ltr" className="font-latin text-sm">
            {d.vehicle.plate_no}
          </bdi>
        ) : (
          <span className="text-sm text-ink-600">{t("noVehicle")}</span>
        ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (d) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={driverTone[d.status] ?? "neutral"}>{text.driverStatus(d.status)}</StatusBadge>
          {d.staff_user && d.staff_user.status !== "active" && (
            <StatusBadge tone="danger">{t("accountSuspended")}</StatusBadge>
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (d) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(d)}
          icon={<Pencil aria-hidden className="size-4" />}
          aria-label={t("editLabel", { name: d.staff_user?.name ?? `#${d.id}` })}
        >
          {t("edit")}
        </Button>
      ),
    },
  ];

  const filtered = filters.search !== "" || filters.status !== "";

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setFilters({ search: "", status: "" });
          setPage(1);
        }}
      >
        <SearchField label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} value={filters.search} onChange={(v) => setFilter("search", v)} />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value)}
          options={DRIVER_STATUSES.map((s) => ({ value: s, label: text.driverStatus(s) }))}
          containerClassName="min-w-[150px]"
        />
      </FilterBar>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(d) => d.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={820}
      />
    </Card>
  );
}

const FIELDS = ["staff_user_id", "license_no", "license_expires_at", "phone", "status"] as const;

function DriverEditor({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  const mode = driver ? "edit" : "create";
  const t = useTranslations("admin.fleet.drivers");
  const catalogT = useTranslations("admin.catalog.common");
  const text = useOpsText();
  const fieldError = useOpsFieldError();
  const toast = useToast();
  const invalidate = useOpsInvalidate();
  const { can } = useAdminSession();
  // A new driver links one of the active driver-role accounts no driver uses yet (GET /admin/drivers/candidates).
  const candidates = useDriverCandidates(mode === "create");
  const noCandidates = mode === "create" && candidates.isSuccess && candidates.data.length === 0;
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    getValues,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(driverFormSchema(mode)), defaultValues: driverToFormValues(driver) });

  /** The account's phone becomes the driver's phone, unless one is typed already. */
  const pickAccount = (id: string) => {
    const account = candidates.data?.find((c) => String(c.id) === id);
    if (account?.phone && getValues("phone").trim() === "") setValue("phone", account.phone, { shouldDirty: true });
  };

  const save = useMutation({
    // The edit schema never carries staff_user_id (the account is fixed; the API prohibits it).
    mutationFn: (payload: DriverPayload) => (driver ? updateDriver(driver.id, payload, driver.version) : createDriver(payload)),
    onSuccess: (saved) => {
      invalidate(adminKeys.fleet());
      const name = saved.staff_user?.name ?? `#${saved.id}`;
      toast.success(driver ? t("updated", { name }) : t("created", { name }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else if (error instanceof AdminApiError && error.code === "NOT_A_DRIVER") {
        // The account lost the role (or got linked) since the list loaded.
        setError("staff_user_id", { message: "notADriver" });
        setFieldsApplied(true);
        void candidates.refetch();
      } else if (error instanceof AdminApiError && error.code === "PHONE_INVALID") {
        setError("phone", { message: "phoneInvalid" });
        setFieldsApplied(true);
      } else setFieldsApplied(applyFieldErrors(error, setError, FIELDS));
    },
  });

  return (
    <>
      <EditorShell
        mode={mode}
        title={driver ? t("editTitle", { name: driver.staff_user?.name ?? `#${driver.id}` }) : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending}
        submitDisabled={noCandidates}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={handleSubmit((payload) => save.mutate(payload))} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {driver ? (
              <div className="flex flex-col gap-0.5 rounded-md bg-neutral-100 px-3 py-2">
                <span className="text-xs font-medium text-ink-600">{t("account")}</span>
                <span className="text-sm font-bold text-ink-900">{driver.staff_user?.name ?? `#${driver.staff_user_id}`}</span>
                {driver.staff_user && <LtrText className="text-xs text-ink-600">{driver.staff_user.email}</LtrText>}
                <span className="text-xs text-ink-600">{t("accountFixed")}</span>
              </div>
            ) : noCandidates ? (
              <EmptyState
                title={t("noCandidatesTitle")}
                // Only users.manage can invite or give roles; anyone else is sent to a system administrator.
                body={can("users.manage") ? t("noCandidates") : t("noCandidatesAsk")}
                action={
                  can("users.manage") ? (
                    <ButtonLink href="/admin/users" variant="outline" size="sm">
                      {t("openUsers")}
                    </ButtonLink>
                  ) : undefined
                }
                className="rounded-md bg-neutral-100"
              />
            ) : (
              <Controller
                control={control}
                name="staff_user_id"
                render={({ field }) => (
                  <Select
                    label={t("account")}
                    required
                    placeholder={candidates.isPending ? catalogT("loadingOptions") : t("chooseAccount")}
                    options={(candidates.data ?? []).map((c) => ({ value: String(c.id), label: `${c.name} · ${c.email}` }))}
                    hint={candidates.isError ? catalogT("optionsFailed") : t("accountHint")}
                    error={fieldError(errors.staff_user_id)}
                    name={field.name}
                    ref={field.ref}
                    value={field.value}
                    onChange={(e) => {
                      field.onChange(e.target.value);
                      pickAccount(e.target.value);
                    }}
                    onBlur={field.onBlur}
                    disabled={candidates.isPending}
                    aria-busy={candidates.isPending || undefined}
                  />
                )}
              />
            )}
          </div>
          <TextField
            label={driver ? t("newLicence") : t("licence")}
            required={!driver}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            className="font-latin text-start uppercase"
            hint={driver ? t("newLicenceHint", { last4: driver.license_no_last4 || "—" }) : t("licenceHint")}
            error={fieldError(errors.license_no)}
            {...register("license_no")}
          />
          <TextField
            type="date"
            label={t("licenceExpiry")}
            dir="ltr"
            className="font-latin text-start"
            error={fieldError(errors.license_expires_at)}
            {...register("license_expires_at")}
          />
          <TextField
            label={t("phone")}
            type="tel"
            dir="ltr"
            className="font-latin text-start"
            hint={t("phoneHint")}
            error={fieldError(errors.phone)}
            {...register("phone")}
          />
          <Select
            label={t("status")}
            options={DRIVER_STATUSES.map((s) => ({ value: s, label: text.driverStatus(s) }))}
            hint={t("statusHint")}
            error={fieldError(errors.status)}
            {...register("status")}
          />
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
          invalidate(adminKeys.fleet());
          onClose();
        }}
      />
    </>
  );
}
