"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRightLeft, ClipboardCheck, GripVertical, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useId, useState, type DragEvent, type ReactNode } from "react";
import { Button, EmptyState, IconButton, Notice, StatusBadge, useToast, type StatusTone } from "@/components/admin";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { fetchAllVehicles } from "@/lib/admin/endpoints";
import { adminKeys } from "@/lib/admin/keys";
import {
  cellCards,
  droppedOnOtherWorker,
  isDropTarget,
  isLaneDropTarget,
  isMovable,
  isRescheduleDrop,
  rescheduleSlotOf,
  unassignedCards,
  type DragSource,
  type DropPlace,
  type DropTarget,
} from "@/lib/admin/schedule/board";
import { useAdminSession } from "@/lib/admin/session";
import type { ScheduleGrid, ScheduleMarker, ScheduleRow, VisitSummary } from "@/lib/admin/types";
import { useZoneName } from "../_ops/options";
import { useOpsText } from "../_ops/opsText";
import { Ltr, SlotLabel } from "../bookings/_components/BookingBits";
import { useBookingText, visitTone } from "../bookings/_components/bookingText";
import { useFocusRescue } from "../bookings/_components/focus";
import { MoveDialog } from "./MoveDialog";
import { attemptMove, isStale, useAfterMove, type MoveOutcome } from "./moveFlow";
import { RescheduleHandoff } from "./RescheduleHandoff";
import { ReviewDrawer } from "./ReviewDrawer";

/*
 * Day and week boards (spec §17 A04; design AdminSchedule.dc.html): cleaner rows × slot columns (day) or date columns
 * (week), the unassigned lane on top, each cell with its visit cards and the day markers (rest day, leave, Live-out day,
 * not on shift). A card dropped on another cleaner's cell at its own time is a team change (checked first by the dry
 * run); dropped on another date or slot, in any row, it is a reschedule, handed to the booking's reschedule dialog. Its
 * Move button does the same without a mouse, and its Review button opens the booking's review panel (the design's
 * "Schedule & review"). Reading needs schedule.view; moving needs assignments.manage (the API checks it again).
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

/** The row a card is shown in: a worker's id, or the unassigned lane. */
const rowKey = (workerId: number | null) => (workerId === null ? "lane" : String(workerId));

type CardAction = "move" | "review";
type Banner = { reference: string; name: string; conflicts?: { code: string; message: string }[]; error?: unknown };
type Reschedule = { source: DragSource; date: string; slotId: number | null; dropWorkerId: number | null };

