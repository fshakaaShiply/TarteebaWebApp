"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, DataTable, EmptyState, FilterBar, PageHeader, Select, type Column } from "@/components/admin";
import { fetchPackages } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { CatalogPackage } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useCatalogText, useServiceOptions } from "../_components/catalogText";
import { useOfferColumns } from "../_components/offerColumns";
import { PackageEditor } from "./PackageEditor";

const PER_PAGE = 25;

/** A11 recurring packages (spec §6.3, REQ §4.4; design AdminSettings.dc.html "Packages" tab). */
export function PackagesScreen() {
  const t = useTranslations("admin.catalog.packages");
  const [editing, setEditing] = useState<CatalogPackage | "new" | null>(null);
  return (
    <RequirePermission anyOf={["catalog.manage"]}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
            {t("create")}
          </Button>
        }
      />
      <PackagesTable onEdit={setEditing} />
      {editing && <PackageEditor pkg={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

function PackagesTable({ onEdit }: { onEdit: (pkg: CatalogPackage) => void }) {
  const t = useTranslations("admin.catalog.packages");
  const text = useCatalogText();
  const services = useServiceOptions();
  const { packageColumns, name } = useOfferColumns();
  const [serviceId, setServiceId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: adminKeys.packageList({ page, perPage: PER_PAGE, serviceId, active: status }),
    queryFn: () =>
      fetchPackages({
        page,
        perPage: PER_PAGE,
        serviceId: serviceId ? Number(serviceId) : undefined,
        isActive: status === "" ? undefined : status === "active",
      }),
    placeholderData: keepPreviousData,
  });

  const serviceName = (id: number) => {
    const s = services.data?.find((x) => x.id === id);
    return s ? text.name(s.name) : `#${id}`;
  };

  const columns: Column<CatalogPackage>[] = [
    packageColumns[0],
    { id: "service", header: t("columns.service"), cell: (p) => serviceName(p.service_id) },
    ...packageColumns.slice(1),
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (p) => (
        <Button variant="ghost" size="sm" onClick={() => onEdit(p)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { name: name(p.name) })}>
          {t("edit")}
        </Button>
      ),
    },
  ];

  const filtered = serviceId !== "" || status !== "";

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setServiceId("");
          setStatus("");
          setPage(1);
        }}
      >
        <Select
          label={t("filters.service")}
          placeholder={t("filters.allServices")}
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setPage(1);
          }}
          options={(services.data ?? [])
            .filter((s) => s.kind === "standard_visit")
            .map((s) => ({ value: String(s.id), label: text.name(s.name) }))}
          containerClassName="min-w-[220px]"
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
        getRowId={(p) => p.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={filtered ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
      />
    </Card>
  );
}
