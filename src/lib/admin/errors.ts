"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { AdminApiError } from "./client";
import { lockoutMinutes } from "./login-machine";

/*
 * API error codes → our own copy (admin.errors.*). Codes without an entry fall back to the API's message, which is
 * already in the request language (Accept-Language), then to a generic message.
 */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: "network",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "notFound",
  STALE_VERSION: "staleVersion",
  VALIDATION_FAILED: "validation",
  CSRF_MISMATCH: "csrf",
  UNAUTHENTICATED: "sessionEnded",
  SESSION_EXPIRED: "sessionEnded",
  TWO_FACTOR_SETUP_REQUIRED: "twoFactorSetupRequired",
  INVALID_CREDENTIALS: "invalidCredentials",
  INVALID_PASSWORD: "invalidPassword",
  TWO_FACTOR_INVALID: "twoFactorInvalid",
  TWO_FACTOR_REQUIRED_FOR_ROLE: "twoFactorRequiredForRole",
  TWO_FACTOR_ALREADY_ENABLED: "twoFactorAlreadyEnabled",
  TWO_FACTOR_NOT_STARTED: "twoFactorNotStarted",
  TWO_FACTOR_NOT_ENABLED: "twoFactorNotEnabled",
  LAST_SYSTEM_ADMIN: "lastSystemAdmin",
  CANNOT_SUSPEND_SELF: "cannotSuspendSelf",
  CANNOT_REMOVE_OWN_ADMIN: "cannotRemoveOwnAdmin",
  ROLE_IMMUTABLE: "roleImmutable",
  INVALID_SETTING_VALUE: "invalidSettingValue",
  UNKNOWN_SETTING: "unknownSetting",
  RESET_TOKEN_INVALID: "resetTokenInvalid",
  POLYGON_INVALID: "polygonInvalid",
  SUB_ZONE_OUTSIDE_ZONE: "subZoneOutsideZone",
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function describeAdminError(error: unknown, t: Translate): string {
  if (!(error instanceof AdminApiError)) return t("generic");
  if (error.code === "RATE_LIMITED") return t("rateLimited", { seconds: Math.max(1, error.retryAfterSeconds ?? 60) });
  if (error.code === "ACCOUNT_LOCKED") return t("accountLocked", { minutes: lockoutMinutes(error.retryAfterSeconds) });
  const key = CODE_MESSAGES[error.code];
  if (key) return t(key);
  if (error.status >= 500) return t("server");
  return error.message || t("generic");
}

/** `(error) => localized message`, for toasts and inline notices. */
export function useAdminErrorMessage(): (error: unknown) => string {
  const t = useTranslations("admin.errors");
  return useCallback((error: unknown) => describeAdminError(error, t as unknown as Translate), [t]);
}

/**
 * Puts VALIDATION_FAILED field messages (localized by the API) on the matching react-hook-form fields.
 * `fieldMap` maps API field names to form field names when they differ. The longest matching prefix of the API name
 * wins, so "name.ar" lands on a "name.ar" field when the form has one, and "roles.0" on "roles".
 * `prefix` reads nested errors such as the preview's "service.name.ar" (others are skipped).
 * Returns true when any field got an error.
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  fieldMap: Partial<Record<string, Path<T>>> = {},
  options: { prefix?: string } = {},
): boolean {
  if (!(error instanceof AdminApiError) || error.code !== "VALIDATION_FAILED") return false;
  let applied = false;
  const known = fields as readonly string[];
  for (const [rawField, messages] of Object.entries(error.fieldErrors)) {
    let apiField = rawField;
    if (options.prefix) {
      if (!rawField.startsWith(`${options.prefix}.`)) continue;
      apiField = rawField.slice(options.prefix.length + 1);
    }
    // Longest matching prefix wins: "applies_to.service_ids.3" → "applies_to.service_ids" → "applies_to".
    const parts = apiField.split(".");
    let target: string | undefined;
    for (let n = parts.length; n > 0 && !target; n--) {
      const candidate = parts.slice(0, n).join(".");
      target = fieldMap[candidate] ?? known.find((f) => f === candidate);
    }
    if (target && messages[0]) {
      setError(target as Path<T>, { type: "server", message: messages[0] });
      applied = true;
    }
  }
  return applied;
}

/** Every VALIDATION_FAILED message, for errors that have no field on screen (e.g. preview rows). */
export function allFieldMessages(error: unknown): string[] {
  if (!(error instanceof AdminApiError) || error.code !== "VALIDATION_FAILED") return [];
  return [...new Set(Object.values(error.fieldErrors).flat())];
}

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_LETTER = /[A-Za-z]/;

/**
 * An API field message when it is written in the UI language, else null. The API localizes validation messages from
 * Accept-Language, but a string it has no Arabic translation for comes back in English with the raw attribute name
 * ("The duration minutes field must be …"); Arabic screens then use our own copy. Same rule as the mobile app
 * (TarteebaMobileApp src/lib/api/errors.ts): Arabic needs Arabic script, English needs Latin letters.
 */
export function messageInLocale(message: string | null | undefined, locale: string): string | null {
  const text = message?.trim();
  if (!text) return null;
  if (locale === "ar") return ARABIC_LETTER.test(text) ? text : null;
  return LATIN_LETTER.test(text) ? text : null;
}

/** `(apiMessage, fallback) => text`: the API's field message in the UI language, otherwise our localized fallback. */
export function useServerFieldMessage(): (message: string | null | undefined, fallback: string) => string {
  const locale = useLocale();
  return useCallback((message, fallback) => messageInLocale(message, locale) ?? fallback, [locale]);
}
