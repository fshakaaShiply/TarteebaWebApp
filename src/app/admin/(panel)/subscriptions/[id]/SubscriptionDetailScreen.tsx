"use client";

import { useQuery } from "@tanstack/react-query";
import { Ban, CalendarX2, Check, ChevronRight, CreditCard, RefreshCw, Snowflake, SunMedium, Undo2, UserRoundCog, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button, Card, CustomerLink, EmptyState, ErrorState, LoadingBlock, TabPanel, Tabs, type TabItem } from "@/components/admin";
import { SUBSCRIPTIONS_PATH, SUBSCRIPTIONS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import { ACTION_ORDER, availableActions, renewalBusy, type SubscriptionAction } from "@/lib/admin/subscriptions/actions";
import { fetchSubscription } from "@/lib/admin/subscriptions/endpoints";
import type { SeriesMoveHandoff } from "@/lib/admin/subscriptions/handoff";
import { subscriptionKeys } from "@/lib/admin/subscriptions/keys";
import type { SubscriptionDetail } from "@/lib/admin/subscriptions/types";
import { useSubscriptionText } from "@/lib/admin/subscriptions/text";
import { RequirePermission } from "../../../_components/RequirePermission";
import { StaleDialog } from "../../catalog/_components/CatalogFields";
import { Banners, HistoryTab, OverviewTab, PeriodsTab, type TabId } from "../_components/DetailParts";
import { CustomerBlockedBanner } from "../../customers/_components/CustomerBlockedBanner";
import { useSubscriptionDialogs, type DialogRequest } from "../_components/DialogHost";
import { useMoveHandoff } from "../_components/MoveHandoff";
import { HealthChip, StatusChip } from "../_components/SubscriptionBits";
import { LiveOutCalendar } from "../_components/LiveOutCalendar";
import { Ltr } from "../_components/kit";
import { VisitsTab } from "../_components/VisitsTab";

const TAB_ID = "subscription-tabs";

/**
 * A08 subscription page (spec §17; design AdminSubscriptions.dc.html; subscriptions.view or .manage): the header with the
 * reference, status and payment chips and the actions the subscription and the user's permissions allow; the banners that
 * need a decision (pending confirmation with its deadline and first visit, a capture whose result is unknown, conflicts,
 * a failing renewal, a cancellation review, customers' moves waiting); and the tabs Overview, Visits, Calendar
 * (Live-out only), Periods & payments and History. `handoff`: a visit the A04 board sent here to be moved (its Visits
 * tab and move dialog open, filled with where it was dropped).
 */
export function SubscriptionDetailScreen({ id, handoff = null }: { id: string; handoff?: SeriesMoveHandoff | null }) {
  return (
    <RequirePermission anyOf={[...SUBSCRIPTIONS_READ]}>
      <SubscriptionDetailContent id={id} handoff={handoff} />
    </RequirePermission>
  );
}

function SubscriptionDetailContent({ id, handoff }: { id: string; handoff: SeriesMoveHandoff | null }) {
  const t = useTranslations("admin.subscriptions.detail");
  const numericId = /^\d{1,10}$/.test(id) ? Number(id) : null;
  const query = useQuery({
    queryKey: subscriptionKeys.detail(numericId ?? 0),
    queryFn: () => fetchSubscription(numericId as number),
    enabled: numericId !== null,
    refetchOnWindowFocus: true,
  });
  const [stale, setStale] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={SUBSCRIPTIONS_PATH} className="inline-flex w-fit items-center gap-1 text-sm font-medium">
          <ChevronRight aria-hidden className="size-4 ltr:rotate-180" />
          {t("back")}
        </Link>
        {query.data && (
          <Button variant="ghost" size="sm" onClick={() => void query.refetch()} loading={query.isFetching} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("refresh")}
          </Button>
        )}
      </div>
      {numericId === null ? (
        <Card>
          <EmptyState title={t("notFound")} />
        </Card>
      ) : query.isPending ? (
        <LoadingBlock lines={10} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <SubscriptionView subscription={query.data} handoff={handoff} onStale={() => setStale(true)} />
      )}
      <StaleDialog
        open={stale}
        onClose={() => setStale(false)}
        onReload={() => {
          setStale(false);
          void query.refetch();
        }}
      />
    </>
  );
}

const ACTION_ICONS: Record<SubscriptionAction, ReactNode> = {
  confirm: <Check aria-hidden className="size-4" />,
  reject: <X aria-hidden className="size-4" />,
  freeze: <Snowflake aria-hidden className="size-4" />,
  unfreeze: <SunMedium aria-hidden className="size-4" />,
  skip: <CalendarX2 aria-hidden className="size-4" />,
  undoSkip: <Undo2 aria-hidden className="size-4" />,
  renew: <CreditCard aria-hidden className="size-4" />,
  autoRenewOff: <Ban aria-hidden className="size-4" />,
  cancel: <Ban aria-hidden className="size-4" />,
  cancelAsCompany: <Ban aria-hidden className="size-4" />,
  resolveReview: <Check aria-hidden className="size-4" />,
  declineReview: <X aria-hidden className="size-4" />,
  assignPrimary: <UserRoundCog aria-hidden className="size-4" />,
  assignBackup: <UserRoundCog aria-hidden className="size-4" />,
};

