"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { fetchAllPackages, fetchAllPolicies, fetchAllServices, fetchAllZones } from "@/lib/admin/endpoints";
import { allFieldMessages, useServerFieldMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import { pickText } from "@/lib/admin/catalog/fields";
import type { Translatable } from "@/lib/admin/types";

/** A react-hook-form error (or nothing) → the text to show under the field. */
type FieldErrorLike = { type?: string | number; message?: string } | undefined;

/**
 * Field error copy: API messages (type "server") are shown when they are in the UI language, otherwise our generic
 * "Check this value." (the API may still answer in English, see messageInLocale); our zod messages are keys under
 * admin.catalog.errors, and "polygon.<reason>" keys under admin.zones.polygonReasons.
 */
export function useFieldError() {
  const t = useTranslations("admin.catalog.errors");
  const polygon = useTranslations("admin.zones.polygonReasons");
  const serverMessage = useServerFieldMessage();
  return useCallback(
    (error: FieldErrorLike): string | undefined => {
      if (!error) return undefined;
      if (error.type === "server") return serverMessage(error.message, t("invalid"));
      const key = error.message ?? "";
      if (key.startsWith("polygon.")) {
        const reason = key.slice("polygon.".length);
        return polygon.has(reason) ? polygon(reason) : t("invalid");
      }
      return key && t.has(key) ? t(key) : t("invalid");
    },
    [t, polygon, serverMessage],
  );
}

/** VALIDATION_FAILED messages with no field on screen (notices, preview rows), each in the UI language. */
export function useFieldMessageList() {
  const t = useTranslations("admin.catalog.errors");
  const serverMessage = useServerFieldMessage();
  return useCallback(
    (error: unknown): string[] => [...new Set(allFieldMessages(error).map((m) => serverMessage(m, t("invalid"))))],
    [t, serverMessage],
  );
}

/** Labels for the catalog's enum values (kinds, units, weekdays …) and small formatters. */
export function useCatalogText() {
  const t = useTranslations("admin.catalog.enums");
  const common = useTranslations("admin.catalog.common");
  const locale = useLocale();
  return useMemo(() => {
    const label = (group: string, value: string | number) => {
      const key = `${group}.${value}`;
      return t.has(key) ? t(key) : String(value);
    };
    return {
      kind: (v: string) => label("kind", v),
      materials: (v: string) => label("materials", v),
      unit: (v: string) => label("unit", v),
      per: (v: string) => label("per", v),
      discountType: (v: string) => label("discountType", v),
      planKind: (v: string) => label("planKind", v),
      policyType: (v: string) => label("policyType", v),
      compensation: (v: string) => label("compensation", v),
      weekday: (v: number) => label("weekday", v),
      /** 240 → "4 h", 90 → "1 h 30 min". */
      duration: (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h && m) return common("durationHm", { h, m });
        return h ? common("durationH", { h }) : common("durationM", { m });
      },
      name: (value: Translatable | null | undefined) => pickText(value, locale),
    };
  }, [t, common, locale]);
}

// Option lists for selects (all pages, cached for a minute).

export function useServiceOptions() {
  return useQuery({ queryKey: adminKeys.serviceOptions(), queryFn: fetchAllServices, staleTime: 60_000 });
}

export function usePolicyOptions() {
  return useQuery({ queryKey: adminKeys.policyOptions(), queryFn: fetchAllPolicies, staleTime: 60_000 });
}

export function usePackageOptions() {
  return useQuery({ queryKey: adminKeys.packageOptions(), queryFn: fetchAllPackages, staleTime: 60_000 });
}

export function useZoneOptions() {
  return useQuery({ queryKey: adminKeys.zoneOptions(), queryFn: fetchAllZones, staleTime: 60_000 });
}
