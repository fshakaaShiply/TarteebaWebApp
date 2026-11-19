"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { formatAed } from "@/lib/money";
import { AdminApiError } from "../client";
import { describeAdminError, useServerFieldMessage } from "../errors";
import { formatIsoDate, formatMonth } from "../format";
import { dubaiTime } from "./attendance";

/*
 * The error codes of the Phase 5 workforce routes (A5 §6) and the staff offer to the waitlist (A6 §5.2) in our own words,
 * Arabic and English, with the figures the API names in `details` put in. Codes that are not here (and the shared ones
 * such as STALE_VERSION, RATE_LIMITED, VALIDATION_FAILED) fall back to admin.errors.*. Every code listed has a message in
 * both languages (workforce-messages.test.ts). INVALID_STATE is in both lists because it means a different thing: an
 * incentive's status in A05, a waitlist request's in A04.
 */
export const WORKFORCE_ERROR_CODES = [
  "SUPERSEDES_INVALID",
  "DOCUMENT_ARCHIVED",
  "DOCUMENT_FILE_MISSING",
  "DOCUMENT_URL_UNAVAILABLE",
  "POSTING_FILE_UNAVAILABLE",
  "PHOTO_INVALID",
  "NO_PHOTO",
  "ATTENDANCE_DATE_INVALID",
  "ATTENDANCE_LOCKED",
  "NOT_A_WORKING_DAY",
  "ON_LEAVE",
  "NOT_MANUAL",
  "PERIOD_INVALID",
  "NO_ACTIVE_RULE",
  "PERIOD_NOT_CLOSED",
  "INVALID_STATE",
  "METRICS_STALE",
  "IDEMPOTENCY_KEY_REUSED",
  "AMOUNT_OUT_OF_RANGE",
  "REASON_REQUIRED",
  "TERMS_CHANGED",
  "PERIOD_MISMATCH",
  "POSTING_BUSY",
  "RULE_INVALID",
  "RULE_ACTIVE",
] as const;

export const WAITLIST_ERROR_CODES = [
  "INVALID_STATE",
  "WAITLIST_SLOT_UNAVAILABLE",
  "CUSTOMER_NOT_ACTIVE",
  "ADDRESS_UNAVAILABLE",
  "OFFER_LIMIT_REACHED",
  "OFFER_LIVE",
  "WAITLIST_NOTICE_DISABLED",
  "WAITLIST_BUSY",
] as const;

const INCENTIVE_STATES: readonly string[] = ["proposed", "approved", "rejected", "posted"];
const WAITLIST_STATES: readonly string[] = ["waiting", "notified", "converted", "expired", "cancelled"];

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Formatters = { money: (fils: number) => string; date: (iso: string) => string; month: (period: string) => string; time: (iso: string) => string };

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function describeWorkforceError(error: unknown, t: Translate, f: Formatters, fallback: (error: unknown) => string): string {
  if (!(error instanceof AdminApiError)) return fallback(error);
  const d = error.details;
  switch (error.code) {
    case "ATTENDANCE_DATE_INVALID": {
      const min = str(d.min);
      const max = str(d.max);
      if (min && max) return t("ATTENDANCE_DATE_INVALID", { min: f.date(min), max: f.date(max) });
      if (max) return t("ATTENDANCE_DATE_INVALID_upTo", { max: f.date(max) });
      return t("ATTENDANCE_DATE_INVALID_plain");
    }
    case "AMOUNT_OUT_OF_RANGE": {
      const min = num(d.min);
      const max = num(d.max);
      return min !== null && max !== null ? t("AMOUNT_OUT_OF_RANGE", { min: f.money(min), max: f.money(max) }) : t("AMOUNT_OUT_OF_RANGE_plain");
    }
    case "PERIOD_INVALID": {
      const days = num(d.max_days);
      return days !== null ? t("PERIOD_INVALID", { days }) : t("PERIOD_INVALID_plain");
    }
    case "PERIOD_NOT_CLOSED": {
      const period = str(d.period);
      return period ? t("PERIOD_NOT_CLOSED", { month: f.month(period) }) : t("PERIOD_NOT_CLOSED_plain");
    }
    case "POSTING_BUSY": {
      const period = str(d.period);
      return period ? t("POSTING_BUSY", { month: f.month(period) }) : t("POSTING_BUSY_plain");
    }
    case "INVALID_STATE": {
      const status = str(d.status);
      return status && INCENTIVE_STATES.includes(status) ? t("INVALID_STATE", { status: t(`incentiveState.${status}`) }) : t("INVALID_STATE_plain");
    }
    case "REASON_REQUIRED": {
      const proposed = num(d.proposed_fils);
      return proposed !== null ? t("REASON_REQUIRED", { amount: f.money(proposed) }) : t("REASON_REQUIRED_plain");
    }
    default:
      return (WORKFORCE_ERROR_CODES as readonly string[]).includes(error.code) ? t(error.code) : fallback(error);
  }
}

