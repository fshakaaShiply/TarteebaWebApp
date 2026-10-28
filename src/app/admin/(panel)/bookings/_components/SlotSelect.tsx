"use client";

import { useTranslations } from "next-intl";
import { useCallback, type ComponentPropsWithRef, type ReactNode } from "react";
import { Select } from "@/components/admin";
import { useAdminSession } from "@/lib/admin/session";
import type { SlotTemplateOption } from "@/lib/admin/types";
import { SLOT_PICK_LIST_PERMISSIONS, useServiceChoices, useSlotPickList } from "../../_ops/options";
import { useBookingText } from "./bookingText";

/*
 * Slot pickers of the booking pages (manual booking, reschedule, alternatives). The times come from the slot pick-list
 * (GET /admin/slot-templates/options), which every bookings role may read; whether a time can take the booking on a
 * date is the dry run's answer (the manual booking, reschedule and alternatives previews), so the picker no longer
 * needs the capacity view (schedule.view).
 */

/** The slot pick-list and whether this user may read it (SLOT_PICK_LIST_PERMISSIONS). */
export function useSlotTemplatePickList() {
  const allowed = useAdminSession().canAny(SLOT_PICK_LIST_PERMISSIONS);
  const query = useSlotPickList();
  return { allowed, query };
}

/** The times a service of this kind is booked in: active slot templates of that kind, in the API's order. */
export function slotsForKind(slots: readonly SlotTemplateOption[] | undefined, kind: string | null): SlotTemplateOption[] {
  return (slots ?? []).filter((s) => s.is_active && s.service_kind === (kind ?? "standard_visit"));
}

/** "Evening · 15:00–19:00". */
export function useSlotLabel() {
  const t = useTranslations("admin.bookings.slots");
  const text = useBookingText();
  return useCallback(
    (slot: Pick<SlotTemplateOption, "name" | "start_time" | "end_time">) => t("option", { name: text.name(slot.name), start: slot.start_time, end: slot.end_time }),
    [t, text],
  );
}

/**
 * The service kind of a booking's service (from the services pick-list), else the kind of the slot it is booked in,
 * else a standard visit.
 */
export function useBookingServiceKind(booking: { service: { id: number }; slot: { id: number } }): string {
  const services = useServiceChoices();
  const { query } = useSlotTemplatePickList();
  return (
    services.data?.find((s) => s.id === booking.service.id)?.kind ?? query.data?.find((s) => s.id === booking.slot.id)?.service_kind ?? "standard_visit"
  );
}

type SlotSelectProps = Omit<ComponentPropsWithRef<"select">, "children"> & {
  label: ReactNode;
  /** The chosen service's kind (standard_visit, live_out …): only its slots are offered. */
  serviceKind: string | null;
  error?: ReactNode;
  hint?: ReactNode;
  containerClassName?: string;
};

/**
 * A time picker: the active slot templates of the service's kind. The preview of the action says whether it fits. A
 * failed load offers "Try again" in place (the manual wizard has no dialog to reopen, and what was typed stays).
 */
export function SlotSelect({ label, serviceKind, error, hint, containerClassName, ...props }: SlotSelectProps) {
  const t = useTranslations("admin.bookings.slots");
  const slotLabel = useSlotLabel();
  const { allowed, query } = useSlotTemplatePickList();
  const choices = slotsForKind(query.data, serviceKind);
  const loadFailed = allowed && query.isError;
  const retry = loadFailed ? (
    <button
      type="button"
      className="touch-target ms-1 font-bold text-petrol-700 underline disabled:opacity-60"
      disabled={query.isFetching}
      onClick={() => void query.refetch()}
    >
      {t("retry")}
    </button>
  ) : null;

  const state = !allowed ? (
    t("noPermission")
  ) : query.isPending ? (
    t("loading")
  ) : loadFailed ? (
    <>
      {t("loadError")}
      {retry}
    </>
  ) : choices.length === 0 ? (
    t("none")
  ) : undefined;

  return (
    <Select
      label={label}
      // The field's error hides the hint: the way to load the times again stays next to it.
      error={error && retry ? <>{error} {retry}</> : error}
      hint={state ?? hint}
      placeholder={t("placeholder")}
      disabled={!allowed || query.isPending || props.disabled}
      containerClassName={containerClassName}
      options={choices.map((slot) => ({ value: String(slot.id), label: slotLabel(slot) }))}
      {...props}
    />
  );
}
