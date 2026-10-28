"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Armchair } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  LoadingBlock,
  Notice,
  Select,
  TextArea,
  TextField,
  showFieldError,
  useToast,
} from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { assignmentReasonSchema } from "@/lib/admin/bookings/forms";
import { addStop, cancelRound, publishRound, removeStop, setPassengers, updateRound } from "@/lib/admin/endpoints";
import { applyFieldErrors, useAdminErrorMessage, useServerFieldMessage } from "@/lib/admin/errors";
import { CAPACITY_OVERRIDE_PERMISSION, FORCE_REASON_MAX } from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  duplicateSeats,
  fillSeats,
  passengerViolations,
  passengersPayload,
  roundChanges,
  roundEditDefaults,
  seatRows,
  type RoundEditValues,
  type SeatRow,
} from "@/lib/admin/trips/rounds";
import type { Round, RoundStop, VisitSummary } from "@/lib/admin/types";
import { useDayVisits } from "../_ops/daySlots";
import { useDriverPickList, useVehiclePickList } from "../_ops/options";
import { useOpsText } from "../_ops/opsText";
import { Ltr } from "../bookings/_components/BookingBits";
import { useBookingText } from "../bookings/_components/bookingText";
import { errorCodeOf, useRoundSaved } from "./tripText";

/*
 * Trip planner changes (spec §6.8, §8.3, §14.3): each dialog works on the round as it was when it opened (its version is
 * the If-Match), so a change made meanwhile answers 409 STALE_VERSION: the dialog closes and the latest round is shown.
 * Seat limits are hard (SEAT_OUT_OF_RANGE, SEATS_EXCEEDED: never overridable, §8.6); a rider who is not on a stop's team
 * or a team split between vans (D-04) needs an override with a reason.
 */

type DialogProps = { round: Round; onClose: () => void; returnFocusTo?: HTMLElement | null };

/** Saves, shows the answered round, and closes; a stale version closes with a notice and reloads. */
function useRoundChange<V>(snapshot: Round, onClose: () => void, run: (input: V) => Promise<Round>, done: string) {
  const t = useTranslations("admin.trips");
  const toast = useToast();
  const saved = useRoundSaved();
  return useMutation({
    mutationFn: run,
    onSuccess: (updated) => {
      saved(updated);
      toast.success(done);
      onClose();
    },
    onError: (error) => {
      if (errorCodeOf(error) === "STALE_VERSION") {
        saved();
        toast.error(t("stale", { plate: snapshot.vehicle.plate_no }));
        onClose();
      }
    },
  });
}

/** The API's refusal in our copy (seat limits say they are never overridable). */
function ChangeError({ error, seats }: { error: unknown; seats?: number }) {
  const t = useTranslations("admin.trips.errors");
  const describe = useAdminErrorMessage();
  if (!error || errorCodeOf(error) === "STALE_VERSION" || errorCodeOf(error) === "VALIDATION_FAILED") return null;
  const code = errorCodeOf(error);
  if (code === "SEAT_OUT_OF_RANGE" && error instanceof AdminApiError) {
    return (
      <Notice tone="danger" title={t("seatOutOfRangeTitle")}>
        <p>{t("seatOutOfRange", { seat: Number(error.details.seat_no ?? 0), seats: Number(error.details.seats ?? seats ?? 0) })}</p>
        <p>{t("seatsNeverOverride")}</p>
      </Notice>
    );
  }
  if (code === "SEATS_EXCEEDED") {
    return (
      <Notice tone="danger" title={describe(error)}>
        <p>{t("seatsNeverOverride")}</p>
      </Notice>
    );
  }
  return <Notice tone="danger">{describe(error)}</Notice>;
}

// ---- Edit: vehicle, driver, departure ------------------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const editSchema = z.object({
  vehicleId: z.string().min(1, "required"),
  driverId: z.string(),
  departTime: z.string().regex(TIME, "timeInvalid"),
});

