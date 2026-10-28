"use client";

import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Armchair, GripVertical, Pencil, Plus, Send, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button, IconButton, Notice, StatusBadge, useToast } from "@/components/admin";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { reorderStops } from "@/lib/admin/endpoints";
import { formatDateTime } from "@/lib/admin/format";
import { useAdminSession } from "@/lib/admin/session";
import { isEditable, moveItem, splitWarnings } from "@/lib/admin/trips/rounds";
import type { Round, RoundStop, RoundWarning } from "@/lib/admin/types";
import { useZoneName } from "../_ops/options";
import { useOpsText } from "../_ops/opsText";
import { Ltr } from "../bookings/_components/BookingBits";
import { AddStopDialog, CancelRoundDialog, EditRoundDialog, PassengersDialog, PublishRoundDialog, RemoveStopDialog } from "./RoundDialogs";
import { StopSketch } from "./StopSketch";
import { errorCodeOf, roundTone, stopTone, useRoundSaved, useTripText } from "./tripText";

/*
 * One round of the trip planner (design AdminFleet.dc.html "van panel"): vehicle and zone, driver, departure, seat
 * counter, status, the round's warnings, then the stops in driving order with their ETA and feasibility (§8.3: a drop-off
 * late by more than the allowed minutes, a pickup that leaves a team waiting). A planned round's stops are reordered by
 * dragging or with the move buttons (POST stops/reorder, If-Match); every change answers the recomputed round.
 */

type DialogState = "edit" | "seats" | "add" | "publish" | "cancel" | { remove: RoundStop } | null;

