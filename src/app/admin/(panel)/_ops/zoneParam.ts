"use client";

import { useEffect, useRef } from "react";
import { useAdminZone } from "@/lib/admin/zone";

/** A zone id written in a URL ("3"), else null (all zones). */
export function zoneFromParam(value: string | null): number | null {
  return value !== null && /^\d{1,9}$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

type Synced = { param: string | null; zone: number | null; adopting: boolean };

/**
 * The zone of a page whose filters live in its URL (A04 schedule, A06 trip planner: "filters kept in the URL"): the
 * shared top-bar zone (lib/admin/zone.tsx), mirrored as `zone_id` so a copied or bookmarked link opens the same zone for
 * whoever opens it, whatever zone they chose last.
 *   - A zone_id the URL brings (first load, a link, the address bar) becomes the shared zone.
 *   - A change of the shared zone (this page's picker or the top bar) is written back into the URL; all zones removes it.
 * `zoneId` is the zone to show now: the URL's while it is being adopted, so the page never loads the old zone first.
 */
export function useZoneInUrl(searchParams: { get(name: string): string | null; toString(): string }, write: (params: URLSearchParams) => void) {
  const { zoneId: shared, setZoneId } = useAdminZone();
  const param = searchParams.get("zone_id");
  const synced = useRef<Synced | null>(null);

  useEffect(() => {
    const last = synced.current;
    // An adopted zone is on its way into the shared filter (a re-run before it lands writes nothing).
    if (last?.adopting && last.param === param && shared !== last.zone) return;
    // The URL brings a zone of its own: the first load, or a link while the shared zone stayed as it was.
    if (param !== null && (last === null || (last.param !== param && last.zone === shared))) {
      const zone = zoneFromParam(param);
      if (zone !== shared) {
        synced.current = { param, zone, adopting: true };
        setZoneId(zone);
        return;
      }
    }
    // Otherwise the URL follows the shared zone.
    const want = shared === null ? null : String(shared);
    if (param !== want) {
      const next = new URLSearchParams(searchParams.toString());
      if (want === null) next.delete("zone_id");
      else next.set("zone_id", want);
      write(next);
    }
    synced.current = { param: want, zone: shared, adopting: false };
  }, [param, shared, searchParams, setZoneId, write]);

  return { zoneId: param !== null ? zoneFromParam(param) : shared, setZoneId };
}
