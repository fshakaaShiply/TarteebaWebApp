"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FilterBar,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { REASON_MAX, checkReason } from "@/lib/admin/catalog/fields";
import { createBlackoutDate, deleteBlackoutDate, fetchBlackoutDates, updateBlackoutDate } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { businessToday } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { blackoutFormSchema, blackoutToFormValues, type BlackoutPayload } from "@/lib/admin/ops/scheduling";
import type { BlackoutDate } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { AsyncOptionsSelect, EditorShell, FormErrorNotice, StaleDialog } from "../../catalog/_components/CatalogFields";
import { useZoneName } from "../../_ops/OpsFields";
import { useOpsInvalidate } from "../../_ops/invalidate";
import { useZoneChoices } from "../../_ops/options";
import { useOpsErrorKey, useOpsFieldError, useOpsText } from "../../_ops/opsText";

const PER_PAGE = 25;

/**
 * A11 blackout dates (spec §6.4): days with no bookings, in every zone or one zone, with an optional reason in each
 * language. A capacity override can still open one slot on such a day. Permission catalog.manage.
 */
export function BlackoutDatesScreen() {
  const t = useTranslations("admin.scheduling.blackouts");
  const [editing, setEditing] = useState<BlackoutDate | "new" | null>(null);
  const [deleting, setDeleting] = useState<BlackoutDate | null>(null);
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
      <BlackoutTable onEdit={setEditing} onDelete={setDeleting} />
      {editing && <BlackoutEditor blackout={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteBlackoutDialog blackout={deleting} onClose={() => setDeleting(null)} />}
    </RequirePermission>
  );
}

function BlackoutTable({ onEdit, onDelete }: { onEdit: (b: BlackoutDate) => void; onDelete: (b: BlackoutDate) => void }) {
  const t = useTranslations("admin.scheduling.blackouts");
  const text = useOpsText();
  const zones = useZoneChoices();
  const zoneName = useZoneName(zones.data);
  // Upcoming dates by default; clearing "From" shows past ones too.
  const [filters, setFilters] = useState(() => ({ zone: "", from: businessToday(), to: "" }));
  const [page, setPage] = useState(1);
  const setFilter = (name: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
  };

  const list = useQuery({
    queryKey: adminKeys.blackoutList({ page, ...filters }),
    queryFn: () =>
      fetchBlackoutDates({
        page,
        perPage: PER_PAGE,
        zoneId: filters.zone ? Number(filters.zone) : undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const reasonText = (b: BlackoutDate) => text.name(b.reason) || "—";

  const columns: Column<BlackoutDate>[] = [
    {
      id: "date",
      header: t("columns.date"),
      cell: (b) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{text.date(b.date)}</span>
          <bdi dir="ltr" className="font-latin text-xs text-ink-600">
            {b.date}
          </bdi>
        </div>
      ),
    },
    { id: "zone", header: t("columns.zone"), cell: (b) => (b.zone_id === null ? t("allZones") : zoneName(b.zone_id)) },
    { id: "reason", header: t("columns.reason"), cell: (b) => <span className="text-sm text-ink-600">{reasonText(b)}</span> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (b) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(b)}
            icon={<Pencil aria-hidden className="size-4" />}
            aria-label={t("editLabel", { date: text.date(b.date) })}
          >
            {t("edit")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-700 hover:bg-danger-50 hover:text-danger-700"
            onClick={() => onDelete(b)}
            icon={<Trash2 aria-hidden className="size-4" />}
            aria-label={t("deleteLabel", { date: text.date(b.date) })}
          >
            {t("delete")}
          </Button>
        </div>
      ),
    },
  ];

  const filtered = filters.zone !== "" || filters.to !== "" || filters.from !== businessToday();

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setFilters({ zone: "", from: businessToday(), to: "" });
          setPage(1);
        }}
      >
        <Select
          label={t("filters.zone")}
          placeholder={t("filters.anyZone")}
          value={filters.zone}
          onChange={(e) => setFilter("zone", e.target.value)}
          options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
          hint={filters.zone ? t("filters.zoneHint") : undefined}
          containerClassName="min-w-[180px]"
        />
        <TextField
          type="date"
          label={t("filters.from")}
          value={filters.from}
          onChange={(e) => setFilter("from", e.target.value)}
          dir="ltr"
          className="font-latin text-start"
          containerClassName="min-w-[150px]"
        />
        <TextField
          type="date"
          label={t("filters.to")}
          value={filters.to}
          onChange={(e) => setFilter("to", e.target.value)}
          dir="ltr"
          className="font-latin text-start"
          containerClassName="min-w-[150px]"
        />
      </FilterBar>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(b) => b.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={t("empty")} body={t("emptyBody")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={640}
      />
    </Card>
  );
}

