"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw, Route, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterBar,
  IconButton,
  LoadingBlock,
  Notice,
  PageHeader,
  Select,
  TextField,
  useToast,
} from "@/components/admin";
import { fetchRounds, planRounds } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { addDaysIso, businessToday, isIsoDate } from "@/lib/admin/format";
import { adminKeys } from "@/lib/admin/keys";
import { TRIPS_READ } from "@/lib/admin/nav";
import { useAdminSession } from "@/lib/admin/session";
import type { PlanResult, Round, ScheduleSlot } from "@/lib/admin/types";
import { RequirePermission } from "../../_components/RequirePermission";
import { useDaySlots } from "../_ops/daySlots";
import { useChoiceOptions, useZoneChoices } from "../_ops/options";
import { useOpsText } from "../_ops/opsText";
import { useZoneInUrl } from "../_ops/zoneParam";
import { Ltr, SlotLabel } from "../bookings/_components/BookingBits";
import { RoundPanel } from "./RoundPanel";
import { useRoundSaved, useTripText } from "./tripText";

/**
 * A06 trip planner (spec §6.8, §8.3, §14.3 "/rounds", §17 A06; design AdminFleet.dc.html): per date, slot and zone, one
 * panel per round (drop-off or pickup per van) with its vehicle, driver, departure, seat counter, status and the
 * feasibility warnings per stop. trips.manage drafts rounds from the confirmed visits, edits, reorders and seats them,
 * and publishes them to the driver; schedule.view reads them (each stop's area only, RoundPresenter). The date and slot
 * live in the URL, and the shared top-bar zone is mirrored there as zone_id.
 *
 * DECISION: there is no maps key yet, so a round shows its stops as an ordered list with a sketch of the stop order
 * instead of a map.
 */
export function TripPlannerScreen() {
  const t = useTranslations("admin.trips");
  return (
    <RequirePermission anyOf={TRIPS_READ}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <TripPlannerContent />
    </RequirePermission>
  );
}

