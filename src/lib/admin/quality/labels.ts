"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { StatusTone } from "@/components/admin";
import { pickText } from "@/lib/admin/catalog/fields";
import { formatDateTime, formatIsoDate } from "@/lib/admin/format";
import type { Translatable } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";
import type { CasePriority, CaseStatus, CompensationStatus } from "./types";

/*
 * Words and colours of A10. The API sends every label in both languages and the page shows them as they are; our own
 * `admin.quality.enums.*` are for the filters, the forms and anything the API sent no label for. Money always has two
 * decimals (the A09 rule, P2-35), and a local date ("2026-11-16") is shown as it is, never moved by a time zone.
 */

export const statusTone: Record<CaseStatus, StatusTone> = {
  open: "pending",
  in_review: "progress",
  awaiting_customer: "neutral",
  resolved: "success",
  closed: "neutral",
};

export const priorityTone: Record<CasePriority, StatusTone> = {
  low: "neutral",
  medium: "confirmed",
  high: "pending",
  urgent: "danger",
};

export const compensationTone: Record<CompensationStatus, StatusTone> = {
  pending_approval: "pending",
  executed: "success",
  rejected: "danger",
  cancelled: "neutral",
  failed: "danger",
};

export function useQualityText() {
  const t = useTranslations("admin.quality.enums");
  const locale = useLocale();
  return useMemo(() => {
    const label = (group: string, value: string, apiLabel?: Translatable | null) => {
      if (apiLabel) {
        const text = pickText(apiLabel, locale);
        if (text) return text;
      }
      const key = `${group}.${value}`;
      return t.has(key) ? t(key) : value;
    };
    return {
      locale,
      name: (value: Translatable | null | undefined) => (value ? pickText(value, locale) : ""),
      status: (value: string, apiLabel?: Translatable | null) => label("status", value, apiLabel),
      priority: (value: string, apiLabel?: Translatable | null) => label("priority", value, apiLabel),
      category: (value: string, apiLabel?: Translatable | null) => label("category", value, apiLabel),
      type: (value: string, apiLabel?: Translatable | null) => label("type", value, apiLabel),
      outcome: (value: string, apiLabel?: Translatable | null) => label("outcome", value, apiLabel),
      compensationType: (value: string, apiLabel?: Translatable | null) => label("compensationType", value, apiLabel),
      compensationStatus: (value: string, apiLabel?: Translatable | null) => label("compensationStatus", value, apiLabel),
      closeReason: (value: string, apiLabel?: Translatable | null) => label("closeReason", value, apiLabel),
      source: (value: string, apiLabel?: Translatable | null) => label("source", value, apiLabel),
      slaState: (value: string) => label("slaState", value),
      kind: (value: string, apiLabel?: Translatable | null) => label("bookingKind", value, apiLabel),
      money: (fils: number | null | undefined) => (fils === null || fils === undefined ? "—" : formatAed(fils, locale, { fixed: true })),
      date: (iso: string | null | undefined) => formatIsoDate(iso, locale, "short"),
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, locale),
    };
  }, [t, locale]);
}

export type QualityText = ReturnType<typeof useQualityText>;
