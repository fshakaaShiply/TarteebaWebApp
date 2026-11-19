"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  LtrText,
  PageHeader,
  SearchField,
  Select,
  StatusBadge,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { createWorker, fetchDashboardSummary, fetchWorkers } from "@/lib/admin/endpoints";
import { applyFieldErrors } from "@/lib/admin/errors";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import { OVERVIEW_PERMISSIONS } from "@/lib/admin/nav";
import { businessToday } from "@/lib/admin/format";
import { hoursText } from "@/lib/admin/workforce/incentives";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import { EMPLOYMENT_STATUSES, newWorkerValues, workerFormSchema, type WorkerPayload } from "@/lib/admin/ops/workforce";
import { useAdminSession } from "@/lib/admin/session";
import type { EmploymentStatus, Worker } from "@/lib/admin/types";
import { RequirePermission } from "../../_components/RequirePermission";
import { FormErrorNotice } from "../catalog/_components/CatalogFields";
import { useOpsInvalidate } from "../_ops/invalidate";
import { useChoiceOptions, useServiceChoices, useServiceName, useSkills, useZoneChoices, useZoneName } from "../_ops/options";
import { employmentTone, useOpsText } from "../_ops/opsText";
import { WORKER_FIELDS, WorkerFormFields } from "./WorkerFormFields";
import { WorkerAvatar } from "./_components/WorkerAvatar";

const PER_PAGE = 25;

