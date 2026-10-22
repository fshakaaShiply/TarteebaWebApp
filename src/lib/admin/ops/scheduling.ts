import { z } from "zod";
import { catalogCodeInput, checkReason, idSelect, parseWholeNumber, translatableInput } from "../catalog/fields";
import { SERVICE_KINDS } from "../catalog/forms";
import type { BlackoutDate, ServiceKind, SlotRule, SlotTemplate, Translatable } from "../types";
import { addIssue, checkWindow, optionalDate, requiredDate, requiredIdSelect, type FormErrorKey } from "./fields";

/*
 * A11 scheduling: slot templates, slot availability rules and blackout dates. Schemas mirror
 * app/Modules/Scheduling/Http/Requests (SlotTemplateRequest + SlotTimes, SlotRuleRequest + RuleFields,
 * BlackoutDateRequest + BlackoutFields).
 */

// ---- Slot templates --------------------------------------------------------------------------------------------

export type SlotTemplateFormValues = {
  code: string;
  name: Translatable;
  start_time: string;
  end_time: string;
  service_kind: ServiceKind;
  is_active: boolean;
  sort_order: string;
};

export type SlotTemplatePayload = {
  code?: string;
  name: Translatable;
  start_time: string;
  end_time: string;
  service_kind: ServiceKind;
  is_active: boolean;
  sort_order: number;
};

const sortOrderInput = z.string().transform((raw, ctx): number => {
  const v = parseWholeNumber(raw);
  if (v === null || v > 1000) addIssue(ctx, "sortOrder");
  return v ?? 0;
});

/** Quarter-hour times, start before end on the same day ("24:00" may end a slot), sort order 0–1000. */
export function slotTemplateFormSchema(mode: "create" | "edit") {
  return z
    .object({
      // The code is fixed after creation; the edit form shows it read-only and never sends it.
      code: z.string().transform((raw, ctx): string | undefined => {
        if (mode === "edit") return undefined;
        const parsed = catalogCodeInput().safeParse(raw);
        if (parsed.success) return parsed.data;
        addIssue(ctx, (parsed.error.issues[0]?.message as FormErrorKey) ?? "codeFormat");
        return undefined;
      }),
      name: translatableInput(60),
      start_time: z.string(),
      end_time: z.string(),
      service_kind: z.enum(SERVICE_KINDS),
      is_active: z.boolean(),
      sort_order: sortOrderInput,
    })
    .transform((v, ctx): SlotTemplatePayload => {
      const window = checkWindow(v.start_time, v.end_time);
      if (window) addIssue(ctx, window.error, [window.field === "start" ? "start_time" : "end_time"]);
      return {
        ...(v.code !== undefined ? { code: v.code } : {}),
        name: v.name,
        start_time: v.start_time,
        end_time: v.end_time,
        service_kind: v.service_kind,
        is_active: v.is_active,
        sort_order: v.sort_order,
      };
    });
}

export function slotTemplateToFormValues(s: SlotTemplate | null): SlotTemplateFormValues {
  return {
    code: s?.code ?? "",
    name: { ar: s?.name?.ar ?? "", en: s?.name?.en ?? "" },
    start_time: s?.start_time ?? "10:00",
    end_time: s?.end_time ?? "14:00",
    service_kind: s?.service_kind ?? "standard_visit",
    is_active: s?.is_active ?? true,
    sort_order: s ? String(s.sort_order) : "0",
  };
}

// ---- Slot rules ------------------------------------------------------------------------------------------------

/**
 * Which rule applies to a slot on a date (Scheduling RuleResolver, decision P2-12), compared one criterion at a time.
 * The UI explains this order in plain words (admin.scheduling.rules.precedence.*).
 */
export const RULE_PRECEDENCE = ["override", "dated", "zone", "service", "weekday", "latest"] as const;

export type SlotRuleFormValues = {
  slot_template_id: string;
  zone_id: string;
  service_id: string;
  day_of_week: string;
  date_from: string;
  date_to: string;
  is_open: boolean;
  max_bookings: string;
  reason: string;
};

