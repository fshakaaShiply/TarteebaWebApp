"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch, type FieldPath } from "react-hook-form";
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  CheckboxGroup,
  LoadingBlock,
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
  companyMaterialsOffered,
  manualFormSchema,
  manualPayload,
  manualPreviewBody,
  normalizeUaePhone,
  parseCoordinates,
  stepOfField,
  type ManualFormValues,
} from "@/lib/admin/bookings/manual";
import { BOOKINGS_PATH, withQuery } from "@/lib/admin/dashboard";
import {
  checkZone,
  createManualBooking,
  fetchAddonOptions,
  fetchPublicServices,
  fetchWorkers,
  lookupCustomer,
  previewManualBooking,
  type ManualBookingPayload,
} from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { addDaysIso, businessToday } from "@/lib/admin/format";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { keepsIdempotencyKey, useIdempotencyKeys } from "@/lib/admin/idempotency";
import { adminKeys } from "@/lib/admin/keys";
import { CAPACITY_OVERRIDE_PERMISSION, FORCE_REASON_MAX } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { CustomerLookupAddress, ManualBookingPreview, ManualBookingResult, ZoneCheck } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { FormErrorNotice } from "../../catalog/_components/CatalogFields";
import { useChoiceLabel, useServiceChoices, useZoneChoices } from "../../_ops/options";
import { BookingChips, Ltr } from "../_components/BookingBits";
import { PaymentLinkBox } from "../_components/PaymentLinkBox";
import { SlotSelect, slotsForKind, useSlotLabel, useSlotTemplatePickList } from "../_components/SlotSelect";
import { useBookingText } from "../_components/bookingText";
import { useBookingRefresh } from "../_components/refresh";

/**
 * A03 manual booking wizard (spec §6.2, §14.3, §17; design AdminBookings.dc.html "new manual booking";
 * bookings.create_manual): source → customer by phone (looked up once the number is complete: name and saved
 * addresses, or a new customer) → address (one of the customer's bookable addresses, or a new one with its position
 * checked against the zones) → service, team and time → details and the summary with the server's price and slot check
 * (POST /admin/bookings/preview). The result shows the booking and its payment link to copy or open in WhatsApp; the
 * web sends nothing itself (the coordinator presses send in WhatsApp).
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

const STEP_COUNT = MANUAL_STEPS.length;
/** Any of these reads GET /admin/addons/options. */
const ADDON_PICK_LIST_PERMISSIONS = ["catalog.manage", "bookings.create_manual", "bookings.view"] as const;
/** The address fields of a new address (typed ones keep the coordinator on the new address). */
const NEW_ADDRESS_FIELDS = ["label", "building", "unitNumber", "street", "areaText", "coordinates"] as const;

const rateLimited = (error: unknown): error is AdminApiError => error instanceof AdminApiError && error.code === "RATE_LIMITED";
/** A 429 is tried again after the seconds the API names (twice at most); what is on screen stays meanwhile. */
const retryRateLimited = (count: number, error: unknown) => rateLimited(error) && count < 2;
const rateLimitDelay = (_count: number, error: unknown) => Math.max(1, (rateLimited(error) ? error.retryAfterSeconds : null) ?? 5) * 1000;
/** A number the API itself refuses for the customer (the booking would be refused the same way). */
const phoneRefused = (error: unknown) => error instanceof AdminApiError && (error.code === "PHONE_INVALID" || error.code === "PHONE_COUNTRY_NOT_SUPPORTED");