export function EditRoundDialog({ round, onClose, returnFocusTo }: DialogProps) {
  const t = useTranslations("admin.trips.edit");
  const f = useTranslations("admin.trips.formErrors");
  const ops = useOpsText();
  const toast = useToast();
  const serverMessage = useServerFieldMessage();
  const formId = useId();
  const [snapshot] = useState(round);
  // The van and driver pick-lists (GET /admin/vehicles/options and /admin/drivers/options) are readable with
  // trips.manage, not only fleet.manage.
  const vehicles = useVehiclePickList();
  const drivers = useDriverPickList();
  const form = useForm<RoundEditValues>({ resolver: zodResolver(editSchema) as never, defaultValues: roundEditDefaults(snapshot) });
  const mutation = useRoundChange(
    snapshot,
    onClose,
    (changes: ReturnType<typeof roundChanges>) => updateRound(snapshot.id, changes, snapshot.version),
    t("done", { plate: snapshot.vehicle.plate_no }),
  );

  const submit = form.handleSubmit((values) => {
    const changes = roundChanges(snapshot, values);
    if (Object.keys(changes).length === 0) {
      toast.info(t("noChanges"));
      onClose();
      return;
    }
    mutation.mutate(changes, {
      onError: (error) =>
        applyFieldErrors(error, form.setError, ["vehicleId", "driverId", "departTime"], {
          vehicle_id: "vehicleId",
          driver_id: "driverId",
          planned_depart_at: "departTime",
        }),
    });
  });

  const errors = form.formState.errors;
  const msg = (e: { message?: string; type?: string } | undefined) =>
    e?.message ? (e.type === "server" ? serverMessage(e.message, f("invalid")) : f.has(e.message) ? f(e.message) : f("invalid")) : undefined;

  // Vans that can carry workers (is_active), and the round's own van while it can't (marked with its status), so saving
  // another change keeps it.
  const vehicleOptions = (vehicles.data ?? [])
    .filter((v) => v.is_active || v.id === snapshot.vehicle.id)
    .map((v) => ({
      value: String(v.id),
      label: t(v.is_active ? "vehicleOption" : "vehicleOptionOff", {
        plate: v.plate_no,
        seats: v.seats,
        status: ops.vehicleStatus(v.status),
      }),
    }));
  if (!vehicleOptions.some((o) => o.value === String(snapshot.vehicle.id))) {
    const own = snapshot.vehicle;
    vehicleOptions.unshift({
      value: String(own.id),
      label:
        own.status === "active"
          ? t("vehicleOption", { plate: own.plate_no, seats: own.seats })
          : t("vehicleOptionOff", { plate: own.plate_no, seats: own.seats, status: ops.vehicleStatus(own.status) }),
    });
  }
  // Drivers who can take a round (is_active: profile and staff account active), and the round's own driver while
  // they can't (marked), so saving another change keeps them.
  const driverOptions = (drivers.data ?? [])
    .filter((d) => d.is_active || d.id === snapshot.driver?.id)
    .map((d) => ({ value: String(d.id), label: d.is_active ? d.name : t("driverOff", { name: d.name }) }));
  if (snapshot.driver && !driverOptions.some((o) => o.value === String(snapshot.driver!.id))) {
    driverOptions.unshift({ value: String(snapshot.driver.id), label: snapshot.driver.name });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !mutation.isPending && onClose()}
      title={t("title", { plate: snapshot.vehicle.plate_no })}
      description={t("body")}
      dismissible={!mutation.isPending}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            {t("submit")}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Select
          label={t("vehicle")}
          required
          // While the list loads or after it failed, only the round's own van is offered: say so, not "only active".
          hint={vehicles.isLoading ? t("vehiclesLoading") : vehicles.isError && !vehicles.data ? t("vehiclesFailed") : t("vehicleHint")}
          options={vehicleOptions}
          error={msg(errors.vehicleId)}
          {...form.register("vehicleId")}
        />
        {vehicles.isError && !vehicles.data && (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => void vehicles.refetch()} loading={vehicles.isFetching}>
            {t("vehiclesRetry")}
          </Button>
        )}
        <Select
          label={t("driver")}
          placeholder={t("noDriver")}
          options={driverOptions}
          // While the list loads or after it failed, only the round's own driver is offered: say so, not "only active".
          hint={drivers.isLoading ? t("driversLoading") : drivers.isError && !drivers.data ? t("driversFailed") : t("driverHint")}
          error={msg(errors.driverId)}
          {...form.register("driverId")}
        />
        {drivers.isError && !drivers.data && (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => void drivers.refetch()} loading={drivers.isFetching}>
            {t("driversRetry")}
          </Button>
        )}
        <TextField
          type="time"
          label={t("departure")}
          required
          step={300}
          hint={t("departureHint", { date: ops.date(snapshot.date) })}
          dir="ltr"
          className="font-latin text-start"
          error={msg(errors.departTime)}
          {...form.register("departTime")}
        />
      </form>
      <ChangeError error={mutation.error} />
    </Dialog>
  );
}

// ---- Seats: passengers by seat --------------------------------------------------------------------------------------