const REQUESTS: Record<SubscriptionAction, DialogRequest> = {
  confirm: { kind: "confirm" },
  reject: { kind: "reject" },
  freeze: { kind: "freeze" },
  unfreeze: { kind: "unfreeze" },
  skip: { kind: "skip" },
  undoSkip: { kind: "undoSkip" },
  renew: { kind: "renew" },
  autoRenewOff: { kind: "autoRenewOff" },
  cancel: { kind: "cancel" },
  cancelAsCompany: { kind: "cancel", party: "company" },
  resolveReview: { kind: "resolveReview" },
  declineReview: { kind: "declineReview" },
  assignPrimary: { kind: "assign", role: "primary" },
  assignBackup: { kind: "assign", role: "backup" },
};

function SubscriptionView({ subscription, handoff, onStale }: { subscription: SubscriptionDetail; handoff: SeriesMoveHandoff | null; onStale: () => void }) {
  const t = useTranslations("admin.subscriptions.detail");
  const text = useSubscriptionText();
  const { can } = useAdminSession();
  const [tab, setTab] = useState<TabId>(handoff ? "visits" : "overview");
  const { open, element } = useSubscriptionDialogs(subscription, onStale);
  const handoffNotice = useMoveHandoff(subscription, handoff, open);
  const actions = availableActions(subscription, can);
  // Renew now waits while a renewal attempt is under way (it would answer 409 RENEWAL_IN_PROGRESS); the banner says why.
  const renewBusy = renewalBusy(subscription);
  const liveOut = subscription.type === "live_out";
  const canManage = can("subscriptions.manage");
  const shown = ACTION_ORDER.filter((a) => actions.has(a));
  // Assigning is on the workers card; the header keeps the decisions.
  const headerActions = shown.filter((a) => a !== "assignPrimary" && a !== "assignBackup");

  const items: TabItem[] = [
    { value: "overview", label: t("tabs.overview") },
    { value: "visits", label: t("tabs.visits") },
    ...(liveOut ? [{ value: "calendar", label: t("tabs.calendar") }] : []),
    { value: "periods", label: t("tabs.periods") },
    { value: "history", label: t("tabs.history") },
  ];

  return (
    <>
      <section aria-labelledby="subscription-title" className="flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 id="subscription-title" className="text-[26px]/[34px] font-bold text-ink-900">
              <span className="sr-only">{t("titlePrefix")} </span>
              <Ltr>{subscription.reference}</Ltr>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip status={subscription.status} label={subscription.status_label} pausedTo={subscription.freeze?.to ?? null} />
              <HealthChip health={subscription.payment_health} />
            </div>
            <p className="text-sm text-ink-600">
              {text.type(subscription.type)} · {text.name(subscription.plan_label) || text.name(subscription.service.name)} ·{" "}
              <CustomerLink customer={{ id: subscription.customer.ulid, name: subscription.customer.name }}>{subscription.customer.name ?? t("noName")}</CustomerLink> · {text.name(subscription.zone.name)}
            </p>
            <p className="text-sm text-ink-600">
              {t("term", { start: text.dateShort(subscription.start_date), end: text.dateShort(subscription.term_end_date) })}
            </p>
          </div>
          {headerActions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {headerActions.map((a) => (
                <Button
                  key={a}
                  variant={a === "confirm" || a === "renew" || a === "resolveReview" ? "primary" : a === "cancel" || a === "cancelAsCompany" || a === "reject" ? "outline" : "secondary"}
                  className={a === "cancel" || a === "cancelAsCompany" ? "text-danger-700" : undefined}
                  disabled={a === "renew" && renewBusy}
                  onClick={() => open(REQUESTS[a])}
                  icon={ACTION_ICONS[a]}
                >
                  {t(`actions.${a}`)}
                </Button>
              ))}
            </div>
          )}
        </div>
        <CustomerBlockedBanner customer={{ id: subscription.customer.ulid, name: subscription.customer.name, status: subscription.customer.status }} kind="subscription" />
        <Banners subscription={subscription} open={open} goTo={setTab} />
        {handoffNotice}
      </section>

      <Tabs id={TAB_ID} label={t("tabsLabel")} items={items} value={tab} onValueChange={(v) => setTab(v as TabId)} />
      <TabPanel id={TAB_ID} value={tab} className="flex flex-col gap-4 outline-none">
        {tab === "overview" && <OverviewTab subscription={subscription} open={open} goTo={setTab} />}
        {tab === "visits" && (
          <Card>
            <VisitsTab subscription={subscription} open={open} />
          </Card>
        )}
        {tab === "calendar" && liveOut && (
          <Card>
            <LiveOutCalendar
              subscription={subscription}
              canManage={canManage}
              onEditDay={(day, scope) => open({ kind: "day", day, scope })}
              onCancel={() => open({ kind: "cancel" })}
            />
          </Card>
        )}
        {tab === "periods" && (
          <Card>
            <PeriodsTab subscription={subscription} />
          </Card>
        )}
        {tab === "history" && (
          <Card>
            <HistoryTab subscription={subscription} />
          </Card>
        )}
      </TabPanel>
      {element}
    </>
  );
}
