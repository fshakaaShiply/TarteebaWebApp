"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, MapPin, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  CheckboxGroup,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextField,
  useUnsavedChanges,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import {
  CLEANING_AREAS,
  MANUAL_DEFAULTS,
  MANUAL_FIELD_MAP,
  MANUAL_LIMITS,
  MANUAL_SOURCES,
  MANUAL_STEPS,
  PROPERTY_TYPES,
  manualFormSchema,
  manualPayload,
  normalizeUaePhone,
  parseCoordinates,
  stepOfField,
  type ManualFormValues,
} from "@/lib/admin/bookings/manual";
import { checkZone, createManualBooking, fetchAddons, fetchBooking, fetchBookings, fetchPublicServices, fetchWorkers } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { addDaysIso, businessToday } from "@/lib/admin/format";
import { useIdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { CAPACITY_OVERRIDE_PERMISSION, FORCE_REASON_MAX } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { AddressSnapshot, ManualBookingResult, ZoneCheck } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { FormErrorNotice } from "../../catalog/_components/CatalogFields";
import { useChoiceLabel, useServiceChoices, useZoneChoices } from "../../_ops/options";
import { BookingChips, Ltr } from "../_components/BookingBits";
import { PaymentLinkBox } from "../_components/PaymentLinkBox";
import { SlotSelect, useSlotChoices } from "../_components/SlotSelect";
import { useBookingText } from "../_components/bookingText";
import { useBookingRefresh } from "../_components/refresh";

/**
 * A03 manual booking wizard (spec §6.2, §14.3, §17; design AdminBookings.dc.html "new manual booking";
 * bookings.create_manual): source → customer by phone (found or created) → address (one of the customer's, or a new
 * one with its position checked against the zones) → service, team and time (from the capacity view) → details and
 * review. The result shows the booking and its payment link to copy or open in WhatsApp; the web sends nothing itself
 * (the coordinator presses send in WhatsApp).
 */
export function ManualBookingWizard() {
  const t = useTranslations("admin.manual");
  return (
    <RequirePermission anyOf={["bookings.create_manual"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Wizard />
    </RequirePermission>
  );
}

type LookupResult = { name: string | null; addresses: AddressSnapshot[]; found: boolean };

/** The customer's name and saved addresses, from their latest bookings (no customer search in the API yet). */
async function lookupCustomer(phone: string): Promise<LookupResult> {
  const page = await fetchBookings({ search: phone, perPage: 20 });
  const mine = page.data.filter((b) => b.customer.phone === phone);
  if (mine.length === 0) return { name: null, addresses: [], found: false };
  const details = await Promise.all(mine.slice(0, 5).map((b) => fetchBooking(b.id).catch(() => null)));
  const addresses = new Map<string, AddressSnapshot>();
  for (const d of details) {
    const a = d?.address;
    if (a?.id && !addresses.has(a.id)) addresses.set(a.id, a);
  }
  return { name: mine[0].customer.name, addresses: [...addresses.values()], found: true };
}

const STEP_COUNT = MANUAL_STEPS.length;

function Wizard() {
  const t = useTranslations("admin.manual");
  const e = useTranslations("admin.manual.errors");
  const text = useBookingText();
  const { can } = useAdminSession();
  const describe = useAdminErrorMessage();
  const keys = useIdempotencyKeys();
  const refresh = useBookingRefresh();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ManualBookingResult | null>(null);
  const [lookupPhone, setLookupPhone] = useState<string | null>(null);
  const [zoneCheck, setZoneCheck] = useState<{ coordinates: string; result: ZoneCheck | null; error: unknown } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const form = useForm<ManualFormValues>({ defaultValues: { ...MANUAL_DEFAULTS, serviceDate: addDaysIso(businessToday(), 1) } });
  const v = useWatch({ control: form.control }) as ManualFormValues;
  useUnsavedChanges(form.formState.isDirty && result === null);

  const zones = useZoneChoices();
  const zoneLabel = useChoiceLabel();
  const services = useServiceChoices();
  const publicServices = useQuery({ queryKey: adminKeys.publicServices(), queryFn: fetchPublicServices, staleTime: 60_000 });
  const lookup = useQuery({
    queryKey: adminKeys.customerLookup(lookupPhone ?? ""),
    queryFn: () => lookupCustomer(lookupPhone as string),
    enabled: lookupPhone !== null && can("bookings.view"),
  });
  const addons = useQuery({
    queryKey: adminKeys.addonOptions(),
    queryFn: () => fetchAddons({ isActive: true, perPage: 100 }),
    enabled: can("catalog.manage"),
    staleTime: 60_000,
  });

  const standardServices = (services.data ?? []).filter((s) => s.kind === "standard_visit" && s.is_active);
  const chosenService = standardServices.find((s) => s.code === v.service) ?? null;
  const publicService = publicServices.data?.find((s) => s.code === v.service);
  const bounds = { minWorkers: publicService?.min_workers ?? 1, maxWorkers: publicService?.max_workers ?? 20 };

  // The zone of the address: an existing address carries it; a new one comes from the zone check of its position.
  const existing = lookup.data?.addresses.find((a) => a.id === v.addressId) ?? null;
  const checkedZone = zoneCheck && zoneCheck.coordinates === v.coordinates ? zoneCheck.result : null;
  const zoneId =
    v.addressMode === "existing"
      ? (existing?.zone_id ?? null)
      : checkedZone?.zone
        ? (zones.data?.find((z) => z.code === checkedZone.zone?.code)?.id ?? null)
        : null;

  const workers = useQuery({
    queryKey: adminKeys.workerList({ zone: zoneId ?? 0, status: "active", page: 1, options: 1 }),
    queryFn: () => fetchWorkers({ zoneId: zoneId ?? undefined, status: "active", page: 1, perPage: 100 }),
    enabled: can("workers.view") && zoneId !== null,
    staleTime: 60_000,
  });

  const zoneMutation = useMutation({
    mutationFn: async (coordinates: string) => {
      const parsed = parseCoordinates(coordinates);
      if (!parsed.ok) throw new Error(parsed.error);
      return checkZone(parsed.lat, parsed.lng);
    },
    onSuccess: (res, coordinates) => setZoneCheck({ coordinates, result: res, error: null }),
    onError: (error, coordinates) => setZoneCheck({ coordinates, result: null, error }),
  });

  const slotChoices = useSlotChoices({ date: v.serviceDate, zoneId, serviceId: chosenService?.id ?? null, workers: Number(v.workersCount) || 1 });
  const chosenSlot = slotChoices.choices.find((c) => String(c.slot.slot_template_id) === v.slotTemplateId) ?? null;
  const unavailable = chosenSlot ? !chosenSlot.fits : false;
  const [addonText, setAddonText] = useState("");

  const create = useMutation({
    mutationFn: (values: ManualFormValues) => {
      const payload = manualPayload(values);
      return createManualBooking(payload, keys.keyFor(payload));
    },
    onSuccess: (res) => {
      keys.settle();
      refresh(res.booking);
      setResult(res);
      form.reset(form.getValues());
    },
    onError: (error) => {
      keys.settle(error);
      if (applyFieldErrors(error, form.setError, Object.values(MANUAL_FIELD_MAP) as FieldPath<ManualFormValues>[], MANUAL_FIELD_MAP)) {
        const first = Object.keys(form.formState.errors)[0] as keyof ManualFormValues | undefined;
        if (first) setStep(stepOfField(first));
      }
    },
  });

  /** Checks the fields of `steps` (zod, with the chosen service's team size range); true when they are valid. */
  const validate = (steps: number[]) => {
    const parsed = manualFormSchema(bounds).safeParse(form.getValues());
    const fields = new Set<string>(steps.flatMap((s) => [...MANUAL_STEPS[s]]));
    for (const f of fields) form.clearErrors(f as keyof ManualFormValues);
    let firstStep: number | null = null;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as keyof ManualFormValues;
        if (!fields.has(field)) continue;
        form.setError(field, { type: "manual", message: issue.message });
        const s = stepOfField(field);
        firstStep = firstStep === null ? s : Math.min(firstStep, s);
      }
    }
    if (firstStep !== null) {
      setStep(firstStep);
      return false;
    }
    return true;
  };

  const go = (next: number) => {
    // A customer found with saved addresses starts on them (the coordinator can still pick a new one).
    if (next === 1 && (lookup.data?.addresses.length ?? 0) > 0 && !form.getFieldState("addressMode").isDirty && !form.getValues("addressId")) {
      form.setValue("addressMode", "existing");
    }
    setStep(next);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const fieldError = (name: keyof ManualFormValues) => {
    const err = form.formState.errors[name] as { message?: string; type?: string } | undefined;
    if (!err?.message) return undefined;
    if (err.type === "server") return err.message;
    return e.has(err.message) ? e(err.message) : err.message;
  };

  if (result) {
    return (
      <ManualResult
        result={result}
        customerLocale={v.locale}
        onNew={() => {
          form.reset({ ...MANUAL_DEFAULTS, serviceDate: addDaysIso(businessToday(), 1) });
          create.reset();
          setResult(null);
          setLookupPhone(null);
          setZoneCheck(null);
          setAddonText("");
          setStep(0);
        }}
      />
    );
  }

  const steps = [t("steps.customer"), t("steps.address"), t("steps.time"), t("steps.details")];

  return (
    <Card>
      <ol aria-label={t("steps.label")} className="flex flex-wrap gap-2">
        {steps.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={clsx(
              "flex items-center gap-2 rounded-pill px-3 py-1 text-sm",
              i === step ? "bg-petrol-700 font-bold text-white" : i < step ? "bg-petrol-50 text-petrol-700" : "bg-neutral-100 text-ink-600",
            )}
          >
            <span className="font-latin">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-ink-900 outline-none">
        {steps[step]}
      </h2>

      <form
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          if (step < STEP_COUNT - 1) {
            if (validate([step])) go(step + 1);
            return;
          }
          if (validate([0, 1, 2, 3])) create.mutate(form.getValues());
        }}
        className="flex flex-col gap-4"
      >
        {step === 0 && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink-900">
                {t("source")}
                <span aria-hidden className="ms-0.5 text-danger-700">
                  *
                </span>
              </legend>
              <div className="flex flex-wrap gap-4">
                {MANUAL_SOURCES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input type="radio" value={s} className="size-4 accent-petrol-700" {...form.register("source")} />
                    {text.source(s)}
                  </label>
                ))}
              </div>
              {fieldError("source") && <p className="text-xs font-medium text-danger-700">{fieldError("source")}</p>}
            </fieldset>
            <div className="flex flex-wrap items-start gap-2">
              <TextField
                label={t("phone")}
                hint={t("phoneHint")}
                required
                type="tel"
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                className="font-latin text-start"
                containerClassName="min-w-[240px] flex-1"
                error={fieldError("phone")}
                {...form.register("phone")}
              />
              {can("bookings.view") && (
                <Button
                  variant="secondary"
                  className="h-11 sm:mt-7"
                  icon={<Search aria-hidden className="size-4" />}
                  onClick={() => {
                    const phone = normalizeUaePhone(form.getValues("phone"));
                    if (!phone) {
                      form.setError("phone", { type: "manual", message: "phoneInvalid" }, { shouldFocus: true });
                      return;
                    }
                    setLookupPhone(phone);
                  }}
                >
                  {t("find")}
                </Button>
              )}
            </div>
            {lookupPhone && lookup.isFetching && <p className="text-sm text-ink-600">{t("finding")}</p>}
            {lookupPhone && lookup.data && (
              <Notice tone={lookup.data.found ? "success" : "info"}>
                {lookup.data.found
                  ? t("found", { name: lookup.data.name || t("noName"), count: lookup.data.addresses.length })
                  : t("notFound")}
                {lookup.data.found && lookup.data.name && !v.name && (
                  <Button variant="ghost" size="sm" className="mt-1 self-start" onClick={() => form.setValue("name", lookup.data?.name ?? "", { shouldDirty: true })}>
                    {t("useName")}
                  </Button>
                )}
              </Notice>
            )}
            {lookup.isError && <Notice tone="danger">{describe(lookup.error)}</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t("name")} hint={t("nameHint")} maxLength={MANUAL_LIMITS.name} error={fieldError("name")} {...form.register("name")} />
              <Select
                label={t("language")}
                hint={t("languageHint")}
                options={[
                  { value: "ar", label: t("languages.ar") },
                  { value: "en", label: t("languages.en") },
                ]}
                {...form.register("locale")}
              />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            {lookup.data && lookup.data.addresses.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium text-ink-900">{t("addressChoice")}</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" value="existing" className="size-4 accent-petrol-700" {...form.register("addressMode")} />
                  {t("addressExisting")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" value="new" className="size-4 accent-petrol-700" {...form.register("addressMode")} />
                  {t("addressNew")}
                </label>
              </fieldset>
            )}
            {v.addressMode === "existing" && lookup.data && lookup.data.addresses.length > 0 ? (
              <Select
                label={t("savedAddress")}
                required
                placeholder={t("chooseAddress")}
                options={lookup.data.addresses.map((a) => ({
                  value: a.id ?? "",
                  label: [a.label, a.building, a.unit_number, a.area].filter(Boolean).join(t("separator")),
                }))}
                error={fieldError("addressId")}
                {...form.register("addressId")}
              />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label={t("label")} hint={t("labelHint")} required maxLength={MANUAL_LIMITS.label} error={fieldError("label")} {...form.register("label")} />
                  <Select
                    label={t("propertyType")}
                    required
                    placeholder={t("choose")}
                    options={PROPERTY_TYPES.map((p) => ({ value: p, label: text.propertyType(p) }))}
                    error={fieldError("propertyType")}
                    {...form.register("propertyType")}
                  />
                  <TextField label={t("building")} maxLength={MANUAL_LIMITS.building} error={fieldError("building")} {...form.register("building")} />
                  <TextField label={t("unit")} maxLength={MANUAL_LIMITS.unit} error={fieldError("unitNumber")} {...form.register("unitNumber")} />
                  <TextField label={t("street")} maxLength={MANUAL_LIMITS.street} error={fieldError("street")} {...form.register("street")} />
                  <TextField label={t("area")} maxLength={MANUAL_LIMITS.area} error={fieldError("areaText")} {...form.register("areaText")} />
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <TextField
                    label={t("coordinates")}
                    hint={t("coordinatesHint")}
                    required
                    dir="ltr"
                    autoComplete="off"
                    className="font-latin text-start"
                    containerClassName="min-w-[260px] flex-1"
                    error={fieldError("coordinates")}
                    {...form.register("coordinates", {
                      onBlur: (ev) => {
                        const value = String(ev.target.value ?? "");
                        if (parseCoordinates(value).ok && zoneCheck?.coordinates !== value) zoneMutation.mutate(value);
                      },
                    })}
                  />
                  <Button
                    variant="secondary"
                    className="h-11 sm:mt-7"
                    loading={zoneMutation.isPending}
                    icon={<MapPin aria-hidden className="size-4" />}
                    onClick={() => {
                      const value = form.getValues("coordinates");
                      const parsed = parseCoordinates(value);
                      if (!parsed.ok) {
                        validate([1]);
                        return;
                      }
                      zoneMutation.mutate(value);
                    }}
                  >
                    {t("checkZone")}
                  </Button>
                </div>
                <ZoneCheckNotice check={zoneCheck && zoneCheck.coordinates === v.coordinates ? zoneCheck : null} />
                <TextArea label={t("access")} rows={2} maxLength={MANUAL_LIMITS.access} error={fieldError("accessInstructions")} {...form.register("accessInstructions")} />
                <CheckboxGroup legend={t("flags")}>
                  <Checkbox label={t("pets")} {...form.register("hasPets")} />
                  {v.hasPets && <TextField label={t("petsNote")} maxLength={MANUAL_LIMITS.petsNote} error={fieldError("petsNote")} {...form.register("petsNote")} />}
                  <Checkbox label={t("parking")} {...form.register("parkingAvailable")} />
                  <Checkbox label={t("permit")} {...form.register("entryPermitRequired")} />
                  <Checkbox label={t("materialsAtHome")} {...form.register("cleaningMaterialsAvailable")} />
                </CheckboxGroup>
              </>
            )}
          </>
        )}

        {step === 2 && (
          <>
            {zoneId === null && <Notice tone="warning">{t("zoneFirst")}</Notice>}
            {zoneId !== null && zones.data && (
              <p className="text-sm text-ink-600">{t("zoneIs", { zone: zoneLabel(zones.data.find((z) => z.id === zoneId) ?? { id: zoneId, name: { ar: `#${zoneId}`, en: `#${zoneId}` }, is_active: true }) })}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={t("service")}
                required
                placeholder={t("choose")}
                options={standardServices.map((s) => ({ value: s.code, label: text.name(s.name) }))}
                error={fieldError("service")}
                {...form.register("service")}
              />
              <TextField
                type="number"
                label={t("workers")}
                hint={t("workersHint", { min: bounds.minWorkers, max: bounds.maxWorkers })}
                required
                min={bounds.minWorkers}
                max={bounds.maxWorkers}
                dir="ltr"
                className="font-latin text-start"
                error={fieldError("workersCount")}
                {...form.register("workersCount")}
              />
              <TextField
                type="date"
                label={t("date")}
                required
                min={businessToday()}
                dir="ltr"
                className="font-latin text-start"
                error={fieldError("serviceDate")}
                {...form.register("serviceDate")}
              />
              <SlotSelect
                label={t("slot")}
                required
                date={v.serviceDate}
                zoneId={zoneId}
                serviceId={chosenService?.id ?? null}
                workers={Number(v.workersCount) || 1}
                error={fieldError("slotTemplateId")}
                {...form.register("slotTemplateId")}
              />
            </div>
            {unavailable && <Notice tone="warning">{can(CAPACITY_OVERRIDE_PERMISSION) ? t("slotFullOverride") : t("slotFull")}</Notice>}
            <Notice tone="info">{t("priceNote")}</Notice>
          </>
        )}

        {step === 3 && (
          <>
            {can("catalog.manage") ? (
              (addons.data?.data.length ?? 0) > 0 && (
                <CheckboxGroup legend={t("addons")} error={fieldError("addons")}>
                  {addons.data?.data.map((a) => (
                    <Checkbox key={a.code} label={text.name(a.name)} description={text.money(a.amount_fils)} value={a.code} {...form.register("addons")} />
                  ))}
                </CheckboxGroup>
              )
            ) : (
              <TextField
                label={t("addonCodes")}
                hint={t("addonCodesHint")}
                dir="ltr"
                className="font-latin text-start"
                value={addonText}
                onChange={(ev) => {
                  setAddonText(ev.target.value);
                  form.setValue(
                    "addons",
                    ev.target.value
                      .split(/[,\s،]+/)
                      .map((c) => c.trim().toUpperCase())
                      .filter(Boolean),
                    { shouldDirty: true },
                  );
                }}
                error={fieldError("addons")}
              />
            )}
            <Select
              label={t("materials")}
              placeholder={t("materialsDefault")}
              options={[
                { value: "customer", label: text.materials("customer") },
                { value: "company", label: text.materials("company") },
              ]}
              {...form.register("materialsBy")}
            />
            <CheckboxGroup legend={t("priorities")}>
              <div className="grid gap-2 sm:grid-cols-3">
                {CLEANING_AREAS.map((a) => (
                  <Checkbox key={a} label={text.area(a)} value={a} {...form.register("priorities")} />
                ))}
              </div>
            </CheckboxGroup>
            <TextArea label={t("instructions")} hint={t("instructionsHint")} rows={2} maxLength={MANUAL_LIMITS.instructions} error={fieldError("instructions")} {...form.register("instructions")} />
            {can("workers.view") && (
              <Select
                label={t("preferredWorker")}
                hint={t("preferredHint")}
                placeholder={t("noPreference")}
                options={(workers.data?.data ?? []).map((w) => ({ value: String(w.id), label: w.display_name }))}
                error={fieldError("preferredWorkerId")}
                {...form.register("preferredWorkerId")}
              />
            )}
            <TextArea label={t("internalNote")} hint={t("internalNoteHint")} rows={2} maxLength={MANUAL_LIMITS.note} error={fieldError("internalNote")} {...form.register("internalNote")} />
            {can(CAPACITY_OVERRIDE_PERMISSION) && (
              <>
                <Checkbox label={t("override")} description={t("overrideHint")} {...form.register("override")} />
                {v.override && (
                  <TextArea label={t("overrideReason")} hint={t("overrideReasonHint")} required rows={2} maxLength={FORCE_REASON_MAX} error={fieldError("reason")} {...form.register("reason")} />
                )}
              </>
            )}
            <Review
              values={v}
              zoneId={zoneId}
              serviceName={chosenService ? text.name(chosenService.name) : v.service}
              slot={chosenSlot ? `${text.name(chosenSlot.slot.name)} ${chosenSlot.slot.start}–${chosenSlot.slot.end}` : null}
            />
            {create.error && !(create.error instanceof AdminApiError && create.error.code === "VALIDATION_FAILED" && Object.keys(form.formState.errors).length > 0) ? (
              <FormErrorNotice error={create.error} fieldsApplied={false} />
            ) : null}
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          {step > 0 ? (
            <Button variant="outline" onClick={() => go(step - 1)} icon={<ChevronRight aria-hidden className="size-4 ltr:rotate-180" />}>
              {t("back")}
            </Button>
          ) : (
            <ButtonLink href="/admin/bookings" variant="ghost">
              {t("cancel")}
            </ButtonLink>
          )}
          <Button
            type="submit"
            loading={create.isPending}
            className={step < STEP_COUNT - 1 ? "flex-row-reverse" : undefined}
            icon={step < STEP_COUNT - 1 ? <ChevronLeft aria-hidden className="size-4 ltr:rotate-180" /> : undefined}
          >
            {step < STEP_COUNT - 1 ? t("next") : t("submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ZoneCheckNotice({ check }: { check: { result: ZoneCheck | null; error: unknown } | null }) {
  const t = useTranslations("admin.manual");
  const describe = useAdminErrorMessage();
  if (!check) return null;
  if (check.error) return <Notice tone="danger">{describe(check.error)}</Notice>;
  if (!check.result) return null;
  return check.result.in_service_area && check.result.zone ? (
    <Notice tone="success">{t("inZone", { zone: check.result.zone.name })}</Notice>
  ) : (
    <Notice tone="danger" title={t("outOfAreaTitle")}>
      {t("outOfAreaBody")}
    </Notice>
  );
}

function Review({ values: v, zoneId, serviceName, slot }: { values: ManualFormValues; zoneId: number | null; serviceName: string; slot: string | null }) {
  const t = useTranslations("admin.manual");
  const text = useBookingText();
  const rows: [string, string][] = [
    [t("review.source"), v.source ? text.source(v.source) : "—"],
    [t("review.customer"), [v.name.trim(), normalizeUaePhone(v.phone) ?? v.phone].filter(Boolean).join(" · ")],
    [t("review.address"), v.addressMode === "existing" ? t("review.savedAddress") : [v.label, v.building, v.unitNumber].filter(Boolean).join(t("separator"))],
    [t("review.service"), `${serviceName || "—"} · ${t("review.workers", { count: Number(v.workersCount) || 0 })}`],
    [t("review.when"), [v.serviceDate ? text.date(v.serviceDate) : "—", slot].filter(Boolean).join(" · ")],
  ];
  return (
    <section aria-label={t("review.title")} className="flex flex-col gap-2 rounded-md bg-neutral-100 p-4">
      <p className="text-sm font-bold text-ink-900">{t("review.title")}</p>
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap gap-2">
            <dt className="text-ink-600">{label}:</dt>
            <dd className="text-ink-900">{value}</dd>
          </div>
        ))}
      </dl>
      {zoneId === null && <p className="text-xs text-danger-700">{t("zoneFirst")}</p>}
      <p className="text-xs text-ink-600">{t("review.pending")}</p>
    </section>
  );
}

function ManualResult({ result, customerLocale, onNew }: { result: ManualBookingResult; customerLocale: "ar" | "en"; onNew: () => void }) {
  const t = useTranslations("admin.manual.result");
  const text = useBookingText();
  const b = result.booking;
  return (
    <Card>
      <Notice tone="success" title={t("title", { reference: b.reference })}>
        {t("body")}
      </Notice>
      <div className="flex flex-col gap-2">
        <p className="text-lg font-bold text-ink-900">
          <Ltr>{b.reference}</Ltr>
        </p>
        <BookingChips status={b.status} statusLabel={b.status_label} payment={result.payment.status as never} />
        <p className="text-sm text-ink-600">
          {text.name(b.service.name)} · {text.date(b.service_date)} · {text.money(result.payment.amount_fils)}
        </p>
      </div>
      <PaymentLinkBox
        link={result.payment.payment_link}
        expiresAt={result.payment.expires_at}
        phone={b.customer.phone}
        customerName={b.customer.name}
        customerLocale={customerLocale}
        reference={b.reference}
        serviceDate={b.service_date}
      />
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/admin/bookings/${b.id}`}>{t("open")}</ButtonLink>
        <Button variant="secondary" onClick={onNew}>
          {t("another")}
        </Button>
        <Link href="/admin/bookings" className="self-center text-sm font-bold">
          {t("list")}
        </Link>
      </div>
    </Card>
  );
}