export function PassengersDialog({ round, onClose, returnFocusTo }: DialogProps) {
  const t = useTranslations("admin.trips.seats");
  const f = useTranslations("admin.bookings.formErrors");
  const formId = useId();
  const { can } = useAdminSession();
  const [snapshot] = useState(round);
  const seats = snapshot.vehicle.seats;
  const [rows, setRows] = useState<SeatRow[]>(() => seatRows(snapshot));
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [reasonField, setReasonField] = useState<HTMLTextAreaElement | null>(null);
  const [triedDuplicates, setTriedDuplicates] = useState(false);
  const mutation = useRoundChange(
    snapshot,
    onClose,
    (input: { reason?: string }) =>
      setPassengers(snapshot.id, passengersPayload(rows), snapshot.version, input.reason ? { override: true, reason: input.reason } : {}),
    t("done", { plate: snapshot.vehicle.plate_no }),
  );
  const duplicates = duplicateSeats(rows);
  // 409 OVERRIDE_REQUIRED: kept while the user decides (a new attempt clears mutation.error).
  const [violation, setViolation] = useState<{ notOnRound: number[]; teamSplit: number[]; canOverride: boolean } | null>(null);
  const violations = violation;
  const mayOverride = !!violation && can(CAPACITY_OVERRIDE_PERMISSION) && violation.canOverride;
  const nameOf = (id: number) => rows.find((r) => r.workerId === id)?.name ?? `#${id}`;
  const stopOf = (visitId: number) => snapshot.stops.find((s) => s.visit_id === visitId);
  const seated = rows.filter((r) => r.seat).length;

  const send = (input: { reason?: string }) =>
    mutation.mutate(input, {
      onError: (error) => {
        if (error instanceof AdminApiError && error.code === "OVERRIDE_REQUIRED") {
          setViolation({ ...passengerViolations(error.details), canOverride: error.details.can_override !== false });
        }
      },
    });

  const submit = () => {
    if (duplicates.size > 0) {
      setTriedDuplicates(true);
      return;
    }
    if (override && mayOverride) {
      const parsed = assignmentReasonSchema(true).safeParse({ reason });
      if (!parsed.success) {
        showFieldError(() => setReasonError(f(parsed.error.issues[0]?.message ?? "reasonRequired")), reasonField);
        return;
      }
      send({ reason: parsed.data });
      return;
    }
    send({});
  };

  const setSeat = (workerId: number, seat: string) => {
    setRows((list) => list.map((r) => (r.workerId === workerId ? { ...r, seat } : r)));
    setTriedDuplicates(false);
  };

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && !mutation.isPending && onClose()}
      title={t("title", { plate: snapshot.vehicle.plate_no })}
      description={t("body", { seats })}
      dismissible={!mutation.isPending}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending} variant={override && mayOverride ? "danger" : "primary"}>
            {override && mayOverride ? t("submitOverride") : t("submit")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mutation.isPending) submit();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-900">{t("summary", { seated, riders: rows.length, seats })}</p>
          <Button variant="secondary" size="sm" onClick={() => setRows((list) => fillSeats(list, seats))} icon={<Armchair aria-hidden className="size-4" />}>
            {t("fill")}
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-600">{t("noRiders")}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("caption")}</caption>
            <thead>
              <tr className="text-ink-600">
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t("worker")}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t("stop")}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t("seat")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const clash = !!row.seat && duplicates.has(row.seat);
                return (
                  <tr key={row.workerId} className="border-t border-line">
                    <th scope="row" className="px-2 py-2 text-start font-medium text-ink-900">
                      {row.name}
                    </th>
                    <td className="px-2 py-2 text-ink-600">{row.sequence === null ? t("notOnStop") : t("stopNumber", { number: row.sequence })}</td>
                    <td className="px-2 py-1.5">
                      <Select
                        label={<span className="sr-only">{t("seatFor", { name: row.name })}</span>}
                        value={row.seat}
                        onChange={(e) => setSeat(row.workerId, e.target.value)}
                        placeholder={t("noSeat")}
                        options={Array.from({ length: seats }, (_, i) => ({ value: String(i + 1), label: t("seatOption", { number: i + 1 }) }))}
                        error={clash && triedDuplicates ? t("seatTaken", { number: row.seat }) : undefined}
                        containerClassName="min-w-[140px] gap-0"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {triedDuplicates && duplicates.size > 0 && (
          <Notice tone="danger">{t("duplicates", { seats: [...duplicates].join(t("separator")) })}</Notice>
        )}
        {violations && (
          <Notice tone="warning" title={t("overrideTitle")}>
            {violations.notOnRound.length > 0 && <p>{t("notOnRound", { names: violations.notOnRound.map(nameOf).join(t("separator")) })}</p>}
            {violations.teamSplit.length > 0 && (
              <p>
                {t("teamSplit", {
                  stops: violations.teamSplit.map((id) => stopOf(id)?.booking.reference ?? `#${id}`).join(t("separator")),
                })}
              </p>
            )}
            <p>{mayOverride ? t("overrideBody") : t("overrideNoPermission")}</p>
            {mayOverride && <Checkbox label={t("overrideCheck")} checked={override} onChange={(e) => setOverride(e.target.checked)} />}
          </Notice>
        )}
        {override && mayOverride && (
          <TextArea
            ref={setReasonField}
            label={t("overrideReason")}
            hint={t("overrideReasonHint")}
            required
            rows={2}
            maxLength={FORCE_REASON_MAX}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            error={reasonError}
          />
        )}
      </form>
      {errorCodeOf(mutation.error) !== "OVERRIDE_REQUIRED" && <ChangeError error={mutation.error} seats={seats} />}
    </Dialog>
  );
}

