"use client";

import { keepPreviousData, useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, LayoutDashboard, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Skeleton,
  StatusBadge,
  TextField,
  type Column,
} from "@/components/admin";
import { OVERVIEW_REFRESH_MS, useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { BOOKINGS_PATH, dashboardAlertHref, dashboardHref, withQuery } from "@/lib/admin/dashboard";
import { fetchBookings, fetchDashboardAlerts, fetchDashboardSummary } from "@/lib/admin/endpoints";
import { addDaysIso, businessToday, formatDateTime, isIsoDate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { OVERVIEW_PERMISSIONS } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { BookingRow, DashboardAlert, DashboardAlertType, DashboardSummary } from "@/lib/admin/types";
import { useAdminZone } from "@/lib/admin/zone";
import { useZoneName } from "../_ops/options";
import { BookingChips, DeadlineCountdown, Ltr, SlotLabel, useDurationText } from "../bookings/_components/BookingBits";
import { bookingTone, useBookingText } from "../bookings/_components/bookingText";
import { CancelReviewQueue } from "../bookings/_components/CancelReviewQueue";
import { useFocusRescue } from "../bookings/_components/focus";

/**
 * A02 daily operations overview (spec §14.3, §17; design AdminOverview.dc.html; bookings.view or schedule.view):
 * exactly four KPI cards, each opening its filtered list; the alerts that need action, each linking to its booking;
 * bookings by status, slot and zone; cleaners, vehicles and rounds; quick stats; and the requests waiting for
 * confirmation. Date filter here, zone filter in the top bar. Users without either permission get a welcome note.
 *
 * The summary and the alerts refresh every OVERVIEW_REFRESH_MS (60 s) while the tab is visible, as background polls
 * (X-Background-Poll: 1): the API checks the idle timeout but does not count them as staff activity, so an open tab
 * still signs out after spec §13.2's idle time. Opening the page, a date or zone change, Refresh, window focus and
 * booking actions load them as ordinary (active) reads. The list of requests waiting for confirmation is not on the
 * timer: it reloads with those loads only.
 */
export function OverviewScreen() {
  const { canAny } = useAdminSession();
  return canAny(OVERVIEW_PERMISSIONS) ? <Overview /> : <Welcome />;
}

function Welcome() {
  const t = useTranslations("admin.overview");
  const { me } = useAdminSession();
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("greeting", { name: me.name })} />
      <Card>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-pill bg-petrol-50 text-petrol-700">
            <LayoutDashboard aria-hidden className="size-6" strokeWidth={1.75} />
          </span>
          <p className="text-base font-bold text-ink-900">{t("welcomeTitle")}</p>
          <p className="max-w-md text-sm/6 text-ink-600">{t("welcomeBody")}</p>
        </div>
      </Card>
    </>
  );
}

