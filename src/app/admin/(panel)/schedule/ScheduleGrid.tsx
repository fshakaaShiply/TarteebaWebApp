"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRightLeft, GripVertical, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type DragEvent, type ReactNode } from "react";
import { Button, EmptyState, IconButton, Notice, StatusBadge, useToast, type StatusTone } from "@/components/admin";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { fetchAllVehicles } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import {
  cellCards,
  isDropTarget,
  isMovable,
  unassignedCards,
  type DragSource,
  type DropTarget,
} from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import type { ScheduleGrid, ScheduleMarker, ScheduleRow, VisitSummary } from "@/lib/admin/types";
import { useZoneName } from "../_ops/options";
import { useOpsText } from "../_ops/opsText";
import { Ltr, SlotLabel } from "../bookings/_components/BookingBits";
import { useBookingText, visitTone } from "../bookings/_components/bookingText";
import { MoveDialog } from "./MoveDialog";
import { attemptMove, isStale, useAfterMove, type MoveOutcome } from "./moveFlow";
import { RescheduleHandoff } from "./RescheduleHandoff";

/*
 * Day and week boards (spec §17 A04; design AdminSchedule.dc.html): cleaner rows × slot columns (day) or date columns
 * (week), the unassigned lane on top, each cell with its visit cards and the day markers (rest day, leave, Live-out day,
 * not on shift). A card is dragged onto another cleaner's cell, or moved with its Move button (the same flow, without a
 * mouse). Reading needs schedule.view; moving needs assignments.manage (the API checks it again).
 */

type Column = { key: string; date: string; slotId: number | null; header: ReactNode };

/** The colour of a card: the request's state while it is pending (spec §16), then the visit's (§27.5). */
export function cardTone(card: VisitSummary): StatusTone {
  if (card.booking.status === "pending_confirmation" || card.booking.status === "alternative_proposed") return "pending";
  return visitTone[card.status] ?? "neutral";
}

const toneBorder: Record<StatusTone, string> = {
  pending: "border-s-warning-700",
  confirmed: "border-s-petrol-700",
  progress: "border-s-info-700",
  success: "border-s-success-700",
  danger: "border-s-danger-700",
  neutral: "border-s-line-strong",
};

type Banner = { reference: string; name: string; conflicts?: { code: string; message: string }[]; error?: unknown };

