"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { AdminApiError } from "../client";
import { describeAdminError } from "../errors";

/*
 * The error codes of the A07 routes (contracts A4a §3, A4b §3) in our own words, Arabic and English, with the figures the
 * API names in `details` put in. Codes that are not here (and the shared ones such as STALE_VERSION, FORBIDDEN,
 * RATE_LIMITED) fall back to admin.errors.*. Every code listed has a message in both languages (customers-messages.test.ts).
 */
export const CUSTOMER_ERROR_CODES = [
  "INVALID_STATE",
  "ALREADY_OPTED_OUT",
  "PRIVACY_REQUEST_OPEN",
  "DELETION_BLOCKED",
  "VERIFICATION_REQUIRED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_LOCKED",
  "OTP_ATTEMPTS_EXCEEDED",
  "OTP_RESEND_TOO_SOON",
  "ERASURE_STARTED",
] as const;

/** INVALID_STATE `details.status`: the customer's status the action does not fit. */
export const INVALID_STATES = ["active", "blocked", "pending_deletion", "deleted"] as const;
/** VERIFICATION_REQUIRED `details.required`. */
export const REQUIRED_PROOFS = ["otp_code", "verification_note"] as const;

type Translate = (key: string, values?: Record<string, string | number>) => string;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function describeCustomerError(error: unknown, t: Translate, fallback: (error: unknown) => string): string {
  if (!(error instanceof AdminApiError)) return fallback(error);
  const d = error.details;
  switch (error.code) {
    case "INVALID_STATE": {
      const status = typeof d.status === "string" && (INVALID_STATES as readonly string[]).includes(d.status) ? d.status : null;
      return status ? t(`invalidState.${status}`) : t("INVALID_STATE");
    }
    case "VERIFICATION_REQUIRED": {
      const proof = typeof d.required === "string" && (REQUIRED_PROOFS as readonly string[]).includes(d.required) ? d.required : null;
      return proof ? t(`verificationRequired.${proof}`) : t("VERIFICATION_REQUIRED");
    }
    case "OTP_INVALID": {
      const left = num(d.attempts_left);
      return left !== null ? t("OTP_INVALID_left", { count: left }) : t("OTP_INVALID");
    }
    case "ERASURE_STARTED":
      return t("ERASURE_STARTED");
    default:
      return (CUSTOMER_ERROR_CODES as readonly string[]).includes(error.code) ? t(error.code) : fallback(error);
  }
}

/** `(error) => text` for the A07 routes; anything else reads as every other admin error. */
export function useCustomerError(): (error: unknown) => string {
  const t = useTranslations("admin.customers.errors");
  const shared = useTranslations("admin.errors");
  return useCallback(
    (error: unknown) => describeCustomerError(error, t as unknown as Translate, (e) => describeAdminError(e, shared as unknown as Translate)),
    [t, shared],
  );
}

/** Whether the answer says the record is not the version the person was looking at. */
export function isStale(error: unknown): boolean {
  return error instanceof AdminApiError && error.code === "STALE_VERSION";
}