function Overview() {
  const t = useTranslations("admin.overview");
  const text = useBookingText();
  const zoneName = useZoneName();
  const { can } = useAdminSession();
  const { zoneId } = useAdminZone();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => businessToday());
  const validDate = isIsoDate(date);
  /** The alerts list narrowed to one type (the uncovered-visits card across all zones). */
  const [alertType, setAlertType] = useState<DashboardAlertType | null>(null);
  const alertsTitle = useRef<HTMLSpanElement>(null);
  const refreshing = useIsFetching({ queryKey: adminKeys.dashboard() }) > 0;

  const summary = useQuery({
    queryKey: adminKeys.dashboardSummary(date, zoneId),
    queryFn: () => fetchDashboardSummary({ date, zoneId }),
    enabled: validDate,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });
  useBackgroundRefresh(adminKeys.dashboardSummary(date, zoneId), () => fetchDashboardSummary({ date, zoneId }, { background: true }), {
    everyMs: OVERVIEW_REFRESH_MS,
    enabled: validDate,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() });
    void queryClient.invalidateQueries({ queryKey: adminKeys.bookings() });
  };
  const showUncoveredAlerts = () => {
    setAlertType("visit_uncovered");
    // Focus moves to the list (focusing scrolls it into view).
    requestAnimationFrame(() => alertsTitle.current?.focus());
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { date: validDate ? text.date(date) : "—", zone: zoneId === null ? t("allZones") : zoneName(zoneId) })}
        actions={
          can("bookings.create_manual") ? (
            <ButtonLink href="/admin/bookings/new" icon={<Plus aria-hidden className="size-4" />}>
              {t("manualBooking")}
            </ButtonLink>
          ) : undefined
        }
      />

      <Card>
        <FilterBar>
          <div className="flex items-end gap-1">
            <Button
              variant="outline"
              className="h-11 px-3"
              aria-label={t("filters.previousDay")}
              onClick={() => setDate((d) => addDaysIso(d, -1))}
              disabled={!validDate}
              icon={<ChevronRight aria-hidden className="size-4 ltr:rotate-180" />}
            />
            <TextField
              type="date"
              label={t("filters.date")}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              dir="ltr"
              className="font-latin text-start"
              containerClassName="min-w-[170px]"
            />
            <Button
              variant="outline"
              className="h-11 px-3"
              aria-label={t("filters.nextDay")}
              onClick={() => setDate((d) => addDaysIso(d, 1))}
              disabled={!validDate}
              icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
            />
          </div>
          <Button variant="ghost" onClick={() => setDate(businessToday())}>
            {t("filters.today")}
          </Button>
          <div className="ms-auto flex flex-wrap items-center gap-3 self-center">
            {summary.data && <p className="text-xs text-ink-600">{t("updated", { time: formatDateTime(summary.data.generated_at, text.locale) })}</p>}
            <Button variant="outline" size="sm" onClick={refresh} loading={refreshing} disabled={!validDate} icon={<RefreshCw aria-hidden className="size-4" />}>
              {t("refresh")}
            </Button>
          </div>
        </FilterBar>
      </Card>

      {!validDate ? (
        <Card>
          <EmptyState title={t("filters.chooseDate")} />
        </Card>
      ) : summary.isPending ? (
        <OverviewSkeleton />
      ) : summary.isError && !summary.data ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </Card>
      ) : (
        <OverviewBody
          summary={summary.data}
          zoneId={zoneId}
          alertType={alertType}
          onShowAllAlerts={() => setAlertType(null)}
          onShowUncoveredAlerts={showUncoveredAlerts}
          alertsTitle={alertsTitle}
        />
      )}
    </>
  );
}

