"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { StatusBadge } from "@/components/admin";
import { fetchRoles } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { StaffUser } from "@/lib/admin/types";
import { useRoleLabel } from "../../_components/roleLabel";

export function useRoles() {
  return useQuery({ queryKey: adminKeys.roles(), queryFn: fetchRoles, staleTime: 5 * 60_000 });
}

/** Role name → label: the API's localized label when loaded, else our seeded-role labels, else the name. */
export function useRoleName() {
  const roles = useRoles();
  const roleLabel = useRoleLabel();
  return useCallback(
    (name: string) => roleLabel(name, roles.data?.find((r) => r.name === name)?.label),
    [roleLabel, roles.data],
  );
}

export function isLocked(user: Pick<StaffUser, "locked_until">, now = Date.now()): boolean {
  return user.locked_until !== null && new Date(user.locked_until).getTime() > now;
}

export function UserStatusBadge({ user }: { user: StaffUser }) {
  const t = useTranslations("admin.users.status");
  if (user.status === "suspended") return <StatusBadge tone="danger">{t("suspended")}</StatusBadge>;
  if (isLocked(user)) return <StatusBadge tone="pending">{t("locked")}</StatusBadge>;
  if (user.status === "active") return <StatusBadge tone="success">{t("active")}</StatusBadge>;
  return <StatusBadge tone="neutral">{user.status}</StatusBadge>;
}