export function RoundPanel({ round, canManage }: { round: Round; canManage: boolean }) {
  const t = useTranslations("admin.trips.round");
  const trip = useTripText();
  const ops = useOpsText();
  const zoneName = useZoneName();
  const toast = useToast();
  const describe = useAdminErrorMessage();
  const saved = useRoundSaved();
  const headingId = useId();
  const editable = canManage && isEditable(round);
  const warnings = splitWarnings(round);
  const [dialog, setDialog] = useState<DialogState>(null);
  /** The new order shown while it is saved, until a round of another version (the answer, or a refetch) arrives. */
  const [order, setOrder] = useState<{ ids: number[]; version: number } | null>(null);
  if (order && order.version !== round.version) setOrder(null);
  const [announce, setAnnounce] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [heading, setHeading] = useState<HTMLHeadingElement | null>(null);
  /** The move button to focus again once its stop has moved (React moves the row, which drops focus). */
  const refocus = useRef<{ stopId: number; dir: "up" | "down" } | null>(null);

  const sorted = [...round.stops].sort((a, b) => a.sequence - b.sequence);
  const shown = order && order.version === round.version ? order.ids : null;
  const stops = shown ? shown.map((id) => sorted.find((s) => s.id === id)).filter((s): s is RoundStop => !!s) : sorted;

  const reorder = useMutation({
    mutationFn: (ids: number[]) => reorderStops(round.id, ids, round.version),
    onSuccess: (updated) => saved(updated),
    onError: (error) => {
      setOrder(null);
      setAnnounce("");
      if (errorCodeOf(error) === "STALE_VERSION") saved();
    },
  });

  // After a keyboard move the row is in its new place: its move button gets focus back (the other one at an end).
  useEffect(() => {
    const target = refocus.current;
    if (!target || !listRef.current) return;
    if (!reorder.isPending && shown === null) refocus.current = null;
    // Focus fell to the page, or stayed on the button that is now disabled (the stop reached an end of the list).
    const active = document.activeElement;
    const lost = !active || active === document.body || (active instanceof HTMLButtonElement && active.disabled);
    if (!lost) return;
    const pick = (dir: string) => {
      const button = listRef.current?.querySelector<HTMLButtonElement>(`button[data-stop="${target.stopId}"][data-dir="${dir}"]`);
      return button && !button.disabled ? button : null;
    };
    (pick(target.dir) ?? pick(target.dir === "up" ? "down" : "up"))?.focus();
  });

  const move = (from: number, to: number, dir?: "up" | "down") => {
    if (to < 0 || to >= stops.length || from === to || reorder.isPending) return;
    const ids = moveItem(
      stops.map((s) => s.id),
      from,
      to,
    );
    const stop = stops[from];
    refocus.current = dir ? { stopId: stop.id, dir } : null;
    setOrder({ ids, version: round.version });
    setAnnounce(t("movedTo", { reference: stop.booking.reference, position: to + 1, count: stops.length }));
    reorder.mutate(ids);
  };

  const close = () => setDialog(null);

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 rounded-lg bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 ref={setHeading} id={headingId} tabIndex={-1} className="text-base font-bold text-ink-900 outline-none">
            {trip.kind(round.kind, round.kind_label)} · <Ltr>{round.vehicle.plate_no}</Ltr>
          </h3>
          <span className="text-sm text-ink-600">
            {round.zone ? ops.name(round.zone.name) : zoneName(null)}
            {round.vehicle.model ? ` · ${round.vehicle.model}` : null}
          </span>
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={roundTone[round.status] ?? "neutral"}>{trip.roundStatus(round.status, round.status_label)}</StatusBadge>
          {round.status === "planned" && (
            <StatusBadge tone={round.published ? "success" : "neutral"}>{round.published ? t("published") : t("notPublished")}</StatusBadge>
          )}
        </span>
      </div>
      {/* An extra round planned after a round already on the road (another van's takeover, R-19, or the same van's second
          trip), as stored: still named after a reload. */}
      {round.follows_round && (
        <p className="text-sm text-ink-900">
          {t.rich("follows", {
            follows: String(round.follows_round.id),
            plate: round.follows_round.plate_no,
            ltr: (chunks: ReactNode) => (
              <bdi dir="ltr" className="font-latin">
                {chunks}
              </bdi>
            ),
          })}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-600">{t("driver")}</dt>
        <dd className={clsx(round.driver ? "text-ink-900" : "font-medium text-danger-700")}>
          {round.driver ? round.driver.name : t("noDriver")}
          {round.driver && round.driver.status !== "active" ? ` · ${ops.driverStatus(round.driver.status)}` : null}
        </dd>
        <dt className="text-ink-600">{t("departure")}</dt>
        <dd className="text-ink-900">
          {t("departs", { time: round.depart_local })} · {t("ends", { time: round.end_local })}
        </dd>
        <dt className="text-ink-600">{t("seats")}</dt>
        <dd>
          <SeatMeter used={round.seats.used} total={round.seats.total} label={t("seatsMeter", { plate: round.vehicle.plate_no })} />
        </dd>
        {round.published_at && (
          <>
            <dt className="text-ink-600">{t("publishedAt")}</dt>
            <dd className="text-ink-900">{formatDateTime(round.published_at, ops.locale)}</dd>
          </>
        )}
        {round.last_action && (
          <>
            <dt className="text-ink-600">{t("lastAction")}</dt>
            <dd className="text-ink-900">
              {t.has(`driverAction.${round.last_action.action}`) ? t(`driverAction.${round.last_action.action}`) : round.last_action.action} ·{" "}
              {formatDateTime(round.last_action.occurred_at, ops.locale)}
            </dd>
          </>
        )}
        {round.status === "cancelled" && round.cancel_reason && (
          <>
            <dt className="text-ink-600">{t("cancelReason")}</dt>
            <dd className="text-ink-900">{round.cancel_reason}</dd>
          </>
        )}
      </dl>

      {warnings.round.length > 0 && <WarningList warnings={warnings.round} />}

      {stops.length === 0 ? (
        <p className="text-sm text-ink-600">{t("noStops")}</p>
      ) : (
        <>
          <h4 className="text-sm font-bold text-ink-900">{t("stopsTitle", { count: stops.length })}</h4>
          {editable && stops.length > 1 && <p className="text-xs text-ink-600">{t("reorderHint")}</p>}
          <ol ref={listRef} className={clsx("flex flex-col gap-2", reorder.isPending && "opacity-70")} aria-busy={reorder.isPending || undefined}>
            {stops.map((stop, i) => (
              <StopItem
                key={stop.id}
                round={round}
                stop={stop}
                position={i + 1}
                count={stops.length}
                warnings={warnings.byStop.get(stop.id) ?? []}
                editable={editable}
                dragOver={overIndex === i && dragIndex !== null && dragIndex !== i}
                dragHandlers={
                  editable && stops.length > 1
                    ? {
                        draggable: !reorder.isPending,
                        onDragStart: (e) => {
                          e.dataTransfer?.setData("text/plain", String(stop.id));
                          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                          setDragIndex(i);
                        },
                        onDragOver: (e) => {
                          if (dragIndex === null || dragIndex === i) return;
                          e.preventDefault();
                          if (overIndex !== i) setOverIndex(i);
                        },
                        onDrop: (e) => {
                          e.preventDefault();
                          const from = dragIndex;
                          setDragIndex(null);
                          setOverIndex(null);
                          if (from !== null) move(from, i);
                        },
                        onDragEnd: () => {
                          setDragIndex(null);
                          setOverIndex(null);
                        },
                      }
                    : undefined
                }
                controls={
                  editable ? (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <IconButton
                        label={t("moveUp", { reference: stop.booking.reference })}
                        data-stop={stop.id}
                        data-dir="up"
                        disabled={i === 0}
                        onClick={() => move(i, i - 1, "up")}
                        className="size-9"
                      >
                        <ArrowUp aria-hidden className="size-4" />
                      </IconButton>
                      <IconButton
                        label={t("moveDown", { reference: stop.booking.reference })}
                        data-stop={stop.id}
                        data-dir="down"
                        disabled={i === stops.length - 1}
                        onClick={() => move(i, i + 1, "down")}
                        className="size-9"
                      >
                        <ArrowDown aria-hidden className="size-4" />
                      </IconButton>
                      <IconButton
                        label={t("removeStop", { reference: stop.booking.reference })}
                        onClick={() => setDialog({ remove: stop })}
                        className="size-9 text-danger-700"
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </IconButton>
                    </span>
                  ) : null
                }
              />
            ))}
          </ol>
          <p role="status" aria-live="polite" className="sr-only">
            {announce}
          </p>
          {reorder.error ? <Notice tone="danger">{errorCodeOf(reorder.error) === "STALE_VERSION" ? t("stale") : describe(reorder.error)}</Notice> : null}
          <StopSketch round={round} stops={stops} />
        </>
      )}

      {editable && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button variant="secondary" size="sm" onClick={() => setDialog("edit")} icon={<Pencil aria-hidden className="size-4" />}>
            {t("edit")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDialog("seats")} icon={<Armchair aria-hidden className="size-4" />}>
            {t("seatsAction")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDialog("add")} icon={<Plus aria-hidden className="size-4" />}>
            {t("addStop")}
          </Button>
          <Button size="sm" onClick={() => setDialog("publish")} icon={<Send aria-hidden className="size-4 rtl:-scale-x-100" />}>
            {round.published ? t("publishAgain") : t("publish")}
          </Button>
          <Button variant="outline" size="sm" className="text-danger-700" onClick={() => setDialog("cancel")} icon={<XCircle aria-hidden className="size-4" />}>
            {t("cancelRound")}
          </Button>
        </div>
      )}

      {dialog === "edit" && <EditRoundDialog round={round} onClose={close} returnFocusTo={heading} />}
      {dialog === "seats" && <PassengersDialog round={round} onClose={close} returnFocusTo={heading} />}
      {dialog === "add" && <AddStopDialog round={round} onClose={close} returnFocusTo={heading} />}
      {dialog === "publish" && (
        <PublishRoundDialog
          round={round}
          onClose={close}
          returnFocusTo={heading}
          onDone={() => toast.success(t("publishedToast", { plate: round.vehicle.plate_no }))}
        />
      )}
      {dialog === "cancel" && <CancelRoundDialog round={round} onClose={close} returnFocusTo={heading} />}
      {dialog && typeof dialog === "object" && <RemoveStopDialog round={round} stop={dialog.remove} onClose={close} returnFocusTo={heading} />}
    </section>
  );
}