function Wizard() {
  const t = useTranslations("admin.manual");
  const e = useTranslations("admin.manual.errors");
  const text = useBookingText();
  const { can, canAny } = useAdminSession();
  const describe = useAdminErrorMessage();
  // POST /admin/bookings has no If-Match: after an unknown outcome the key stays with the first attempt even when the
  // form changes, so a booking the API did create is never made twice (see lib/admin/idempotency.ts).
  const keys = useIdempotencyKeys({ holdAfterUnknown: true });
  const refresh = useBookingRefresh();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ManualBookingResult | null>(null);
  const [zoneCheck, setZoneCheck] = useState<{ coordinates: string; result: ZoneCheck | null; error: unknown } | null>(null);
  /** What the lookup filled in, for the number it was made for (a corrected number takes it back). */
  const applied = useRef<{ phone: string; name: string | null } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /**
   * What to focus once a step is on screen: its heading (Next / Back) or the field validation or the API sent the
   * wizard back to. Done right after the step renders, so it never lands while the user is already typing.
   */
  const pendingFocus = useRef<keyof ManualFormValues | "heading" | null>(null);

  const form = useForm<ManualFormValues>({ defaultValues: { ...MANUAL_DEFAULTS, serviceDate: addDaysIso(businessToday(), 1) } });
  const v = useWatch({ control: form.control }) as ManualFormValues;
  useUnsavedChanges(form.formState.isDirty && result === null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    if (target !== "heading") form.setFocus(target);
    // The heading, or a field without a focusable input: the user is left on the step's heading.
    if (target === "heading" || document.activeElement === document.body) headingRef.current?.focus();
  });

  const zones = useZoneChoices();
  const zoneLabel = useChoiceLabel();
  const services = useServiceChoices();
  const slots = useSlotTemplatePickList();
  const slotLabel = useSlotLabel();
  const publicServices = useQuery({ queryKey: adminKeys.publicServices(), queryFn: fetchPublicServices, staleTime: 60_000 });

  // The customer, looked up once the field holds a full number (a partial one is 422 PHONE_INVALID, not "no customer").
  // A UAE mobile number is complete at its exact length, so it is looked up while typing (debounced); a number from
  // elsewhere has no length we can check here, so it is looked up once the field is left (or on Next), never half typed.
  const typedPhone = normalizeUaePhone(v.phone ?? "");
  const [phoneLeft, setPhoneLeft] = useState(false);
  const uaePhone = typedPhone?.startsWith("+971") ?? false;
  const phoneReady = typedPhone !== null && (uaePhone || phoneLeft);
  const lookupPhone = useDebouncedValue(phoneReady ? typedPhone : null, uaePhone ? 400 : 0);
  const lookupCurrent = phoneReady && lookupPhone === typedPhone;
  const lookup = useQuery({
    queryKey: adminKeys.customerLookup(lookupPhone ?? ""),
    queryFn: () => lookupCustomer(lookupPhone as string),
    enabled: lookupCurrent,
    staleTime: 60_000,
    retry: retryRateLimited,
    retryDelay: rateLimitDelay,
  });
  // The lookup belongs to the number it was made for: a corrected phone never offers another customer's name or
  // saved addresses (the API would refuse such an address with 404 at the last step).
  const found = lookupCurrent ? lookup.data : undefined;
  const customer = found?.data[0] ?? null;
  const savedAddresses: CustomerLookupAddress[] = customer?.bookable ? customer.addresses : [];
  const hasSaved = savedAddresses.length > 0;
  const lookupError = lookupCurrent && lookup.isError ? lookup.error : null;
  const lookupRateLimited = lookupCurrent && rateLimited(lookup.failureReason) && lookup.isFetching;
  /**
   * No answer for the number because of 429s (still waiting them out, or the retries ran out): an existing customer
   * can't be told from a new one yet, so the wizard does not go on (a saved address would be typed again as new).
   */
  const lookupHeldBack = lookupCurrent && !lookup.data && rateLimited(lookup.isError ? lookup.error : lookup.failureReason);

  // A found customer fills in the name (when empty) and the language (unless chosen) once per number.
  useEffect(() => {
    if (!customer || !lookupPhone || applied.current?.phone === lookupPhone) return;
    applied.current = { phone: lookupPhone, name: null };
    if (!form.getValues("name").trim() && customer.name) {
      form.setValue("name", customer.name, { shouldDirty: true });
      applied.current.name = customer.name;
    }
    if (!form.getFieldState("locale").isDirty && (customer.locale === "ar" || customer.locale === "en")) form.setValue("locale", customer.locale);
  }, [customer, lookupPhone, form]);

  // Saved addresses come first once known (the coordinator can still pick a new one), unless a new one is being typed.
  useEffect(() => {
    if (step !== 1) return;
    if (!hasSaved) {
      if (form.getValues("addressMode") === "existing") form.setValue("addressMode", "new");
      return;
    }
    if (form.getFieldState("addressMode").isDirty || form.getValues("addressId")) return;
    if (NEW_ADDRESS_FIELDS.every((f) => form.getValues(f).trim() === "")) form.setValue("addressMode", "existing");
  }, [step, hasSaved, form]);

  const addonOptions = useQuery({
    queryKey: adminKeys.addonPickList(),
    queryFn: fetchAddonOptions,
    staleTime: 60_000,
    enabled: canAny(ADDON_PICK_LIST_PERMISSIONS),
  });
  const offeredAddons = (addonOptions.data ?? []).filter((a) => a.is_active && a.service_codes.includes(v.service));
  const offeredCodes = addonOptions.data ? new Set(offeredAddons.map((a) => a.code)) : null;

  const standardServices = (services.data ?? []).filter((s) => s.kind === "standard_visit" && s.is_active);
  const chosenService = standardServices.find((s) => s.code === v.service) ?? null;
  const publicService = publicServices.data?.find((s) => s.code === v.service);
  const bounds = { minWorkers: publicService?.min_workers ?? 1, maxWorkers: publicService?.max_workers ?? 20 };
  // "The company brings the materials" only where the API can accept it (D-02b): materials included, or the MATERIALS
  // add-on offered with the service. Otherwise every preview and the booking would be refused on materials_by.
  const companyMaterials = companyMaterialsOffered(publicService?.materials_mode, offeredCodes);
  useEffect(() => {
    if (companyMaterials || form.getValues("materialsBy") !== "company") return;
    form.setValue("materialsBy", "", { shouldDirty: true });
    form.clearErrors("materialsBy");
  }, [companyMaterials, form]);

  // The zone of the address: a saved address carries it; a new one comes from the zone check of its position.
  const existing = savedAddresses.find((a) => a.id === v.addressId) ?? null;
  const checkedZone = zoneCheck && zoneCheck.coordinates === v.coordinates ? zoneCheck.result : null;
  const zoneId =
    v.addressMode === "existing"
      ? (existing?.zone?.id ?? null)
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

  /** The request body: the number as the lookup normalized it, only the add-ons the service offers. */
  const payloadOf = (values: ManualFormValues) => manualPayload(values, { phone: lookupCurrent ? found?.meta.phone : null, addons: offeredCodes });

  // The summary's price and slot check: again after every change that matters (debounced), the last answer kept while
  // the next one loads or waits out a 429.
  const onSummary = step === STEP_COUNT - 1;
  const previewBody = onSummary ? manualPreviewBody(payloadOf(v)) : "";
  const debouncedBody = useDebouncedValue(previewBody, 400);
  const preview = useQuery({
    queryKey: adminKeys.manualPreview(debouncedBody),
    queryFn: () => previewManualBooking(JSON.parse(debouncedBody) as ManualBookingPayload),
    enabled: debouncedBody !== "" && debouncedBody === previewBody,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: retryRateLimited,
    retryDelay: rateLimitDelay,
  });
  // The dry run's field refusals (e.g. materials_by, D-02b) are marked on their fields like the booking's own, but only
  // while they belong to what is on screen: a changed value takes its mark away until the next answer.
  const previewFieldErrors = debouncedBody !== "" && debouncedBody === previewBody && preview.isError ? previewFieldMessages(preview.error) : {};

  const chosenSlot = slotsForKind(slots.query.data, chosenService?.kind ?? null).find((s) => String(s.id) === v.slotTemplateId) ?? null;

  const create = useMutation({
    mutationFn: (payload: ManualBookingPayload) => createManualBooking(payload, keys.keyFor(payload)),
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
        if (first) {
          pendingFocus.current = first;
          setStep(stepOfField(first));
        }
      }
    },
  });
  /** The first attempt's body while its outcome is unknown: "Try again" sends exactly that. */
  const heldPayload = create.isError ? keys.heldBody<ManualBookingPayload>() : null;
  const createErrorCode = create.error instanceof AdminApiError ? create.error.code : null;
  const outcomeUnknown = create.isError && keepsIdempotencyKey(create.error);
  const earlierStored = createErrorCode === "IDEMPOTENCY_KEY_REUSED" && heldPayload !== null;

  const focusField = (field: keyof ManualFormValues) => {
    if (step === stepOfField(field)) form.setFocus(field);
    else {
      pendingFocus.current = field;
      setStep(stepOfField(field));
    }
  };

  /**
   * Checks the fields of `steps` (zod, with the chosen service's team size range); true when they are valid. Otherwise
   * the wizard shows the first step with an error and focuses its first invalid field.
   */
  const validate = (steps: number[]) => {
    const parsed = manualFormSchema(bounds).safeParse(form.getValues());
    const fields = new Set<string>(steps.flatMap((s) => [...MANUAL_STEPS[s]]));
    for (const f of fields) form.clearErrors(f as keyof ManualFormValues);
    let first: { step: number; field: keyof ManualFormValues } | null = null;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as keyof ManualFormValues;
        if (!fields.has(field)) continue;
        form.setError(field, { type: "manual", message: issue.message });
        const s = stepOfField(field);
        if (first === null || s < first.step) first = { step: s, field };
      }
    }
    // What the lookup already knows about the number: an account that can't book, or a number the API refuses.
    if (first === null && fields.has("phone")) {
      if (customer && !customer.bookable) {
        form.setError("phone", { type: "manual", message: "accountBlocked" });
        first = { step: 0, field: "phone" };
      } else if (phoneRefused(lookupError)) {
        form.setError("phone", { type: "server", message: describePhoneError(lookupError) });
        first = { step: 0, field: "phone" };
      } else if (lookupHeldBack) {
        form.setError("phone", { type: "manual", message: "lookupRateLimited" });
        first = { step: 0, field: "phone" };
      }
    }
    if (first !== null) {
      focusField(first.field);
      return false;
    }
    return true;
  };

  /** A corrected phone drops what the earlier lookup filled in. */
  const onPhoneChange = (value: string) => {
    setPhoneLeft(false);
    const before = applied.current;
    if (!before || normalizeUaePhone(value) === before.phone) return;
    applied.current = null;
    if (form.getValues("addressMode") === "existing" || form.getValues("addressId")) {
      form.setValue("addressId", "");
      form.setValue("addressMode", "new");
    }
    if (before.name !== null && form.getValues("name") === before.name) form.setValue("name", "");
  };

  const go = (next: number) => {
    pendingFocus.current = "heading";
    setStep(next);
  };

  const fieldError = (name: keyof ManualFormValues) => {
    const err = form.formState.errors[name] as { message?: string; type?: string } | undefined;
    if (!err?.message) return previewFieldErrors[name];
    // "Not looked up yet" lasts only until the lookup answers.
    if (err.message === "lookupRateLimited" && !lookupHeldBack) return undefined;
    if (err.type === "server") return err.message;
    return e.has(err.message) ? e(err.message) : err.message;
  };

  /**
   * PHONE_COUNTRY_NOT_SUPPORTED names the countries served (each code isolated left-to-right, so "+971" never reads
   * "971+" in an Arabic sentence); RATE_LIMITED after the retries asks to look up again; other refusals read as usual.
   */
  function describePhoneError(error: unknown): string {
    if (error instanceof AdminApiError && error.code === "PHONE_COUNTRY_NOT_SUPPORTED") {
      const codes = Array.isArray(error.details.supported_country_codes) ? error.details.supported_country_codes.filter((c) => typeof c === "string") : [];
      return t("phoneCountry", { codes: codes.map((c) => `⁦${c}⁩`).join(t("separator")) || "—" });
    }
    if (rateLimited(error)) return t("lookupRateLimitedRetry", { seconds: Math.max(1, error.retryAfterSeconds ?? 5) });
    return describe(error);
  }

  if (result) {
    return (
      <ManualResult
        result={result}
        customerLocale={v.locale}
        onNew={() => {
          form.reset({ ...MANUAL_DEFAULTS, serviceDate: addDaysIso(businessToday(), 1) });
          create.reset();
          setResult(null);
          applied.current = null;
          setPhoneLeft(false);
          setZoneCheck(null);
          setStep(0);
        }}
      />
    );
  }

  const steps = [t("steps.customer"), t("steps.address"), t("steps.time"), t("steps.details")];
  const showNewAddress = !hasSaved || v.addressMode === "new";
  const phoneField = form.register("phone");

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
      {step > 0 && customer && !customer.bookable && <Notice tone="danger">{e("accountBlocked")}</Notice>}

      <form
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          // Next from the phone field (Enter) counts as leaving it: a number from outside the UAE is looked up now.
          if (step === 0) setPhoneLeft(true);
          if (step < STEP_COUNT - 1) {
            if (validate([step])) go(step + 1);
            return;
          }
          if (validate([0, 1, 2, 3])) create.mutate(payloadOf(form.getValues()));
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
            <TextField
              label={t("phone")}
              hint={t("phoneHint")}
              required
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="off"
              className="font-latin text-start"
              containerClassName="max-w-md"
              error={fieldError("phone")}
              {...phoneField}
              onChange={(ev) => {
                void phoneField.onChange(ev);
                onPhoneChange(ev.target.value);
              }}
              onBlur={(ev) => {
                void phoneField.onBlur(ev);
                setPhoneLeft(true);
              }}
            />
            <CustomerLookupNotice
              phoneComplete={typedPhone !== null}
              waitingForLeave={typedPhone !== null && !phoneReady}
              looking={phoneReady && (!lookupCurrent || lookup.isPending || (lookup.isError && lookup.isFetching)) && !lookupRateLimited}
              rateLimitedSeconds={lookupRateLimited ? Math.max(1, (lookup.failureReason as AdminApiError).retryAfterSeconds ?? 5) : null}
              error={lookupError}
              errorText={lookupError ? describePhoneError(lookupError) : ""}
              onRetry={() => void lookup.refetch()}
              customer={found ? customer : undefined}
            />
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
            {hasSaved && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium text-ink-900">{t("addressChoice")}</legend>
                {savedAddresses.map((a) => (
                  <label
                    key={a.id}
                    className={clsx(
                      "flex items-start gap-2 rounded-md border border-line p-3 text-sm",
                      a.bookable ? "cursor-pointer" : "cursor-not-allowed bg-neutral-100 text-ink-600",
                    )}
                  >
                    <input
                      type="radio"
                      name="manual-address"
                      value={a.id}
                      checked={v.addressMode === "existing" && v.addressId === a.id}
                      disabled={!a.bookable}
                      onChange={() => {
                        form.setValue("addressMode", "existing", { shouldDirty: true });
                        form.setValue("addressId", a.id, { shouldDirty: true });
                        form.clearErrors("addressId");
                      }}
                      className="mt-0.5 size-4 accent-petrol-700"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium text-ink-900">
                        {a.label}
                        {a.is_default && <span className="font-normal text-ink-600"> · {t("addressDefault")}</span>}
                      </span>
                      <span className="text-xs text-ink-600">{addressLine(a, t("separator")) || text.propertyType(a.property_type)}</span>
                      {a.zone && <span className="text-xs text-ink-600">{t("addressZone", { zone: text.name(a.zone.name) })}</span>}
                      {!a.bookable && <span className="text-xs font-medium text-danger-700">{a.is_blocked ? t("addressBlocked") : t("addressOutOfZone")}</span>}
                    </span>
                  </label>
                ))}
                <label className="flex items-center gap-2 rounded-md border border-line p-3 text-sm">
                  <input
                    type="radio"
                    name="manual-address"
                    value="new"
                    checked={v.addressMode === "new"}
                    onChange={() => {
                      form.setValue("addressMode", "new", { shouldDirty: true });
                      form.setValue("addressId", "");
                      form.clearErrors("addressId");
                    }}
                    className="size-4 accent-petrol-700"
                  />
                  {t("addressNew")}
                </label>
                {fieldError("addressId") && <p className="text-xs font-medium text-danger-700">{fieldError("addressId")}</p>}
              </fieldset>
            )}
            {showNewAddress && (
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
            {zoneId !== null && (
              <p className="text-sm text-ink-600">
                {t("zoneIs", {
                  zone: (() => {
                    const zone = zones.data?.find((z) => z.id === zoneId);
                    return zone ? zoneLabel(zone) : existing?.zone ? text.name(existing.zone.name) : `#${zoneId}`;
                  })(),
                })}
              </p>
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
                serviceKind={chosenService?.kind ?? null}
                error={fieldError("slotTemplateId")}
                {...form.register("slotTemplateId")}
              />
            </div>
            <Notice tone="info">{t("priceNote")}</Notice>
          </>
        )}

        {step === 3 && (
          <>
            {/* The add-on pick-list is the only way to add one: its loading and failure are said, never an empty section. */}
            {addonOptions.isError ? (
              <Notice
                tone="warning"
                title={t("addonsLoadError")}
                action={
                  <Button variant="secondary" size="sm" className="self-start" loading={addonOptions.isFetching} onClick={() => void addonOptions.refetch()}>
                    {t("addonsRetry")}
                  </Button>
                }
              >
                {describe(addonOptions.error)}
              </Notice>
            ) : addonOptions.isLoading ? (
              <p role="status" className="text-sm text-ink-600">
                {t("addonsLoading")}
              </p>
            ) : offeredAddons.length > 0 ? (
              <CheckboxGroup legend={t("addons")} error={fieldError("addons")}>
                {offeredAddons.map((a) => (
                  <Checkbox
                    key={a.code}
                    label={text.name(a.name)}
                    description={t(`addonPer.${a.per}`, { amount: text.money(a.amount_fils) })}
                    value={a.code}
                    {...form.register("addons")}
                  />
                ))}
              </CheckboxGroup>
            ) : (
              addonOptions.isSuccess && <p className="text-sm text-ink-600">{t("addonsNone")}</p>
            )}
            <Select
              label={t("materials")}
              placeholder={t("materialsDefault")}
              options={[
                { value: "customer", label: text.materials("customer") },
                ...(companyMaterials ? [{ value: "company", label: text.materials("company") }] : []),
              ]}
              error={fieldError("materialsBy")}
              {...form.register("materialsBy", { onChange: () => form.clearErrors("materialsBy") })}
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
              slot={chosenSlot ? slotLabel(chosenSlot) : null}
            />
            <PricePreview
              preview={preview.data}
              loading={preview.isPending && !preview.data}
              stale={preview.isPlaceholderData || debouncedBody !== previewBody}
              rateLimitedSeconds={rateLimited(preview.failureReason) && preview.isFetching ? Math.max(1, preview.failureReason.retryAfterSeconds ?? 5) : null}
              error={preview.isError ? preview.error : null}
              onRetry={() => void preview.refetch()}
              override={v.override}
            />
            {outcomeUnknown ? (
              // No answer (or the server failed): the booking may exist. "Try again" sends the same request with the
              // same key, so the API either makes it now or answers with the one it already made.
              <Notice
                tone="warning"
                title={t("unknownTitle")}
                action={
                  heldPayload ? (
                    <Button variant="secondary" size="sm" className="self-start" onClick={() => create.mutate(heldPayload)}>
                      {t("tryAgain")}
                    </Button>
                  ) : undefined
                }
              >
                <p>{describe(create.error)}</p>
                <p>{t("unknownBody")}</p>
              </Notice>
            ) : earlierStored && heldPayload ? (
              // The details changed after an unknown outcome and the API already holds an answer for the first try.
              <Notice
                tone="warning"
                title={t("earlierTitle")}
                action={
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" onClick={() => create.mutate(heldPayload)}>
                      {t("showEarlier")}
                    </Button>
                    <Link href={withQuery(BOOKINGS_PATH, { search: heldPayload.customer.phone })} className="text-sm font-bold">
                      {t("checkList")}
                    </Link>
                  </div>
                }
              >
                {t("earlierBody")}
              </Notice>
            ) : create.error && !(createErrorCode === "VALIDATION_FAILED" && Object.keys(form.formState.errors).length > 0) ? (
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

/** A dry run's VALIDATION_FAILED messages by wizard field (the first of each), mapped like the booking's own refusal. */
function previewFieldMessages(error: unknown): Partial<Record<keyof ManualFormValues, string>> {
  const out: Partial<Record<keyof ManualFormValues, string>> = {};
  applyFieldErrors<ManualFormValues>(
    error,
    (name, err) => {
      const field = name as keyof ManualFormValues;
      if (err.message && out[field] === undefined) out[field] = err.message;
    },
    Object.values(MANUAL_FIELD_MAP) as FieldPath<ManualFormValues>[],
    MANUAL_FIELD_MAP,
  );
  return out;
}

/** "Villa 14, Unit 3, Al Wasl Road, Jumeirah" from a saved address's parts. */
function addressLine(a: Pick<CustomerLookupAddress, "building" | "unit_number" | "street" | "area_text">, separator: string): string {
  return [a.building, a.unit_number, a.street, a.area_text].filter(Boolean).join(separator);
}

/**
 * What the lookup found for the number: the customer and how many saved addresses, a new customer, or why not (a
 * refused number; a lookup that failed or stayed rate limited after its retries, with "Look up again").
 */
function CustomerLookupNotice({
  phoneComplete,
  waitingForLeave,
  looking,
  rateLimitedSeconds,
  error,
  errorText,
  onRetry,
  customer,
}: {
  phoneComplete: boolean;
  /** A number from outside the UAE, looked up once the field is left. */
  waitingForLeave: boolean;
  looking: boolean;
  rateLimitedSeconds: number | null;
  error: unknown;
  errorText: string;
  onRetry: () => void;
  /** undefined while there is no answer for this number; null when nobody has it. */
  customer: { name: string | null; bookable: boolean; status: string; addresses: unknown[] } | null | undefined;
}) {
  const t = useTranslations("admin.manual");
  if (!phoneComplete) return null;
  if (waitingForLeave) return <p className="text-sm text-ink-600">{t("lookupOnLeave")}</p>;
  if (rateLimitedSeconds !== null) return <Notice tone="info">{t("lookupRateLimited", { seconds: rateLimitedSeconds })}</Notice>;
  if (looking) return <p role="status" className="text-sm text-ink-600">{t("finding")}</p>;
  if (error) {
    const refused = phoneRefused(error);
    return (
      <Notice
        tone="danger"
        action={
          refused ? undefined : (
            <Button variant="secondary" size="sm" className="self-start" onClick={onRetry}>
              {t("lookupRetry")}
            </Button>
          )
        }
      >
        {errorText}
      </Notice>
    );
  }
  if (customer === undefined) return null;
  if (customer === null) return <Notice tone="info">{t("notFound")}</Notice>;
  if (!customer.bookable) return <Notice tone="danger">{t("blocked")}</Notice>;
  return <Notice tone="success">{t("found", { name: customer.name || t("noName"), count: customer.addresses.length })}</Notice>;
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
      {zoneId === null && v.addressMode !== "existing" && <p className="text-xs text-danger-700">{t("zoneFirst")}</p>}
      <p className="text-xs text-ink-600">{t("review.pending")}</p>
    </section>
  );
}

/**
 * The server's dry run of the booking (POST /admin/bookings/preview): price lines and totals, whether the slot can take
 * it (a full or closed one needs an override), how long the payment link holds it and the cancellation terms. The last
 * answer stays (marked) while the next one loads or waits out a 429.
 */
function PricePreview({
  preview,
  loading,
  stale,
  rateLimitedSeconds,
  error,
  onRetry,
  override,
}: {
  preview: ManualBookingPreview | undefined;
  loading: boolean;
  stale: boolean;
  rateLimitedSeconds: number | null;
  error: unknown;
  onRetry: () => void;
  override: boolean;
}) {
  const t = useTranslations("admin.manual.summary");
  const d = useTranslations("admin.bookings.detail");
  const text = useBookingText();
  const { can } = useAdminSession();
  const canOverride = can(CAPACITY_OVERRIDE_PERMISSION);

  // One live region that stays mounted: "working out" / "updating" while a check runs (shown), then the total and
  // whether the time can take the booking (screen readers only; the figures are below). Errors and the 429 notice
  // carry their own roles.
  const failed = !!error && !preview;
  const checking = !failed && (loading || !preview);
  const updating = !failed && !checking && stale && rateLimitedSeconds === null;
  const availability = preview
    ? preview.availability.bookable
      ? preview.availability.status === "limited"
        ? t("limited", { count: preview.availability.remaining })
        : t("available")
      : preview.availability.status === "closed"
        ? t("closedTitle")
        : t("fullTitle")
    : "";
  const status = checking
    ? t("checking")
    : updating
      ? t("updating")
      : preview && !failed && !stale
        ? t("announce", { total: text.money(preview.amounts.total_fils), availability })
        : "";

  return (
    <section aria-label={t("title")} className="flex flex-col gap-3 rounded-md border border-line p-4 text-sm">
      <p className="font-bold text-ink-900">{t("title")}</p>
      <p role="status" aria-live="polite" aria-atomic="true" className={checking ? "text-ink-600" : updating ? "text-xs text-ink-600" : "sr-only"}>
        {status}
      </p>
      {rateLimitedSeconds !== null && <Notice tone="info">{t("rateLimited", { seconds: rateLimitedSeconds })}</Notice>}
      {failed ? (
        <>
          <FormErrorNotice error={error} fieldsApplied={false} />
          <Button variant="secondary" size="sm" className="self-start" onClick={onRetry}>
            {t("retry")}
          </Button>
        </>
      ) : checking || !preview ? (
        <LoadingBlock lines={3} />
      ) : (
        <>
          {error && <FormErrorNotice error={error} fieldsApplied={false} />}
          {preview.lines.length > 0 && (
            <ul className="flex flex-col gap-1">
              {preview.lines.map((line, i) => (
                <li key={`${line.code}-${i}`} className="flex items-start justify-between gap-3">
                  <span>
                    {text.name(line.description)}
                    {line.quantity > 1 && (
                      <span className="text-ink-600">
                        {" "}
                        × <Ltr>{line.quantity}</Ltr>
                      </span>
                    )}
                  </span>
                  <span className="font-latin whitespace-nowrap">{text.money(line.gross_fils)}</span>
                </li>
              ))}
            </ul>
          )}
          <dl className="flex flex-col gap-1 border-t border-line pt-2">
            <AmountRow label={d("subtotal")} value={text.money(preview.amounts.subtotal_fils)} />
            {preview.amounts.addons_fils > 0 && <AmountRow label={d("addons")} value={text.money(preview.amounts.addons_fils)} />}
            {preview.amounts.discount_fils > 0 && <AmountRow label={d("discount")} value={`-${text.money(preview.amounts.discount_fils)}`} />}
            <AmountRow label={d("net")} value={text.money(preview.amounts.net_fils)} />
            <AmountRow label={d("vat", { rate: (preview.amounts.vat_rate_bp / 100).toString() })} value={text.money(preview.amounts.vat_fils)} />
            <AmountRow label={d("total")} value={text.money(preview.amounts.total_fils)} strong />
          </dl>
          {preview.availability.bookable ? (
            <p className="text-success-700">{availability}</p>
          ) : (
            <Notice tone="warning" title={preview.availability.status === "closed" ? t("closedTitle") : t("fullTitle")}>
              {override ? t("overrideOn") : canOverride ? t("needsOverride") : t("needsOverrideNoPermission")}
            </Notice>
          )}
          <p className="text-ink-600">{t("hold", { minutes: preview.payment_hold_minutes })}</p>
          {!preview.customer_exists && <p className="text-ink-600">{t("newCustomer")}</p>}
          {preview.address_is_new && <p className="text-ink-600">{t("newAddress")}</p>}
          {(preview.policy_summary[text.locale === "en" ? "en" : "ar"] ?? []).length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-ink-900">{t("policy")}</p>
              <ul className="list-disc ps-5 text-ink-600">
                {preview.policy_summary[text.locale === "en" ? "en" : "ar"].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AmountRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={clsx("flex justify-between gap-3", strong && "text-base font-bold text-ink-900")}>
      <dt>{label}</dt>
      <dd className="font-latin whitespace-nowrap">{value}</dd>
    </div>
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
