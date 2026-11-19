"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { pickText } from "@/lib/admin/catalog/fields";
import { businessToday, formatDateTime, formatIsoDate } from "@/lib/admin/format";
import type { Translatable } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";

/*
 * Words of A07 and the privacy queue. The API sends every status, verification and hold label in both languages and the
 * page shows them as they are; our own `admin.customers.enums.*` and `admin.privacy.enums.*` are for the filters, the forms
 * and anything the API sent no label for. Money always has two decimals (A09's rule), a local date ("2026-11-24") is shown
 * as it is, an instant in its Dubai time.
 */
export function useCustomerText() {
  const t = useTranslations("admin.customers.enums");
  const p = useTranslations("admin.privacy.enums");
  const ui = useTranslations("admin.ui");
  const locale = useLocale();
  return useMemo(() => {
    const label = (messages: { has: (key: string) => boolean; (key: string): string }, group: string, value: string, apiLabel?: Translatable | null) => {
      if (apiLabel) {
        const text = pickText(apiLabel, locale);
        if (text) return text;
      }
      const key = `${group}.${value}`;
      return messages.has(key) ? messages(key) : value;
    };
    return {
      locale,
      name: (value: Translatable | null | undefined) => (value ? pickText(value, locale) : ""),
      list: (items: readonly string[]) => items.join(ui("listSeparator")),
      status: (value: string, apiLabel?: Translatable | null) => label(t, "status", value, apiLabel),
      privacyType: (value: string, apiLabel?: { ar: string | null; en: string | null } | null) =>
        label(p, "type", value, apiLabel && apiLabel.ar && apiLabel.en ? { ar: apiLabel.ar, en: apiLabel.en } : null),
      privacyStatus: (value: string, apiLabel?: Translatable | null) => label(p, "status", value, apiLabel),
      verification: (value: string, apiLabel?: Translatable | null) => label(p, "verification", value, apiLabel),
      waitingOn: (value: string, apiLabel?: Translatable | null) => label(p, "waitingOn", value, apiLabel),
      failure: (value: string, apiLabel?: Translatable | null) => label(p, "failure", value, apiLabel),
      money: (fils: number | null | undefined) => (fils === null || fils === undefined ? "—" : formatAed(fils, locale, { fixed: true })),
      date: (iso: string | null | undefined) => formatIsoDate(iso, locale, "short"),
      /**
       * The Dubai day of an instant ("2026-11-18T22:00:00+00:00" is Thu 19 Nov), short; "" without one. Never the instant's
       * first 10 characters: the API's instants are UTC.
       */
      instantDate: (iso: string | null | undefined) => {
        const at = iso ? new Date(iso) : null;
        return at && !Number.isNaN(at.getTime()) ? formatIsoDate(businessToday(at), locale, "short") : "";
      },
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, locale),
    };
  }, [t, p, ui, locale]);
}

export type CustomerText = ReturnType<typeof useCustomerText>;
