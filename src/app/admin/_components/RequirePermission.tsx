"use client";

import type { ReactNode } from "react";
import { PermissionDenied } from "@/components/admin";
import { useAdminSession } from "@/lib/admin/session";

/**
 * Renders the page only for users holding any of `anyOf`; everyone else sees "you don't have access to this page"
 * (A01). This only avoids loading data the user cannot see: the API refuses it anyway (403).
 */
export function RequirePermission({ anyOf, children }: { anyOf: readonly string[]; children: ReactNode }) {
  const { canAny } = useAdminSession();
  return canAny(anyOf) ? <>{children}</> : <PermissionDenied className="rounded-lg bg-surface shadow-card" />;
}