// ---- Add a stop ------------------------------------------------------------------------------------------------------

/** The date's visits of the round's slot (cards and the unassigned lane), one entry per visit, not already on it. */
function slotVisits(board: { rows: { days: { cards: VisitSummary[] }[] }[]; unassigned: VisitSummary[] } | null, round: Round): VisitSummary[] {
  if (!board) return [];
  const seen = new Map<number, VisitSummary>();
  for (const card of [...board.unassigned, ...board.rows.flatMap((r) => r.days.flatMap((d) => d.cards))]) seen.set(card.id, card);
  const onRound = new Set(round.stops.map((s) => s.visit_id));
  return [...seen.values()]
    .filter((v) => v.slot_template_id === round.slot.id && v.service_date === round.date && !onRound.has(v.id))
    .filter((v) => v.status !== "cancelled" && v.status !== "missed_by_company" && v.status !== "completed")
    .sort((a, b) => a.booking.reference.localeCompare(b.booking.reference));
}

export function AddStopDialog({ round, onClose, returnFocusTo }: DialogProps) {
  const t = useTranslations("admin.trips.add");
  const text = useBookingText();
  const { can } = useAdminSession();
  const formId = useId();
  const [snapshot] = useState(round);
  const day = useDayVisits(snapshot.date, snapshot.zone?.id ?? null);
  const visits = slotVisits(day.data ?? null, snapshot);
  const [visitId, setVisitId] = useState("");
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const mutation = useRoundChange(snapshot, onClose, (id: number) => addStop(snapshot.id, id, snapshot.version), t("done"));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !mutation.isPending && onClose()}
      title={t("title", { plate: snapshot.vehicle.plate_no })}
      description={t("body")}
      dismissible={!mutation.isPending}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={mutation.isPending} disabled={visits.length === 0}>
            {t("submit")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (mutation.isPending) return;
          if (!visitId) {
            setChoiceError(t("chooseVisit"));
            return;
          }
          mutation.mutate(Number(visitId));
        }}
      >
        {!can("schedule.view") ? (
          <Notice tone="info">{t("needsSchedule")}</Notice>
        ) : day.isPending ? (
          <LoadingBlock lines={3} />
        ) : visits.length === 0 ? (
          <p className="text-sm text-ink-600">{t("none")}</p>
        ) : (
          <fieldset className="flex flex-col gap-2" aria-describedby={choiceError ? `${formId}-error` : undefined}>
            <legend className="mb-1 text-sm font-medium text-ink-900">{t("legend")}</legend>
            {visits.map((v) => (
              <label key={v.id} className="flex items-start gap-2 rounded-md border border-line p-2.5 text-sm has-[:checked]:border-petrol-700 has-[:checked]:bg-petrol-50/50">
                <input
                  type="radio"
                  name={`${formId}-visit`}
                  value={String(v.id)}
                  checked={visitId === String(v.id)}
                  onChange={() => {
                    setVisitId(String(v.id));
                    setChoiceError(null);
                  }}
                  className="mt-0.5 size-4 accent-petrol-700"
                />
                <span className="flex flex-col">
                  <span className="font-bold text-ink-900">
                    <Ltr>{v.booking.reference}</Ltr>
                  </span>
                  <span className="text-xs text-ink-600">
                    {v.area || t("noArea")} · {text.status(v.booking.status, v.booking.status_label)} ·{" "}
                    {t("team", { assigned: v.assigned_count, count: v.workers_count })}
                  </span>
                </span>
              </label>
            ))}
            {choiceError && (
              <p id={`${formId}-error`} role="alert" className="text-xs font-medium text-danger-700">
                {choiceError}
              </p>
            )}
          </fieldset>
        )}
      </form>
      <ChangeError error={mutation.error} seats={snapshot.vehicle.seats} />
    </Dialog>
  );
}

