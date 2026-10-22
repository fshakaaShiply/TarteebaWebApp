"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ButtonLink, Card, ErrorState, LoadingBlock, PageHeader, StatusBadge, TabPanel, Tabs } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { fetchWorker } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import { RequirePermission } from "../../../_components/RequirePermission";
import { useZoneName } from "../../_ops/options";
import { employmentTone, useOpsText } from "../../_ops/opsText";
import { WorkerInfoTab } from "./WorkerInfoTab";
import { WorkerLeavesTab } from "./WorkerLeavesTab";
import { WorkerScheduleTab } from "./WorkerScheduleTab";
import { WorkerServicesTab } from "./WorkerServicesTab";

const TABS_ID = "a05-worker";
const TABS = ["info", "schedule", "services", "leaves"] as const;
type Tab = (typeof TABS)[number];

export function WorkerDetailScreen({ id, initialTab }: { id: string; initialTab?: string }) {
  return (
    <RequirePermission anyOf={["workers.view"]}>
      <WorkerDetail
        id={/^\d+$/.test(id) ? Number(id) : null}
        initialTab={(TABS as readonly string[]).includes(initialTab ?? "") ? (initialTab as Tab) : "info"}
      />
    </RequirePermission>
  );
}

function BackLink() {
  const t = useTranslations("admin.workers.detail");
  return (
    <ButtonLink
      href="/admin/workers"
      variant="ghost"
      size="sm"
      className="self-start"
      icon={<ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />}
    >
      {t("back")}
    </ButtonLink>
  );
}

function WorkerDetail({ id, initialTab }: { id: number | null; initialTab: Tab }) {
  const t = useTranslations("admin.workers.detail");
  const text = useOpsText();
  const zoneName = useZoneName();
  const [tab, setTab] = useState<Tab>(initialTab);
  // Panels mount on first visit and stay mounted (hidden), so unsaved edits survive a tab switch.
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set([initialTab]));
  const selectTab = (value: string) => {
    const next = value as Tab;
    setTab(next);
    setVisited((previous) => (previous.has(next) ? previous : new Set(previous).add(next)));
  };
  const query = useQuery({ queryKey: adminKeys.worker(id ?? 0), queryFn: () => fetchWorker(id as number), enabled: id !== null });

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

  const worker = query.data;
  const panel = (value: Tab) => {
    switch (value) {
      case "info":
        return <WorkerInfoTab worker={worker} />;
      case "schedule":
        return <WorkerScheduleTab worker={worker} />;
      case "services":
        return <WorkerServicesTab worker={worker} />;
      case "leaves":
        return <WorkerLeavesTab worker={worker} />;
    }
  };

  return (
    <>
      <BackLink />
      <PageHeader
        title={worker.display_name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{text.name(worker.full_name)}</span>
            <span aria-hidden>·</span>
            <bdi dir="ltr" className="font-latin">
              {worker.employee_no}
            </bdi>
            <span aria-hidden>·</span>
            <span>{zoneName(worker.home_zone_id, worker.home_zone && text.name(worker.home_zone.name))}</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={employmentTone[worker.employment_status] ?? "neutral"}>{text.employmentStatus(worker.employment_status)}</StatusBadge>
            {worker.on_leave_until && <StatusBadge tone="pending">{t("onLeaveUntil", { date: text.dateShort(worker.on_leave_until) })}</StatusBadge>}
            {worker.can_live_out && <StatusBadge tone="confirmed">{t("liveOut")}</StatusBadge>}
          </div>
        }
      />
      <Tabs
        id={TABS_ID}
        label={t("tabsLabel")}
        value={tab}
        onValueChange={selectTab}
        items={TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
      />
      {TABS.filter((value) => visited.has(value)).map((value) => (
        <TabPanel key={value} id={TABS_ID} value={value} hidden={value !== tab} className="flex flex-col gap-5">
          {panel(value)}
        </TabPanel>
      ))}
    </>
  );
}