function OverviewSkeleton() {
  const t = useTranslations("admin.ui");
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-5">
      <span className="sr-only">{t("loading")}</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

function OverviewBody({
  summary,
  zoneId,
  alertType,
  onShowAllAlerts,
  onShowUncoveredAlerts,
  alertsTitle,
}: {
  summary: DashboardSummary;
  zoneId: number | null;
  alertType: DashboardAlertType | null;
  onShowAllAlerts: () => void;
  onShowUncoveredAlerts: () => void;
  alertsTitle: RefObject<HTMLSpanElement | null>;
}) {
  const { can } = useAdminSession();
  return (
    <>
      <KpiCards summary={summary} onShowUncoveredAlerts={onShowUncoveredAlerts} />
      <div className="grid gap-5 xl:grid-cols-3">
        <AlertsCard zoneId={zoneId} type={alertType} onShowAll={onShowAllAlerts} titleRef={alertsTitle} className="xl:col-span-2" />
        <TeamCard summary={summary} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <StatusPanel summary={summary} />
        <SlotPanel summary={summary} />
        <ZonePanel summary={summary} />
      </div>
      <QuickStats summary={summary} />
      {/* Customer cancellations waiting for review: finance resolves them, coordinators keep or cancel them. */}
      <CancelReviewQueue card={summary.cards.cancellation_reviews} />
      {can("bookings.view") && <PendingQueue zoneId={zoneId} />}
    </>
  );
}

// ---- KPI cards ------------------------------------------------------------------------------------------------------

/**
 * A KPI card: a link to the list it counts, or (onSelect) a button that shows that list on this page, or plain figures
 * when no page lists exactly what it counts.
 */
function KpiCard({
  label,
  value,
  detail,
  href,
  onSelect,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  href: string | null;
  onSelect?: () => void;
  tone?: "neutral" | "warning" | "danger";
}) {
  const body = (
    <>
      <span className="text-sm font-medium text-ink-600">{label}</span>
      <span
        className={clsx(
          "font-latin text-[32px]/10 font-bold",
          tone === "danger" ? "text-danger-700" : tone === "warning" ? "text-warning-700" : "text-ink-900",
        )}
      >
        {value}
      </span>
      <span className="flex flex-col gap-0.5 text-sm text-ink-600">{detail}</span>
    </>
  );
  const box = "flex min-w-0 flex-col gap-1.5 rounded-lg bg-surface p-5 shadow-card";
  const interactive = "text-ink-900 transition-shadow hover:text-ink-900 hover:ring-2 hover:ring-petrol-700/25";
  if (href) {
    return (
      <Link href={href} className={clsx(box, interactive)}>
        {body}
      </Link>
    );
  }
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={clsx(box, interactive, "text-start")}>
        {body}
      </button>
    );
  }
  return <div className={box}>{body}</div>;
}

function KpiCards({ summary, onShowUncoveredAlerts }: { summary: DashboardSummary; onShowUncoveredAlerts: () => void }) {
  const t = useTranslations("admin.overview.cards");
  const text = useBookingText();
  const duration = useDurationText();
  const { todays_bookings: today, pending_confirmation: pending, uncovered_visits: uncovered, on_time_rate: onTime } = summary.cards;
  const slotsWithBookings = today.by_slot.filter((s) => s.bookings > 0);

  /*
   * Each card opens exactly what it counts. With a zone the uncovered card opens that zone's capacity view (its
   * uncovered_visits are the card's visits). Without one the API points at the A04 day board, a later phase: today's
   * uncovered visits of every zone are this page's own visit_uncovered alerts (the same rule, each linking to its
   * booking), so the card narrows the alerts list to them; another day has no list across zones, so the card asks for
   * a zone. The on-time card counts arrived visits, which only the A04 board lists: no link until it exists.
   */
  const uncoveredHref = dashboardHref(uncovered.link);
  const allZones = summary.zone === null;
  const uncoveredInAlerts = !uncoveredHref && allZones && summary.is_today && uncovered.value > 0;
  const uncoveredPickZone = !uncoveredHref && allZones && !summary.is_today && uncovered.value > 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label={text.name(today.label)}
        value={today.value}
        href={dashboardHref(today.link)}
        detail={
          today.value === 0 ? (
            <span>{t("todayNone")}</span>
          ) : (
            <>
              <span>{slotsWithBookings.map((s) => t("slotCount", { name: text.name(s.name), count: s.bookings })).join(" · ")}</span>
              <span>{t("todayWorkers", { count: today.workers })}</span>
            </>
          )
        }
      />
      <KpiCard
        label={text.name(pending.label)}
        value={pending.value}
        tone={pending.overdue > 0 ? "danger" : pending.value > 0 ? "warning" : "neutral"}
        href={dashboardHref(pending.link)}
        detail={
          pending.value === 0 ? (
            <span>{t("pendingNone")}</span>
          ) : (
            <>
              {pending.next_deadline && (
                <span>
                  {pending.next_deadline.minutes_left < 0
                    ? t("pendingDeadlinePassed", { time: duration(-pending.next_deadline.minutes_left) })
                    : t("pendingDeadline", { time: duration(pending.next_deadline.minutes_left) })}
                </span>
              )}
              {pending.oldest_request && <span>{t("pendingOldest", { time: duration(pending.oldest_request.waiting_minutes) })}</span>}
              {pending.overdue > 0 && <span className="font-medium text-danger-700">{t("pendingOverdue", { count: pending.overdue })}</span>}
            </>
          )
        }
      />
      <KpiCard
        label={text.name(uncovered.label)}
        value={uncovered.value}
        tone={uncovered.value > 0 ? "danger" : "neutral"}
        href={uncoveredHref}
        onSelect={uncoveredInAlerts ? onShowUncoveredAlerts : undefined}
        detail={
          <>
            <span>{uncovered.value === 0 ? t("uncoveredNone") : t("uncoveredMissing", { count: uncovered.missing_workers })}</span>
            {uncoveredInAlerts && <span className="font-medium text-petrol-700">{t("uncoveredInAlerts")}</span>}
            {uncoveredPickZone && <span>{t("uncoveredPickZone")}</span>}
          </>
        }
      />
      <KpiCard
        label={text.name(onTime.label)}
        value={onTime.value === null ? "—" : `${onTime.value}%`}
        href={dashboardHref(onTime.link)}
        detail={
          onTime.arrived === 0 ? (
            <span>{t("onTimeNone")}</span>
          ) : (
            <>
              <span>{t("onTimeDetail", { onTime: onTime.on_time, arrived: onTime.arrived, late: onTime.late })}</span>
              {onTime.overdue > 0 && <span className="font-medium text-danger-700">{t("onTimeOverdue", { count: onTime.overdue })}</span>}
            </>
          )
        }
      />
    </div>
  );
}

