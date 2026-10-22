"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
  StatusBadge,
  Switch,
  TextArea,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { REASON_MAX, checkReason } from "@/lib/admin/catalog/fields";
import { WEEKDAYS } from "@/lib/admin/catalog/forms";
import { createSlotRule, deleteSlotRule, fetchSlotRules, updateSlotRule } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { CAPACITY_OVERRIDE_PERMISSION } from "@/lib/admin/ops/capacity";
import { RULE_PRECEDENCE, slotRuleFormSchema, slotRuleToFormValues, type SlotRulePayload } from "@/lib/admin/ops/scheduling";
import { useAdminSession } from "@/lib/admin/session";
import type { SlotRule } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { AsyncOptionsSelect, EditorShell, FormErrorNotice, StaleDialog } from "../../catalog/_components/CatalogFields";
import { useOpsInvalidate } from "../../_ops/invalidate";
import { useServiceChoices, useSlotTemplateOptions, useZoneChoices } from "../../_ops/options";
import { useOpsErrorKey, useOpsFieldError, useOpsText } from "../../_ops/opsText";
import { useRuleText } from "../../_ops/ruleText";

const PER_PAGE = 25;

/**
 * A11 slot availability rules (spec §6.4): open or close a slot, or cap its bookings, for a zone, a service, a weekday
 * or a season. Capacity overrides appear here as read-only rules. Permission catalog.manage.
 */
export function SlotRulesScreen() {
  const t = useTranslations("admin.scheduling.rules");
  const [editing, setEditing] = useState<SlotRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<SlotRule | null>(null);
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
      <PrecedenceCard />
      <SlotRulesTable onEdit={setEditing} onDelete={setDeleting} />
      {editing && <SlotRuleEditor rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteRuleDialog rule={deleting} onClose={() => setDeleting(null)} />}
    </RequirePermission>
  );
}

/** Plain-language version of RuleResolver's order (decision P2-12). */
function PrecedenceCard() {
  const t = useTranslations("admin.scheduling.rules.precedence");
  return (
    <Card title={t("title")}>
      <p className="text-sm/6 text-ink-600">{t("intro")}</p>
      <ol className="list-decimal flex-col gap-1 ps-5 text-sm/6 text-ink-900 marker:font-bold marker:text-petrol-700">
        {RULE_PRECEDENCE.map((step) => (
          <li key={step}>{t(`steps.${step}`)}</li>
        ))}
      </ol>
      <p className="text-sm/6 text-ink-600">{t("noRule")}</p>
      <p className="text-sm/6 text-ink-600">{t("blackouts")}</p>
    </Card>
  );
}