export type SlotRulePayload = {
  slot_template_id: number;
  zone_id: number | null;
  service_id: number | null;
  day_of_week: number | null;
  date_from: string | null;
  date_to: string | null;
  is_open: boolean;
  max_bookings: number | null;
  reason: string;
};

export const slotRuleFormSchema = z
  .object({
    slot_template_id: requiredIdSelect("slotRequired"),
    zone_id: idSelect,
    service_id: idSelect,
    day_of_week: z.string().transform((raw, ctx): number | null => {
      if (raw === "") return null;
      const v = Number(raw);
      if (!(Number.isInteger(v) && v >= 0 && v <= 6)) addIssue(ctx, "int");
      return v;
    }),
    date_from: optionalDate,
    date_to: optionalDate,
    is_open: z.boolean(),
    max_bookings: z.string().transform((raw, ctx): number | null => {
      if (raw.trim() === "") return null;
      const v = parseWholeNumber(raw);
      // SlotRuleRequest: integer 0–1000 (no "higher than the current limit" here; that is the override form's rule).
      if (v === null || v > 1000) addIssue(ctx, "maxBookingsRange");
      return v;
    }),
    reason: z.string().transform((raw, ctx): string => {
      const problem = checkReason(raw);
      if (problem) addIssue(ctx, problem);
      return raw.trim();
    }),
  })
  .transform((v, ctx): SlotRulePayload => {
    if (v.date_from && v.date_to && v.date_to < v.date_from) addIssue(ctx, "dateRange", ["date_to"]);
    return {
      slot_template_id: v.slot_template_id,
      zone_id: v.zone_id,
      service_id: v.service_id,
      day_of_week: v.day_of_week,
      date_from: v.date_from,
      date_to: v.date_to,
      is_open: v.is_open,
      // A closed slot takes no bookings, so a cap only matters on an open rule.
      max_bookings: v.is_open ? v.max_bookings : null,
      reason: v.reason,
    };
  });

export function slotRuleToFormValues(r: SlotRule | null): SlotRuleFormValues {
  const num = (n: number | null | undefined) => (n == null ? "" : String(n));
  return {
    slot_template_id: num(r?.slot_template_id),
    zone_id: num(r?.zone_id),
    service_id: num(r?.service_id),
    day_of_week: num(r?.day_of_week),
    date_from: r?.date_from ?? "",
    date_to: r?.date_to ?? "",
    is_open: r?.is_open ?? false,
    max_bookings: num(r?.max_bookings),
    reason: r?.reason ?? "",
  };
}

// ---- Blackout dates --------------------------------------------------------------------------------------------

export type BlackoutFormValues = { date: string; zone_id: string; reason: Translatable };
export type BlackoutPayload = { date: string; zone_id: number | null; reason: Partial<Translatable> | null };

/** A date, every zone or one zone, and an optional reason in either or both languages (200 characters each). */
export const blackoutFormSchema = z
  .object({
    date: requiredDate,
    zone_id: idSelect,
    reason: z.object({ ar: z.string(), en: z.string() }).transform((v, ctx): Partial<Translatable> | null => {
      const reason: Partial<Translatable> = {};
      for (const lang of ["ar", "en"] as const) {
        const text = v[lang].trim();
        if (text.length > 200) addIssue(ctx, "blackoutReasonLength", [lang]);
        if (text !== "") reason[lang] = text;
      }
      return Object.keys(reason).length > 0 ? reason : null;
    }),
  })
  .transform((v): BlackoutPayload => ({ date: v.date, zone_id: v.zone_id, reason: v.reason }));

export function blackoutToFormValues(b: BlackoutDate | null, defaultDate = ""): BlackoutFormValues {
  return {
    date: b?.date ?? defaultDate,
    zone_id: b?.zone_id == null ? "" : String(b.zone_id),
    reason: { ar: b?.reason?.ar ?? "", en: b?.reason?.en ?? "" },
  };
}
