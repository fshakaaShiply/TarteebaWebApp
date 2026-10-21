"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useMemo } from "react";
import { Card, ErrorState, LoadingBlock, Notice, StatusBadge } from "@/components/admin";
import { fetchPermissions } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { Permission } from "@/lib/admin/types";
import { useRoleName, useRoles } from "./shared";

/**
 * A13 roles and their permissions as a read-only matrix (spec §5.1). Permission labels come from the API in the
 * current language; editing permissions is a later step (PUT /admin/roles/{name}/permissions exists).
 */
export function RolesPanel() {
  const t = useTranslations("admin.users");
  const roles = useRoles();
  const roleName = useRoleName();
  const permissions = useQuery({ queryKey: adminKeys.permissions(), queryFn: fetchPermissions, staleTime: 5 * 60_000 });

  const groups = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of permissions.data ?? []) {
      const list = map.get(p.group) ?? [];
      list.push(p);
      map.set(p.group, list);
    }
    return [...map.entries()];
  }, [permissions.data]);

  if (roles.isPending || permissions.isPending) return <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />;
  if (roles.isError || permissions.isError) {
    return (
      <Card>
        <ErrorState
          error={roles.error ?? permissions.error}
          onRetry={() => {
            void roles.refetch();
            void permissions.refetch();
          }}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Notice tone="neutral" role="none">
        {t("rolesReadOnly")}
      </Notice>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="sr-only">{t("rolesCaption")}</caption>
          <thead>
            <tr className="align-bottom text-ink-600">
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("permission")}
              </th>
              {roles.data.map((role) => (
                <th key={role.name} scope="col" className="px-2 py-2 text-center font-medium">
                  <div className="flex flex-col items-center gap-1">
                    <span className="font-bold text-ink-900">{roleName(role.name)}</span>
                    {typeof role.users_count === "number" && (
                      <span className="text-xs">{t("usersCount", { count: role.users_count })}</span>
                    )}
                    {role.is_system && <StatusBadge tone="confirmed">{t("systemRole")}</StatusBadge>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, items]) => (
              <Fragment key={group}>
                <tr className="border-t border-line bg-ivory-50">
                  <th scope="colgroup" colSpan={roles.data.length + 1} className="px-2 py-2 text-start font-bold text-ink-900">
                    {t.has(`permissionGroups.${group}`) ? t(`permissionGroups.${group}`) : group}
                  </th>
                </tr>
                {items.map((p) => (
                  <tr key={p.name} className="border-t border-line">
                    <th scope="row" className="px-2 py-2 text-start font-normal">
                      <span className="block text-ink-900">{p.label}</span>
                      <code dir="ltr" className="font-latin text-xs text-ink-600">
                        {p.name}
                      </code>
                    </th>
                    {roles.data.map((role) => {
                      const granted = role.permissions.includes(p.name);
                      return (
                        <td key={role.name} className="px-2 py-2 text-center">
                          {granted ? (
                            <Check role="img" aria-label={t("granted")} className="mx-auto block size-4.5 text-success-700" strokeWidth={2} />
                          ) : (
                            <Minus role="img" aria-label={t("notGranted")} className="mx-auto block size-4 text-line-strong" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
