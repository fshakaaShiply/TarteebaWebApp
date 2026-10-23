"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { Select } from "@/components/admin";
import { fetchCapacity } from "@/lib/admin/endpoints";
import { isIsoDate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { CapacitySlot } from "@/lib/admin/types";
import { useOpsText } from "../../_ops/opsText";

export type SlotChoice = { slot: CapacitySlot; fits: boolean };

/** A slot can take a team of `workers` now: open, and enough workers and seats left (CapacitySlot.max_workers_fit). */
export function slotFits(slot: CapacitySlot, workers: number): boolean {
  return (slot.status === "available" || slot.status === "limited") && slot.max_workers_fit >= workers;
}

/**
 * The slots of one date and zone for one service, from the capacity view (GET /admin/capacity, schedule.view): the
 * same figures the booking engine uses, so the picker shows what is free now. The API decides again on save.
 */
export function useSlotChoices({ date, zoneId, serviceId, workers }: { date: string; zoneId: number | null; serviceId: number | null; workers: number }) {
  const { can } = useAdminSession();
  const allowed = can("schedule.view");
  const enabled = allowed && isIsoDate(date) && zoneId !== null;
  const query = useQuery({
    queryKey: [...adminKeys.capacityView(date, zoneId ?? 0), "service", serviceId ?? 0],
    queryFn: () => fetchCapacity({ date, zoneId: zoneId as number, serviceId: serviceId ?? undefined }),
    enabled,
    staleTime: 30_000,
  });
  const choices: SlotChoice[] = (query.data?.slots ?? [])
    .filter((s) => s.is_active && (serviceId === null ? s.service_kind === "standard_visit" : s.service?.id === serviceId))
    .map((slot) => ({ slot, fits: slotFits(slot, workers) }));
  return { allowed, enabled, query, choices };
}

type SlotSelectProps = Omit<ComponentPropsWithRef<"select">, "children"> & {
  label: ReactNode;
  date: string;
  zoneId: number | null;
  serviceId: number | null;
  workers: number;
  error?: ReactNode;
  containerClassName?: string;
};

/**
 * A slot picker for a date: each slot with its status and whether the team fits. Full or closed slots stay selectable
 * (marked): staff with capacity.override may book past the soft caps, and the API decides.
 */
export function SlotSelect({ label, date, zoneId, serviceId, workers, error, containerClassName, ...props }: SlotSelectProps) {
  const t = useTranslations("admin.bookings.slots");
  const ops = useOpsText();
  const { allowed, enabled, query, choices } = useSlotChoices({ date, zoneId, serviceId, workers });

  const hint = !allowed
    ? t("noPermission")
    : !isIsoDate(date)
      ? t("chooseDate")
      : query.isPending && enabled
        ? t("loading")
        : query.isError
          ? t("loadError")
          : choices.length === 0
            ? t("none")
            : undefined;

  return (
    <Select
      label={label}
      error={error}
      hint={hint}
      placeholder={t("placeholder")}
      disabled={!allowed || !enabled || query.isPending || props.disabled}
      containerClassName={containerClassName}
      options={choices.map(({ slot, fits }) => ({
        value: String(slot.slot_template_id),
        label: t(fits ? "option" : "optionUnavailable", {
          name: ops.name(slot.name),
          start: slot.start,
          end: slot.end,
          status: ops.slotStatus(slot.status),
          free: slot.max_workers_fit,
        }),
      }))}
      {...props}
    />
  );
}

/** True when the chosen slot is shown as unavailable for the team (to ask for an override). */
export function useChosenSlotUnavailable(args: { date: string; zoneId: number | null; serviceId: number | null; workers: number; slotId: string }) {
  const { choices } = useSlotChoices(args);
  const chosen = choices.find((c) => String(c.slot.slot_template_id) === args.slotId);
  return chosen ? !chosen.fits : false;
}
