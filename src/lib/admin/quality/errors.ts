"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { formatAed } from "@/lib/money";
import { AdminApiError } from "../client";
import { describeAdminError } from "../errors";

/*
 * The error codes of the A10 routes (contracts A2 §8.2, A3 §4) in our own words, Arabic and English, with the figures
 * the API names in `details` put in. Codes that are not here (and the shared ones such as STALE_VERSION, FORBIDDEN,
 * RATE_LIMITED, REFUND_PERMISSION_REQUIRED, SLOT_FULL) fall back to admin.errors.*. Every code listed has a message in
 * both languages (quality-messages.test.ts).
 */
export const QUALITY_ERROR_CODES = [
  "COMPLAINT_CLOSED",
  "COMPENSATION_NOT_FINAL",
  "COMPLAINT_ALREADY_OPEN",
  "ASSIGNEE_INVALID",
  "WORKER_NOT_ON_VISIT",
  "DRIVER_NOT_ON_VISIT",
  "CLOSE_REASON_REQUIRED",
  "AWAIT_REQUIRES_PUBLIC_MESSAGE",
  "REOPEN_REASON_REQUIRED",
  "OUTCOME_REQUIRED",
  "RESOLUTION_REQUIRED",
  "COMPENSATION_PENDING",
  "COMPENSATION_ALREADY_GIVEN",
  "COMPENSATION_NOT_PENDING",
  "COMPENSATION_TYPE_UNAVAILABLE",
  "COMPENSATION_AMOUNT_INVALID",
  "COMPENSATION_ALREADY_CREDITED",
  "REFUND_AMOUNT_INVALID",
  "WORKERS_OUT_OF_RANGE",
  "ACCOUNT_CLOSING",
  "TERMS_CHANGED",
  "ATTACHMENT_INVALID",
  "ATTACHMENT_UNREADABLE",
  "TOO_MANY_PENDING_UPLOADS",
  "CUSTOMER_NOT_FOUND",
  "BOOKING_INVALID",
  "COMPLAINT_NOT_ALLOWED",
  "TOO_MANY_OPEN_CASES",
  "RECOVERY_VISIT_LOCKED",
  "NOT_IMPLEMENTED",
] as const;

/** COMPENSATION_TYPE_UNAVAILABLE `details.reason`, and `compensation_options[type].reason` of a case. */
export const UNAVAILABLE_REASONS = [
  "disabled",
  "wallet_disabled",
  "no_booking",
  "no_payment",
  "recovery_visit",
  "visit_not_eligible",
  "cap_reached",
  "account_closing",
  "already_credited",
] as const;

export const NOT_ALLOWED_REASONS = ["booking_status", "category_not_applicable", "window_closed"] as const;

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Money = (fils: number) => string;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function describeQualityError(error: unknown, t: Translate, money: Money, fallback: (error: unknown) => string): string {
  if (!(error instanceof AdminApiError)) return fallback(error);
  const d = error.details;
  switch (error.code) {
    case "COMPENSATION_AMOUNT_INVALID": {
      const max = num(d.max_fils);
      return max !== null && max > 0 ? t("COMPENSATION_AMOUNT_INVALID", { max: money(max) }) : t("COMPENSATION_AMOUNT_INVALID_plain");
    }
    case "REFUND_AMOUNT_INVALID": {
      const left = num(d.refundable_fils);
      return left !== null ? t("REFUND_AMOUNT_INVALID", { max: money(left) }) : t("REFUND_AMOUNT_INVALID_plain");
    }
    case "COMPENSATION_TYPE_UNAVAILABLE": {
      const reason = typeof d.reason === "string" && (UNAVAILABLE_REASONS as readonly string[]).includes(d.reason) ? d.reason : null;
      return reason ? t(`unavailable.${reason}`) : t("COMPENSATION_TYPE_UNAVAILABLE");
    }
    case "WORKERS_OUT_OF_RANGE": {
      const min = num(d.min_workers);
      const max = num(d.max_workers);
      return min !== null && max !== null ? t("WORKERS_OUT_OF_RANGE", { min, max }) : t("WORKERS_OUT_OF_RANGE_plain");
    }
    case "COMPLAINT_ALREADY_OPEN":
      return typeof d.reference === "string" ? t("COMPLAINT_ALREADY_OPEN", { reference: d.reference }) : t("COMPLAINT_ALREADY_OPEN_plain");
    case "COMPLAINT_NOT_ALLOWED": {
      const reason = typeof d.reason === "string" && (NOT_ALLOWED_REASONS as readonly string[]).includes(d.reason) ? d.reason : null;
      return reason ? t(`notAllowed.${reason}`) : t("COMPLAINT_NOT_ALLOWED");
    }
    case "ATTACHMENT_INVALID":
      return d.reason === "internal_only" ? t("ATTACHMENT_INVALID_internal") : t("ATTACHMENT_INVALID");
    case "TOO_MANY_PENDING_UPLOADS": {
      const max = num(d.max);
      return max !== null ? t("TOO_MANY_PENDING_UPLOADS", { max }) : t("TOO_MANY_PENDING_UPLOADS_plain");
    }
    case "TOO_MANY_OPEN_CASES": {
      const max = num(d.max);
      return max !== null ? t("TOO_MANY_OPEN_CASES", { max }) : t("TOO_MANY_OPEN_CASES_plain");
    }
    default:
      return (QUALITY_ERROR_CODES as readonly string[]).includes(error.code) ? t(error.code) : fallback(error);
  }
}

/** `(error) => text` for the A10 routes; anything else reads as every other admin error. */
export function useQualityError(): (error: unknown) => string {
  const t = useTranslations("admin.quality.errors");
  const shared = useTranslations("admin.errors");
  const locale = useLocale();
  return useCallback(
    (error: unknown) =>
      describeQualityError(
        error,
        t as unknown as Translate,
        (fils) => formatAed(fils, locale, { fixed: true }),
        (e) => describeAdminError(e, shared as unknown as Translate),
      ),
    [t, shared, locale],
  );
}
