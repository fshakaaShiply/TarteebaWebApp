"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  ButtonLink,
  Button,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  LtrText,
  PageHeader,
  Select,
  StatusBadge,
  type Column,
} from "@/components/admin";
import { fetchPublicServices, fetchServices } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { SERVICE_KINDS } from "@/lib/admin/catalog/forms";
import type { CatalogService, PublicService } from "@/lib/admin/types";
import { formatAed } from "@/lib/money";
import { RequirePermission } from "../../../_components/RequirePermission";
import { ActiveBadge } from "../_components/CatalogFields";
import { useCatalogText } from "../_components/catalogText";
import { CreateServiceDialog } from "./CreateServiceDialog";

const PER_PAGE = 25;

/** A11 services & prices (spec §17; design AdminSettings.dc.html, "Services" tab). */
export function ServicesScreen() {
  const t = useTranslations("admin.catalog.services");
  const [creating, setCreating] = useState(false);
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
      <ServicesTable />
      {creating && <CreateServiceDialog onClose={() => setCreating(false)} />}
    </RequirePermission>
  );
}

function ServicesTable() {
  const t = useTranslations("admin.catalog.services");
  const text = useCatalogText();
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: adminKeys.serviceList({ page, perPage: PER_PAGE, kind, active: status }),
    queryFn: () =>
      fetchServices({ page, perPage: PER_PAGE, kind, isActive: status === "" ? undefined : status === "active" }),
    placeholderData: keepPreviousData,
  });
  // What customers see now: the "from" price of active, bookable-online services (P1-03).
  const publicServices = useQuery({ queryKey: adminKeys.publicServices(), queryFn: fetchPublicServices });
  const byCode = new Map((publicServices.data ?? []).map((s) => [s.code, s]));

  const columns: Column<CatalogService>[] = [
    {
      id: "service",
      header: t("columns.service"),
      cell: (s) => (
        <div className="flex flex-col">
          <span className="font-bold text-ink-900">{text.name(s.name)}</span>
          <LtrText className="text-xs text-ink-600">{s.code}</LtrText>
        </div>
      ),
    },
    { id: "kind", header: t("columns.kind"), cell: (s) => text.kind(s.kind) },
    { id: "duration", header: t("columns.duration"), cell: (s) => text.duration(s.duration_minutes) },
    {
      id: "workers",
      header: t("columns.workers"),
      cell: (s) => (
        <bdi dir="ltr" className="font-latin">
          {s.min_workers === s.max_workers ? s.min_workers : `${s.min_workers}–${s.max_workers}`}
        </bdi>
      ),
    },
    {
      id: "price",
      header: t("columns.priceFrom"),
      cell: (s) =>
        publicServices.isError ? (
          <span className="text-ink-600" title={t("priceUnavailable")}>
            —
          </span>
        ) : (
          <PriceFrom service={s} published={byCode.get(s.code)} loading={publicServices.isPending} />
        ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (s) => (
        <div className="flex flex-wrap gap-1.5">
          <ActiveBadge active={s.is_active} />
          {!s.is_bookable_online && <StatusBadge tone="neutral">{t("notOnline")}</StatusBadge>}
        </div>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (s) => (
        <ButtonLink
          href={`/admin/catalog/services/${s.id}`}
          variant="ghost"
          size="sm"
          aria-label={t("openLabel", { name: text.name(s.name) })}
        >
          {t("open")}
        </ButtonLink>
      ),
    },
  ];

  const filtered = kind !== "" || status !== "";

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          setKind("");
          setStatus("");
          setPage(1);
        }}
      >
        <Select
          label={t("filters.kind")}
          placeholder={t("filters.allKinds")}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
          options={SERVICE_KINDS.map((k) => ({ value: k, label: text.kind(k) }))}
          containerClassName="min-w-[200px]"
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
        getRowId={(s) => s.id}
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

/** The public "from" price (gross, VAT included), or why customers see none. */
function PriceFrom({ service, published, loading }: { service: CatalogService; published?: PublicService; loading: boolean }) {
  const t = useTranslations("admin.catalog.services");
  const text = useCatalogText();
  const locale = useLocale();
  if (loading) return <span className="text-ink-600">…</span>;
  if (!published) {
    return <span className="text-sm text-ink-600">{service.is_active && service.is_bookable_online ? "—" : t("notListed")}</span>;
  }
  if (published.price_from_fils === null || published.price_unit === null) {
    return <StatusBadge tone="pending">{t("notPriced")}</StatusBadge>;
  }
  return (
    <div className="flex flex-col">
      <span className="font-medium text-ink-900">{formatAed(published.price_from_fils, locale)}</span>
      <span className="text-xs text-ink-600">
        {text.unit(published.price_unit)} · {t("vatIncluded")}
      </span>
    </div>
  );
}
