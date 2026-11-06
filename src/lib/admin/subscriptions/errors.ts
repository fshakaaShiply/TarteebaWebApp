"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { AdminApiError } from "../client";
import { useAdminErrorMessage } from "../errors";
import { formatIsoDate } from "../format";

/*
 * The error codes of A08's routes (design §7.2, contracts A5a, A5b, A6) in our own copy, ar and en
 * (admin.subscriptions.errors.codes.*): they say what happened to the subscription, not to a booking. A code without an
 * entry here goes through the shared messages (network, session, validation, rate limit …). The numbers some errors
 * carry (the lead time, the freeze limit) come from the error's details.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Has = (key: string) => boolean;

const numberOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The earliest date an error names, in the admin's date format ("Fri, 20 Nov 2026"): FREEZE_DATES_INVALID gives
 * `min_from`, DATE_OUT_OF_RANGE `min_date`; never the API's raw "YYYY-MM-DD".
 */
function dateOf(details: Record<string, unknown>, locale: string): string {
  const raw = [details.date, details.min_date, details.min_from].find((v): v is string => typeof v === "string" && v !== "");
  return raw ? formatIsoDate(raw, locale, "short") : "";
}

/** The copy for an error: `codes.<CODE>`, `dayNotEditable.<reason>` for DAY_NOT_EDITABLE, else null. */
export function subscriptionErrorText(error: unknown, t: Translate, has: Has, locale = "en"): string | null {
  if (!(error instanceof AdminApiError)) return null;
  const d = error.details;
  if (error.code === "DAY_NOT_EDITABLE") {
    const reason = typeof d.reason === "string" ? d.reason : "";
    return has(`dayNotEditable.${reason}`) ? t(`dayNotEditable.${reason}`) : t("codes.DAY_NOT_EDITABLE");
  }
  if (error.code === "FREEZE_NOT_ALLOWED") {
    const reason = typeof d.reason === "string" ? d.reason : "";
    return has(`freezeNotAllowed.${reason}`) ? t(`freezeNotAllowed.${reason}`) : t("codes.FREEZE_NOT_ALLOWED");
  }
  if (!has(`codes.${error.code}`)) return null;
  return t(`codes.${error.code}`, {
    hours: numberOf(d.lead_time_hours) ?? 12,
    max: numberOf(d.max_days) ?? numberOf(d.max) ?? 0,
    used: numberOf(d.used) ?? 0,
    requested: numberOf(d.requested) ?? 0,
    date: dateOf(d, locale),
  });
}

/** `(error) => localized message` for the dialogs and notices of A08. */
export function useSubscriptionErrorMessage(): (error: unknown) => string {
  const t = useTranslations("admin.subscriptions.errors");
  const locale = useLocale();
  const shared = useAdminErrorMessage();
  return useCallback(
    (error: unknown) => subscriptionErrorText(error, t as unknown as Translate, (key) => t.has(key as never), locale) ?? shared(error),
    [t, shared, locale],
  );
}
