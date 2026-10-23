"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { StatusTone } from "@/components/admin";
import { pickText } from "@/lib/admin/catalog/fields";
import { formatDateTime, formatIsoDate } from "@/lib/admin/format";
import type { BookingStatus, PaymentStatus, ProposalStatus, RescheduleRequestStatus, Translatable, VisitStatus } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";

/*
 * Copy and colours for A02/A03 (spec §27.5 status colours, §16 copy rules): "pending confirmation" until staff
 * confirm, the payment chip shows the provider's state only, the preferred worker is never promised. The API sends
 * status labels in both languages; our own labels (admin.bookings.enums.*) are for filters and anything without one.
 */

export const bookingTone: Record<BookingStatus, StatusTone> = {
  draft: "neutral",
  held: "neutral",
  pending_confirmation: "pending",
  alternative_proposed: "pending",
  confirmed: "confirmed",
  rescheduled: "confirmed",
  completed: "success",
  rejected: "danger",
  cancelled: "danger",
  expired: "neutral",
};

export const paymentTone: Record<PaymentStatus, StatusTone> = {
  unpaid: "neutral",
  pending: "pending",
  verifying: "neutral",
  authorized: "confirmed",
  captured: "success",
  partially_refunded: "neutral",
  refunded: "neutral",
  failed: "danger",
  voided: "neutral",
};

export const visitTone: Record<VisitStatus, StatusTone> = {
  scheduled: "neutral",
  worker_assigned: "confirmed",
  en_route: "progress",
  arrived: "progress",
  in_progress: "progress",
  completed: "success",
  no_show_customer: "danger",
  missed_by_company: "danger",
  cancelled: "danger",
};

export const proposalTone: Record<ProposalStatus, StatusTone> = { pending: "pending", accepted: "success", declined: "danger", expired: "neutral" };
export const requestTone: Record<RescheduleRequestStatus, StatusTone> = {
  pending: "pending",
  approved: "success",
  auto_approved: "success",
  rejected: "danger",
};

export function useBookingText() {
  const t = useTranslations("admin.bookings.enums");
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
      payment: (value: string, apiLabel?: Translatable | null) => label("payment", value, apiLabel),
      source: (value: string, apiLabel?: Translatable | null) => label("source", value, apiLabel),
      visit: (value: string, apiLabel?: Translatable | null) => label("visit", value, apiLabel),
      proposal: (value: string, apiLabel?: Translatable | null) => label("proposal", value, apiLabel),
      request: (value: string, apiLabel?: Translatable | null) => label("request", value, apiLabel),
      rejectReason: (value: string) => label("rejectReason", value),
      cancelReason: (value: string) => label("cancelReason", value),
      party: (value: string) => label("party", value),
      area: (value: string) => label("area", value),
      propertyType: (value: string) => label("propertyType", value),
      materials: (value: string) => label("materials", value),
      manualSource: (value: string) => label("source", value),
      /** "Tue 20 Oct 2026". */
      dateShort: (iso: string | null | undefined) => formatIsoDate(iso, locale, "short"),
      /** "Tuesday 20 October 2026". */
      date: (iso: string | null | undefined) => formatIsoDate(iso, locale, "long"),
      /** "20 Oct 2026, 09:12" in Dubai time. */
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, locale),
      money: (fils: number | null | undefined) => (fils === null || fils === undefined ? "—" : formatAed(fils, locale)),
    };
  }, [t, locale]);
}

export type BookingText = ReturnType<typeof useBookingText>;
