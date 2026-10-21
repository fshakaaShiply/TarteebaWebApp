"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MapPinned, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  LtrText,
  Notice,
  PageHeader,
  Select,
  type Column,
} from "@/components/admin";
import { fetchZones } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { Zone } from "@/lib/admin/types";
import { RequirePermission } from "../../_components/RequirePermission";
import { ActiveBadge } from "../catalog/_components/CatalogFields";
import { useCatalogText } from "../catalog/_components/catalogText";
import { CreateZoneDialog, ZoneDrawer } from "./ZoneEditor";

const PER_PAGE = 25;

/** A11 service zones and sub-zones (spec §6.2, §17; permission catalog.manage, P1-05; demo zones P1-07). */
export function ZonesScreen() {
  const t = useTranslations("admin.zones");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Zone | null>(null);
  return (
    <RequirePermission anyOf={["catalog.manage"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setCreating(true)} icon={<Plus aria-hidden className="size-4" />}>
            {t("create")}
          </Button>
        }
      />
      <ZonesTable onEdit={setEditing} />
      {creating && (
        <CreateZoneDialog
          onClose={() => setCreating(false)}
          onCreated={(zone) => {
            setCreating(false);
            setEditing(zone);
          }}
        />
      )}
      {editing && <ZoneDrawer initial={editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

function ZonesTable({ onEdit }: { onEdit: (zone: Zone) => void }) {
  const t = useTranslations("admin.zones");
  const text = useCatalogText();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: adminKeys.zoneList({ page, perPage: PER_PAGE, active: status }),
    queryFn: () => fetchZones({ page, perPage: PER_PAGE, isActive: status === "" ? undefined : status === "active" }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Zone>[] = [
    {
      id: "zone",
      header: t("columns.zone"),
      cell: (z) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{text.name(z.name)}</span>
          <LtrText className="text-xs text-ink-600">{z.code}</LtrText>
        </div>
      ),
    },
    {
      id: "subZones",
      header: t("columns.subZones"),
      cell: (z) =>
        z.sub_zones && z.sub_zones.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-sm">
            {z.sub_zones.map((s) => (
              <li key={s.id} className={s.is_active ? "text-ink-900" : "text-ink-600 line-through"}>
                {text.name(s.name)}{" "}
                <span className="text-xs text-ink-600">{t("addressesShort", { count: s.active_addresses_count ?? 0 })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-sm text-ink-600">{t("noSubZones")}</span>
        ),
    },
    {
      id: "addresses",
      header: t("columns.addresses"),
      cell: (z) => <span className="font-latin">{z.active_addresses_count ?? 0}</span>,
    },
    {
      id: "buffer",
      header: t("columns.travelBuffer"),
      cell: (z) =>
        z.default_travel_buffer_min === null ? (
          <span className="text-sm text-ink-600">{t("bufferDefault")}</span>
        ) : (
          t("minutes", { count: z.default_travel_buffer_min })
        ),
    },
    { id: "order", header: t("columns.order"), cell: (z) => <span className="font-latin">{z.sort_order}</span> },
    { id: "status", header: t("columns.status"), cell: (z) => <ActiveBadge active={z.is_active} /> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (z) => (
        <Button variant="ghost" size="sm" onClick={() => onEdit(z)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { name: text.name(z.name) })}>
          {t("edit")}
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <Notice tone="info" title={t("mapNoteTitle")}>
        <span className="inline-flex items-start gap-1.5">
          <MapPinned aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("mapNote")}
        </span>
      </Notice>
      <FilterBar
        canReset={status !== ""}
        onReset={() => {
          setStatus("");
          setPage(1);
        }}
      >
        <Select
          label={t("filters.status")}
          placeholder={t("filters.allStatuses")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: "active", label: t("filters.active") },
            { value: "inactive", label: t("filters.inactive") },
          ]}
          containerClassName="min-w-[160px]"
        />
      </FilterBar>
      <DataTable
        caption={t("tableCaption")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(z) => z.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={status ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={820}
      />
    </Card>
  );
}
