"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  LtrText,
  PageHeader,
  SearchField,
  Select,
  StatusBadge,
  TabPanel,
  Tabs,
  type Column,
} from "@/components/admin";
import { fetchStaffUsers } from "@/lib/admin/endpoints";
import { formatDateTime } from "@/lib/admin/format";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { adminKeys } from "@/lib/admin/keys";
import type { StaffUser } from "@/lib/admin/types";
import { RequirePermission } from "../../_components/RequirePermission";
import { InviteUserDialog } from "./InviteUserDialog";
import { RolesPanel } from "./RolesPanel";
import { UserDrawer } from "./UserDrawer";
import { UserStatusBadge, useRoleName, useRoles } from "./shared";

const PER_PAGE = 25;
const TABS_ID = "a13";

export function UsersScreen() {
  const t = useTranslations("admin.users");
  const [tab, setTab] = useState("users");
  const [inviting, setInviting] = useState(false);

  return (
    <RequirePermission anyOf={["users.manage"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setInviting(true)} icon={<UserPlus aria-hidden className="size-4" />}>
            {t("invite")}
          </Button>
        }
      />
      <Tabs
        id={TABS_ID}
        label={t("tabsLabel")}
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "users", label: t("tabs.users") },
          { value: "roles", label: t("tabs.roles") },
        ]}
      />
      <TabPanel id={TABS_ID} value={tab}>
        {tab === "users" ? <UsersTab /> : <RolesPanel />}
      </TabPanel>
      {inviting && <InviteUserDialog onClose={() => setInviting(false)} />}
    </RequirePermission>
  );
}

function UsersTab() {
  const t = useTranslations("admin.users");
  const locale = useLocale();
  const roleName = useRoleName();
  const roles = useRoles();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<StaffUser | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const filters = { search: debouncedSearch, role, status, page, perPage: PER_PAGE };
  const list = useQuery({
    queryKey: adminKeys.staffUserList(filters),
    queryFn: () =>
      fetchStaffUsers({
        search: debouncedSearch,
        role,
        status: status === "active" || status === "suspended" ? status : undefined,
        page,
        perPage: PER_PAGE,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<StaffUser>[] = [
    {
      id: "name",
      header: t("columns.name"),
      cell: (u) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{u.name}</span>
          <LtrText className="text-xs text-ink-600">{u.email}</LtrText>
        </div>
      ),
    },
    {
      id: "roles",
      header: t("columns.roles"),
      cell: (u) => (u.roles.length ? u.roles.map(roleName).join(t("listSeparator")) : <span className="text-ink-600">—</span>),
    },
    {
      id: "2fa",
      header: t("columns.twoFactor"),
      cell: (u) =>
        u.two_factor_enabled ? (
          <StatusBadge tone="success">{t("twoFactorOn")}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">{t("twoFactorOff")}</StatusBadge>
        ),
    },
    {
      id: "lastLogin",
      header: t("columns.lastLogin"),
      cell: (u) => (u.last_login_at ? formatDateTime(u.last_login_at, locale) : <span className="text-ink-600">{t("never")}</span>),
    },
    { id: "status", header: t("columns.status"), cell: (u) => <UserStatusBadge user={u} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (u) => (
        <Button variant="ghost" size="sm" onClick={() => setSelected(u)} aria-label={t("manageLabel", { name: u.name })}>
          {t("manage")}
        </Button>
      ),
    },
  ];

  const filtered = search !== "" || role !== "" || status !== "";

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setSearch("");
          setRole("");
          setStatus("");
          setPage(1);
        }}
      >
        <SearchField
          label={t("search")}
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <Select
          label={t("filters.role")}
          placeholder={t("filters.allRoles")}
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          options={(roles.data ?? []).map((r) => ({ value: r.name, label: roleName(r.name) }))}
          containerClassName="min-w-[180px]"
        />
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "active", label: t("status.active") },
            { value: "suspended", label: t("status.suspended") },
          ]}
          containerClassName="min-w-[160px]"
        />
      </FilterBar>

      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(u) => u.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
      />

      {selected && <UserDrawer initial={selected} onClose={() => setSelected(null)} />}
    </Card>
  );
}
