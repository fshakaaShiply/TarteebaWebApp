"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { pickText } from "../catalog/fields";
import { businessToday, formatDateTime, formatIsoDate } from "../format";
import type { Translatable } from "../types";
import { formatAed } from "@/lib/money";

/*
 * Copy helpers of A08: dates and money in the admin's own formats (Dubai time, Latin digits), the API's two-language
 * labels in the UI language, weekday names (0 = Sunday … 6 = Saturday, as the API numbers them), slot times and the
 * unfit reasons of the worker checks. Our own labels sit in admin.subscriptions.enums.*; anything the API labels
 * itself (status, state, history type) uses the API's text.
 */

/** The local weekday name of `n` (0 = Sunday), `long` or `short`, in the UI language. 1 Nov 2026 is a Sunday. */
export function weekdayName(n: number, locale: string, style: "long" | "short" = "long"): string {
  const date = new Date(Date.UTC(2026, 10, 1 + (((n % 7) + 7) % 7), 12));
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { weekday: style, timeZone: "UTC" }).format(date);
}

/** The weekday number (0 = Sunday) of a local date "YYYY-MM-DD". */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** "2026-11" for a local date. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The month before or after "YYYY-MM". */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Days in "YYYY-MM". */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The Asia/Dubai calendar date "YYYY-MM-DD" of an API instant (the API answers instants in UTC, e.g. a renewal at 02:00
 * local on 29 Nov is "2026-11-28T22:00:00+00:00"), or "" when it is not one. Never the instant's first 10 characters.
 */
export function businessDateOf(instant: string | null | undefined): string {
  if (!instant) return "";
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? "" : businessToday(date);
}

export function useSubscriptionText() {
  const locale = useLocale();
  const t = useTranslations("admin.subscriptions.enums");
  return useMemo(() => {
    const own = (group: string, value: string, fallback?: string) => {
      const key = `${group}.${value}`;
      return t.has(key as never) ? t(key as never) : (fallback ?? value);
    };
    return {
      locale,
      name: (value: Translatable | null | undefined) => (value ? pickText(value, locale) : ""),
      /** The API's two-language label, else ours. */
      label: (api: Translatable | string | null | undefined, group: string, value: string) => {
        if (api && typeof api === "object") {
          const text = pickText(api, locale);
          if (text) return text;
        }
        if (typeof api === "string" && api) return api;
        return own(group, value);
      },
      type: (value: string) => own("type", value),
      status: (value: string) => own("status", value),
      health: (value: string) => own("health", value),
      period: (value: string) => own("period", value),
      occurrence: (value: string) => own("occurrence", value),
      origin: (value: string) => own("origin", value),
      day: (value: string) => own("day", value),
      reason: (value: string) => own("cancelReason", value),
      cancelRule: (value: string | null | undefined) => (value ? own("rule", value) : ""),
      compensation: (value: string | null | undefined) => (value ? own("compensation", value) : ""),
      unfit: (value: string) => own("unfit", value),
      /**
       * Why a date cannot be held (P4-245: Scheduling's closed and full reasons, lead_time … max_bookings): the label of
       * a preview's `conflicts {date: reason}` and `reason` fields. Never label those with the conflict codes below.
       */
      dateReason: (value: string) => own("dateReason", value),
      /**
       * An occurrence conflict (P4-245 codes SLOT_FULL, SLOT_CLOSED, BLACKOUT): its code, and the date's reason when the
       * API gives one ("Slot is full · not enough workers"). A BLACKOUT always carries the reason "blackout"
       * (FlagBlackoutConflicts), which says nothing more, so it reads "Blackout day" alone.
       */
      conflictWithReason: (code: string, reason: string | null) =>
        reason && code !== "BLACKOUT" ? `${own("conflict", code)} · ${own("dateReason", reason)}` : own("conflict", code),
      /** Where the subscription was bought (app, web, phone, whatsapp, admin). */
      source: (value: string) => own("source", value),
      /** Who brings the cleaning materials (customer, company). */
      materialsBy: (value: string) => own("materialsBy", value),
      /** Items joined with the UI language's list separator. */
      list: (items: readonly string[]) => items.join(locale === "ar" ? "، " : ", "),
      weekday: (n: number, style: "long" | "short" = "long") => weekdayName(n, locale, style),
      weekdays: (days: readonly number[] | null | undefined, style: "long" | "short" = "short") =>
        [...(days ?? [])].sort((a, b) => a - b).map((n) => weekdayName(n, locale, style)).join(locale === "ar" ? "، " : ", "),
      date: (iso: string | null | undefined) => formatIsoDate(iso, locale, "long"),
      dateShort: (iso: string | null | undefined) => formatIsoDate(iso, locale, "short"),
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, locale),
      /** The Dubai date of an instant, short ("Sun, 29 Nov 2026"). */
      instantDate: (iso: string | null | undefined) => formatIsoDate(businessDateOf(iso), locale, "short"),
      money: (fils: number | null | undefined) => (fils === null || fils === undefined ? "—" : formatAed(fils, locale)),
      /** Cancellation money always shows two decimals like the printed documents (P2-35). */
      moneyFixed: (fils: number | null | undefined) => (fils === null || fils === undefined ? "—" : formatAed(fils, locale, { fixed: true })),
      /** "10:00–14:00". */
      slot: (slot: { start: string; end: string } | null | undefined) => (slot ? `${slot.start}–${slot.end}` : "—"),
    };
  }, [t, locale]);
}

export type SubscriptionText = ReturnType<typeof useSubscriptionText>;