export function ScheduleGridView({ board }: { board: ScheduleGrid }) {
  const t = useTranslations("admin.schedule");
  const text = useOpsText();
  const toast = useToast();
  const { can, canAny } = useAdminSession();
  const canMove = can("assignments.manage");
  const after = useAfterMove();
  const vehicles = useQuery({
    queryKey: adminKeys.vehicleList({ all: 1 }),
    queryFn: fetchAllVehicles,
    staleTime: 60_000,
    enabled: canAny(["fleet.manage", "schedule.view"]),
  });
  const plateOf = (id: number | null) => (id === null ? null : (vehicles.data?.find((v) => v.id === id)?.plate_no ?? null));
  const nameOf = (id: number) => board.rows.find((r) => r.worker.id === id)?.worker.display_name ?? `#${id}`;

  const [drag, setDrag] = useState<DragSource | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ visitId: number; message: string } | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [dialog, setDialog] = useState<{ source: DragSource; target?: DropTarget; outcome?: MoveOutcome } | null>(null);
  const [reschedule, setReschedule] = useState<{ source: DragSource; date: string; slotId: number | null } | null>(null);

  const columns: Column[] =
    board.view === "day"
      ? board.slots.map((s) => ({
          key: `${board.date}:${s.id}`,
          date: board.date,
          slotId: s.id,
          header: <SlotLabel name={s.name} start={s.start} end={s.end} />,
        }))
      : board.dates.map((d) => ({ key: d, date: d, slotId: null, header: text.dateShort(d) }));

  /** The answer to a finished attempt, wherever it started (a drop or the Move dialog). */
  const settle = (source: DragSource, target: DropTarget, outcome: MoveOutcome) => {
    const reference = source.card.booking.reference;
    const name = nameOf(target.workerId);
    if (outcome.kind === "saved") {
      toast.success(
        source.fromWorkerId === null
          ? t("drag.added", { reference, name })
          : t("drag.replaced", { reference, name, from: nameOf(source.fromWorkerId) }),
      );
      after(source.card);
      return;
    }
    if (outcome.kind === "reschedule") {
      setReschedule({ source, date: outcome.date, slotId: outcome.slotId });
      return;
    }
    if (outcome.kind === "override") {
      setDialog({ source, target, outcome });
      return;
    }
    if (outcome.kind === "error" && isStale(outcome.error)) after(source.card);
    setBanner({ reference, name, ...(outcome.kind === "conflicts" ? { conflicts: outcome.conflicts } : { error: outcome.error }) });
  };

  const drop = async (source: DragSource, target: DropTarget) => {
    setBanner(null);
    setBusy({ visitId: source.card.id, message: t("drag.checking", { reference: source.card.booking.reference, name: nameOf(target.workerId) }) });
    const outcome = await attemptMove(source, target);
    setBusy(null);
    settle(source, target, outcome);
  };

  const dropHandlers = (row: ScheduleRow, column: Column) => {
    const target: DropTarget = { workerId: row.worker.id, date: column.date, slotId: column.slotId };
    const key = `${row.worker.id}:${column.key}`;
    const allowed = !!drag && isDropTarget(drag, target);
    return {
      key,
      active: allowed && hover === key,
      onDragOver: (e: DragEvent) => {
        if (!allowed) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        if (hover !== key) setHover(key);
      },
      onDragLeave: () => setHover((h) => (h === key ? null : h)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setHover(null);
        const source = drag;
        setDrag(null);
        if (source && isDropTarget(source, target)) void drop(source, target);
      },
    };
  };

  const card = (c: VisitSummary, fromWorkerId: number | null) => (
    <VisitCard
      key={`${c.id}:${fromWorkerId ?? "lane"}`}
      card={c}
      showTime={board.view === "week"}
      plate={plateOf(c.vehicle_id)}
      busy={busy?.visitId === c.id}
      draggable={canMove && isMovable(c) && busy === null}
      canMove={canMove && isMovable(c)}
      onDragStart={() => {
        setBanner(null);
        setDrag({ card: c, fromWorkerId });
      }}
      onDragEnd={() => {
        setDrag(null);
        setHover(null);
      }}
      onMove={() => setDialog({ source: { card: c, fromWorkerId } })}
    />
  );

  return (
    <>
      <p className="text-sm text-ink-600">{canMove ? t("grid.hint") : t("grid.readOnly")}</p>
      <p role="status" aria-live="polite" className="sr-only">
        {busy?.message ?? ""}
      </p>
      {banner && <MoveBanner banner={banner} onDismiss={() => setBanner(null)} />}

      <div className="overflow-x-auto rounded-lg bg-surface shadow-card">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <caption className="sr-only">{t("grid.caption", { view: t(`views.${board.view}`) })}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-48 px-3 py-2.5 text-start font-bold text-ink-900">
                {t("grid.worker")}
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-3 py-2.5 text-start font-bold text-ink-900">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line bg-apricot-100/40">
              <th scope="row" className="px-3 py-3 text-start align-top">
                <span className="block font-bold text-ink-900">{t("grid.unassigned")}</span>
                <span className="text-xs font-normal text-ink-600">{t("grid.unassignedCount", { count: board.unassigned.length })}</span>
              </th>
              {columns.map((c) => {
                const cards = unassignedCards(board, c.date, c.slotId);
                return (
                  <td key={c.key} className="px-2 py-2 align-top">
                    <div className="flex flex-col gap-2">
                      {cards.length === 0 ? <span className="text-xs text-ink-600">{t("grid.none")}</span> : cards.map((x) => card(x, null))}
                    </div>
                  </td>
                );
              })}
            </tr>
            {board.rows.map((row) => (
              <WorkerRow key={row.worker.id} row={row} board={board} columns={columns} dropHandlers={dropHandlers} renderCard={card} />
            ))}
          </tbody>
        </table>
        {board.rows.length === 0 && <EmptyState title={t("grid.noWorkers")} body={t("grid.noWorkersBody")} />}
      </div>

      {dialog && (
        <MoveDialog
          board={board}
          source={dialog.source}
          target={dialog.target}
          outcome={dialog.outcome}
          onClose={() => setDialog(null)}
          onSettled={(target, outcome) => {
            setDialog(null);
            settle(dialog.source, target, outcome);
          }}
          onReschedule={() => {
            const { source } = dialog;
            setDialog(null);
            setReschedule({ source, date: source.card.service_date, slotId: null });
          }}
        />
      )}
      {reschedule && (
        <RescheduleHandoff source={reschedule.source} date={reschedule.date} slotId={reschedule.slotId} onClose={() => setReschedule(null)} />
      )}
    </>
  );
}