export function describeWaitlistError(error: unknown, t: Translate, f: Formatters, fallback: (error: unknown) => string): string {
  if (!(error instanceof AdminApiError)) return fallback(error);
  const d = error.details;
  switch (error.code) {
    case "INVALID_STATE": {
      const status = str(d.status);
      return status && WAITLIST_STATES.includes(status) ? t("INVALID_STATE", { status: t(`state.${status}`) }) : t("INVALID_STATE_plain");
    }
    case "WAITLIST_SLOT_UNAVAILABLE": {
      if (d.status === "full") {
        const left = num(d.remaining_workers);
        return left !== null ? t("WAITLIST_SLOT_UNAVAILABLE_full", { count: left }) : t("WAITLIST_SLOT_UNAVAILABLE_full_plain");
      }
      return t("WAITLIST_SLOT_UNAVAILABLE_closed");
    }
    case "CUSTOMER_NOT_ACTIVE":
      return t("CUSTOMER_NOT_ACTIVE");
    case "OFFER_LIMIT_REACHED": {
      const max = num(d.max);
      return max !== null ? t("OFFER_LIMIT_REACHED", { max }) : t("OFFER_LIMIT_REACHED_plain");
    }
    case "OFFER_LIVE": {
      const until = str(d.expires_at);
      return until ? t("OFFER_LIVE", { time: f.time(until) }) : t("OFFER_LIVE_plain");
    }
    default:
      return (WAITLIST_ERROR_CODES as readonly string[]).includes(error.code) ? t(error.code) : fallback(error);
  }
}

function useFormatters(): Formatters {
  const locale = useLocale();
  return useMemo(
    () => ({
      money: (fils: number) => formatAed(fils, locale, { fixed: true }),
      date: (iso: string) => formatIsoDate(iso, locale, "short"),
      month: (period: string) => formatMonth(`${period}-01`, locale),
      time: (iso: string) => dubaiTime(iso),
    }),
    [locale],
  );
}

/** `(error) => text` for the A05 workforce and A09 posting routes; anything else reads as every other admin error. */
export function useWorkforceError(): (error: unknown) => string {
  const t = useTranslations("admin.workers.errors");
  const shared = useTranslations("admin.errors");
  const formatters = useFormatters();
  return useCallback(
    (error: unknown) => describeWorkforceError(error, t as unknown as Translate, formatters, (e) => describeAdminError(e, shared as unknown as Translate)),
    [t, shared, formatters],
  );
}

/** `(error) => text` for the staff offer of A04's waitlist page. */
export function useWaitlistError(): (error: unknown) => string {
  const t = useTranslations("admin.waitlist.errors");
  const shared = useTranslations("admin.errors");
  const formatters = useFormatters();
  return useCallback(
    (error: unknown) => describeWaitlistError(error, t as unknown as Translate, formatters, (e) => describeAdminError(e, shared as unknown as Translate)),
    [t, shared, formatters],
  );
}

/**
 * The API's message for one field of a 422 VALIDATION_FAILED answer, in the UI language when the API wrote it in that
 * language, else `fallback` (our own words). Undefined when the answer has nothing for the field.
 */
export function useApiFieldMessage(error: unknown): (field: string, fallback: string) => string | undefined {
  const serverMessage = useServerFieldMessage();
  return useCallback(
    (field, fallback) => {
      if (!(error instanceof AdminApiError) || error.code !== "VALIDATION_FAILED") return undefined;
      const message = error.fieldErrors[field]?.[0];
      return message ? serverMessage(message, fallback) : undefined;
    },
    [error, serverMessage],
  );
}
