import { z } from "zod";
import { AdminApiError } from "../client";
import type {
  CapacitySlot,
  ClosedReason,
  ExclusionReason,
  FullReason,
  OverrideAction,
  Shortfall,
  SlotRuleSnapshot,
  SlotStatus,
} from "../types";
import { addIssue, type OpsErrorKey } from "./fields";

/*
 * Capacity rules shared by the capacity page and every workforce / fleet change the API guards (spec §8.5, §8.6):
 *   - 409 CAPACITY_SHORTFALL lists the reserved pools a change would leave short (details.shortfalls);
 *   - staff with capacity.override may apply such a change anyway by sending `force: true` and a reason of at least
 *     10 characters (Scheduling CapacityForce::MIN_REASON);
 *   - a manual override only relaxes soft caps (a blackout, a closed rule, the booking cap). It never puts more
 *     workers or seats into a slot than exist.
 */

export const CAPACITY_OVERRIDE_PERMISSION = "capacity.override";

/** Values the capacity view and errors use (Scheduling Enums, CapacitySnapshot::EXCLUSIONS, ResourceTimeBlock::HOLDER_*). */
export const SLOT_STATUSES = ["available", "limited", "full", "closed"] as const satisfies readonly SlotStatus[];
export const SLOT_REASONS = [
  "lead_time",
  "blackout",
  "rule_closed",
  "horizon",
  "past",
  "inactive",
  "workers",
  "seats",
  "max_bookings",
] as const satisfies readonly (ClosedReason | FullReason)[];
/** In the order the engine checks them (the first reason that applies is the one counted). */
export const EXCLUSION_REASONS = [
  "not_active",
  "not_eligible",
  "rest_day",
  "not_on_shift",
  "leave",
  "live_out",
  "busy",
] as const satisfies readonly ExclusionReason[];
export const HOLDER_TYPES = ["visit", "live_out_day", "leave", "hold", "manual_block"] as const;
export const RULE_SOURCES = ["admin", "override"] as const;

/** CapacityForce::MIN_REASON and the reason column limit. */
export const FORCE_REASON_MIN = 10;
export const FORCE_REASON_MAX = 500;

export type ForceInput = { reason: string };

/** The trimmed reason's problem, or null when it can be sent. */
export function checkForceReason(reason: string): OpsErrorKey | null {
  const v = reason.trim();
  if (v.length < FORCE_REASON_MIN) return "forceReasonMin";
  if (v.length > FORCE_REASON_MAX) return "forceReasonMax";
  return null;
}

/** Adds `force: true` and the trimmed reason to a request body ("save anyway"); without `force` the body is unchanged. */
export function withForce<T extends object>(body: T, force?: ForceInput | null): T & { force?: true; reason?: string } {
  if (!force) return body;
  return { ...body, force: true, reason: force.reason.trim() };
}

/** details.shortfalls of a 409 CAPACITY_SHORTFALL, or null for any other error. */
export function readShortfalls(error: unknown): Shortfall[] | null {
  if (!(error instanceof AdminApiError) || error.code !== "CAPACITY_SHORTFALL") return null;
  const list = error.details.shortfalls;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (s): s is Shortfall =>
      s !== null && typeof s === "object" && typeof (s as Shortfall).date === "string" && typeof (s as Shortfall).reserved === "number",
  );
}

/** How many workers or seats a pool is short. */
export const shortBy = (s: Pick<Shortfall, "reserved" | "available">) => Math.max(0, s.reserved - s.available);

export type ResourceConflict = {
  resourceType: string | null;
  date: string | null;
  holderType: string | null;
  holderId: number | null;
  from: string | null;
};

/** 409 RESOURCE_CONFLICT details: who already holds the time (a visit, a Live-out day, another leave …). */
export function readResourceConflict(error: unknown): ResourceConflict | null {
  if (!(error instanceof AdminApiError) || error.code !== "RESOURCE_CONFLICT") return null;
  const d = error.details;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    resourceType: str(d.resource_type),
    date: str(d.date),
    holderType: str(d.holder_type),
    holderId: typeof d.holder_id === "number" ? d.holder_id : null,
    from: str(d.from),
  };
}

// ---- Manual override (POST /admin/capacity/override) ------------------------------------------------------------

/** What an override could relax on this slot, from the capacity view (the API decides again on save). */
export type OverrideOption = {
  action: OverrideAction;
  /** The soft caps this action relaxes. */
  relaxes: ({ kind: "blackout" } | { kind: "closed_rule"; rule: SlotRuleSnapshot } | { kind: "cap"; rule: SlotRuleSnapshot })[];
};

/**
 * The override actions that make sense for a slot:
 *   open       the slot is closed by a blackout or by a closed rule;
 *   raise_cap  the rule that applies is open with a booking cap.
 * Hard limits (no workers, no seats, past, beyond the horizon, inactive slot) cannot be overridden: no option.
 */
export function overrideOptions(slot: CapacitySlot): OverrideOption[] {
  const out: OverrideOption[] = [];
  const rule = slot.rule;
  if (slot.status === "closed" && (slot.reason === "past" || slot.reason === "horizon" || slot.reason === "inactive")) return out;
  if (!slot.is_active) return out;

  const relaxes: OverrideOption["relaxes"] = [];
  if (slot.reason === "blackout") relaxes.push({ kind: "blackout" });
  if (rule && !rule.is_open) relaxes.push({ kind: "closed_rule", rule });
  if (relaxes.length > 0) out.push({ action: "open", relaxes });

  if (rule && rule.is_open && rule.max_bookings !== null) out.push({ action: "raise_cap", relaxes: [{ kind: "cap", rule }] });
  return out;
}

export type OverrideFormValues = { action: OverrideAction; max_bookings: string; reason: string; confirmed: boolean };

export type OverridePayload = {
  date: string;
  zone_id: number;
  slot_template_id: number;
  service_id?: number | null;
  action: OverrideAction;
  max_bookings?: number | null;
  reason: string;
};

/**
 * The override form (CapacityOverrideRequest): a reason of at least 10 characters, an explicit confirmation, and for
 * raise_cap a whole number above the current cap (0–1000). For open, a new cap is optional.
 */
export function overrideFormSchema(currentCap: number | null) {
  return z
    .object({
      action: z.enum(["open", "raise_cap"]),
      max_bookings: z.string(),
      reason: z.string(),
      confirmed: z.boolean(),
    })
    .transform((v, ctx) => {
      const raw = v.max_bookings.trim();
      let maxBookings: number | null = null;
      if (raw !== "") {
        const n = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isInteger(n) || n > 1000) addIssue(ctx, "maxBookings", ["max_bookings"]);
        else if (v.action === "raise_cap" && currentCap !== null && n <= currentCap) addIssue(ctx, "maxBookings", ["max_bookings"]);
        else maxBookings = n;
      } else if (v.action === "raise_cap") {
        addIssue(ctx, "maxBookingsRequired", ["max_bookings"]);
      }
      const reasonError = checkForceReason(v.reason);
      if (reasonError) addIssue(ctx, reasonError, ["reason"]);
      if (!v.confirmed) addIssue(ctx, "required", ["confirmed"]);
      return { action: v.action, max_bookings: maxBookings, reason: v.reason.trim() };
    });
}
