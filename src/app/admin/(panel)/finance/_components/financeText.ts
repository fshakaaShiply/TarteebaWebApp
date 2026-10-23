"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { StatusTone } from "@/components/admin";
import { pickText } from "@/lib/admin/catalog/fields";
import { formatDateTime, formatIsoDate } from "@/lib/admin/format";
import type { InvoiceStatus, RefundStatus, Translatable } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";

/*
 * Copy and colours for A09 (spec §27.5 status colours, §16 copy rules). Payment and refund states are the provider's:
 * the API sends their labels in both languages and the page shows them as they are (a refund "processing" is never
 * shown as refunded). Our own labels (admin.finance.enums.*) are for filters and anything without an API label.
 */

export const refundTone: Record<RefundStatus, StatusTone> = {
  requested: "neutral",
  processing: "neutral",
  succeeded: "success",
  failed: "danger",
};

export const invoiceTone: Record<InvoiceStatus, StatusTone> = {
  issued: "success",
  credited_partial: "neutral",
  credited_full: "neutral",
};

export function useFinanceText() {
  const t = useTranslations("admin.finance.enums");
  const locale = useLocale();
  return useMemo(() => {
    const label = (group: string, value: string, apiLabel?: Translatable | string | null) => {
      if (typeof apiLabel === "string" && apiLabel !== "") return apiLabel;
      if (apiLabel && typeof apiLabel === "object") {
        const text = pickText(apiLabel, locale);
        if (text) return text;
      }
      const key = `${group}.${value}`;
      return t.has(key) ? t(key) : value;
    };
    return {
      locale,
      name: (value: Translatable | null | undefined) => (value ? pickText(value, locale) : ""),
      payment: (value: string, apiLabel?: Translatable | null) => label("payment", value, apiLabel),
      refund: (value: string, apiLabel?: Translatable | null) => label("refund", value, apiLabel),
      invoice: (value: string, apiLabel?: string | null) => label("invoice", value, apiLabel),
      payable: (value: string) => label("payable", value),
      /** A refund reason: the API's bilingual label when the record has one, else ours; an unknown code reads "Other". */
      reason: (code: string | null | undefined, apiLabel?: Translatable | null) => {
        if (apiLabel) {
          const text = pickText(apiLabel, locale);
          if (text) return text;
        }
        const key = `reason.${code ?? "other"}`;
        return t.has(key) ? t(key) : t("reason.other");
      },
      document: (value: string) => label("document", value),
      problem: (value: string) => label("problem", value),
      source: (value: string) => label("eventSource", value),
      requester: (value: string) => label("requester", value),
      /** "120.00" style amounts in tables use the full "AED 120" form (D-13 Latin digits). */
      money: (fils: number | null | undefined) => (fils === null || fils === undefined ? "—" : formatAed(fils, locale)),
      date: (iso: string | null | undefined) => formatIsoDate(iso, locale, "short"),
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, locale),
      /** A bilingual text from the API in the page language, else the other one. */
      either: (value: { ar: string | null; en: string | null } | null | undefined) =>
        value ? (locale === "en" ? value.en || value.ar : value.ar || value.en) || "" : "",
    };
  }, [t, locale]);
}

export type FinanceText = ReturnType<typeof useFinanceText>;
