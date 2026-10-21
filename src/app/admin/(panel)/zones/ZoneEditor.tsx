"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Pencil, Plus, Power, PowerOff, WandSparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import {
  Controller,
  useForm,
  useWatch,
  type FieldErrors,
  type UseFormRegister,
  type UseFormRegisterReturn,
} from "react-hook-form";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  LtrText,
  Notice,
  Switch,
  TextArea,
  TextField,
  useToast,
  type Column,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import {
  createSubZone,
  createZone,
  deactivateZone,
  fetchZone,
  updateSubZone,
  updateZone,
  type SubZonePayload,
  type ZonePayload,
} from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { REASON_MAX, checkReason } from "@/lib/admin/catalog/fields";
import {
  firstVertexOutside,
  formatPolygonText,
  parsePolygonText,
  subZoneFormSchema,
  subZoneToFormValues,
  zoneFormSchema,
  zoneToFormValues,
  type ZoneFormValues,
} from "@/lib/admin/geo";
import type { GeoPolygon, SubZone, Zone } from "@/lib/admin/types";
import {
  ActiveBadge,
  BilingualFields,
  CodeField,
  FormErrorNotice,
  ReasonField,
  SectionTitle,
  StaleDialog,
} from "../catalog/_components/CatalogFields";
import { useCatalogText, useFieldError } from "../catalog/_components/catalogText";
import { PolygonPreview, type PreviewShape } from "./PolygonPreview";

/** POLYGON_INVALID / SUB_ZONE_OUTSIDE_ZONE → copy for the polygon field, plus the offending vertex if any. */
function usePolygonApiError() {
  const t = useTranslations("admin.zones");
  const reasons = useTranslations("admin.zones.polygonReasons");
  return (error: unknown): { message: string; vertex: [number, number] | null } | null => {
    if (!(error instanceof AdminApiError)) return null;
    if (error.code === "POLYGON_INVALID") {
      const reason = typeof error.details.reason === "string" ? error.details.reason : "";
      const path = typeof error.details.path === "string" ? error.details.path : null;
      const text = reason && reasons.has(reason) ? reasons(reason) : error.message;
      return { message: path ? t("polygonErrorAt", { reason: text, path }) : text, vertex: null };
    }
    if (error.code === "SUB_ZONE_OUTSIDE_ZONE") {
      const v = error.details.vertex;
      const vertex =
        Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" ? ([v[0], v[1]] as [number, number]) : null;
      const code = typeof error.details.sub_zone_code === "string" ? error.details.sub_zone_code : "";
      return {
        message: vertex
          ? t("outsideZoneAt", { code, lng: vertex[0], lat: vertex[1] })
          : t("outsideZone", { code }),
        vertex,
      };
    }
    return null;
  };
}

function useZoneSaved() {
  const queryClient = useQueryClient();
  return (zone: Zone) => {
    queryClient.setQueryData(adminKeys.zone(zone.id), zone);
    void queryClient.invalidateQueries({ queryKey: adminKeys.zones() });
    // Price rows show zone names and the public "from" price depends on active zones.
    void queryClient.invalidateQueries({ queryKey: adminKeys.catalog() });
  };
}

const ZONE_FIELDS = ["code", "name", "name.ar", "name.en", "polygon", "default_travel_buffer_min", "sort_order", "is_active", "reason"] as const;

