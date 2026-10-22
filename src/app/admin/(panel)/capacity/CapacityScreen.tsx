"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
  StatusBadge,
  TextField,
} from "@/components/admin";
import { fetchAllVehicles, fetchCapacity } from "@/lib/admin/endpoints";
import { addDaysIso, businessToday } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { CAPACITY_OVERRIDE_PERMISSION, EXCLUSION_REASONS, overrideOptions } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { CapacitySlot, CapacityView, Vehicle } from "@/lib/admin/types";
import { RequirePermission } from "../../_components/RequirePermission";
import { useZoneChoices } from "../_ops/options";
import { slotTone, useOpsText } from "../_ops/opsText";
import { useRuleText } from "../_ops/ruleText";
import { OverrideDialog } from "./OverrideDialog";

/**
 * Capacity for one date and zone (spec §8, §14.3 "Capacity"; permission schedule.view): one card per slot with its
 * status, the workers available, reserved and remaining, who is excluded and why, each vehicle's seats, the booking
 * cap and the rule that applies. Staff with capacity.override can relax a soft cap from a card.
 */
export function CapacityScreen() {
  const t = useTranslations("admin.capacity");
  return (
    <RequirePermission anyOf={["schedule.view"]}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <CapacityContent />
    </RequirePermission>
  );
}

