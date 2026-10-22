"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchAllDrivers,
  fetchAllServices,
  fetchAllSlotTemplates,
  fetchAllVehicles,
  fetchAllWorkers,
  fetchAllZones,
  fetchDriverAccounts,
  fetchSkills,
} from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { useAdminSession } from "@/lib/admin/session";
import type { ServiceKind, Translatable } from "@/lib/admin/types";

/*
 * Option lists for the operations pickers. The zone and service endpoints need catalog.manage (P1-05), which booking
 * and operations coordinators and HR do not hold, so without it the lists are built from records this user may read:
 * vehicle zones (schedule.view or fleet.manage) and workers' home zones and services (workers.view). A zone or
 * service nobody uses yet is then missing; the API remains the gate either way.
 */

export type ZoneChoice = { id: number; code: string; name: Translatable; is_active: boolean };
export type ServiceChoice = { id: number; code: string; kind: ServiceKind; name: Translatable; is_active: boolean };

const STALE = 60_000;

function byCode<T extends { code: string }>(list: Iterable<T>): T[] {
  return [...list].sort((a, b) => a.code.localeCompare(b.code));
}

export function useZoneChoices() {
  const { can, canAny } = useAdminSession();
  const full = can("catalog.manage");
  const viaVehicles = canAny(["fleet.manage", "schedule.view"]);
  const viaWorkers = can("workers.view");
  const scope = full ? "catalog" : `derived:${viaVehicles ? "v" : ""}${viaWorkers ? "w" : ""}`;
  return useQuery({
    queryKey: adminKeys.zoneChoices(scope),
    staleTime: STALE,
    queryFn: async (): Promise<ZoneChoice[]> => {
      if (full) {
        const zones = await fetchAllZones();
        return byCode(zones.map((z) => ({ id: z.id, code: z.code, name: z.name, is_active: z.is_active })));
      }
      const found = new Map<number, ZoneChoice>();
      const [vehicles, workers] = await Promise.all([
        viaVehicles ? fetchAllVehicles() : Promise.resolve([]),
        viaWorkers ? fetchAllWorkers() : Promise.resolve([]),
      ]);
      for (const v of vehicles) if (v.zone) found.set(v.zone.id, { ...v.zone, is_active: true });
      for (const w of workers) if (w.home_zone) found.set(w.home_zone.id, { ...w.home_zone, is_active: true });
      return byCode(found.values());
    },
  });
}

export function useServiceChoices() {
  const { can } = useAdminSession();
  const full = can("catalog.manage");
  const viaWorkers = can("workers.view");
  return useQuery({
    queryKey: adminKeys.serviceChoices(full ? "catalog" : viaWorkers ? "workers" : "none"),
    staleTime: STALE,
    queryFn: async (): Promise<ServiceChoice[]> => {
      if (full) {
        const services = await fetchAllServices();
        return services.map((s) => ({ id: s.id, code: s.code, kind: s.kind, name: s.name, is_active: s.is_active }));
      }
      if (!viaWorkers) return [];
      const found = new Map<number, ServiceChoice>();
      for (const w of await fetchAllWorkers()) {
        for (const s of w.services ?? []) found.set(s.id, { ...s, is_active: true });
      }
      return byCode(found.values());
    },
  });
}

/** True when the lists above come from the full catalogue (catalog.manage), not from records in use. */
export function useHasFullCatalog(): boolean {
  return useAdminSession().can("catalog.manage");
}

export function useSkills(enabled = true) {
  return useQuery({ queryKey: adminKeys.skills(), queryFn: fetchSkills, staleTime: STALE, enabled });
}

export function useSlotTemplateOptions(enabled = true) {
  return useQuery({ queryKey: adminKeys.slotTemplateOptions(), queryFn: fetchAllSlotTemplates, staleTime: STALE, enabled });
}

export function useDriverOptions(enabled = true) {
  return useQuery({ queryKey: adminKeys.driverOptions(), queryFn: fetchAllDrivers, staleTime: STALE, enabled });
}

/** Staff accounts with the driver role; the staff user list needs users.manage. */
export function useDriverAccounts(enabled = true) {
  return useQuery({ queryKey: adminKeys.driverAccounts(), queryFn: fetchDriverAccounts, staleTime: STALE, enabled });
}
