"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Button, Checkbox, Dialog, Notice, Select, TextArea, TextField, useToast } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { overrideCapacity } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { FORCE_REASON_MAX, overrideFormSchema, overrideOptions, overrideServiceId, type OverrideFormValues } from "@/lib/admin/ops/capacity";
import type { CapacitySlot, CapacityView, OverrideAction } from "@/lib/admin/types";
import { useOpsInvalidate } from "../_ops/invalidate";
import { useServiceChoices } from "../_ops/options";
import { useOpsFieldError, useOpsText } from "../_ops/opsText";
import { useRuleText } from "../_ops/ruleText";

/**
 * Manual capacity override (spec §8.6, permission capacity.override): shows exactly which soft rule(s) it relaxes,
 * lets the admin open the slot or raise its booking cap, and needs a reason of at least 10 characters plus an explicit
 * confirmation. Workers and seats stay hard limits: an override never books more than exist.
 */
export function OverrideDialog({ view, slot, onClose }: { view: CapacityView; slot: CapacitySlot; onClose: () => void }) {
  const t = useTranslations("admin.capacity.overrideDialog");
  const text = useOpsText();
  const ruleText = useRuleText();
  const fieldError = useOpsFieldError();
  const describe = useAdminErrorMessage();
  const toast = useToast();
  const invalidate = useOpsInvalidate();
  const services = useServiceChoices();
  const formId = useId();
  const options = overrideOptions(slot);
  const cap = options.find((o) => o.action === "raise_cap")?.relaxes[0];
  const currentCap = cap && cap.kind === "cap" ? cap.rule.max_bookings : null;

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(overrideFormSchema(currentCap)),
    defaultValues: { action: options[0]?.action ?? "open", max_bookings: "", reason: "", confirmed: false } satisfies OverrideFormValues,
  });
  const action = useWatch({ control, name: "action" }) as OverrideAction;
  const selected = options.find((o) => o.action === action) ?? options[0];
  const serviceId = overrideServiceId(selected);
  const serviceName = (id: number) => {
    const found = services.data?.find((s) => s.id === id);
    return found ? text.name(found.name) : slot.service?.id === id ? slot.service.code : `#${id}`;
  };

  const save = useMutation({
    mutationFn: (values: { action: OverrideAction; max_bookings: number | null; reason: string }) => {
      // Limited to one service only when a relaxed rule is for that service; a blackout is relaxed for every service.
      const service = overrideServiceId(options.find((o) => o.action === values.action));
      return overrideCapacity({
        date: view.date,
        zone_id: view.zone.id,
        slot_template_id: slot.slot_template_id,
        ...(service !== null ? { service_id: service } : {}),
        action: values.action,
        ...(values.max_bookings !== null ? { max_bookings: values.max_bookings } : {}),
        reason: values.reason,
      });
    },
    onSuccess: (result) => {
      invalidate(adminKeys.scheduling());
      const status = result.capacity ? text.slotStatus(result.capacity.status) : null;
      toast.success(
        t("applied", { slot: text.name(slot.name), count: result.relaxed.length, status: status ?? "", hasStatus: status ? "yes" : "no" }),
      );
      onClose();
    },
    onError: (error) => applyFieldErrors(error, setError, ["action", "max_bookings", "reason"]),
  });

  const fieldsError = save.error instanceof AdminApiError && save.error.code === "VALIDATION_FAILED";

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !save.isPending && onClose()}
      title={t("title", { slot: text.name(slot.name), date: text.dateShort(view.date) })}
      description={t("body", { zone: text.name(view.zone.name) })}
      size="lg"
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={save.isPending} icon={<ShieldAlert aria-hidden className="size-4" />}>
            {t("apply")}
          </Button>
        </>
      }
    >
      <Notice tone="warning" title={t("hardLimitsTitle")}>
        <p>{t("hardLimits")}</p>
      </Notice>

      <form id={formId} noValidate onSubmit={handleSubmit((values) => save.mutate(values))} className="flex flex-col gap-4">
        {options.length > 1 ? (
          <Select
            label={t("action")}
            options={options.map((o) => ({ value: o.action, label: t(`actions.${o.action}`) }))}
            error={fieldError(errors.action)}
            {...register("action")}
          />
        ) : (
          <p className="text-sm font-bold text-ink-900">{t(`actions.${selected?.action ?? "open"}`)}</p>
        )}

        <section className="flex flex-col gap-1.5" aria-label={t("relaxesTitle")}>
          <h3 className="text-sm font-bold text-ink-900">{t("relaxesTitle")}</h3>
          <ul className="flex flex-col gap-1.5">
            {(selected?.relaxes ?? []).map((item, i) => (
              <li key={i} className="rounded-md bg-apricot-100 px-3 py-2 text-sm text-warning-700">
                {item.kind === "blackout" ? (
                  t("relaxes.blackout", { date: text.date(view.date), zone: text.name(view.zone.name) })
                ) : (
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {t(item.kind === "cap" ? "relaxes.cap" : "relaxes.closedRule", {
                        id: item.rule.id,
                        effect: ruleText.effect(item.rule),
                      })}
                    </span>
                    <span className="text-xs">{ruleText.scope(item.rule).join(" · ")}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-600">
            {serviceId === null ? t("scopeAllServices") : t("scopeOneService", { service: serviceName(serviceId) })}
          </p>
        </section>

        <TextField
          label={action === "raise_cap" ? t("newCap") : t("newCapOptional")}
          required={action === "raise_cap"}
          inputMode="numeric"
          dir="ltr"
          className="font-latin text-start"
          hint={
            action === "raise_cap"
              ? t("newCapHint", { current: currentCap ?? 0 })
              : t("openCapHint")
          }
          error={fieldError(errors.max_bookings)}
          {...register("max_bookings")}
        />
        <TextArea
          label={t("reason")}
          hint={t("reasonHint")}
          required
          rows={3}
          maxLength={FORCE_REASON_MAX}
          error={fieldError(errors.reason)}
          {...register("reason")}
        />
        <Controller
          control={control}
          name="confirmed"
          render={({ field }) => (
            // The ref lets the form focus the box when the confirmation is the missing item.
            <Checkbox
              ref={field.ref}
              name={field.name}
              label={t("confirm")}
              checked={field.value}
              onChange={(e) => field.onChange(e.target.checked)}
              onBlur={field.onBlur}
              error={errors.confirmed ? t("confirmRequired") : undefined}
            />
          )}
        />
        {save.error && !fieldsError ? <Notice tone="danger">{describe(save.error)}</Notice> : null}
      </form>
    </Dialog>
  );
}
