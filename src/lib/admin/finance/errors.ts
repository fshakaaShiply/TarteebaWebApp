"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { formatAed } from "@/lib/money";
import { AdminApiError } from "../client";
import { describeAdminError } from "../errors";

/*
 * The error codes of the Phase 5 finance routes (A1a §5, A1b §2.3 and §3.3) in our own words, Arabic and English, with
 * the figures the API names in `details` put in. Codes that are not here (and the shared ones such as STALE_VERSION,
 * RATE_LIMITED or REFUND_PERMISSION_REQUIRED) fall back to admin.errors.*. Every code listed has a message in both
 * languages (finance-messages.test.ts).
 */
export const FINANCE_ERROR_CODES = [
  "SETTLEMENT_FORMAT_UNKNOWN",
  "SETTLEMENT_FILE_TOO_LARGE",
  "SETTLEMENT_DATE_MISMATCH",
  "GATEWAY_UNKNOWN",
  "RECONCILIATION_RUN_EXISTS",
  "RECONCILIATION_RUN_IN_PROGRESS",
  "SETTLEMENT_FILE_DUPLICATE",
  "RECONCILIATION_RUN_NOT_ACTIVE",
  "RECONCILIATION_ITEM_RESOLVED",
  "RECONCILIATION_ITEM_NOT_RESOLVED",
  "RESOLUTION_NOT_REOPENABLE",
  "RESOLUTION_NOT_ALLOWED",
  "PAIRED_ITEM_INVALID",
  "TERMS_CHANGED",
  "OPEN_REFUND_EXISTS",
  "PROVIDER_REF_IN_USE",
  "REFUND_NOT_OPEN",
  "REFUND_NOT_FAILED",
  "REFUND_OPEN",
  "NOT_FLAGGED",
  "PAYMENT_VERIFYING",
  "REFUND_AMOUNT_INVALID",
  "WALLET_REFUND_AUTOMATIC",
  "WALLET_DISABLED",
  "ACCOUNT_CLOSING",
  "WALLET_BALANCE_INSUFFICIENT",
  "EXPORT_REPORT_UNKNOWN",
  "EXPORT_FORMAT_UNSUPPORTED",
  "EXPORT_TOO_LARGE",
  "EXPORT_PERIOD_TOO_LONG",
  "EXPORT_NOT_READY",
  "EXPORT_EXPIRED",
] as const;

/** PAIRED_ITEM_INVALID `details.reason`. */
export const PAIR_REASONS = ["not_found", "resolved", "reference_differs", "amount_differs", "wrong_kind"] as const;

const REFUND_STATES = ["requested", "processing", "succeeded", "failed"] as const;

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Money = (fils: number) => string;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function describeFinanceError(error: unknown, t: Translate, money: Money, fallback: (error: unknown) => string): string {
  if (!(error instanceof AdminApiError)) return fallback(error);
  const d = error.details;
  switch (error.code) {
    case "SETTLEMENT_FILE_TOO_LARGE": {
      const bytes = num(d.max_bytes);
      const lines = num(d.max_lines);
      return bytes !== null && lines !== null ? t("SETTLEMENT_FILE_TOO_LARGE", { size: formatBytes(bytes), lines }) : t("SETTLEMENT_FILE_TOO_LARGE_plain");
    }
    case "SETTLEMENT_DATE_MISMATCH":
      return typeof d.file_date === "string" ? t("SETTLEMENT_DATE_MISMATCH", { date: d.file_date }) : t("SETTLEMENT_DATE_MISMATCH_plain");
    case "OPEN_REFUND_EXISTS": {
      const refund = d.refund as { amount_fils?: unknown; status?: unknown } | undefined;
      const amount = num(refund?.amount_fils);
      const status = typeof refund?.status === "string" && (REFUND_STATES as readonly string[]).includes(refund.status) ? refund.status : null;
      return amount !== null && status !== null
        ? t("OPEN_REFUND_EXISTS", { amount: money(amount), status: t(`refundStatus.${status}`) })
        : t("OPEN_REFUND_EXISTS_plain");
    }
    case "PAIRED_ITEM_INVALID": {
      const reason = typeof d.reason === "string" && (PAIR_REASONS as readonly string[]).includes(d.reason) ? d.reason : null;
      return reason ? t(`PAIRED_ITEM_INVALID_${reason}`) : t("PAIRED_ITEM_INVALID");
    }
    case "REFUND_AMOUNT_INVALID": {
      const left = num(d.refundable_fils);
      return left !== null ? t("REFUND_AMOUNT_INVALID", { max: money(left) }) : t("REFUND_AMOUNT_INVALID_plain");
    }
    case "WALLET_BALANCE_INSUFFICIENT": {
      const balance = num(d.balance_fils);
      return balance !== null ? t("WALLET_BALANCE_INSUFFICIENT", { balance: money(balance) }) : t("WALLET_BALANCE_INSUFFICIENT_plain");
    }
    case "EXPORT_TOO_LARGE": {
      const max = num(d.max_rows);
      const base = max !== null ? t("EXPORT_TOO_LARGE", { max: new Intl.NumberFormat("en-US").format(max) }) : t("EXPORT_TOO_LARGE_plain");
      return d.hint === "csv" ? `${base} ${t("EXPORT_TOO_LARGE_csv")}` : base;
    }
    case "EXPORT_PERIOD_TOO_LONG": {
      const days = num(d.max_days);
      return days !== null ? t("EXPORT_PERIOD_TOO_LONG", { days }) : t("EXPORT_PERIOD_TOO_LONG_plain");
    }
    default:
      return (FINANCE_ERROR_CODES as readonly string[]).includes(error.code) ? t(error.code) : fallback(error);
  }
}

/** `(error) => text` for the Phase 5 finance routes; anything else reads as every other admin error. */
export function useFinanceError(): (error: unknown) => string {
  const t = useTranslations("admin.finance.errors");
  const shared = useTranslations("admin.errors");
  const locale = useLocale();
  return useCallback(
    (error: unknown) =>
      describeFinanceError(
        error,
        t as unknown as Translate,
        (fils) => formatAed(fils, locale, { fixed: true }),
        (e) => describeAdminError(e, shared as unknown as Translate),
      ),
    [t, shared, locale],
  );
}