type DragHandlers = {
  draggable: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
};

/** Where the van stops: the building, unit and area (the area only for viewers without the full address). */
export function stopPlace(stop: RoundStop): string {
  const a = stop.address ?? {};
  return [a.building, a.unit_number ? `#${a.unit_number}` : null, a.area].filter(Boolean).join(" · ");
}

function StopItem({
  round,
  stop,
  position,
  count,
  warnings,
  editable,
  dragOver,
  dragHandlers,
  controls,
}: {
  round: Round;
  stop: RoundStop;
  position: number;
  count: number;
  warnings: RoundWarning[];
  editable: boolean;
  dragOver: boolean;
  dragHandlers?: DragHandlers;
  controls: ReactNode;
}) {
  const t = useTranslations("admin.trips.round");
  const trip = useTripText();
  const { can } = useAdminSession();
  const late = warnings.find((w) => w.type === "late_stop");
  const pickupLate = warnings.find((w) => w.type === "pickup_late");
  const place = stopPlace(stop);
  return (
    <li
      {...dragHandlers}
      aria-label={t("stopLabel", { position, count, reference: stop.booking.reference })}
      className={clsx(
        "flex items-start gap-3 rounded-md border p-3",
        warnings.length > 0 ? "border-warning-700/40 bg-apricot-100/30" : "border-line",
        dragOver && "outline-2 outline-petrol-700 outline-dashed",
        dragHandlers?.draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="flex shrink-0 items-center gap-1">
        {editable && dragHandlers && <GripVertical aria-hidden className="size-4 text-ink-600" />}
        <span aria-hidden className="flex size-7 items-center justify-center rounded-pill bg-petrol-700 font-latin text-sm font-bold text-white">
          {position}
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          {/* The booking page needs bookings.view (HR reads the planner without it): plain text otherwise. */}
          {can("bookings.view") ? (
            <Link href={`/admin/bookings/${stop.booking.id}`} className="font-bold">
              <Ltr>{stop.booking.reference}</Ltr>
            </Link>
          ) : (
            <Ltr className="font-bold text-ink-900">{stop.booking.reference}</Ltr>
          )}
          <StatusBadge tone={stopTone[stop.status] ?? "neutral"}>{trip.stopStatus(stop.status, stop.status_label)}</StatusBadge>
        </span>
        <span className="text-ink-900">{place || t("noAddress")}</span>
        <span className="text-xs text-ink-600">
          {stop.workers.length > 0 ? stop.workers.map((w) => w.display_name).join(t("separator")) : t("noTeam")}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
          {stop.eta_local && (
            <span>{round.kind === "dropoff" ? t("etaDropoff", { time: stop.eta_local }) : t("etaPickup", { time: stop.eta_local })}</span>
          )}
          <span>{t("slotTimes", { start: stop.slot_start, end: stop.slot_end })}</span>
          {late ? (
            <StatusBadge tone="danger">{t("lateBy", { minutes: Number(late.late_by_minutes ?? stop.late_by_minutes ?? 0) })}</StatusBadge>
          ) : stop.late_by_minutes ? (
            <span>{t("afterStart", { minutes: stop.late_by_minutes })}</span>
          ) : null}
          {pickupLate ? (
            <StatusBadge tone="danger">{t("waitsTooLong", { minutes: Number(pickupLate.wait_minutes ?? stop.wait_minutes ?? 0) })}</StatusBadge>
          ) : stop.wait_minutes ? (
            <span>{t("teamWaits", { minutes: stop.wait_minutes })}</span>
          ) : null}
        </span>
        {stop.failure_reason && <span className="text-xs text-danger-700">{t("failure", { reason: stop.failure_reason })}</span>}
        {warnings.length > 0 && <WarningList warnings={warnings} compact />}
      </div>
      {controls}
    </li>
  );
}

function WarningList({ warnings, compact }: { warnings: RoundWarning[]; compact?: boolean }) {
  const t = useTranslations("admin.trips.round");
  const trip = useTripText();
  if (compact) {
    return (
      <ul className="flex flex-col gap-0.5 text-xs font-medium text-warning-700">
        {warnings.map((w, i) => (
          <li key={`${w.type}-${i}`}>{trip.warning(w)}</li>
        ))}
      </ul>
    );
  }
  return (
    <Notice tone="warning" title={t("warningsTitle", { count: warnings.length })}>
      <ul className="list-inside list-disc">
        {warnings.map((w, i) => (
          <li key={`${w.type}-${i}`}>{trip.warning(w)}</li>
        ))}
      </ul>
    </Notice>
  );
}

function SeatMeter({ used, total, label }: { used: number; total: number; label: string }) {
  const t = useTranslations("admin.trips.round");
  const percent = total > 0 ? Math.min(100, Math.round((100 * used) / total)) : 0;
  return (
    <span className="flex flex-col gap-1">
      <span className="font-latin text-ink-900">{t("seatsUsed", { used, total })}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        aria-valuetext={t("seatsUsed", { used, total })}
        className="h-1.5 w-40 overflow-hidden rounded-pill bg-neutral-100"
      >
        <span className={clsx("block h-full rounded-pill", used > total ? "bg-danger-700" : "bg-petrol-700")} style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}
