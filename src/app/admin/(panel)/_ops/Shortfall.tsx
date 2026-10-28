"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, DataTable, Dialog, Notice, TextArea, showFieldError, type Column } from "@/components/admin";
import { fetchAllVehicles } from "@/lib/admin/endpoints";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { adminKeys } from "@/lib/admin/keys";
import {
  CAPACITY_OVERRIDE_PERMISSION,
  FORCE_REASON_MAX,
  checkForceReason,
  readResourceConflict,
  readShortfalls,
  shortBy,
  type ForceInput,
} from "@/lib/admin/ops/capacity";
import { useAdminSession } from "@/lib/admin/session";
import type { Shortfall, Translatable } from "@/lib/admin/types";
import { useServiceName, useSlotPickList, useZoneName } from "./options";
import { useOpsErrorKey, useOpsText } from "./opsText";

const STALE = 60_000;

type SlotLabel = { name: Translatable; start: string; end: string };

/**
 * Names for the ids a shortfall row carries, from lists this user may read: the slot's name and times (the slot
 * pick-list: catalog.manage, schedule.view, trips.manage, bookings.view or bookings.create_manual) and the vehicle's
 * plate (fleet.manage or schedule.view). What stays unknown falls back to the slot code or the number.
 */
function useShortfallNames(shortfalls: readonly Shortfall[]) {
  const { canAny } = useAdminSession();
  const templates = useSlotPickList(shortfalls.length > 0);
  const vehicles = useQuery({
    // The same list the capacity page loads for its seat bars.
    queryKey: adminKeys.vehicleList({ all: 1 }),
    queryFn: () => fetchAllVehicles(),
    staleTime: STALE,
    enabled: shortfalls.some((s) => s.kind === "seats") && canAny(["fleet.manage", "schedule.view"]),
  });

  const slots = new Map<number, SlotLabel>();
  for (const tpl of templates.data ?? []) slots.set(tpl.id, { name: tpl.name, start: tpl.start_time, end: tpl.end_time });
  const plates = new Map((vehicles.data ?? []).map((v) => [v.id, v.plate_no]));
  return { slot: (id: number) => slots.get(id), plate: (id: number) => plates.get(id) };
}

/** The pools a change would leave short (409 CAPACITY_SHORTFALL details.shortfalls). */
export function ShortfallTable({ shortfalls }: { shortfalls: readonly Shortfall[] }) {
  const t = useTranslations("admin.ops.shortfall");
  const text = useOpsText();
  const zoneName = useZoneName();
  const serviceName = useServiceName();
  const names = useShortfallNames(shortfalls);

  /** Workers rows name their service (one row per service), seat rows their vehicle. */
  const detail = (s: Shortfall): ReactNode => {
    if (s.kind === "seats" && s.vehicle_id !== undefined) {
      const plate = names.plate(s.vehicle_id);
      return plate ? (
        <bdi dir="ltr" className="font-latin">
          {plate}
        </bdi>
      ) : (
        t("vehicleNumber", { id: s.vehicle_id })
      );
    }
    if (s.kind === "workers" && s.service_id !== undefined && s.service_id !== null) {
      return serviceName(s.service_id, t("serviceNumber", { id: s.service_id }));
    }
    return null;
  };

  const columns: Column<Shortfall>[] = [
    { id: "date", header: t("columns.date"), cell: (s) => text.dateShort(s.date) },
    { id: "zone", header: t("columns.zone"), cell: (s) => zoneName(s.zone_id) },
    {
      id: "slot",
      header: t("columns.slot"),
      cell: (s) => {
        const slot = names.slot(s.slot_template_id);
        if (!slot) {
          return (
            <bdi dir="ltr" className="font-latin">
              {s.slot}
            </bdi>
          );
        }
        return (
          <div className="flex flex-col">
            <span>{text.name(slot.name)}</span>
            <bdi dir="ltr" className="font-latin text-xs text-ink-600">
              {slot.start}–{slot.end}
            </bdi>
          </div>
        );
      },
    },
    {
      id: "kind",
      header: t("columns.kind"),
      cell: (s) => {
        const more = detail(s);
        return (
          <div className="flex flex-col">
            <span>{t(`kind.${s.kind}`)}</span>
            {more && <span className="text-xs text-ink-600">{more}</span>}
          </div>
        );
      },
    },
    { id: "reserved", header: t("columns.reserved"), cell: (s) => <span className="font-latin">{s.reserved}</span> },
    { id: "available", header: t("columns.available"), cell: (s) => <span className="font-latin">{s.available}</span> },
    {
      id: "short",
      header: t("columns.short"),
      cell: (s) => <span className="font-latin font-bold text-danger-700">{shortBy(s)}</span>,
    },
  ];
  return (
    <DataTable
      caption={t("caption")}
      columns={columns}
      rows={shortfalls}
      getRowId={(s) => `${s.date}|${s.zone_id}|${s.slot_template_id}|${s.kind}|${s.service_id ?? ""}|${s.vehicle_id ?? ""}`}
      minWidth={560}
    />
  );
}