function CapacityContent() {
  const t = useTranslations("admin.capacity");
  const text = useOpsText();
  const zones = useZoneChoices();
  const [date, setDate] = useState(() => businessToday());
  const [zoneChoice, setZoneChoice] = useState("");
  // The first zone until the user picks one.
  const zoneId = zoneChoice ? Number(zoneChoice) : (zones.data?.find((z) => z.is_active)?.id ?? zones.data?.[0]?.id ?? null);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const capacity = useQuery({
    queryKey: adminKeys.capacityView(date, zoneId ?? 0),
    queryFn: () => fetchCapacity({ date, zoneId: zoneId as number }),
    enabled: zoneId !== null && validDate,
  });
  const vehicles = useQuery({ queryKey: adminKeys.vehicleList({ all: 1 }), queryFn: fetchAllVehicles, staleTime: 60_000 });

  if (zones.isPending) return <LoadingBlock lines={6} className="rounded-lg bg-surface p-5 shadow-card" />;
  if (zones.isError) {
    return (
      <Card>
        <ErrorState error={zones.error} onRetry={() => void zones.refetch()} />
      </Card>
    );
  }
  if (zones.data.length === 0) {
    return (
      <Card>
        <EmptyState title={t("noZones")} body={t("noZonesBody")} />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <FilterBar>
          <div className="flex items-end gap-1">
            <Button
              variant="outline"
              size="md"
              className="h-11 px-3"
              aria-label={t("previousDay")}
              onClick={() => setDate((d) => addDaysIso(d, -1))}
              disabled={!validDate}
              icon={<ChevronRight aria-hidden className="size-4 ltr:rotate-180" />}
            />
            <TextField
              type="date"
              label={t("date")}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              dir="ltr"
              className="font-latin text-start"
              containerClassName="min-w-[170px]"
            />
            <Button
              variant="outline"
              size="md"
              className="h-11 px-3"
              aria-label={t("nextDay")}
              onClick={() => setDate((d) => addDaysIso(d, 1))}
              disabled={!validDate}
              icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
            />
          </div>
          <Select
            label={t("zone")}
            value={zoneId === null ? "" : String(zoneId)}
            onChange={(e) => setZoneChoice(e.target.value)}
            options={zones.data.map((z) => ({ value: String(z.id), label: text.name(z.name) }))}
            containerClassName="min-w-[200px]"
          />
          <Button variant="ghost" onClick={() => setDate(businessToday())}>
            {t("today")}
          </Button>
        </FilterBar>
        {validDate && <p className="text-sm text-ink-600">{text.date(date)}</p>}
      </Card>

      {!validDate ? (
        <Card>
          <EmptyState title={t("chooseDate")} />
        </Card>
      ) : capacity.isPending ? (
        <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : capacity.isError ? (
        <Card>
          <ErrorState error={capacity.error} onRetry={() => void capacity.refetch()} />
        </Card>
      ) : (
        <CapacityBody view={capacity.data} vehicles={vehicles.data} />
      )}
    </>
  );
}

function CapacityBody({ view, vehicles }: { view: CapacityView; vehicles: Vehicle[] | undefined }) {
  const t = useTranslations("admin.capacity");
  const [overriding, setOverriding] = useState<CapacitySlot | null>(null);
  if (view.slots.length === 0) {
    return (
      <Card>
        <EmptyState title={t("noSlots")} />
      </Card>
    );
  }
  return (
    <>
      <p className="text-sm text-ink-600">
        {t("settingsLine", { buffer: view.travel_buffer_minutes, scope: view.live_out_block_scope })}
      </p>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {view.slots.map((slot) => (
          <SlotCard key={slot.slot_template_id} slot={slot} vehicles={vehicles} onOverride={() => setOverriding(slot)} />
        ))}
      </div>
      {overriding && <OverrideDialog view={view} slot={overriding} onClose={() => setOverriding(null)} />}
    </>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-neutral-100 px-3 py-2">
      <span className="text-xs font-medium text-ink-600">{label}</span>
      <span className={clsx("font-latin text-xl font-bold", strong ? "text-petrol-700" : "text-ink-900")}>{value}</span>
      {hint && <span className="text-xs text-ink-600">{hint}</span>}
    </div>
  );
}

function SlotCard({ slot, vehicles, onOverride }: { slot: CapacitySlot; vehicles: Vehicle[] | undefined; onOverride: () => void }) {
  const t = useTranslations("admin.capacity");
  const text = useOpsText();
  const ruleText = useRuleText();
  const { can } = useAdminSession();
  const options = overrideOptions(slot);
  const excluded = EXCLUSION_REASONS.filter((reason) => (slot.excluded[reason] ?? 0) > 0);
  const excludedTotal = excluded.reduce((sum, reason) => sum + (slot.excluded[reason] ?? 0), 0);
  const plate = (id: number) => vehicles?.find((v) => v.id === id)?.plate_no ?? t("vehicleId", { id });

  return (
    <Card as="section" className="gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg/7 font-bold text-ink-900">{text.name(slot.name)}</h2>
          <span className="text-sm text-ink-600">
            <bdi dir="ltr" className="font-latin">
              {slot.start}–{slot.end}
            </bdi>{" "}
            · {text.serviceKind(slot.service_kind)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge tone={slotTone[slot.status]}>{text.slotStatus(slot.status)}</StatusBadge>
          {slot.reason && <span className="text-xs text-ink-600">{text.slotReason(slot.reason)}</span>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("available")} value={slot.available_workers} />
        <Stat
          label={t("reserved")}
          value={slot.reserved_workers + slot.reserved_competing}
          hint={slot.reserved_competing > 0 ? t("competing", { count: slot.reserved_competing }) : undefined}
        />
        <Stat label={t("remaining")} value={slot.remaining_workers} strong />
      </div>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-bold text-ink-900">{t("excludedTitle")}</h3>
        {excluded.length === 0 ? (
          <p className="text-sm text-ink-600">{t("noneExcluded", { count: slot.zone_workers })}</p>
        ) : (
          <>
            <p className="text-xs text-ink-600">{t("excludedOf", { count: excludedTotal, total: slot.zone_workers })}</p>
            <ul className="flex flex-wrap gap-1.5">
              {excluded.map((reason) => (
                <li key={reason} className="rounded-pill bg-neutral-100 px-2.5 py-0.5 text-[13px] text-ink-900">
                  {text.exclusion(reason)}: <span className="font-latin font-bold">{slot.excluded[reason]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-ink-900">{t("seatsTitle")}</h3>
        {slot.vehicles.length === 0 ? (
          <p className="text-sm text-ink-600">{t("noVehicles")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {slot.vehicles.map((v) => {
              const used = Math.min(v.seats, v.reserved_seats);
              const percent = v.seats > 0 ? Math.round((used / v.seats) * 100) : 0;
              return (
                <li key={v.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <bdi dir="ltr" className="font-latin font-medium text-ink-900">
                      {plate(v.id)}
                    </bdi>
                    <span className="text-ink-600">{t("seatsUsed", { used: v.reserved_seats, seats: v.seats, free: v.free })}</span>
                  </div>
                  <div
                    role="meter"
                    aria-label={t("seatsMeter", { vehicle: plate(v.id) })}
                    aria-valuemin={0}
                    aria-valuemax={v.seats}
                    aria-valuenow={used}
                    aria-valuetext={t("seatsUsed", { used: v.reserved_seats, seats: v.seats, free: v.free })}
                    className="h-2.5 overflow-hidden rounded-pill bg-neutral-100"
                  >
                    <div
                      className={clsx("h-full rounded-pill", v.free === 0 ? "bg-danger-700" : percent >= 70 ? "bg-apricot-400" : "bg-petrol-700")}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <dl className="grid gap-3 border-t border-line pt-3 text-sm sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-ink-600">{t("bookings")}</dt>
          <dd className="text-ink-900">
            {slot.max_bookings === null
              ? t("bookingsNoCap", { count: slot.bookings_count })
              : t("bookingsCap", { count: slot.bookings_count, max: slot.max_bookings })}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-ink-600">{t("holds")}</dt>
          <dd className="text-ink-900">{t("holdsValue", { active: slot.holds.active, converted: slot.holds.converted })}</dd>
        </div>
        <div className="flex flex-col gap-0.5 sm:col-span-2">
          <dt className="text-xs font-medium text-ink-600">{t("rule")}</dt>
          <dd className="text-ink-900">
            {slot.rule ? (
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  {ruleText.effect(slot.rule)}
                  {slot.rule.source === "override" && (
                    <StatusBadge tone="pending" className="ms-2">
                      {text.ruleSource("override")}
                    </StatusBadge>
                  )}
                </span>
                <span className="text-xs text-ink-600">{ruleText.scope(slot.rule).join(" · ")}</span>
                {slot.rule.reason && <span className="text-xs text-ink-600">{t("ruleReason", { reason: slot.rule.reason })}</span>}
              </span>
            ) : (
              t("noRule")
            )}
          </dd>
        </div>
      </dl>

      {can(CAPACITY_OVERRIDE_PERMISSION) &&
        (options.length > 0 ? (
          <Button
            variant="secondary"
            className="self-start"
            onClick={onOverride}
            icon={<ShieldAlert aria-hidden className="size-4" />}
            aria-label={t("overrideLabel", { slot: text.name(slot.name), time: `${slot.start}–${slot.end}` })}
          >
            {t("override")}
          </Button>
        ) : (
          slot.status !== "available" &&
          slot.status !== "limited" && <Notice tone="neutral">{t("hardLimit")}</Notice>
        ))}
    </Card>
  );
}
