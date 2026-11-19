"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, Card, CustomerLink, DataTable, EmptyState, FilterBar, PageHeader, SearchField, Select, StatusBadge, TextField, type Column } from "@/components/admin";
import { useBackgroundRefresh } from "@/lib/admin/backgroundRefresh";
import { isolate } from "@/lib/admin/format";
import { useDebouncedValue } from "@/lib/admin/hooks";
import { useAdminSession } from "@/lib/admin/session";
import { fetchWaitlist } from "@/lib/admin/workforce/endpoints";
import { workforceKeys } from "@/lib/admin/workforce/keys";
import { useWorkforceText } from "@/lib/admin/workforce/text";
import type { WaitlistEntry } from "@/lib/admin/workforce/types";
import { customerStateKey, entryPhase, notifyAction, statusParams, waitlistTone, WAITLIST_FILTERS, WAITLIST_STATUS_CHOICES, type NotifyMode } from "@/lib/admin/workforce/waitlist";
import { RequirePermission } from "../../_components/RequirePermission";
import { useUrlFilters } from "../finance/_components/useUrlFilters";
import { useChoiceOptions, useSlotPickList, useZoneChoices, useZoneName } from "../_ops/options";
import { NotifyDialog } from "./NotifyDialog";

const PER_PAGE = 25;
/** The list is read again every minute while the tab is visible (as a background poll, spec §13.2). */
export const WAITLIST_REFRESH_MS = 60_000;

/**
 * A04 waitlist (waitlist.manage; waitlist §7.1, contract A6 §5.2): the customers waiting for a place in a full slot, by
 * date, zone and slot, with the state of each request and a staff offer. The API decides what may be offered and why not
 * (`actions`); the page words it. Customers are told by push, SMS and in-app message and nothing is held for them.
 */
