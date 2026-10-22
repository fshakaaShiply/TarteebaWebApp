"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { SlotRuleSnapshot } from "@/lib/admin/types";
import { useZoneName } from "./OpsFields";
import { useServiceChoices, useZoneChoices } from "./options";
import { useOpsText } from "./opsText";

/**
 * Plain-language descriptions of a slot rule, shared by the rules table and the capacity cards:
 *   scope  → ["All zones", "Cleaning visit", "Fridays", "1 Dec – 31 Dec 2026"]
 *   effect → "Closed" / "Open, no booking limit" / "Open, up to 6 bookings"
 */
export function useRuleText() {
  const t = useTranslations("admin.scheduling.rules");
  const text = useOpsText();
  const zones = useZoneChoices();
  const services = useServiceChoices();
  const zoneName = useZoneName(zones.data);

  const scope = useCallback(
    (rule: Pick<SlotRuleSnapshot, "zone_id" | "service_id" | "day_of_week" | "date_from" | "date_to">): string[] => {
      const service = rule.service_id === null ? null : services.data?.find((s) => s.id === rule.service_id);
      const dates =
        rule.date_from && rule.date_to
          ? rule.date_from === rule.date_to
            ? t("scope.oneDay", { date: text.dateShort(rule.date_from) })
            : t("scope.between", { from: text.dateShort(rule.date_from), to: text.dateShort(rule.date_to) })
          : rule.date_from
            ? t("scope.from", { date: text.dateShort(rule.date_from) })
            : rule.date_to
              ? t("scope.until", { date: text.dateShort(rule.date_to) })
              : t("scope.always");
      return [
        rule.zone_id === null ? t("scope.allZones") : zoneName(rule.zone_id),
        rule.service_id === null ? t("scope.allServices") : service ? text.name(service.name) : `#${rule.service_id}`,
        rule.day_of_week === null ? t("scope.everyDay") : text.weekday(rule.day_of_week),
        dates,
      ];
    },
    [t, text, zoneName, services.data],
  );

  const effect = useCallback(
    (rule: Pick<SlotRuleSnapshot, "is_open" | "max_bookings">): string => {
      if (!rule.is_open) return t("effect.closed");
      return rule.max_bookings === null ? t("effect.open") : t("effect.capped", { count: rule.max_bookings });
    },
    [t],
  );

  return { scope, effect };
}