function SlotRulesTable({ onEdit, onDelete }: { onEdit: (rule: SlotRule) => void; onDelete: (rule: SlotRule) => void }) {
  const t = useTranslations("admin.scheduling.rules");
  const text = useOpsText();
  const ruleText = useRuleText();
  const { can } = useAdminSession();
  const slots = useSlotTemplateOptions();
  const zones = useZoneChoices();
  const services = useServiceChoices();
  const [filters, setFilters] = useState({ slot: "", zone: "", service: "", source: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const setFilter = (name: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [name]: value }));
    setPage(1);
  };

  const list = useQuery({
    queryKey: adminKeys.slotRuleList({ page, ...filters }),
    queryFn: () =>
      fetchSlotRules({
        page,
        perPage: PER_PAGE,
        slotTemplateId: filters.slot ? Number(filters.slot) : undefined,
        zoneId: filters.zone ? Number(filters.zone) : undefined,
        serviceId: filters.service ? Number(filters.service) : undefined,
        source: (filters.source || undefined) as "admin" | "override" | undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const slotName = (rule: SlotRule) => {
    const slot = slots.data?.find((s) => s.id === rule.slot_template_id);
    return slot ? `${text.name(slot.name)} (${slot.start_time}–${slot.end_time})` : (rule.slot ?? `#${rule.slot_template_id}`);
  };

  const columns: Column<SlotRule>[] = [
    { id: "slot", header: t("columns.slot"), cell: (r) => <span className="font-bold text-ink-900">{slotName(r)}</span> },
    {
      id: "scope",
      header: t("columns.scope"),
      cell: (r) => (
        <ul className="flex flex-col text-sm">
          {ruleText.scope(r).map((part, i) => (
            <li key={i}>{part}</li>
          ))}
        </ul>
      ),
    },
    {
      id: "effect",
      header: t("columns.effect"),
      cell: (r) => <StatusBadge tone={r.is_open ? "success" : "danger"}>{ruleText.effect(r)}</StatusBadge>,
    },
    {
      id: "source",
      header: t("columns.source"),
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge tone={r.source === "override" ? "pending" : "neutral"} className="self-start">
            {text.ruleSource(r.source)}
          </StatusBadge>
          {r.created_by && <span className="text-xs text-ink-600">{r.created_by.name}</span>}
        </div>
      ),
    },
    { id: "reason", header: t("columns.reason"), cell: (r) => <span className="text-sm text-ink-600">{r.reason ?? "—"}</span> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (r) => {
        const override = r.source === "override";
        const mayDelete = !override || can(CAPACITY_OVERRIDE_PERMISSION);
        return (
          <div className="flex justify-end gap-1">
            {override ? (
              <span className="inline-flex items-center gap-1 px-2 text-xs text-ink-600" title={t("readOnlyHint")}>
                <Lock aria-hidden className="size-3.5" />
                {t("readOnly")}
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(r)}
                icon={<Pencil aria-hidden className="size-4" />}
                aria-label={t("editLabel", { slot: slotName(r) })}
              >
                {t("edit")}
              </Button>
            )}
            {mayDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-700 hover:bg-danger-50 hover:text-danger-700"
                onClick={() => onDelete(r)}
                icon={<Trash2 aria-hidden className="size-4" />}
                aria-label={t("deleteLabel", { slot: slotName(r) })}
              >
                {t("delete")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const filtered = Object.values(filters).some((v) => v !== "");

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setFilters({ slot: "", zone: "", service: "", source: "", from: "", to: "" });
          setPage(1);
        }}
      >
        <Select
          label={t("filters.slot")}
          placeholder={t("filters.allSlots")}
          value={filters.slot}
          onChange={(e) => setFilter("slot", e.target.value)}
          options={(slots.data ?? []).map((s) => ({ value: String(s.id), label: text.name(s.name) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.zone")}
          placeholder={t("filters.allZones")}
          value={filters.zone}
          onChange={(e) => setFilter("zone", e.target.value)}
          options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.service")}
          placeholder={t("filters.allServices")}
          value={filters.service}
          onChange={(e) => setFilter("service", e.target.value)}
          options={(services.data ?? []).map((s) => ({ value: String(s.id), label: text.name(s.name) }))}
          containerClassName="min-w-[170px]"
        />
        <Select
          label={t("filters.source")}
          placeholder={t("filters.allSources")}
          value={filters.source}
          onChange={(e) => setFilter("source", e.target.value)}
          options={[
            { value: "admin", label: text.ruleSource("admin") },
            { value: "override", label: text.ruleSource("override") },
          ]}
          containerClassName="min-w-[160px]"
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
        getRowId={(r) => r.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} body={filtered ? undefined : t("emptyBody")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={900}
      />
    </Card>
  );
}

const FIELDS = [
  "slot_template_id",
  "zone_id",
  "service_id",
  "day_of_week",
  "date_from",
  "date_to",
  "is_open",
  "max_bookings",
  "reason",
] as const;

function SlotRuleEditor({ rule, onClose }: { rule: SlotRule | null; onClose: () => void }) {
  const mode = rule ? "edit" : "create";
  const t = useTranslations("admin.scheduling.rules");
  const catalogT = useTranslations("admin.catalog.common");
  const text = useOpsText();
  const fieldError = useOpsFieldError();
  const toast = useToast();
  const invalidate = useOpsInvalidate();
  const slots = useSlotTemplateOptions();
  const zones = useZoneChoices();
  const services = useServiceChoices();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(slotRuleFormSchema), defaultValues: slotRuleToFormValues(rule) });
  const isOpen = useWatch({ control, name: "is_open" });

  const save = useMutation({
    mutationFn: (payload: SlotRulePayload) => (rule ? updateSlotRule(rule.id, payload, rule.version) : createSlotRule(payload)),
    onSuccess: () => {
      invalidate(adminKeys.scheduling());
      toast.success(rule ? t("updated") : t("created"));
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
        title={rule ? t("editTitle") : t("createTitle")}
        description={t("editorBody")}
        formId={formId}
        pending={save.isPending}
        onClose={onClose}
      >
        <form id={formId} noValidate onSubmit={handleSubmit((payload) => save.mutate(payload))} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <AsyncOptionsSelect
              control={control}
              name="slot_template_id"
              label={t("slot")}
              options={(slots.data ?? []).map((s) => ({
                value: String(s.id),
                label: `${text.name(s.name)} (${s.start_time}–${s.end_time})`,
              }))}
              loading={slots.isPending}
              failed={slots.isError}
              placeholder={t("chooseSlot")}
              loadingLabel={catalogT("loadingOptions")}
              error={fieldError(errors.slot_template_id)}
            />
          </div>
          <AsyncOptionsSelect
            control={control}
            name="zone_id"
            label={t("zone")}
            options={(zones.data ?? []).map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
            loading={zones.isPending}
            failed={zones.isError}
            placeholder={t("scope.allZones")}
            loadingLabel={catalogT("loadingOptions")}
            error={fieldError(errors.zone_id)}
          />
          <AsyncOptionsSelect
            control={control}
            name="service_id"
            label={t("service")}
            options={(services.data ?? []).map((s) => ({ value: String(s.id), label: text.name(s.name) }))}
            loading={services.isPending}
            failed={services.isError}
            placeholder={t("scope.allServices")}
            loadingLabel={catalogT("loadingOptions")}
            error={fieldError(errors.service_id)}
          />
          <Select
            label={t("weekday")}
            placeholder={t("scope.everyDay")}
            options={WEEKDAYS.map((d) => ({ value: String(d), label: text.weekday(d) }))}
            error={fieldError(errors.day_of_week)}
            {...register("day_of_week")}
          />
          <div />
          <TextField
            type="date"
            label={t("dateFrom")}
            dir="ltr"
            className="font-latin text-start"
            hint={t("datesHint")}
            error={fieldError(errors.date_from)}
            {...register("date_from")}
          />
          <TextField
            type="date"
            label={t("dateTo")}
            dir="ltr"
            className="font-latin text-start"
            error={fieldError(errors.date_to)}
            {...register("date_to")}
          />
          <div className="sm:col-span-2">
            <Controller
              control={control}
              name="is_open"
              render={({ field }) => (
                <Switch
                  label={t("isOpen")}
                  description={t("isOpenHint")}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  stateLabel={field.value ? t("effect.openShort") : t("effect.closed")}
                />
              )}
            />
          </div>
          {isOpen && (
            <TextField
              label={t("maxBookings")}
              inputMode="numeric"
              dir="ltr"
              className="font-latin text-start"
              hint={t("maxBookingsHint")}
              error={fieldError(errors.max_bookings)}
              {...register("max_bookings")}
            />
          )}
          <div className="sm:col-span-2">
            <TextArea
              label={t("reason")}
              hint={t("reasonHint")}
              required
              rows={2}
              maxLength={REASON_MAX}
              error={fieldError(errors.reason)}
              {...register("reason")}
            />
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
          invalidate(adminKeys.scheduling());
          onClose();
        }}
      />
    </>
  );
}

function DeleteRuleDialog({ rule, onClose }: { rule: SlotRule; onClose: () => void }) {
  const t = useTranslations("admin.scheduling.rules");
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const errorText = useOpsErrorKey();
  const invalidate = useOpsInvalidate();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => deleteSlotRule(rule.id, rule.version, reason.trim()),
    onSuccess: () => {
      invalidate(adminKeys.scheduling());
      toast.success(t("deleted"));
      onClose();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteTitle")}
      description={rule.source === "override" ? t("deleteOverrideBody") : t("deleteBody")}
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