/** GeoJSON text area with a Format button and a live validity line. */
function PolygonField({
  text,
  onFormat,
  error,
  registration,
}: {
  /** The field's current text (watched by the form). */
  text: string;
  onFormat: (formatted: string) => void;
  error?: string;
  registration: UseFormRegisterReturn;
}) {
  const t = useTranslations("admin.zones");
  const check = useMemo(() => (text.trim() ? parsePolygonText(text) : null), [text]);
  const points = check?.ok
    ? (check.polygon.type === "Polygon" ? [check.polygon.coordinates] : check.polygon.coordinates)
        .flat()
        .reduce((n, ring) => n + ring.length - 1, 0)
    : 0;
  return (
    <div className="flex flex-col gap-2">
      <TextArea
        label={t("polygon")}
        hint={t("polygonHint")}
        required
        dir="ltr"
        rows={10}
        spellCheck={false}
        className="text-start font-mono text-[13px]"
        error={error}
        {...registration}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={!check?.ok}
          onClick={() => check?.ok && onFormat(formatPolygonText(check.polygon))}
          icon={<WandSparkles aria-hidden className="size-4" />}
        >
          {t("format")}
        </Button>
        {check?.ok && !error && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success-700">
            <CircleCheck aria-hidden className="size-4" />
            {t("polygonValid", { count: points })}
          </span>
        )}
      </div>
    </div>
  );
}

/** The polygon typed so far, when it is valid (for the live preview). */
function useDraftPolygon(text: string): GeoPolygon | null {
  return useMemo(() => {
    if (!text.trim()) return null;
    const check = parsePolygonText(text);
    return check.ok ? check.polygon : null;
  }, [text]);
}

// ---- Create ----------------------------------------------------------------------------------------------------

export function CreateZoneDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (zone: Zone) => void }) {
  const t = useTranslations("admin.zones");
  const fieldError = useFieldError();
  const polygonError = usePolygonApiError();
  const toast = useToast();
  const saved = useZoneSaved();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(zoneFormSchema("create")), defaultValues: zoneToFormValues(null) });
  const polygonText = useWatch({ control, name: "polygon" });
  const draft = useDraftPolygon(polygonText);

  const create = useMutation({
    mutationFn: ({ payload, reason }: { payload: ZonePayload; reason: string }) => createZone({ ...payload, reason }),
    onSuccess: (zone) => {
      saved(zone);
      toast.success(t("created", { code: zone.code }));
      onCreated(zone);
    },
    onError: (error) => {
      const polygon = polygonError(error);
      if (polygon) {
        setError("polygon", { type: "server", message: polygon.message });
        setFieldsApplied(true);
      } else setFieldsApplied(applyFieldErrors(error, setError, ZONE_FIELDS));
    },
  });

  const submit = handleSubmit(({ payload, reason }) => {
    const reasonError = checkReason(reason);
    if (reasonError) {
      setError("reason", { message: reasonError });
      return;
    }
    create.mutate({ payload, reason: reason.trim() });
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("createTitle")}
      description={t("createBody")}
      dismissible={!create.isPending}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            {t("createSubmit")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <ZoneBasics register={register} errors={errors} fieldError={fieldError} />
        <div className="sm:col-span-2">
          <PolygonField
            text={polygonText}
            onFormat={(v) => setValue("polygon", v, { shouldDirty: true })}
            error={fieldError(errors.polygon)}
            registration={register("polygon")}
          />
        </div>
        <div className="sm:col-span-2">
          <PolygonPreview label={t("preview.label")} shapes={draft ? [{ key: "draft", polygon: draft, variant: "draft" }] : []} />
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
          <FormErrorNotice error={create.error} fieldsApplied={fieldsApplied} />
        </div>
      </form>
    </Dialog>
  );
}

/** Code, names, travel buffer and display order (shared by create and edit). */
function ZoneBasics({
  register,
  errors,
  fieldError,
}: {
  register: UseFormRegister<ZoneFormValues>;
  errors: FieldErrors<ZoneFormValues>;
  fieldError: ReturnType<typeof useFieldError>;
}) {
  const t = useTranslations("admin.zones");
  const numeric = { inputMode: "numeric" as const, dir: "ltr" as const, className: "font-latin text-start" };
  return (
    <>
      <CodeField registration={register("code")} hint={t("codeHint")} error={fieldError(errors.code)} />
      <TextField label={t("sortOrder")} required error={fieldError(errors.sort_order)} {...numeric} {...register("sort_order")} />
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
      <TextField
        label={t("travelBuffer")}
        hint={t("travelBufferHint")}
        suffix={t("minutesSuffix")}
        error={fieldError(errors.default_travel_buffer_min)}
        {...numeric}
        {...register("default_travel_buffer_min")}
      />
    </>
  );
}