export function ScheduleGridView({ board }: { board: ScheduleGrid }) {
  const t = useTranslations("admin.schedule");
  const text = useOpsText();
  const toast = useToast();
  const { can, canAny } = useAdminSession();
  const canMove = can("assignments.manage");
  const canReview = can("bookings.view");
  const after = useAfterMove();
  const headingId = useId();
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
  const [reschedule, setReschedule] = useState<Reschedule | null>(null);
  const [review, setReview] = useState<{ card: VisitSummary; row: string } | null>(null);

  // ---- focus: a card is re-mounted in another row after a move or a refetch, which drops focus to the page ----------
  const gridId = useId();
  const [heading, setHeading] = useState<HTMLHeadingElement | null>(null);
  /** The row a visit was just moved to (written on the grid as data-moved-*, read when focus has to find the card). */
  const [movedTo, setMovedTo] = useState<{ visitId: number; row: string } | null>(null);
  /**
   * The visit's Move or Review button on the board now: in the row it was just moved to, else `row`, else wherever the
   * card is shown. It reads the page when it is called (a dialog closing, a refetch landing), not when it was made.
   */
  const cardButton = useCallback(
    (visitId: number, action: CardAction, row?: string): HTMLElement | null => {
      const root = document.getElementById(gridId);
      if (!root) return null;
      const moved = root.dataset.movedVisit === String(visitId) ? root.dataset.movedRow : undefined;
      const card = (r?: string) => `[data-visit-card="${visitId}"]${r ? `[data-row="${r}"]` : ""}`;
      const pick = (r?: string) =>
        root.querySelector<HTMLElement>(`${card(r)} [data-card-action="${action}"]`) ?? root.querySelector<HTMLElement>(`${card(r)} [data-card-action]`);
      return (moved ? pick(moved) : null) ?? (row ? pick(row) : null) ?? pick();
    },
    [gridId],
  );
  /** Focus on closing a card's dialog when its button is gone: the same card where it is now, else the board heading. */
  const backTo = (visitId: number, action: CardAction, row: string) => () => cardButton(visitId, action, row) ?? heading;
  // A refetch that takes the focused card out of its row: the same visit's button in its new row, else the heading.
  useFocusRescue((removed) => {
    const cardEl = removed.closest("[data-visit-card]");
    const visitId = cardEl ? Number(cardEl.getAttribute("data-visit-card")) : null;
    const action = (removed.getAttribute("data-card-action") as CardAction | null) ?? "move";
    return (visitId !== null ? cardButton(visitId, action) : null) ?? heading;
  }, board);

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
      setMovedTo({ visitId: source.card.id, row: rowKey(target.workerId) });
      toast.success(
        source.fromWorkerId === null
          ? t("drag.added", { reference, name })
          : t("drag.replaced", { reference, name, from: nameOf(source.fromWorkerId) }),
      );
      after(source.card);
      return;
    }
    if (outcome.kind === "reschedule") {
      setReschedule({ source, date: outcome.date, slotId: outcome.slotId ?? source.card.slot_template_id, dropWorkerId: droppedOnOtherWorker(source, target) });
      return;
    }
    if (outcome.kind === "override") {
      setDialog({ source, target, outcome });
      return;
    }
    // A refused move may have raced another change (a stale version always has): the board reloads.
    if (outcome.kind === "error") after(source.card);
    setBanner({ reference, name, ...(outcome.kind === "conflicts" ? { conflicts: outcome.conflicts } : { error: outcome.error }) });
  };

  const drop = async (source: DragSource, target: DropTarget) => {
    setBanner(null);
    setBusy({ visitId: source.card.id, message: t("drag.checking", { reference: source.card.booking.reference, name: nameOf(target.workerId) }) });
    const outcome = await attemptMove(source, target);
    setBusy(null);
    settle(source, target, outcome);
  };

  /** Another date or slot: the booking's reschedule dialog, with the drop's date and time (no team change is sent). */
  const dropToReschedule = (source: DragSource, place: DropTarget | DropPlace) => {
    setBanner(null);
    setReschedule({ source, date: place.date, slotId: rescheduleSlotOf(source, place), dropWorkerId: droppedOnOtherWorker(source, place) });
  };

  const cellHandlers = (key: string, accepts: (source: DragSource) => boolean, onAccept: (source: DragSource) => void) => {
    const allowed = !!drag && accepts(drag);
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
        if (source && accepts(source)) onAccept(source);
      },
    };
  };

  const dropHandlers = (row: ScheduleRow, column: Column) => {
    const target: DropTarget = { workerId: row.worker.id, date: column.date, slotId: column.slotId };
    return cellHandlers(
      `${row.worker.id}:${column.key}`,
      (source) => isDropTarget(source, target),
      (source) => (isRescheduleDrop(source, target) ? dropToReschedule(source, target) : void drop(source, target)),
    );
  };

  const laneHandlers = (column: Column) => {
    const place: DropPlace = { date: column.date, slotId: column.slotId };
    return cellHandlers(
      `lane:${column.key}`,
      (source) => isLaneDropTarget(source, place),
      (source) => dropToReschedule(source, place),
    );
  };

  const card = (c: VisitSummary, fromWorkerId: number | null) => (
    <VisitCard
      key={`${c.id}:${rowKey(fromWorkerId)}`}
      card={c}
      row={rowKey(fromWorkerId)}
      showTime={board.view === "week"}
      plate={plateOf(c.vehicle_id)}
      busy={busy?.visitId === c.id}
      draggable={canMove && isMovable(c) && busy === null}
      canMove={canMove && isMovable(c)}
      canReview={canReview}
      onDragStart={() => {
        setBanner(null);
        setDrag({ card: c, fromWorkerId });
      }}
      onDragEnd={() => {
        setDrag(null);
        setHover(null);
      }}
      onMove={() => setDialog({ source: { card: c, fromWorkerId } })}
      onReview={() => setReview({ card: c, row: rowKey(fromWorkerId) })}
    />
  );

  return (
    <>
      <h2 ref={setHeading} id={headingId} tabIndex={-1} className="sr-only">
        {t("grid.caption", { view: t(`views.${board.view}`) })}
      </h2>
      <p className="text-sm text-ink-600">{canMove ? t("grid.hint") : t("grid.readOnly")}</p>
      <p role="status" aria-live="polite" className="sr-only">
        {busy?.message ?? ""}
      </p>
      {banner && <MoveBanner banner={banner} onDismiss={() => setBanner(null)} />}

      <div
        id={gridId}
        data-moved-visit={movedTo?.visitId}
        data-moved-row={movedTo?.row}
        className="overflow-x-auto rounded-lg bg-surface shadow-card"
      >
        <table aria-labelledby={headingId} className="w-full min-w-[760px] border-collapse text-sm">
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
                const { key, active, ...handlers } = laneHandlers(c);
                return (
                  <td
                    key={key}
                    {...handlers}
                    data-drop-target={`lane:${c.date}:${c.slotId ?? "any"}`}
                    className={clsx("px-2 py-2 align-top transition-colors", active && "bg-petrol-50 outline-2 -outline-offset-2 outline-petrol-700 outline-dashed")}
                  >
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
          returnFocusTo={backTo(dialog.source.card.id, "move", rowKey(dialog.source.fromWorkerId))}
          onClose={() => setDialog(null)}
          onSettled={(target, outcome) => {
            setDialog(null);
            settle(dialog.source, target, outcome);
          }}
          onRefresh={() => after(dialog.source.card)}
          onReschedule={() => {
            const { source } = dialog;
            setDialog(null);
            setReschedule({ source, date: source.card.service_date, slotId: null, dropWorkerId: null });
          }}
        />
      )}
      {reschedule && (
        <RescheduleHandoff
          source={reschedule.source}
          date={reschedule.date}
          slotId={reschedule.slotId}
          dropWorkerName={reschedule.dropWorkerId === null ? null : nameOf(reschedule.dropWorkerId)}
          returnFocusTo={backTo(reschedule.source.card.id, "move", rowKey(reschedule.source.fromWorkerId))}
          onClose={() => setReschedule(null)}
        />
      )}
      {review && <ReviewDrawer bookingId={review.card.booking.id} returnFocusTo={backTo(review.card.id, "review", review.row)} onClose={() => setReview(null)} />}
    </>
  );
}

