"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  ButtonLink,
  Card,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatusBadge,
  TabPanel,
  Tabs,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { fetchService } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { RequirePermission } from "../../../../_components/RequirePermission";
import { ActiveBadge } from "../../_components/CatalogFields";
import { useCatalogText } from "../../_components/catalogText";
import { ServiceGeneralForm } from "./ServiceGeneralForm";
import { ServicePackagesPanel, ServicePlansPanel } from "./ServiceOffersPanels";
import { ServicePricesPanel } from "./ServicePricesPanel";

const TABS_ID = "a11-service";

export function ServiceDetailScreen({ id }: { id: string }) {
  return (
    <RequirePermission anyOf={["catalog.manage"]}>
      <ServiceDetail id={/^\d+$/.test(id) ? Number(id) : null} />
    </RequirePermission>
  );
}

function BackLink() {
  const t = useTranslations("admin.catalog.serviceDetail");
  return (
    <ButtonLink
      href="/admin/catalog/services"
      variant="ghost"
      size="sm"
      className="self-start"
      icon={<ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />}
    >
      {t("back")}
    </ButtonLink>
  );
}

function ServiceDetail({ id }: { id: number | null }) {
  const t = useTranslations("admin.catalog.serviceDetail");
  const text = useCatalogText();
  const [tab, setTab] = useState("general");
  // Panels mount on first visit and then stay mounted (hidden), so unsaved General edits survive a tab switch.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set(["general"]));
  const selectTab = (value: string) => {
    setTab(value);
    setVisited((previous) => (previous.has(value) ? previous : new Set(previous).add(value)));
  };
  const query = useQuery({
    queryKey: adminKeys.service(id ?? 0),
    queryFn: () => fetchService(id as number),
    enabled: id !== null,
  });

  if (id === null) {
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState error={new AdminApiError(404, { code: "NOT_FOUND", message: "", details: {} })} />
        </Card>
      </>
    );
  }
  if (query.isPending) {
    return (
      <>
        <BackLink />
        <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </>
    );
  }

  const service = query.data;
  const offersTab =
    service.kind === "standard_visit"
      ? { value: "packages", label: t("tabs.packages") }
      : service.kind === "live_out"
        ? { value: "plans", label: t("tabs.plans") }
        : null;
  const tabs = [{ value: "general", label: t("tabs.general") }, { value: "prices", label: t("tabs.prices") }, ...(offersTab ? [offersTab] : [])];
  const panel = (value: string) => {
    switch (value) {
      case "general":
        // Remount with fresh values after every save (new version).
        return <ServiceGeneralForm key={service.version} service={service} onReload={() => void query.refetch()} />;
      case "prices":
        return <ServicePricesPanel service={service} onReload={() => void query.refetch()} />;
      case "packages":
        return <ServicePackagesPanel service={service} />;
      case "plans":
        return <ServicePlansPanel service={service} />;
      default:
        return null;
    }
  };

  return (
    <>
      <BackLink />
      <PageHeader
        title={text.name(service.name)}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <bdi dir="ltr" className="font-latin">
              {service.code}
            </bdi>
            <span aria-hidden>·</span>
            {text.kind(service.kind)}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-1.5">
            <ActiveBadge active={service.is_active} />
            {!service.is_bookable_online && <StatusBadge tone="neutral">{t("notOnline")}</StatusBadge>}
          </div>
        }
      />
      <Tabs id={TABS_ID} label={t("tabsLabel")} value={tab} onValueChange={selectTab} items={tabs} />
      {tabs
        .filter((item) => visited.has(item.value))
        .map((item) => (
          <TabPanel key={item.value} id={TABS_ID} value={item.value} hidden={item.value !== tab} className="flex flex-col gap-5">
            {panel(item.value)}
          </TabPanel>
        ))}
    </>
  );
}