// ---- Edit (drawer) ---------------------------------------------------------------------------------------------

/**
 * Zone details: edit the zone (If-Match), deactivate / re-activate it with a reason, and manage its sub-zones. The
 * drawer stays open after a save so sub-zones can be edited next.
 */
export function ZoneDrawer({ initial, onClose }: { initial: Zone; onClose: () => void }) {
  const t = useTranslations("admin.zones");
  const text = useCatalogText();
  const query = useQuery({
    queryKey: adminKeys.zone(initial.id),
    queryFn: () => fetchZone(initial.id),
    placeholderData: initial,
  });
  const zone = query.data ?? initial;
  const formId = useId();
  const [pending, setPending] = useState(false);

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      title={text.name(zone.name)}
      description={
        <span className="inline-flex items-center gap-2">
          <bdi dir="ltr" className="font-latin">
            {zone.code}
          </bdi>
          <ActiveBadge active={zone.is_active} />
        </span>
      }
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("close")}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {t("save")}
          </Button>
        </>
      }
    >
      {query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <ZoneEditForm key={zone.version} zone={zone} formId={formId} onPendingChange={setPending} onReload={() => void query.refetch()} />
          <ZoneStatusSection zone={zone} />
          <SubZonesSection zone={zone} />
        </>
      )}
    </Drawer>
  );
}

function ZoneEditForm({
  zone,
  formId,
  onPendingChange,
  onReload,
}: {
  zone: Zone;
  formId: string;
  onPendingChange: (pending: boolean) => void;
  onReload: () => void;
}) {
  const t = useTranslations("admin.zones");
  const fieldError = useFieldError();
  const polygonError = usePolygonApiError();
  const toast = useToast();
  const saved = useZoneSaved();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);
  const [outsideVertex, setOutsideVertex] = useState<[number, number] | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(zoneFormSchema("edit")), defaultValues: zoneToFormValues(zone) });
  const polygonText = useWatch({ control, name: "polygon" });
  const draft = useDraftPolygon(polygonText);

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: Partial<ZonePayload>; reason: string }) => updateZone(zone.id, { ...payload, reason }, zone.version),
    onMutate: () => onPendingChange(true),
    onSettled: () => onPendingChange(false),
    onSuccess: (updated) => {
      saved(updated);
      toast.success(t("saved", { code: updated.code }));
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") {
        setStale(true);
        return;
      }
      const polygon = polygonError(error);
      if (polygon) {
        setError("polygon", { type: "server", message: polygon.message });
        setOutsideVertex(polygon.vertex);
        setFieldsApplied(true);
      } else setFieldsApplied(applyFieldErrors(error, setError, ZONE_FIELDS));
    },
  });

  const submit = handleSubmit(({ payload, reason }) => {
    const reasonError = checkReason(reason);
    if (reasonError) {
      setError("reason", { message: reasonError });
      return;
    }
    setOutsideVertex(null);
    save.mutate({ payload, reason: reason.trim() });
  });

  const shapes: PreviewShape[] = [
    ...(draft ? [{ key: "zone", polygon: draft, variant: "zone" as const }] : []),
    ...(zone.sub_zones ?? []).map((s) => ({
      key: `sub-${s.id}`,
      polygon: s.polygon,
      variant: s.is_active ? ("subZone" as const) : ("inactive" as const),
    })),
  ];

  return (
    <>
      <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <ZoneBasics register={register} errors={errors} fieldError={fieldError} />
        <div className="sm:col-span-2">
          <PolygonField
            text={polygonText}
            onFormat={(v) => setValue("polygon", v, { shouldDirty: true })}
            error={fieldError(errors.polygon)}
            registration={register("polygon")}
          />
        </div>
        <div className="sm:col-span-2">
          <PolygonPreview label={t("preview.label")} shapes={shapes} highlight={outsideVertex} />
        </div>
        <div className="sm:col-span-2">
          <ReasonField registration={register("reason")} error={fieldError(errors.reason)} />
        </div>
        <div className="sm:col-span-2">
          <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} />
        </div>
      </form>
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          onReload();
        }}
      />
    </>
  );
}