function WorkerRow({
  row,
  board,
  columns,
  dropHandlers,
  renderCard,
}: {
  row: ScheduleRow;
  board: ScheduleGrid;
  columns: Column[];
  dropHandlers: (row: ScheduleRow, column: Column) => {
    key: string;
    active: boolean;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent) => void;
  };
  renderCard: (card: VisitSummary, fromWorkerId: number | null) => ReactNode;
}) {
  const t = useTranslations("admin.schedule");
  const zoneName = useZoneName();
  const otherZone = board.filters.zone_id !== null && row.worker.home_zone_id !== board.filters.zone_id;
  return (
    <tr className="border-b border-line last:border-b-0">
      <th scope="row" className="px-3 py-3 text-start align-top">
        <span className="block font-bold text-ink-900">{row.worker.display_name}</span>
        <span className="block text-xs font-normal text-ink-600">
          {zoneName(row.worker.home_zone_id)}
          {otherZone ? ` · ${t("grid.otherZone")}` : null}
        </span>
      </th>
      {columns.map((c) => {
        const { key, active, ...handlers } = dropHandlers(row, c);
        const day = row.days.find((d) => d.date === c.date);
        const cards = cellCards(row, c.date, c.slotId);
        return (
          <td
            key={key}
            {...handlers}
            data-drop-target={`${row.worker.id}:${c.date}:${c.slotId ?? "any"}`}
            className={clsx("px-2 py-2 align-top transition-colors", active && "bg-petrol-50 outline-2 -outline-offset-2 outline-petrol-700 outline-dashed")}
          >
            <div className="flex min-h-12 flex-col gap-2">
              {day && day.markers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {day.markers.map((m) => (
                    <MarkerBadge key={m.code} marker={m} />
                  ))}
                </div>
              )}
              {cards.map((x) => renderCard(x, row.worker.id))}
              {cards.length === 0 && (!day || day.markers.length === 0) && <span className="text-xs text-ink-600">{t("grid.free")}</span>}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

const markerTone: Record<string, StatusTone> = {
  rest_day: "neutral",
  not_on_shift: "neutral",
  not_active: "danger",
  leave: "pending",
  live_out: "confirmed",
};

function MarkerBadge({ marker }: { marker: ScheduleMarker }) {
  const t = useTranslations("admin.schedule.markers");
  const ops = useOpsText();
  const label = t.has(marker.code) ? t(marker.code) : ops.name(marker.label);
  return (
    <StatusBadge tone={markerTone[marker.code] ?? "neutral"}>
      {marker.code === "leave" && marker.leave_type ? t("leaveOf", { type: ops.leaveType(marker.leave_type) }) : label}
    </StatusBadge>
  );
}

function VisitCard({
  card,
  showTime,
  plate,
  busy,
  draggable,
  canMove,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: VisitSummary;
  showTime: boolean;
  plate: string | null;
  busy: boolean;
  draggable: boolean;
  canMove: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: () => void;
}) {
  const t = useTranslations("admin.schedule.card");
  const text = useBookingText();
  const tone = cardTone(card);
  const pending = tone === "pending";
  const label = pending ? text.status(card.booking.status, card.booking.status_label) : text.visit(card.status, card.status_label);
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        // A card the user may not move never starts a move (the link inside it may still be dragged as a link).
        if (!draggable) return;
        e.dataTransfer?.setData("text/plain", card.booking.reference);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      aria-busy={busy || undefined}
      data-visit-card={card.id}
      className={clsx(
        "flex flex-col gap-1 rounded-md border border-s-4 border-line bg-surface p-2 shadow-card",
        toneBorder[tone],
        draggable && "cursor-grab active:cursor-grabbing",
        busy && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="flex items-center gap-1">
          {draggable && <GripVertical aria-hidden className="size-3.5 text-ink-600" />}
          <Link href={`/admin/bookings/${card.booking.id}`} className="font-bold">
            <Ltr>{card.booking.reference}</Ltr>
          </Link>
        </span>
        <StatusBadge tone={tone}>{label}</StatusBadge>
      </div>
      {showTime && <SlotLabel className="text-xs text-ink-600" start={card.start} end={card.end} />}
      <span className="text-xs text-ink-900">{card.area || t("noArea")}</span>
      <span className="text-xs text-ink-600">
        {t("team", { assigned: card.assigned_count, count: card.workers_count })}
        {card.missing > 0 && <span className="font-medium text-warning-700"> · {t("missing", { count: card.missing })}</span>}
      </span>
      {card.workers.length > 0 && <span className="text-xs text-ink-600">{card.workers.map((w) => w.display_name).join(t("separator"))}</span>}
      {plate && (
        <span className="text-xs text-ink-600">
          {t("vehicle")} <Ltr>{plate}</Ltr>
        </span>
      )}
      {canMove && (
        <Button
          variant="ghost"
          size="sm"
          className="touch-target self-start px-2"
          onClick={onMove}
          disabled={busy}
          aria-label={t("moveLabel", { reference: card.booking.reference })}
          icon={<ArrowRightLeft aria-hidden className="size-3.5" />}
        >
          {t("move")}
        </Button>
      )}
    </div>
  );
}

/** A refused drop (design: "drag check result … nothing was saved"): the rules in our copy, else the API's message. */
function MoveBanner({ banner, onDismiss }: { banner: Banner; onDismiss: () => void }) {
  const t = useTranslations("admin.schedule.drag");
  const rules = useTranslations("admin.bookings.assignment.rules");
  const describe = useAdminErrorMessage();
  const conflictText = (c: { code: string; message: string }) => (rules.has(c.code) ? rules(c.code) : c.message || rules("unknown"));
  return (
    <Notice
      tone="danger"
      title={t("refusedTitle", { reference: banner.reference, name: banner.name })}
      action={
        <IconButton label={t("dismiss")} onClick={onDismiss} className="size-8 self-end">
          <X aria-hidden className="size-4" />
        </IconButton>
      }
    >
      {banner.conflicts ? (
        <ul className="list-inside list-disc">
          {banner.conflicts.map((c) => (
            <li key={c.code}>{conflictText(c)}</li>
          ))}
        </ul>
      ) : (
        <p>{isStale(banner.error) ? t("stale") : describe(banner.error)}</p>
      )}
      <p>{t("nothingSaved")}</p>
    </Notice>
  );
}