const FIELDS = ["date", "zone_id", "reason", "reason.ar", "reason.en"] as const;

function BlackoutEditor({ blackout, onClose }: { blackout: BlackoutDate | null; onClose: () => void }) {
  const mode = blackout ? "edit" : "create";
  const t = useTranslations("admin.scheduling.blackouts");
  const catalogT = useTranslations("admin.catalog.common");
  const text = useOpsText();
  const fieldError = useOpsFieldError();
  const toast = useToast();
  const invalidate = useOpsInvalidate();
  const zones = useZoneChoices();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(blackoutFormSchema), defaultValues: blackoutToFormValues(blackout) });

  const save = useMutation({
    mutationFn: (payload: BlackoutPayload) =>
      blackout ? updateBlackoutDate(blackout.id, payload, blackout.version) : createBlackoutDate(payload),
    onSuccess: (saved) => {
      invalidate(adminKeys.scheduling());
      toast.success(blackout ? t("updated", { date: text.date(saved.date) }) : t("created", { date: text.date(saved.date) }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") setStale(true);
      else setFieldsApplied(applyFieldErrors(error, setError, FIELDS));
    },
  });

  return (
    <>
      <EditorShell
        mode={mode}
        title={blackout ? t("editTitle", { date: text.date(blackout.date) }) : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={handleSubmit((payload) => save.mutate(payload))} className="grid gap-4 sm:grid-cols-2">
          <TextField
            type="date"
            label={t("date")}
            required
            dir="ltr"
            className="font-latin text-start"
            error={fieldError(errors.date)}
            {...register("date")}
          />
          <AsyncOptionsSelect
            control={control}
            name="zone_id"
            label={t("zone")}
            options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
            loading={zones.isPending}
            failed={zones.isError}
            placeholder={t("allZones")}
            loadingLabel={catalogT("loadingOptions")}
            hint={t("zoneHint")}
            error={fieldError(errors.zone_id)}
          />
          <TextField
            label={t("reasonAr")}
            dir="rtl"
            lang="ar"
            maxLength={200}
            error={fieldError(errors.reason?.ar)}
            {...register("reason.ar")}
          />
          <TextField
            label={t("reasonEn")}
            dir="ltr"
            lang="en"
            className="text-start"
            maxLength={200}
            error={fieldError(errors.reason?.en)}
            {...register("reason.en")}
          />
          <p className="text-xs text-ink-600 sm:col-span-2">{t("reasonHint")}</p>
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
          invalidate(adminKeys.scheduling());
          onClose();
        }}
      />
    </>
  );
}

function DeleteBlackoutDialog({ blackout, onClose }: { blackout: BlackoutDate; onClose: () => void }) {
  const t = useTranslations("admin.scheduling.blackouts");
  const text = useOpsText();
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const errorText = useOpsErrorKey();
  const invalidate = useOpsInvalidate();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => deleteBlackoutDate(blackout.id, blackout.version, reason.trim()),
    onSuccess: () => {
      invalidate(adminKeys.scheduling());
      toast.success(t("deleted", { date: text.date(blackout.date) }));
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteTitle", { date: text.date(blackout.date) })}
      description={t("deleteBody")}
      confirmLabel={t("delete")}
      tone="danger"
      pending={remove.isPending}
      onConfirm={() => {
        const problem = checkReason(reason);
        setReasonError(problem ? (errorText(problem) ?? null) : null);
        if (!problem) remove.mutate();
      }}
    >
      <TextArea
        label={t("deleteReason")}
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
      {remove.error ? <Notice tone="danger">{describe(remove.error)}</Notice> : null}
    </ConfirmDialog>
  );
}
