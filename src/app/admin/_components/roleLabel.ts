"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

/**
 * Seeded role names → our labels (admin.roles.*). Custom roles created in A13 keep their API label (pass it as
 * `fallback`) or their name.
 */
export function useRoleLabel(): (name: string, fallback?: string) => string {
  const t = useTranslations("admin.roles");
  return useCallback((name: string, fallback?: string) => (t.has(name) ? t(name) : (fallback ?? name)), [t]);
}
