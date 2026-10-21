"use client";

import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ButtonLink, Card, DataTable, EmptyState } from "@/components/admin";
import type { CatalogPackage, CatalogService, LiveOutPlan } from "@/lib/admin/types";
import { useOfferColumns } from "../../_components/offerColumns";
import { PlanEditor } from "../../live-out/PlanEditor";
import { PackageEditor } from "../../packages/PackageEditor";

/** Packages tab of a standard-visit service (the same editor as the Packages page, with the service fixed). */
export function ServicePackagesPanel({ service }: { service: CatalogService }) {
  const t = useTranslations("admin.catalog.packages");
  const columns = useOfferColumns();
  const [editing, setEditing] = useState<CatalogPackage | "new" | null>(null);
  return (
    <Card
      title={t("serviceTabTitle")}
      actions={
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/admin/catalog/packages" variant="ghost" size="sm">
            {t("openPage")}
          </ButtonLink>
          <Button onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
            {t("create")}
          </Button>
        </div>
      }
    >
      <DataTable
        caption={t("tableCaption")}
        columns={[
          ...columns.packageColumns,
          {
            id: "actions",
            header: <span className="sr-only">{t("columns.actions")}</span>,
            className: "text-end",
            cell: (p: CatalogPackage) => (
              <Button variant="ghost" size="sm" onClick={() => setEditing(p)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { name: columns.name(p.name) })}>
                {t("edit")}
              </Button>
            ),
          },
        ]}
        rows={service.packages ?? []}
        getRowId={(p) => p.id}
        empty={<EmptyState title={t("empty")} />}
      />
      {editing && (
        <PackageEditor pkg={editing === "new" ? null : editing} serviceId={service.id} onClose={() => setEditing(null)} />
      )}
    </Card>
  );
}

/** Live-out plans tab of a live-out service. */
export function ServicePlansPanel({ service }: { service: CatalogService }) {
  const t = useTranslations("admin.catalog.liveOut");
  const columns = useOfferColumns();
  const [editing, setEditing] = useState<LiveOutPlan | "new" | null>(null);
  return (
    <Card
      title={t("serviceTabTitle")}
      actions={
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/admin/catalog/live-out" variant="ghost" size="sm">
            {t("openPage")}
          </ButtonLink>
          <Button onClick={() => setEditing("new")} icon={<Plus aria-hidden className="size-4" />}>
            {t("create")}
          </Button>
        </div>
      }
    >
      <DataTable
        caption={t("tableCaption")}
        columns={[
          ...columns.planColumns,
          {
            id: "actions",
            header: <span className="sr-only">{t("columns.actions")}</span>,
            className: "text-end",
            cell: (p: LiveOutPlan) => (
              <Button variant="ghost" size="sm" onClick={() => setEditing(p)} icon={<Pencil aria-hidden className="size-4" />} aria-label={t("editLabel", { name: columns.name(p.name) })}>
                {t("edit")}
              </Button>
            ),
          },
        ]}
        rows={service.live_out_plans ?? []}
        getRowId={(p) => p.id}
        empty={<EmptyState title={t("empty")} />}
      />
      {editing && <PlanEditor plan={editing === "new" ? null : editing} serviceId={service.id} onClose={() => setEditing(null)} />}
    </Card>
  );
}