/** Deactivate (POST /deactivate) or re-activate (PATCH is_active) with a required reason. */
function ZoneStatusSection({ zone }: { zone: Zone }) {
  const t = useTranslations("admin.zones");
  const errorsT = useTranslations("admin.catalog.errors");
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const saved = useZoneSaved();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () =>
      zone.is_active
        ? deactivateZone(zone.id, zone.version, reason.trim())
        : updateZone(zone.id, { is_active: true, reason: reason.trim() }, zone.version),
    onSuccess: (updated) => {
      saved(updated);
      toast.success(updated.is_active ? t("activated", { code: updated.code }) : t("deactivated", { code: updated.code }));
      setOpen(false);
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle description={zone.is_active ? t("deactivateIntro") : t("inactiveIntro")}>{t("statusTitle")}</SectionTitle>
      <Button
        variant={zone.is_active ? "danger" : "secondary"}
        className="self-start"
        onClick={() => {
          change.reset();
          setReason("");
          setReasonError(null);
          setOpen(true);
        }}
        icon={zone.is_active ? <PowerOff aria-hidden className="size-4" /> : <Power aria-hidden className="size-4" />}
      >
        {zone.is_active ? t("deactivate") : t("activate")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={zone.is_active ? t("deactivateTitle", { code: zone.code }) : t("activateTitle", { code: zone.code })}
        description={zone.is_active ? t("deactivateBody", { count: zone.active_addresses_count ?? 0 }) : t("activateBody")}
        confirmLabel={zone.is_active ? t("deactivate") : t("activate")}
        tone={zone.is_active ? "danger" : "primary"}
        pending={change.isPending}
        onConfirm={() => {
          const error = checkReason(reason);
          if (error) {
            setReasonError(errorsT(error));
            return;
          }
          change.mutate();
        }}
      >
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
        {change.error && (
          <Notice tone="danger">
            {change.error instanceof AdminApiError && change.error.code === "STALE_VERSION" ? t("staleStatus") : describe(change.error)}
          </Notice>
        )}
      </ConfirmDialog>
    </section>
  );
}

function SubZonesSection({ zone }: { zone: Zone }) {
  const t = useTranslations("admin.zones");
  const text = useCatalogText();
  const [editing, setEditing] = useState<SubZone | "new" | null>(null);

  const columns: Column<SubZone>[] = [
    {
      id: "name",
      header: t("columns.subZone"),
      cell: (s) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{text.name(s.name)}</span>
          <LtrText className="text-xs text-ink-600">{s.code}</LtrText>
        </div>
      ),
    },
    { id: "addresses", header: t("columns.addresses"), cell: (s) => <span className="font-latin">{s.active_addresses_count ?? 0}</span> },
    { id: "status", header: t("columns.status"), cell: (s) => <ActiveBadge active={s.is_active} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (s) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(s)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { name: text.name(s.name) })}>
          {t("edit")}
        </Button>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <SectionTitle description={t("subZonesIntro")}>{t("subZonesTitle")}</SectionTitle>
        <Button variant="secondary" size="sm" onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
          {t("addSubZone")}
        </Button>
      </div>
      <DataTable
        caption={t("subZonesCaption")}
        columns={columns}
        rows={zone.sub_zones ?? []}
        getRowId={(s) => s.id}
        empty={<EmptyState title={t("noSubZones")} />}
        minWidth={480}
      />
      {editing && <SubZoneDialog zone={zone} sub={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

const SUB_FIELDS = ["code", "name", "name.ar", "name.en", "polygon", "is_active", "reason"] as const;

function SubZoneDialog({ zone, sub, onClose }: { zone: Zone; sub: SubZone | null; onClose: () => void }) {
  const t = useTranslations("admin.zones");
  const text = useCatalogText();
  const fieldError = useFieldError();
  const polygonError = usePolygonApiError();
  const toast = useToast();
  const queryClient = useQueryClient();
  const formId = useId();
  const [fieldsApplied, setFieldsApplied] = useState(false);
  const [stale, setStale] = useState(false);
  const [apiVertex, setApiVertex] = useState<[number, number] | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(subZoneFormSchema), defaultValues: subZoneToFormValues(sub) });
  const polygonText = useWatch({ control, name: "polygon" });
  const draft = useDraftPolygon(polygonText);
  // Same containment rule as the API (boundary counts as inside), to warn before saving.
  const outside = draft ? firstVertexOutside(zone.polygon, draft) : null;

  const save = useMutation({
    mutationFn: ({ payload, reason }: { payload: SubZonePayload; reason: string }) =>
      sub ? updateSubZone(sub.id, { ...payload, reason }, sub.version) : createSubZone(zone.id, { ...payload, reason }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.zones() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.catalog() });
      toast.success(sub ? t("subSaved", { code: saved.code }) : t("subCreated", { code: saved.code }));
      onClose();
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "STALE_VERSION") {
        setStale(true);
        return;
      }
      const polygon = polygonError(error);
      if (polygon) {
        setError("polygon", { type: "server", message: polygon.message });
        setApiVertex(polygon.vertex);
        setFieldsApplied(true);
      } else setFieldsApplied(applyFieldErrors(error, setError, SUB_FIELDS));
    },
  });

  const submit = handleSubmit(({ payload, reason }) => {
    const reasonError = checkReason(reason);
    if (reasonError) {
      setError("reason", { message: reasonError });
      return;
    }
    setApiVertex(null);
    save.mutate({ payload, reason: reason.trim() });
  });

  const shapes: PreviewShape[] = [
    { key: "zone", polygon: zone.polygon, variant: "zone" },
    ...(zone.sub_zones ?? [])
      .filter((s) => s.id !== sub?.id)
      .map((s) => ({ key: `sub-${s.id}`, polygon: s.polygon, variant: "inactive" as const })),
    ...(draft ? [{ key: "draft", polygon: draft, variant: "draft" as const }] : []),
  ];

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={sub ? t("editSubTitle", { name: text.name(sub.name) }) : t("addSubTitle", { zone: text.name(zone.name) })}
        description={t("subBody")}
        dismissible={!save.isPending}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={save.isPending}>
              {t("cancel")}
            </Button>
            <Button type="submit" form={formId} loading={save.isPending}>
              {sub ? t("save") : t("createSubmit")}
            </Button>
          </>
        }
      >
        <form id={formId} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <CodeField registration={register("code")} hint={t("subCodeHint")} error={fieldError(errors.code)} />
          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <Switch label={t("active")} description={t("subActiveHint")} checked={field.value} onCheckedChange={field.onChange} />
            )}
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
          <div className="sm:col-span-2">
            <PolygonField
              text={polygonText}
              onFormat={(v) => setValue("polygon", v, { shouldDirty: true })}
              error={fieldError(errors.polygon)}
              registration={register("polygon")}
            />
          </div>
          {outside && !errors.polygon && (
            <Notice tone="warning" className="sm:col-span-2">
              {t("outsideWarning", { lng: outside[0], lat: outside[1] })}
            </Notice>
          )}
          <div className="sm:col-span-2">
            <PolygonPreview label={t("preview.subLabel")} shapes={shapes} highlight={apiVertex ?? outside} />
          </div>
          <div className="sm:col-span-2">
            <ReasonField registration={register("reason")} error={fieldError(errors.reason)} />
          </div>
          <div className="sm:col-span-2">
            <FormErrorNotice error={save.error} fieldsApplied={fieldsApplied} />
          </div>
        </form>
      </Dialog>
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void queryClient.invalidateQueries({ queryKey: adminKeys.zones() });
          onClose();
        }}
      />
    </>
  );
}