/**
 * Remembers the request that answered 409 CAPACITY_SHORTFALL, so the dialog below can show the affected pools and
 * send the same request again with `force` and a reason.
 */
export function useShortfallGuard<V>() {
  const [state, setState] = useState<{ vars: V; shortfalls: Shortfall[] } | null>(null);
  const capture = useCallback((error: unknown, vars: V): boolean => {
    const shortfalls = readShortfalls(error);
    if (!shortfalls) return false;
    setState({ vars, shortfalls });
    return true;
  }, []);
  const clear = useCallback(() => setState(null), []);
  return { state, capture, clear };
}

/**
 * "This change would leave booked requests short." Lists the pools; staff with capacity.override can "save anyway"
 * with a reason of at least 10 characters (audited as capacity.override); everyone else is told to move or release
 * the affected requests first. `forceError` is the error of the forced attempt, if it failed too.
 */
export function ShortfallDialog({
  shortfalls,
  onClose,
  onForce,
  pending,
  forceError,
  allowForce = true,
  returnFocusTo,
}: {
  shortfalls: readonly Shortfall[] | null;
  onClose: () => void;
  onForce: (force: ForceInput) => void;
  pending: boolean;
  forceError?: unknown;
  /** False where the API has no force path (settings changes). */
  allowForce?: boolean;
  /**
   * Where focus goes on close when this dialog replaced another one (a confirmation that unmounted as it opened), so
   * keyboard and screen-reader users land back on the control that started the change instead of the page body.
   */
  returnFocusTo?: HTMLElement | null;
}) {
  const t = useTranslations("admin.ops.shortfall");
  const { can } = useAdminSession();
  const describe = useAdminErrorMessage();
  const errorText = useOpsErrorKey();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const mayForce = allowForce && can(CAPACITY_OVERRIDE_PERMISSION);

  const submit = () => {
    const problem = checkForceReason(reason);
    if (problem) {
      showFieldError(() => setReasonError(errorText(problem) ?? null), reasonRef.current);
      return;
    }
    setReasonError(null);
    onForce({ reason: reason.trim() });
  };

  return (
    <Dialog
      open={shortfalls !== null}
      onOpenChange={(open) => !open && !pending && onClose()}
      title={t("title")}
      description={t("body")}
      size="lg"
      dismissible={!pending}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {mayForce ? t("keep") : t("close")}
          </Button>
          {mayForce && (
            <Button variant="danger" onClick={submit} loading={pending} icon={<ShieldAlert aria-hidden className="size-4" />}>
              {t("saveAnyway")}
            </Button>
          )}
        </>
      }
    >
      <ShortfallTable shortfalls={shortfalls ?? []} />
      {mayForce ? (
        <>
          <Notice tone="warning">{t("forceNote")}</Notice>
          <TextArea
            ref={reasonRef}
            label={t("reason")}
            hint={t("reasonHint")}
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
        </>
      ) : (
        <Notice tone="info">{allowForce ? t("noPermission") : t("noForcePath")}</Notice>
      )}
      {forceError ? <Notice tone="danger">{describe(forceError)}</Notice> : null}
    </Dialog>
  );
}

/** 409 RESOURCE_CONFLICT: who already holds that time (a visit, a Live-out day, another leave …), and when. */
export function ResourceConflictNotice({ error, subject }: { error: unknown; subject?: string }) {
  const t = useTranslations("admin.ops.conflict");
  const text = useOpsText();
  const conflict = readResourceConflict(error);
  if (!conflict) return null;
  const holder = conflict.holderType ? text.holderType(conflict.holderType) : t("unknownHolder");
  return (
    <Notice tone="danger" title={t("title")}>
      <p>
        {t("body", {
          subject: subject ?? t("thisResource"),
          holder,
          id: conflict.holderId ?? "",
          hasId: conflict.holderId === null ? "no" : "yes",
          date: conflict.date ? text.date(conflict.date) : "",
          from: conflict.from ?? "",
          hasFrom: conflict.from ? "yes" : "no",
        })}
      </p>
      <p>{t("hint")}</p>
    </Notice>
  );
}
