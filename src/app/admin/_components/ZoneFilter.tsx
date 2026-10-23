"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId } from "react";
import { useAdminSession } from "@/lib/admin/session";
import { useAdminZone } from "@/lib/admin/zone";
import { PICK_LIST_PERMISSIONS, useChoiceLabel, useZoneChoices } from "../(panel)/_ops/options";

/**
 * The top bar's zone filter (spec §17): all zones or one, shared by the overview, the bookings list and the capacity
 * view. Shown to users who may read the zone list.
 */
export function ZoneFilter() {
  const { canAny } = useAdminSession();
  if (!canAny(PICK_LIST_PERMISSIONS)) return null;
  return <ZoneSelect />;
}

function ZoneSelect() {
  const t = useTranslations("admin.zoneFilter");
  const id = useId();
  const zones = useZoneChoices();
  const label = useChoiceLabel();
  const { zoneId, setZoneId } = useAdminZone();

  // A remembered zone that no longer exists falls back to all zones.
  const known = zones.data?.some((z) => z.id === zoneId) ?? true;
  useEffect(() => {
    if (zoneId !== null && !known) setZoneId(null);
  }, [zoneId, known, setZoneId]);

  return (
    <div className="relative flex items-center">
      <label htmlFor={id} className="sr-only">
        {t("label")}
      </label>
      <MapPin aria-hidden className="pointer-events-none absolute start-2 size-4 text-ink-600" strokeWidth={1.75} />
      <select
        id={id}
        value={zoneId !== null && known ? String(zoneId) : ""}
        onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}
        className="h-9 w-24 truncate rounded-md border border-line bg-surface ps-7 pe-1 text-sm text-ink-900 sm:w-48 sm:pe-2"
      >
        <option value="">{t("all")}</option>
        {(zones.data ?? []).map((z) => (
          <option key={z.id} value={z.id}>
            {label(z)}
          </option>
        ))}
      </select>
    </div>
  );
}
