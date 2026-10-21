"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Card, DataTable, EmptyState, FilterBar, Notice, PageHeader, Select, type Column } from "@/components/admin";
import { fetchLiveOutPlans } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import type { LiveOutPlan } from "@/lib/admin/types";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useCatalogText, useServiceOptions } from "../_components/catalogText";
import { useOfferColumns } from "../_components/offerColumns";
import { PlanEditor } from "./PlanEditor";

const PER_PAGE = 25;

/** A11 Live-out (full day) plans (spec §6.3, §11.3; design AdminSettings.dc.html "Live-out" tab). */
export function LiveOutPlansScreen() {
  const t = useTranslations("admin.catalog.liveOut");
  const [editing, setEditing] = useState<LiveOutPlan | "new" | null>(null);
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
      <PlansTable onEdit={setEditing} />
      {editing && <PlanEditor plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </RequirePermission>
  );
}

function PlansTable({ onEdit }: { onEdit: (plan: LiveOutPlan) => void }) {
  const t = useTranslations("admin.catalog.liveOut");
  const text = useCatalogText();
  const services = useServiceOptions();
  const { planColumns, name } = useOfferColumns();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: adminKeys.liveOutPlanList({ page, perPage: PER_PAGE, active: status }),
    queryFn: () => fetchLiveOutPlans({ page, perPage: PER_PAGE, isActive: status === "" ? undefined : status === "active" }),
    placeholderData: keepPreviousData,
  });

  const serviceName = (id: number) => {
    const s = services.data?.find((x) => x.id === id);
    return s ? text.name(s.name) : `#${id}`;
  };

  const columns: Column<LiveOutPlan>[] = [
    planColumns[0],
    { id: "service", header: t("columns.service"), cell: (p) => serviceName(p.service_id) },
    ...planColumns.slice(1),
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

  const unpriced = (list.data?.data ?? []).some((p) => p.price_fils === null);

  return (
    <Card>
      {unpriced && <Notice tone="warning">{t("unpricedListNotice")}</Notice>}
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
        getRowId={(p) => p.id}
        loading={list.isPending}
        fetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={status ? t("noMatches") : t("empty")} />}
        pagination={list.data ? { meta: list.data.meta, onPageChange: setPage } : undefined}
        minWidth={880}
      />
    </Card>
  );
}