// ---- Remove a stop, publish, cancel ----------------------------------------------------------------------------------

export function RemoveStopDialog({ round, stop, onClose, returnFocusTo }: DialogProps & { stop: RoundStop }) {
  const t = useTranslations("admin.trips.remove");
  const [snapshot] = useState(round);
  const mutation = useRoundChange(snapshot, onClose, () => removeStop(snapshot.id, stop.id, snapshot.version), t("done", { reference: stop.booking.reference }));
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { reference: stop.booking.reference })}
      description={t("body")}
      confirmLabel={t("submit")}
      tone="danger"
      pending={mutation.isPending}
      onConfirm={() => mutation.mutate(undefined)}
      returnFocusTo={returnFocusTo}
    >
      <ChangeError error={mutation.error} />
    </ConfirmDialog>
  );
}

export function PublishRoundDialog({ round, onClose, onDone, returnFocusTo }: DialogProps & { onDone: () => void }) {
  const t = useTranslations("admin.trips.publish");
  const [snapshot] = useState(round);
  const saved = useRoundSaved();
  const toast = useToast();
  const tr = useTranslations("admin.trips");
  const mutation = useMutation({
    mutationFn: () => publishRound(snapshot.id, snapshot.version),
    onSuccess: (updated) => {
      saved(updated);
      onDone();
      onClose();
    },
    onError: (error) => {
      if (errorCodeOf(error) === "STALE_VERSION") {
        saved();
        toast.error(tr("stale", { plate: snapshot.vehicle.plate_no }));
        onClose();
      }
    },
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={snapshot.published ? t("titleAgain", { plate: snapshot.vehicle.plate_no }) : t("title", { plate: snapshot.vehicle.plate_no })}
      description={snapshot.driver ? t("body", { driver: snapshot.driver.name }) : t("noDriver")}
      confirmLabel={snapshot.published ? t("submitAgain") : t("submit")}
      pending={mutation.isPending}
      onConfirm={() => mutation.mutate()}
      returnFocusTo={returnFocusTo}
    >
      {snapshot.warnings.length > 0 && <Notice tone="warning">{t("warnings", { count: snapshot.warnings.length })}</Notice>}
      <ChangeError error={mutation.error} />
    </ConfirmDialog>
  );
}

export function CancelRoundDialog({ round, onClose, returnFocusTo }: DialogProps) {
  const t = useTranslations("admin.trips.cancel");
  const f = useTranslations("admin.trips.formErrors");
  const serverMessage = useServerFieldMessage();
  const [snapshot] = useState(round);
  const schema = z.object({ reason: z.string().trim().min(CANCEL_REASON_MIN, "reasonMin").max(CANCEL_REASON_MAX, "tooLong") });
  const form = useForm<{ reason: string }>({ resolver: zodResolver(schema) as never, defaultValues: { reason: "" } });
  const mutation = useRoundChange(snapshot, onClose, (reason: string) => cancelRound(snapshot.id, reason, snapshot.version), t("done", { plate: snapshot.vehicle.plate_no }));
  const error = form.formState.errors.reason;
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title", { plate: snapshot.vehicle.plate_no })}
      description={t("body")}
      confirmLabel={t("submit")}
      tone="danger"
      pending={mutation.isPending}
      onConfirm={() =>
        void form.handleSubmit((values) =>
          mutation.mutate(values.reason.trim(), { onError: (e) => applyFieldErrors(e, form.setError, ["reason"]) }),
        )()
      }
      returnFocusTo={returnFocusTo}
    >
      <TextArea
        label={t("reason")}
        hint={t("reasonHint")}
        required
        rows={3}
        maxLength={CANCEL_REASON_MAX}
        error={error?.message ? (error.type === "server" ? serverMessage(error.message, f("invalid")) : f.has(error.message) ? f(error.message) : f("invalid")) : undefined}
        {...form.register("reason")}
      />
      <ChangeError error={mutation.error} />
    </ConfirmDialog>
  );
}