export function WaitlistScreen() {
  const t = useTranslations("admin.waitlist");
  return (
    <RequirePermission anyOf={["waitlist.manage"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <WaitlistTable />
    </RequirePermission>
  );
}

/** A blocked account, one being closed or any other inactive one, in words (never the API's status token). */
function CustomerState({ status }: { status: string }) {
  const t = useTranslations("admin.waitlist.customerState");
  const key = customerStateKey(status);
  return key === null ? null : <span className="text-xs text-warning-700">{t(key)}</span>;
}

function WaitlistTable() {
  const t = useTranslations("admin.waitlist");
  const wt = useWorkforceText();
  const zones = useZoneChoices();
  const slots = useSlotPickList();
  const choiceOptions = useChoiceOptions();
  const zoneName = useZoneName();
  const { filters, set, setPage, reset, filtered } = useUrlFilters(WAITLIST_FILTERS);
  const [search, setSearch] = useState(filters.q);
  const q = useDebouncedValue(search.trim(), 300);
  const [offer, setOffer] = useState<{ entry: WaitlistEntry; mode: NotifyMode } | null>(null);
  const chipsId = useId();

  const params = {
    dateFrom: filters.date_from || undefined,
    dateTo: filters.date_to || undefined,
    zoneId: filters.zone_id ? Number(filters.zone_id) : undefined,
    slotTemplateId: filters.slot_template_id ? Number(filters.slot_template_id) : undefined,
    status: statusParams(filters.status),
    q: q || undefined,
    page: filters.page,
    perPage: PER_PAGE,
  };
  const key = workforceKeys.waitlist({ from: params.dateFrom ?? "", to: params.dateTo ?? "", zone: params.zoneId ?? 0, slot: params.slotTemplateId ?? 0, status: filters.status, q, page: filters.page });
  const query = useQuery({ queryKey: key, queryFn: () => fetchWaitlist(params), placeholderData: keepPreviousData });
  useBackgroundRefresh(key, () => fetchWaitlist(params, { background: true }), { everyMs: WAITLIST_REFRESH_MS });
  const counts = query.data?.meta.counts_by_status;

  const statusLabel = (value: string) => t(`filters.status.${value}`);
  const columns: Column<WaitlistEntry>[] = [
    {
      id: "slot",
      header: t("columns.slot"),
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-bold text-ink-900">{wt.date(e.date)}</span>
          <span className="text-xs text-ink-600">
            {wt.locale === "ar" ? e.slot.name.ar : e.slot.name.en}{" "}
            <bdi dir="ltr" className="font-latin">
              {e.slot.start}–{e.slot.end}
            </bdi>
          </span>
        </span>
      ),
    },
    { id: "zone", header: t("columns.zone"), cell: (e) => zoneName(e.zone.id, wt.locale === "ar" ? e.zone.name.ar : e.zone.name.en) },
    {
      id: "customer",
      header: t("columns.customer"),
      cell: (e) => (
        <span className="flex flex-col">
          {e.customer.name === null && e.customer.status === "deleted" ? <span className="font-medium text-ink-900">{t("deletedCustomer")}</span> : <CustomerLink customer={{ id: e.customer.id, name: e.customer.name, phone: e.customer.phone_masked }} />}
          {e.customer.phone_masked && e.customer.name !== null && (
            <bdi dir="ltr" className="font-latin text-xs text-ink-600">
              {e.customer.phone_masked}
            </bdi>
          )}
          <CustomerState status={e.customer.status} />
        </span>
      ),
    },
    {
      id: "service",
      header: t("columns.service"),
      cell: (e) => (
        <span className="flex flex-col text-sm">
          <span>{wt.locale === "ar" ? e.service.name.ar : e.service.name.en}</span>
          <span className="text-xs text-ink-600">{t("team", { count: e.workers_count })}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (e) => <StatusCell entry={e} />,
    },
    {
      id: "offers",
      header: t("columns.offers"),
      cell: (e) => (
        <span className="flex flex-col text-sm">
          <span className="font-latin">{e.offers_count}</span>
          {e.offers_count > 0 && <span className="text-xs text-ink-600">{e.offer.offered_by ? t("lastBy", { name: isolate(e.offer.offered_by.name) }) : t("lastAuto")}</span>}
        </span>
      ),
    },
    { id: "joined", header: t("columns.joined"), cell: (e) => <span className="text-xs text-ink-600">{wt.dateTime(e.created_at)}</span> },
    {
      id: "actions",
      header: <span className="sr-only">{t("columns.actions")}</span>,
      className: "text-end",
      cell: (e) => {
        const action = notifyAction(e);
        if (!action) return null;
        const reasonId = `${chipsId}-${e.id}`;
        return (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant={action.mode === "again" ? "outline" : "primary"}
              size="sm"
              disabled={!action.enabled}
              aria-describedby={action.blocked ? reasonId : undefined}
              onClick={() => setOffer({ entry: e, mode: action.mode })}
              icon={<BellRing aria-hidden className="size-4" />}
              aria-label={t(action.mode === "again" ? "notifyAgainLabel" : "notifyLabel", { name: e.customer.name ?? t("theCustomer") })}
            >
              {action.mode === "again" ? t("notifyAgain") : t("notifyNow")}
            </Button>
            {action.blocked && (
              <span id={reasonId} className="max-w-[220px] text-end text-xs text-ink-600">
                {t(`blocked.${action.blocked}`)}
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Card>
      <FilterBar
        canReset={filtered}
        onReset={() => {
          reset();
          setSearch("");
        }}
      >
        <SearchField label={t("filters.search")} placeholder={t("filters.searchPlaceholder")} value={search} onChange={(v) => { setSearch(v); set({ q: v }); }} />
        <TextField label={t("filters.dateFrom")} type="date" dir="ltr" value={filters.date_from} onChange={(e) => set({ date_from: e.target.value })} containerClassName="min-w-[160px]" />
        <TextField label={t("filters.dateTo")} type="date" dir="ltr" value={filters.date_to} onChange={(e) => set({ date_to: e.target.value })} containerClassName="min-w-[160px]" />
        <Select label={t("filters.zone")} placeholder={t("filters.allZones")} value={filters.zone_id} onChange={(e) => set({ zone_id: e.target.value })} options={choiceOptions(zones.data)} containerClassName="min-w-[170px]" />
        {slots.data && (
          <Select
            label={t("filters.slot")}
            placeholder={t("filters.allSlots")}
            value={filters.slot_template_id}
            onChange={(e) => set({ slot_template_id: e.target.value })}
            options={slots.data.map((s) => ({ value: String(s.id), label: `${wt.locale === "ar" ? s.name.ar : s.name.en} ${s.start_time}–${s.end_time}` }))}
            containerClassName="min-w-[200px]"
          />
        )}
        <Select label={t("filters.statusLabel")} value={filters.status === "" ? "open" : filters.status} onChange={(e) => set({ status: e.target.value === "open" ? "" : e.target.value })} options={WAITLIST_STATUS_CHOICES.map((s) => ({ value: s, label: statusLabel(s) }))} containerClassName="min-w-[170px]" />
      </FilterBar>
      <p className="text-xs text-ink-600">{filters.date_from === "" && filters.date_to === "" ? t("defaultRange") : t("customRange")}</p>
      {counts && (
        <ul className="flex flex-wrap gap-2" aria-label={t("countsLabel")}>
          {(["waiting", "notified", "converted", "expired", "cancelled"] as const).map((s) => (
            <li key={s}>
              <button
                type="button"
                aria-pressed={filters.status === s}
                onClick={() => set({ status: filters.status === s ? "" : s })}
                className="touch-target inline-flex items-center gap-1.5 rounded-pill bg-petrol-50 px-3 py-1 text-sm text-petrol-700 aria-pressed:bg-petrol-700 aria-pressed:text-white"
              >
                {statusLabel(s)} <span className="font-latin font-bold">{counts[s]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={query.data?.data}
        getRowId={(e) => e.id}
        loading={query.isPending}
        fetching={query.isFetching && !query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? undefined : t("emptyBody")} />}
        pagination={query.data ? { meta: query.data.meta, onPageChange: setPage } : undefined}
        minWidth={1100}
      />
      {offer && <NotifyDialog entry={offer.entry} mode={offer.mode} onClose={() => setOffer(null)} />}
    </Card>
  );
}

/** What the request is now: waiting at a place, a live offer, a lapsed one, booked, or closed and why. */
function StatusCell({ entry }: { entry: WaitlistEntry }) {
  const t = useTranslations("admin.waitlist.phase");
  const wt = useWorkforceText();
  const { can } = useAdminSession();
  const phase = entryPhase(entry);
  const tone = waitlistTone[entry.status];
  const reason = entry.closed_reason ? entry.closed_reason : null;
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={tone}>
        {phase === "waiting" && entry.position !== null ? t("waitingAt", { position: entry.position }) : phase === "live" ? t("live", { time: wt.time(entry.offer.expires_at) }) : phase === "lapsed" ? t("lapsed", { count: entry.offers_count }) : phase === "booked" ? t("booked") : phase === "ended" ? (reason === "cutoff" ? t("endedCutoff") : t("endedExhausted")) : phase === "left" ? t("left") : phase === "closed" ? t(reason === "address_unavailable" ? "closedAddress" : "closedAccount") : t("waiting")}
      </StatusBadge>
      {phase === "booked" && entry.booking && (
        can("bookings.view") ? (
          <Link href={`/admin/bookings/${entry.booking.id}`} className="text-xs font-bold">
            <bdi dir="ltr" className="font-latin">
              {entry.booking.reference}
            </bdi>
          </Link>
        ) : (
          <bdi dir="ltr" className="font-latin text-xs">
            {entry.booking.reference}
          </bdi>
        )
      )}
      {entry.slot_now && (entry.status === "waiting" || entry.status === "notified") && (
        <span className="text-xs text-ink-600">{t("slotNow", { status: t(`slot.${entry.slot_now.status}`), left: entry.slot_now.remaining_for_team })}</span>
      )}
    </span>
  );
}
