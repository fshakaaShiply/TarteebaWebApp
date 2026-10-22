"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { StatusTone } from "@/components/admin";
import { pickText } from "@/lib/admin/catalog/fields";
import { useServerFieldMessage } from "@/lib/admin/errors";
import { formatIsoDate } from "@/lib/admin/format";
import type {
  DriverStatus,
  EmploymentStatus,
  LeaveStatus,
  SlotStatus,
  Translatable,
  VehicleStatus,
} from "@/lib/admin/types";

/*
 * Copy for the Phase 2 operations screens (A04 capacity, A05 workers, A06 fleet, A11 scheduling): enum labels under
 * admin.ops.enums.<group>.<value>, weekday names, local dates, and field error messages.
 */

export function useOpsText() {
  const t = useTranslations("admin.ops");
  const weekdays = useTranslations("admin.catalog.enums.weekday");
  const kinds = useTranslations("admin.catalog.enums.kind");
  const locale = useLocale();
  return useMemo(() => {
    const label = (group: string, value: string) => {
      const key = `enums.${group}.${value}`;
      return t.has(key) ? t(key) : value;
    };
    return {
      locale,
      weekday: (day: number) => (weekdays.has(String(day)) ? weekdays(String(day)) : String(day)),
      weekdayShort: (day: number) => (t.has(`weekdaysShort.${day}`) ? t(`weekdaysShort.${day}`) : String(day)),
      serviceKind: (kind: string) => (kinds.has(kind) ? kinds(kind) : kind),
      employmentStatus: (v: string) => label("employmentStatus", v),
      leaveType: (v: string) => label("leaveType", v),
      leaveStatus: (v: string) => label("leaveStatus", v),
      vehicleStatus: (v: string) => label("vehicleStatus", v),
      driverStatus: (v: string) => label("driverStatus", v),
      slotStatus: (v: string) => label("slotStatus", v),
      slotReason: (v: string) => label("slotReason", v),
      exclusion: (v: string) => label("exclusion", v),
      holderType: (v: string) => label("holderType", v),
      ruleSource: (v: string) => label("ruleSource", v),
      name: (value: Translatable | Partial<Translatable> | null | undefined) =>
        value ? pickText({ ar: value.ar ?? "", en: value.en ?? "" }, locale) : "",
      /** "Tuesday 20 October 2026" for a local date. */
      date: (iso: string | null | undefined) => formatIsoDate(iso, locale, "long"),
      /** "Tue 20 Oct 2026". */
      dateShort: (iso: string | null | undefined) => formatIsoDate(iso, locale, "short"),
    };
  }, [t, weekdays, kinds, locale]);
}

export type OpsText = ReturnType<typeof useOpsText>;

export const employmentTone: Record<EmploymentStatus, StatusTone> = {
  active: "success",
  on_leave: "pending",
  suspended: "danger",
  terminated: "neutral",
};

export const leaveTone: Record<LeaveStatus, StatusTone> = {
  requested: "pending",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export const vehicleTone: Record<VehicleStatus, StatusTone> = { active: "success", maintenance: "pending", inactive: "neutral" };
export const driverTone: Record<DriverStatus, StatusTone> = { active: "success", inactive: "neutral" };
export const slotTone: Record<SlotStatus, StatusTone> = { available: "success", limited: "pending", full: "danger", closed: "neutral" };

type FieldErrorLike = { type?: string | number; message?: string } | undefined;

/**
 * Field error copy for the operations forms: API messages (type "server") when they are in the UI language, our zod
 * keys from admin.ops.errors, then the shared catalog keys (admin.catalog.errors), else "Check this value."
 */
export function useOpsFieldError() {
  const ops = useTranslations("admin.ops.errors");
  const catalog = useTranslations("admin.catalog.errors");
  const serverMessage = useServerFieldMessage();
  return useCallback(
    (error: FieldErrorLike): string | undefined => {
      if (!error) return undefined;
      if (error.type === "server") return serverMessage(error.message, catalog("invalid"));
      const key = error.message ?? "";
      if (key && ops.has(key)) return ops(key);
      if (key && catalog.has(key)) return catalog(key);
      return catalog("invalid");
    },
    [ops, catalog, serverMessage],
  );
}

/** A message key (ours or a catalog one) → text; for errors not tied to react-hook-form. */
export function useOpsErrorKey() {
  const ops = useTranslations("admin.ops.errors");
  const catalog = useTranslations("admin.catalog.errors");
  return useCallback(
    (key: string | null | undefined): string | undefined => {
      if (!key) return undefined;
      if (ops.has(key)) return ops(key);
      if (catalog.has(key)) return catalog(key);
      return catalog("invalid");
    },
    [ops, catalog],
  );
}
