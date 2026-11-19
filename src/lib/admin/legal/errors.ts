"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { AdminApiError } from "../client";
import { describeAdminError } from "../errors";

/*
 * The error codes of the A11 content routes (contract A4a §3) in our own words, with the figures the API names put in.
 * The shared ones (STALE_VERSION, FORBIDDEN, RATE_LIMITED) fall back to admin.errors.*. Every code listed has a message
 * in both languages (customers-messages.test.ts).
 */
export const LEGAL_ERROR_CODES = ["SLUG_UNKNOWN", "VERSION_LABEL_TAKEN", "PAGE_NOT_EDITABLE", "PAGE_FIGURES_NOT_ALLOWED", "PLACEHOLDER_UNKNOWN", "FAQ_LIMIT_REACHED", "ORDER_INCOMPLETE"] as const;

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function describeLegalError(error: unknown, t: Translate, fallback: (error: unknown) => string): string {
  if (!(error instanceof AdminApiError)) return fallback(error);
  const d = error.details;
  switch (error.code) {
    case "VERSION_LABEL_TAKEN":
      return typeof d.version_label === "string" ? t("VERSION_LABEL_TAKEN", { label: d.version_label }) : t("VERSION_LABEL_TAKEN_plain");
    case "PLACEHOLDER_UNKNOWN":
      return typeof d.placeholder === "string" ? t("PLACEHOLDER_UNKNOWN", { placeholder: d.placeholder }) : t("PLACEHOLDER_UNKNOWN_plain");
    case "FAQ_LIMIT_REACHED":
      return typeof d.max === "number" ? t("FAQ_LIMIT_REACHED", { max: d.max }) : t("FAQ_LIMIT_REACHED_plain");
    default:
      return (LEGAL_ERROR_CODES as readonly string[]).includes(error.code) ? t(error.code) : fallback(error);
  }
}

export function useLegalError(): (error: unknown) => string {
  const t = useTranslations("admin.legal.errors");
  const shared = useTranslations("admin.errors");
  return useCallback((error: unknown) => describeLegalError(error, t as unknown as Translate, (e) => describeAdminError(e, shared as unknown as Translate)), [t, shared]);
}