// ---- Alerts ---------------------------------------------------------------------------------------------------------

const ALERTS_SHOWN = 8;

function AlertsCard({
  zoneId,
  type,
  onShowAll,
  titleRef,
  className,
}: {
  zoneId: number | null;
  /** Only this alert type (the uncovered-visits card), or every alert. */
  type: DashboardAlertType | null;
  onShowAll: () => void;
  titleRef: RefObject<HTMLSpanElement | null>;
  className?: string;
}) {
  const t = useTranslations("admin.overview.alerts");
  const [all, setAll] = useState(false);
  const alerts = useQuery({
    queryKey: adminKeys.dashboardAlerts(zoneId),
    queryFn: () => fetchDashboardAlerts({ zoneId }),
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
  useBackgroundRefresh(adminKeys.dashboardAlerts(zoneId), () => fetchDashboardAlerts({ zoneId }, { background: true }), { everyMs: OVERVIEW_REFRESH_MS });
  // A refresh can take away the alert link (or the Show all button) that has focus: focus goes to the alert now at its
  // place in the list, else the last one before it, else the card's title, never to <body>.
  const listId = useId();
  useFocusRescue((removed) => {
    const links = Array.from(document.getElementById(listId)?.querySelectorAll<HTMLElement>("[data-alert-open]") ?? []);
    const position = removed.getAttribute("data-alert-open");
    if (position === null || links.length === 0) return titleRef.current;
    const at = Number(position);
    return links.find((l) => Number(l.dataset.alertOpen) >= at) ?? links[links.length - 1];
  }, alerts.data);
  const items = (alerts.data?.data ?? []).filter((a) => type === null || a.type === type);
  // A narrowed list shows every item of its type; the full list starts with the first few.
  const shown = all || type !== null ? items : items.slice(0, ALERTS_SHOWN);
  /** The API lists at most limit_per_type alerts of a type; meta.counts has the full number. */
  const typeTotal = type !== null ? (alerts.data?.meta.counts[type] ?? items.length) : 0;

  return (
    <Card
      title={
        <span ref={titleRef} tabIndex={-1} className="outline-none">
          {type === "visit_uncovered" ? t("uncoveredTitle") : t("title")}
        </span>
      }
      className={className}
      actions={
        type !== null ? (
          <Button variant="ghost" size="sm" onClick={onShowAll}>
            {t("showAllTypes")}
          </Button>
        ) : alerts.data && alerts.data.meta.total > 0 ? (
          <span className="text-sm text-ink-600">{t("total", { count: alerts.data.meta.total, urgent: alerts.data.meta.urgent })}</span>
        ) : undefined
      }
    >
      {type !== null && typeTotal > items.length && <p className="text-sm text-ink-600">{t("firstOf", { shown: items.length, total: typeTotal })}</p>}
      {alerts.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : alerts.isError && !alerts.data ? (
        <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} className="py-6" />
      ) : items.length === 0 ? (
        <EmptyState title={type === "visit_uncovered" ? t("uncoveredEmpty") : t("empty")} className="py-6" />
      ) : (
        <>
          <ul id={listId} className="flex flex-col gap-2">
            {shown.map((alert, i) => (
              <AlertRow key={`${alert.type}-${alert.entity?.type ?? ""}-${alert.entity?.id ?? i}-${alert.at}`} alert={alert} position={i} />
            ))}
          </ul>
          {type === null && items.length > ALERTS_SHOWN && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>
              {all ? t("showFewer") : t("showAll", { count: items.length })}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function AlertRow({ alert, position }: { alert: DashboardAlert; position: number }) {
  const t = useTranslations("admin.overview.alerts");
  const text = useBookingText();
  const href = dashboardAlertHref(alert);
  const urgent = alert.severity === "urgent";
  const title = text.name(alert.title);
  return (
    <li className={clsx("flex items-start gap-3 rounded-md border px-3 py-2.5", urgent ? "border-danger-700/30 bg-danger-50/60" : "border-line")}>
      <StatusBadge tone={urgent ? "danger" : "pending"} className="mt-0.5 shrink-0">
        {urgent ? t("urgent") : t("warning")}
      </StatusBadge>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-bold text-ink-900">{title}</p>
        <p className="text-sm/6 text-ink-600">{text.name(alert.message)}</p>
      </div>
      {href && (
        <Link href={href} aria-label={t("openLabel", { title })} data-alert-open={position} className="touch-target shrink-0 self-center rounded-sm px-2 py-1 text-sm font-bold text-petrol-700 hover:bg-petrol-50">
          {t("open")}
        </Link>
      )}
    </li>
  );
}

// ---- Panels ---------------------------------------------------------------------------------------------------------

/** "9 / 12" with a bar; the value and total are read out by the meter. */
function Meter({ label, value, total, tone = "petrol" }: { label: string; value: number; total: number; tone?: "petrol" | "apricot" | "danger" }) {
  const t = useTranslations("admin.overview.panels");
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-ink-900">{label}</span>
        <span className="font-latin font-medium text-ink-900">{t("ofTotal", { value, total })}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={value}
        className="h-2 overflow-hidden rounded-pill bg-neutral-100"
      >
        <div
          className={clsx("h-full rounded-pill", tone === "danger" ? "bg-danger-700" : tone === "apricot" ? "bg-apricot-400" : "bg-petrol-700")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function TeamCard({ summary }: { summary: DashboardSummary }) {
  const t = useTranslations("admin.overview.panels");
  const text = useBookingText();
  const w = summary.panels.workers;
  const fleet = summary.panels.fleet;
  const rounds = fleet.rounds.filter((r) => r.rounds > 0 || r.seats_total > 0 || r.code !== "LIVE_OUT_DAY");
  return (
    <Card title={t("workersTitle")}>
      <div className="flex flex-col gap-3">
        <Meter label={t("available")} value={w.available} total={w.total} />
        <Meter label={t("assigned")} value={w.assigned} total={w.total} />
        <Meter label={t("liveOut")} value={w.live_out} total={w.total} tone="apricot" />
        <Meter label={t("absent")} value={w.absent} total={w.total} tone="apricot" />
        <p className="text-sm text-ink-600">
          {t("offAndLate", { off: w.off, late: w.late })}
        </p>
      </div>
      <h3 className="pt-2 text-base font-bold text-ink-900">{t("fleetTitle")}</h3>
      <p className="text-sm text-ink-600">
        {t("vehicles", { active: fleet.vehicles.active, total: fleet.vehicles.total, inUse: fleet.vehicles.in_use, maintenance: fleet.vehicles.maintenance })}
      </p>
      <div className="flex flex-col gap-3">
        {rounds.map((r) => (
          <div key={r.slot_template_id} className="flex flex-col gap-1">
            <Meter label={t("roundSeats", { name: text.name(r.name) })} value={r.seats_used} total={r.seats_total} />
            <span className="text-xs text-ink-600">{t("roundsCount", { count: r.rounds, departed: r.departed, completed: r.completed })}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CountRow({ label, count, href, extra }: { label: ReactNode; count: number; href: string | null; extra?: ReactNode }) {
  const content = (
    <>
      <span className="min-w-0 flex-1">{label}</span>
      {extra}
      <span className="font-latin font-bold text-ink-900">{count}</span>
    </>
  );
  return (
    <li className={clsx("border-t border-line first:border-t-0", count === 0 && "opacity-70")}>
      {href ? (
        <Link href={href} className="flex items-center gap-2 py-2 text-sm text-ink-900 hover:text-petrol-700">
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-2 py-2 text-sm">{content}</div>
      )}
    </li>
  );
}

function StatusPanel({ summary }: { summary: DashboardSummary }) {
  const t = useTranslations("admin.overview.panels");
  const text = useBookingText();
  return (
    <Card title={t("statusTitle")}>
      <ul>
        {summary.panels.bookings_by_status.map((row) => (
          <CountRow
            key={row.status}
            label={<StatusBadge tone={bookingTone[row.status] ?? "neutral"}>{text.status(row.status, row.label)}</StatusBadge>}
            count={row.bookings}
            href={row.bookings > 0 ? dashboardHref(row.link) : null}
          />
        ))}
      </ul>
    </Card>
  );
}

function SlotPanel({ summary }: { summary: DashboardSummary }) {
  const t = useTranslations("admin.overview.panels");
  return (
    <Card title={t("slotTitle")}>
      <ul>
        {summary.panels.bookings_by_slot.map((row) => (
          <CountRow
            key={row.slot_template_id}
            label={
              <span className="flex flex-col">
                <SlotLabel name={row.name} start={row.start} end={row.end} />
                <span className="text-xs text-ink-600">{t("slotWorkers", { workers: row.workers })}</span>
              </span>
            }
            count={row.bookings}
            href={null}
            extra={row.uncovered_visits > 0 ? <StatusBadge tone="danger">{t("slotUncovered", { count: row.uncovered_visits })}</StatusBadge> : null}
          />
        ))}
      </ul>
    </Card>
  );
}

function ZonePanel({ summary }: { summary: DashboardSummary }) {
  const t = useTranslations("admin.overview.panels");
  const text = useBookingText();
  return (
    <Card title={t("zoneTitle")}>
      {summary.panels.bookings_by_zone.length === 0 ? (
        <p className="text-sm text-ink-600">{t("noZones")}</p>
      ) : (
        <ul>
          {summary.panels.bookings_by_zone.map((row) => (
            <CountRow
              key={row.zone_id}
              label={
                <span className="flex flex-col">
                  <span>{text.name(row.name)}</span>
                  <span className="text-xs text-ink-600">{t("slotWorkers", { workers: row.workers })}</span>
                </span>
              }
              count={row.bookings}
              href={row.bookings > 0 ? dashboardHref(row.link) : null}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-line p-4">
      <span className="text-sm text-ink-600">{label}</span>
      <span className="font-latin text-xl font-bold text-ink-900">{value}</span>
      {detail && <span className="text-xs text-ink-600">{detail}</span>}
    </div>
  );
}

function QuickStats({ summary }: { summary: DashboardSummary }) {
  const t = useTranslations("admin.overview.quick");
  const text = useBookingText();
  const { sales, occupancy, cancellations, rating } = summary.quick_stats;
  return (
    <Card title={t("title")}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sales && (
          <Stat
            label={t("sales")}
            value={text.money(sales.net_fils)}
            detail={t("salesDetail", { captured: text.money(sales.captured_fils), refunded: text.money(sales.refunded_fils) })}
          />
        )}
        <Stat
          label={t("occupancy")}
          value={occupancy.percent === null ? "—" : `${occupancy.percent}%`}
          detail={t("occupancyDetail", { used: occupancy.used_units, available: occupancy.available_units })}
        />
        <Stat
          label={t("cancellations")}
          value={cancellations.total}
          detail={t("cancellationsDetail", { customer: cancellations.customer, company: cancellations.company, system: cancellations.system })}
        />
        {rating && <Stat label={t("rating")} value={rating.average.toFixed(1)} detail={t("ratingDetail", { count: rating.count })} />}
      </div>
    </Card>
  );
}

// ---- Requests pending confirmation ----------------------------------------------------------------------------------

function PendingQueue({ zoneId }: { zoneId: number | null }) {
  const t = useTranslations("admin.overview.pending");
  const text = useBookingText();
  const list = useQuery({
    queryKey: adminKeys.bookingList({ status: "pending_confirmation", zone: zoneId ?? 0, page: 1, perPage: 5 }),
    queryFn: () => fetchBookings({ status: "pending_confirmation", zoneId, page: 1, perPage: 5 }),
    refetchOnWindowFocus: true,
  });

  const columns: Column<BookingRow>[] = [
    {
      id: "reference",
      header: t("columns.reference"),
      cell: (b) => (
        <Link href={`${BOOKINGS_PATH}/${b.id}`} className="font-bold">
          <Ltr className="whitespace-nowrap">{b.reference}</Ltr>
        </Link>
      ),
    },
    { id: "customer", header: t("columns.customer"), cell: (b) => b.customer.name ?? <Ltr>{b.customer.phone}</Ltr> },
    {
      id: "when",
      header: t("columns.when"),
      cell: (b) => (
        <span className="flex flex-col">
          <span>{text.dateShort(b.service_date)}</span>
          <SlotLabel className="text-xs text-ink-600" name={b.slot.name} start={b.slot.start} end={b.slot.end} />
        </span>
      ),
    },
    { id: "zone", header: t("columns.zone"), cell: (b) => text.name(b.zone.name) },
    { id: "workers", header: t("columns.workers"), cell: (b) => <span className="font-latin">{b.workers_count}</span> },
    { id: "payment", header: t("columns.payment"), cell: (b) => <BookingChips status={b.status} statusLabel={b.status_label} payment={b.payment_status} paymentLabel={b.payment_status_label} /> },
    { id: "deadline", header: t("columns.deadline"), cell: (b) => <DeadlineCountdown deadline={b.confirmation_deadline_at} /> },
    {
      id: "action",
      header: <span className="sr-only">{t("columns.action")}</span>,
      className: "text-end",
      cell: (b) => (
        <ButtonLink href={`${BOOKINGS_PATH}/${b.id}`} variant="secondary" size="sm" aria-label={t("reviewLabel", { reference: b.reference })}>
          {t("review")}
        </ButtonLink>
      ),
    },
  ];

  return (
    <Card
      title={t("title")}
      actions={
        <Link href={withQuery(BOOKINGS_PATH, { status: "pending_confirmation", zone_id: zoneId })} className="text-sm font-bold">
          {t("all")}
        </Link>
      }
    >
      <DataTable
        caption={t("title")}
        columns={columns}
        rows={list.data?.data}
        getRowId={(b) => b.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={t("empty")} className="py-6" />}
        minWidth={860}
      />
    </Card>
  );
}