/** A05 workers (spec §17): searchable list with filters; HR adds workers here. */
export function WorkersScreen() {
  const t = useTranslations("admin.workers");
  const { can } = useAdminSession();
  const [creating, setCreating] = useState(false);
  return (
    <RequirePermission anyOf={["workers.view"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          can("workers.manage") ? (
            <Button onClick={() => setCreating(true)} icon={<Plus aria-hidden className="size-4" />}>
              {t("create")}
            </Button>
          ) : undefined
        }
      />
      <WorkersTable />
      {creating && <CreateWorkerDialog onClose={() => setCreating(false)} />}
    </RequirePermission>
  );
}

type Filters = { search: string; zone: string; status: string; service: string; skill: string; alert: string };
const NO_FILTERS: Filters = { search: "", zone: "", status: "", service: "", skill: "", alert: "" };

function WorkersTable() {
  const t = useTranslations("admin.workers");
  const text = useOpsText();
  const wt = useWorkforceText();
  const { can, canAny } = useAdminSession();
  const zones = useZoneChoices();
  const services = useServiceChoices();
  const choiceOptions = useChoiceOptions();
  const zoneName = useZoneName();
  const serviceName = useServiceName();
  const skills = useSkills();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(filters.search.trim(), 300);
  const setFilter = (name: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
  };

  const list = useQuery({
    queryKey: adminKeys.workerList({ page, search, zone: filters.zone, status: filters.status, service: filters.service, skill: filters.skill, alert: filters.alert }),
    queryFn: () =>
      fetchWorkers({
        page,
        perPage: PER_PAGE,
        search,
        zoneId: filters.zone ? Number(filters.zone) : undefined,
        status: filters.status as EmploymentStatus | "",
        serviceId: filters.service ? Number(filters.service) : undefined,
        skill: filters.skill,
        alert: filters.alert === "documents" ? "documents" : undefined,
      }),
    placeholderData: keepPreviousData,
  });
  // "9 available today" is the overview's own figure: read only by staff who may open the overview (the API refuses the rest).
  const summary = useQuery({
    queryKey: adminKeys.dashboardSummary(businessToday(), null),
    queryFn: () => fetchDashboardSummary({ date: businessToday() }),
    enabled: canAny(OVERVIEW_PERMISSIONS),
    retry: false,
  });
  const available = summary.data?.panels.workers.available;

  const columns: Column<Worker>[] = [
    {
      id: "worker",
      header: t("columns.worker"),
      cell: (w) => (
        <div className="flex items-center gap-3">
          <WorkerAvatar name={w.display_name} url={w.photo_url} />
          <div className="flex flex-col">
            <span className="font-bold text-ink-900">{w.display_name}</span>
            <span className="text-xs text-ink-600">{text.name(w.full_name)}</span>
            <LtrText className="text-xs text-ink-600">{w.employee_no}</LtrText>
          </div>
        </div>
      ),
    },
    { id: "zone", header: t("columns.zone"), cell: (w) => zoneName(w.home_zone_id, w.home_zone && text.name(w.home_zone.name)) },
    {
      id: "status",
      header: t("columns.status"),
      cell: (w) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={employmentTone[w.employment_status] ?? "neutral"}>{text.employmentStatus(w.employment_status)}</StatusBadge>
          {w.on_leave_until && <span className="text-xs text-ink-600">{t("onLeaveUntil", { date: text.dateShort(w.on_leave_until) })}</span>}
        </div>
      ),
    },
    {
      id: "restDay",
      header: t("columns.restDay"),
      cell: (w) => text.weekday(w.weekly_rest_day),
    },
    {
      id: "services",
      header: t("columns.services"),
      cell: (w) =>
        w.services && w.services.length > 0 ? (
          <span className="text-sm">{w.services.map((s) => serviceName(s.id, text.name(s.name))).join(t("listSeparator"))}</span>
        ) : (
          <span className="text-sm text-ink-600">{t("noServices")}</span>
        ),
    },
    {
      id: "skills",
      header: t("columns.skills"),
      cell: (w) =>
        w.skills && w.skills.length > 0 ? (
          <ul className="flex flex-wrap gap-1">
            {w.skills.map((s) => (
              <li key={s.id} className="rounded-pill bg-petrol-50 px-2 py-0.5 text-xs font-medium text-petrol-700">
                {text.name(s.name)}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-sm text-ink-600">—</span>
        ),
    },
    {
      id: "weekHours",
      header: t("columns.weekHours"),
      cell: (w) => (w.week_minutes === undefined ? <span className="text-sm text-ink-600">—</span> : <span className="font-latin text-sm">{t("hoursValue", { hours: hoursText(w.week_minutes) })}</span>),
    },
    {
      id: "rating",
      header: t("columns.rating"),
      cell: (w) =>
        w.rating ? (
          <span className="text-sm">
            <span aria-hidden>★ </span>
            <bdi dir="ltr" className="font-latin font-medium">
              {w.rating.average.toFixed(1)}
            </bdi>
            <span className="text-ink-600"> · {t("ratingCount", { count: w.rating.count })}</span>
          </span>
        ) : (
          <span className="text-sm text-ink-600">—</span>
        ),
    },
    ...(can("workers.documents")
      ? [
          {
            id: "alert",
            header: t("columns.alert"),
            cell: (w: Worker) => {
              const a = w.alert;
              if (!a) return <span className="text-sm text-ink-600">—</span>;
              const more = (w.alerts_count ?? 1) - 1;
              return (
                <span className="flex flex-col items-start gap-0.5">
                  <StatusBadge tone={a.state === "expired" ? "danger" : "pending"}>
                    {a.state === "expired"
                      ? t("alertExpired", { type: wt.documentType(a.type) })
                      : a.days_left === 0
                        ? t("alertToday", { type: wt.documentType(a.type) })
                        : t("alertSoon", { type: wt.documentType(a.type), count: a.days_left ?? 0 })}
                  </StatusBadge>
                  {more > 0 && <span className="text-xs text-ink-600">{t("alertMore", { count: more })}</span>}
                </span>
              );
            },
          },
        ]
      : []),
    {
      id: "liveOut",
      header: t("columns.liveOut"),
      cell: (w) => (w.can_live_out ? <StatusBadge tone="confirmed">{t("liveOutYes")}</StatusBadge> : <span className="text-sm text-ink-600">—</span>),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (w) => (
        <ButtonLink
          href={`/admin/workers/${w.id}`}
          variant="ghost"
          size="sm"
          className="flex-row-reverse"
          icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
          aria-label={t("openLabel", { name: w.display_name })}
        >
          {t("open")}
        </ButtonLink>
      ),
    },
  ];

  const filtered = Object.values(filters).some((v) => v !== "");

  return (
    <Card>
      {list.data && (
        <p className="text-sm text-ink-600" aria-live="polite">
          {available === undefined ? t("countLine", { count: list.data.meta.total }) : t("countLineAvailable", { count: list.data.meta.total, available })}
        </p>
      )}
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setFilters(NO_FILTERS);
          setPage(1);
        }}
      >
        <SearchField label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} value={filters.search} onChange={(v) => setFilter("search", v)} />
        <Select
          label={t("filters.zone")}
          placeholder={t("filters.allZones")}
          value={filters.zone}
          onChange={(e) => setFilter("zone", e.target.value)}
          options={choiceOptions(zones.data)}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value)}
          options={EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: text.employmentStatus(s) }))}
          containerClassName="min-w-[150px]"
        />
        <Select
          label={t("filters.service")}
          placeholder={t("filters.allServices")}
          value={filters.service}
          onChange={(e) => setFilter("service", e.target.value)}
          options={choiceOptions(services.data)}
          containerClassName="min-w-[170px]"
        />
        {can("workers.documents") && (
          <Select
            label={t("filters.documents")}
            placeholder={t("filters.allCleaners")}
            value={filters.alert}
            onChange={(e) => setFilter("alert", e.target.value)}
            options={[{ value: "documents", label: t("filters.documentAlerts") }]}
            containerClassName="min-w-[170px]"
          />
        )}
        <Select
          label={t("filters.skill")}
          placeholder={t("filters.allSkills")}
          value={filters.skill}
          onChange={(e) => setFilter("skill", e.target.value)}
          options={(skills.data ?? []).map((s) => ({ value: s.code, label: text.name(s.name) }))}
          containerClassName="min-w-[150px]"
        />
      </FilterBar>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(w) => w.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={1100}
      />
    </Card>
  );
}

function CreateWorkerDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("admin.workers");
  const router = useRouter();
  const toast = useToast();
  const invalidate = useOpsInvalidate();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(workerFormSchema()), defaultValues: newWorkerValues() });

  const save = useMutation({
    mutationFn: (payload: WorkerPayload) => createWorker(payload),
    onSuccess: (worker) => {
      invalidate(adminKeys.workers());
      toast.success(t("created", { name: worker.display_name }));
      onClose();
      // Next step: the weekly schedule (a new worker has no shifts yet).
      router.push(`/admin/workers/${worker.id}?tab=schedule`);
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "PHONE_INVALID") {
        setError("phone", { message: "phoneInvalid" });
        setFieldsApplied(true);
        return;
      }
      setFieldsApplied(applyFieldErrors(error, setError, WORKER_FIELDS));
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={t("createTitle")}
      description={t("createBody")}
      size="lg"
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {t("createSubmit")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={handleSubmit((payload) => save.mutate(payload))} className="flex flex-col gap-4">
        <WorkerFormFields register={register} control={control} errors={errors} privateFields />
        <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} />
      </form>
    </Dialog>
  );
}