function slotFromParams(value: string | null): number | null {
  return value !== null && /^\d{1,9}$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

function TripPlannerContent() {
  const t = useTranslations("admin.trips");
  const text = useOpsText();
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can } = useAdminSession();
  const canManage = can("trips.manage");
  // The slot picker, the visits to add and the van list come from the schedule (schedule.view): see the notice below.
  const readsSchedule = can("schedule.view");
  const today = businessToday();
  const dateParam = searchParams.get("date");
  const date = isIsoDate(dateParam) ? dateParam : today;
  const slotId = slotFromParams(searchParams.get("slot_template_id"));
  const zones = useZoneChoices();
  const choiceOptions = useChoiceOptions();
  const saved = useRoundSaved();

  const writeParams = useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );
  // The shared top-bar zone, kept in the URL as zone_id beside the date and slot (a link opens the same rounds).
  const { zoneId: effectiveZone, setZoneId } = useZoneInUrl(searchParams, writeParams);
  const slots = useDaySlots(date, effectiveZone);

  const roundsQuery = { date, slotTemplateId: slotId, zoneId: effectiveZone };
  const rounds = useQuery({
    queryKey: adminKeys.roundList({ date, slot: slotId ?? 0, zone: effectiveZone ?? 0 }),
    queryFn: () => fetchRounds(roundsQuery),
    placeholderData: keepPreviousData,
  });

  /** A draft belongs to the date, slot and zone it was run for: its result and its refusal show only there. */
  type Run = { date: string; slot_template_id: number; zone_id: number | null };
  const draft = useMutation({
    mutationFn: (run: Run) => planRounds(run),
    onSuccess: (result) => {
      saved();
      toast.success(t("plan.done", { count: result.rounds.length }));
    },
  });
  const [closed, setClosed] = useState<PlanResult | null>(null);
  const ran = draft.variables;
  const forThisPage = !!ran && ran.date === date && ran.slot_template_id === slotId && ran.zone_id === effectiveZone;
  const plan = forThisPage && draft.data && draft.data !== closed ? draft.data : null;
  const draftError = forThisPage ? draft.error : null;

  /** The date and slot stay in the URL (a link from the overview or the schedule opens the same rounds). */
  const setParams = useCallback(
    (next: { date?: string; slot?: number | null }) => {
      const params = new URLSearchParams(searchParams);
      const nextDate = next.date ?? date;
      if (nextDate === today) params.delete("date");
      else params.set("date", nextDate);
      const nextSlot = next.slot === undefined ? slotId : next.slot;
      if (nextSlot === null) params.delete("slot_template_id");
      else params.set("slot_template_id", String(nextSlot));
      writeParams(params);
    },
    [searchParams, date, slotId, today, writeParams],
  );

  const slotList: ScheduleSlot[] = slots.data ?? [];
  const groups = groupBySlot(rounds.data ?? [], slotList);
  const planSlot = plan ? (slotList.find((s) => s.id === plan.slot_template_id) ?? null) : null;

  return (
    <>
      <Card>
        <FilterBar>
          <div className="flex items-end gap-1">
            <Button
              variant="outline"
              className="h-11 px-3"
              aria-label={t("previousDay")}
              onClick={() => setParams({ date: addDaysIso(date, -1) })}
              icon={<ChevronRight aria-hidden className="size-4 ltr:rotate-180" />}
            />
            <TextField
              type="date"
              label={t("date")}
              value={date}
              onChange={(e) => isIsoDate(e.target.value) && setParams({ date: e.target.value })}
              dir="ltr"
              className="font-latin text-start"
              containerClassName="min-w-[170px]"
            />
            <Button
              variant="outline"
              className="h-11 px-3"
              aria-label={t("nextDay")}
              onClick={() => setParams({ date: addDaysIso(date, 1) })}
              icon={<ChevronLeft aria-hidden className="size-4 ltr:rotate-180" />}
            />
          </div>
          <Select
            label={t("slot")}
            value={slotId === null ? "" : String(slotId)}
            onChange={(e) => setParams({ slot: e.target.value ? Number(e.target.value) : null })}
            placeholder={t("allSlots")}
            options={slotList.map((s) => ({ value: String(s.id), label: t("slotOption", { name: text.name(s.name), start: s.start, end: s.end }) }))}
            containerClassName="min-w-[200px]"
          />
          <Select
            label={t("zone")}
            value={effectiveZone === null ? "" : String(effectiveZone)}
            onChange={(e) => setZoneId(e.target.value ? Number(e.target.value) : null)}
            placeholder={t("allZones")}
            options={choiceOptions(zones.data)}
            containerClassName="min-w-[200px]"
          />
          <Button variant="ghost" className="h-11" onClick={() => setParams({ date: today })} disabled={date === today}>
            {t("today")}
          </Button>
        </FilterBar>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink-900">{text.date(date)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void rounds.refetch()}
              loading={rounds.isFetching && !rounds.isPending}
              icon={<RefreshCw aria-hidden className="size-4" />}
            >
              {t("refresh")}
            </Button>
            {canManage && (
              <Button
                onClick={() => slotId !== null && draft.mutate({ date, slot_template_id: slotId, zone_id: effectiveZone })}
                disabled={slotId === null}
                loading={draft.isPending && forThisPage}
                icon={<Route aria-hidden className="size-4" />}
              >
                {t("plan.submit")}
              </Button>
            )}
          </div>
        </div>
        {canManage && !readsSchedule ? (
          <Notice tone="info" title={t("plan.needsScheduleTitle")}>
            {t("plan.needsSchedule")}
          </Notice>
        ) : (
          canManage && slotId === null && <p className="text-xs text-ink-600">{t("plan.chooseSlot")}</p>
        )}
        {draftError ? <Notice tone="danger">{describe(draftError)}</Notice> : null}
        <p className="text-xs text-ink-600">{t("mapNote")}</p>
      </Card>

      {plan && <PlanResultCard plan={plan} slot={planSlot} onClose={() => setClosed(plan)} />}

      {rounds.isPending ? (
        <LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />
      ) : rounds.isError ? (
        <Card>
          <ErrorState error={rounds.error} onRetry={() => void rounds.refetch()} />
        </Card>
      ) : rounds.data.length === 0 ? (
        <Card>
          <EmptyState title={t("empty")} body={canManage ? t("emptyManage") : t("emptyRead")} />
        </Card>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`slot-${group.key}`} className="flex flex-col gap-3">
            <h2 id={`slot-${group.key}`} className="text-lg/7 font-bold text-ink-900">
              <SlotLabel name={group.slot.name} start={group.slot.start} end={group.slot.end} />
            </h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {group.rounds.map((round) => (
                <RoundPanel key={round.id} round={round} canManage={canManage} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

type SlotGroup = { key: string; slot: Round["slot"]; rounds: Round[] };

/** Rounds by slot in the day's slot order (then by start time), drop-offs before pickups, then by departure. */
function groupBySlot(rounds: readonly Round[], slots: readonly ScheduleSlot[]): SlotGroup[] {
  const order = new Map(slots.map((s, i) => [s.id, i]));
  const groups = new Map<number, SlotGroup>();
  for (const round of rounds) {
    const group = groups.get(round.slot.id) ?? { key: String(round.slot.id), slot: round.slot, rounds: [] };
    group.rounds.push(round);
    groups.set(round.slot.id, group);
  }
  const kindRank = (r: Round) => (r.kind === "dropoff" ? 0 : 1);
  return [...groups.values()]
    .sort((a, b) => (order.get(a.slot.id) ?? 99) - (order.get(b.slot.id) ?? 99) || a.slot.start.localeCompare(b.slot.start))
    .map((g) => ({
      ...g,
      rounds: [...g.rounds].sort((a, b) => kindRank(a) - kindRank(b) || a.planned_depart_at.localeCompare(b.planned_depart_at) || a.id - b.id),
    }));
}

/**
 * What "Draft rounds" did, for the date and slot it ran for (named in the title): rounds created or extended, and the
 * visits it could not place, each with the reason.
 */
function PlanResultCard({ plan, slot, onClose }: { plan: PlanResult; slot: ScheduleSlot | null; onClose: () => void }) {
  const t = useTranslations("admin.trips.plan");
  const trip = useTripText();
  const reasons = useTranslations("admin.trips.unplanned");
  const ops = useOpsText();
  const { can } = useAdminSession();
  const created = plan.rounds.filter((r) => r.plan === "created").length;
  const extended = plan.rounds.filter((r) => r.plan === "extended").length;
  const slotName = slot ? t("slotName", { name: ops.name(slot.name), start: slot.start, end: slot.end }) : null;
  return (
    <Card
      title={slotName ? t("resultTitleFor", { date: ops.dateShort(plan.date), slot: slotName }) : t("resultTitleOn", { date: ops.dateShort(plan.date) })}
      actions={
        <IconButton label={t("close")} onClick={onClose}>
          <X aria-hidden className="size-4" />
        </IconButton>
      }
    >
      <p role="status" className="text-sm text-ink-900">
        {t("summary", { created, extended, already: plan.already_planned.length })}
      </p>
      {plan.unplanned.length === 0 ? (
        <p className="text-sm text-ink-600">{t("allPlaced")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-ink-900">{t("unplannedTitle", { count: plan.unplanned.length })}</h3>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {plan.unplanned.map((u) => (
              <li key={`${u.visit_id}:${u.kind ?? "any"}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex flex-col">
                  {can("bookings.view") ? (
                    <Link href={`/admin/bookings/${u.booking_id}`} className="font-bold">
                      <Ltr>{u.booking_reference}</Ltr>
                    </Link>
                  ) : (
                    <Ltr className="font-bold text-ink-900">{u.booking_reference}</Ltr>
                  )}
                  <span className="text-xs text-ink-600">{u.kind ? trip.kind(u.kind) : t("bothRides")}</span>
                </span>
                <span className="text-ink-900">{reasons.has(u.reason) ? reasons(u.reason) : ops.name(u.message)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
