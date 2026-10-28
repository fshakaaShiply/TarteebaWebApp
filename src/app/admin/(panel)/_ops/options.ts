"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import {
  fetchAllDrivers,
  fetchAllSlotTemplates,
  fetchDriverCandidates,
  fetchDriverOptions,
  fetchServiceOptions,
  fetchSkills,
  fetchSlotTemplateOptions,
  fetchZoneOptions,
} from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { Translatable } from "@/lib/admin/types";
import { useOpsText } from "./opsText";

/*
 * Option lists for the operations pickers. Zones and services come from the pick-list endpoints (GET
 * /admin/zones/options and /admin/services/options), which every operations, workforce, fleet and bookings role may
 * read: each page lists every zone and service by its name, inactive ones marked, whether or not the user manages the
 * catalog. The API stays the gate for what may be saved.
 */

/** Any of these reads the zone and service pick-lists (Geo and Catalog admin routes). */
export const PICK_LIST_PERMISSIONS = [
  "catalog.manage",
  "schedule.view",
  "workers.view",
  "workers.manage",
  "fleet.manage",
  "bookings.view",
] as const;

const STALE = 60_000;

/** Every zone (id, code, name, is_active) in the API's order (sort order, then id). */
export function useZoneChoices() {
  const enabled = useAdminSession().canAny(PICK_LIST_PERMISSIONS);
  return useQuery({ queryKey: adminKeys.zonePickList(), queryFn: fetchZoneOptions, staleTime: STALE, enabled });
}

/** Every service (id, code, name, kind, is_active) in the API's order (sort order, then id). */
export function useServiceChoices() {
  const enabled = useAdminSession().canAny(PICK_LIST_PERMISSIONS);
  return useQuery({ queryKey: adminKeys.servicePickList(), queryFn: fetchServiceOptions, staleTime: STALE, enabled });
}

type Choice = { id: number; name: Translatable; is_active: boolean };

/** A zone's or service's name in the UI language, marked "(inactive)" while it is out of service. */
export function useChoiceLabel() {
  const text = useOpsText();
  const t = useTranslations("admin.ops");
  return useCallback(
    (choice: Choice) => (choice.is_active ? text.name(choice.name) : t("inactiveChoice", { name: text.name(choice.name) })),
    [text, t],
  );
}

/** Select options for zones or services: the id as value, the name (inactive ones marked) as label. */
export function useChoiceOptions() {
  const label = useChoiceLabel();
  return useCallback(
    (choices: readonly Choice[] | undefined) => (choices ?? []).map((c) => ({ value: String(c.id), label: label(c) })),
    [label],
  );
}

/**
 * A zone's name for tables and summaries: from the pick-list (inactive marked), else `fallback` (e.g. the name the
 * record embeds) while the list loads, else "#id". No zone means "All zones".
 */
export function useZoneName() {
  const zones = useZoneChoices();
  const label = useChoiceLabel();
  const t = useTranslations("admin.ops");
  return useCallback(
    (id: number | null | undefined, fallback?: string | null) => {
      if (id === null || id === undefined) return t("allZones");
      const zone = zones.data?.find((z) => z.id === id);
      return zone ? label(zone) : fallback || `#${id}`;
    },
    [zones.data, label, t],
  );
}

/** A service's name: from the pick-list (inactive marked), else `fallback` while the list loads, else "#id". */
export function useServiceName() {
  const services = useServiceChoices();
  const label = useChoiceLabel();
  return useCallback(
    (id: number, fallback?: string | null) => {
      const service = services.data?.find((s) => s.id === id);
      return service ? label(service) : fallback || `#${id}`;
    },
    [services.data, label],
  );
}

export function useSkills(enabled = true) {
  return useQuery({ queryKey: adminKeys.skills(), queryFn: fetchSkills, staleTime: STALE, enabled });
}

/** Every slot template as a full A11 record (catalog.manage): the A11 screens that edit them. */
export function useSlotTemplateOptions(enabled = true) {
  return useQuery({ queryKey: adminKeys.slotTemplateOptions(), queryFn: fetchAllSlotTemplates, staleTime: STALE, enabled });
}

/** Every driver as a full fleet record (fleet.manage): the fleet screens. */
export function useDriverOptions(enabled = true) {
  return useQuery({ queryKey: adminKeys.driverOptions(), queryFn: fetchAllDrivers, staleTime: STALE, enabled });
}

/** Any of these reads GET /admin/slot-templates/options. */
export const SLOT_PICK_LIST_PERMISSIONS = ["catalog.manage", "schedule.view", "trips.manage", "bookings.view", "bookings.create_manual"] as const;
/** Any of these reads GET /admin/drivers/options. */
export const DRIVER_PICK_LIST_PERMISSIONS = ["fleet.manage", "trips.manage", "schedule.view", "bookings.view"] as const;

/** Every slot template (id, code, name, times, service kind, is_active) in the API's order (sort order, then id). */
export function useSlotPickList(enabled = true) {
  const allowed = useAdminSession().canAny(SLOT_PICK_LIST_PERMISSIONS);
  return useQuery({ queryKey: adminKeys.slotTemplatePickList(), queryFn: () => fetchSlotTemplateOptions(), staleTime: STALE, enabled: enabled && allowed });
}

/** Every driver (id, name, status, is_active, usual van) by name; never contact data. */
export function useDriverPickList(enabled = true) {
  const allowed = useAdminSession().canAny(DRIVER_PICK_LIST_PERMISSIONS);
  return useQuery({ queryKey: adminKeys.driverPickList(), queryFn: () => fetchDriverOptions(), staleTime: STALE, enabled: enabled && allowed });
}

/** Active driver-role staff accounts not linked to a driver yet (fleet.manage), for a new driver. */
export function useDriverCandidates(enabled = true) {
  return useQuery({ queryKey: adminKeys.driverCandidates(), queryFn: fetchDriverCandidates, staleTime: STALE, enabled });
}