type CellHandlers = {
  key: string;
  active: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
};

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
  dropHandlers: (row: ScheduleRow, column: Column) => CellHandlers;
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

/**
 * Day markers in the design's colours (AdminSchedule.dc.html): Live-out days sage, leave, rest days and shifts grey,
 * an inactive cleaner red. Never the pending (apricot) or confirmed (petrol) tones: beside the visit cards those mean
 * "pending confirmation" and "confirmed / assigned" (spec §27.5).
 */
export const markerTone: Record<string, StatusTone> = {
  rest_day: "neutral",
  not_on_shift: "neutral",
  leave: "neutral",
  live_out: "success",
  not_active: "danger",
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
  row,
  showTime,
  plate,
  busy,
  draggable,
  canMove,
  canReview,
  onDragStart,
  onDragEnd,
  onMove,
  onReview,
}: {
  card: VisitSummary;
  row: string;
  showTime: boolean;
  plate: string | null;
  busy: boolean;
  draggable: boolean;
  canMove: boolean;
  canReview: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: () => void;
  onReview: () => void;
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
      data-row={row}
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
          {/* The booking page needs bookings.view (HR reads the schedule without it): plain text otherwise. */}
          {canReview ? (
            <Link href={`/admin/bookings/${card.booking.id}`} className="font-bold">
              <Ltr>{card.booking.reference}</Ltr>
            </Link>
          ) : (
            <Ltr className="font-bold text-ink-900">{card.booking.reference}</Ltr>
          )}
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
      {(canMove || canReview) && (
        <span className="flex flex-wrap gap-1">
          {canReview && (
            <Button
              variant="ghost"
              size="sm"
              className="touch-target px-2"
              onClick={onReview}
              data-card-action="review"
              aria-label={t("reviewLabel", { reference: card.booking.reference })}
              icon={<ClipboardCheck aria-hidden className="size-3.5" />}
            >
              {t("review")}
            </Button>
          )}
          {canMove && (
            <Button
              variant="ghost"
              size="sm"
              className="touch-target px-2"
              onClick={onMove}
              disabled={busy}
              data-card-action="move"
              aria-label={t("moveLabel", { reference: card.booking.reference })}
              icon={<ArrowRightLeft aria-hidden className="size-3.5" />}
            >
              {t("move")}
            </Button>
          )}
        </span>
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
