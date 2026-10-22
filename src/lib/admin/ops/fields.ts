import { z } from "zod";
import { normalizeDigits } from "@/lib/money";
import type { CatalogErrorKey } from "../catalog/fields";
import { isIsoDate } from "../format";

/*
 * Building blocks shared by the Phase 2 operations forms (A05 workers, A06 fleet, A11 scheduling, capacity). As in the
 * catalog forms, inputs stay strings and every zod issue message is a message key: keys under admin.ops.errors
 * (OPS_ERROR_KEYS, checked in both languages by a test) or the shared catalog keys (admin.catalog.errors).
 */

export const OPS_ERROR_KEYS = [
  "timeStep",
  "timeOrder",
  "startMidnight",
  "dateRequired",
  "employeeNo",
  "nationality",
  "language",
  "languagesRequired",
  "languagesMax",
  "displayName",
  "phoneLength",
  "phoneInvalid",
  "notesLength",
  "zoneRequired",
  "restDay",
  "restDayWorking",
  "restDayShift",
  "noteRequired",
  "noteLength",
  "forceReasonMin",
  "forceReasonMax",
  "maxBookings",
  "maxBookingsRequired",
  "plateFormat",
  "plateLength",
  "modelLength",
  "seats",
  "licenseLength",
  "staffUserRequired",
  "notADriver",
  "slotRequired",
  "sortOrder",
  "blackoutReasonLength",
] as const;

export type OpsErrorKey = (typeof OPS_ERROR_KEYS)[number];

/** A message key: one of ours or a shared catalog key (admin.catalog.errors). */
export type FormErrorKey = OpsErrorKey | CatalogErrorKey;

export const addIssue = (ctx: z.RefinementCtx, message: FormErrorKey, path: (string | number)[] = []) =>
  ctx.addIssue({ code: "custom", message, path });

// ---- Times: 15-minute blocks (spec §8.4) -----------------------------------------------------------------------

export const MINUTES_PER_DAY = 1440;
export const TIME_STEP = 15;

/** "HH:MM" → minutes after midnight ("24:00" → 1440); null when not a time. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const v = normalizeDigits(value).trim();
  if (v === "24:00") return MINUTES_PER_DAY;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Start times on the quarter hour: 00:00 … 23:45. */
export const START_TIMES: readonly string[] = Array.from({ length: MINUTES_PER_DAY / TIME_STEP }, (_, i) => minutesToTime(i * TIME_STEP));

/** End times on the quarter hour: 00:15 … 24:00 (the end of the day). */
export const END_TIMES: readonly string[] = Array.from({ length: MINUTES_PER_DAY / TIME_STEP }, (_, i) => minutesToTime((i + 1) * TIME_STEP));

export function isQuarterHour(value: string | null | undefined): boolean {
  const minutes = timeToMinutes(value);
  return minutes !== null && minutes % TIME_STEP === 0;
}

/**
 * Checks a start/end pair on the quarter hour, start before end on the same day (24:00 allowed only as an end).
 * Returns the problem and the field it belongs to, or null.
 */
export function checkWindow(
  start: string | null | undefined,
  end: string | null | undefined,
  options: { step?: boolean } = {},
): { field: "start" | "end"; error: OpsErrorKey } | null {
  const step = options.step ?? true;
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || (step && s % TIME_STEP !== 0)) return { field: "start", error: "timeStep" };
  if (s === MINUTES_PER_DAY) return { field: "start", error: "startMidnight" };
  if (e === null || (step && e % TIME_STEP !== 0)) return { field: "end", error: "timeStep" };
  if (e <= s) return { field: "end", error: "timeOrder" };
  return null;
}

// ---- Small zod inputs ------------------------------------------------------------------------------------------

/** A <select> of a required record id ("" → issue). */
export function requiredIdSelect(message: FormErrorKey) {
  return z.string().transform((raw, ctx): number => {
    const n = Number(raw);
    if (raw === "" || !Number.isInteger(n) || n < 1) {
      addIssue(ctx, message);
      return z.NEVER;
    }
    return n;
  });
}

/** A required "YYYY-MM-DD". */
export const requiredDate = z.string().transform((raw, ctx): string => {
  const v = normalizeDigits(raw).trim();
  if (v === "") {
    addIssue(ctx, "dateRequired");
    return z.NEVER;
  }
  if (!isIsoDate(v)) {
    addIssue(ctx, "date");
    return z.NEVER;
  }
  return v;
});

/** An optional "YYYY-MM-DD" ("" → null). */
export const optionalDate = z.string().transform((raw, ctx): string | null => {
  const v = normalizeDigits(raw).trim();
  if (v === "") return null;
  if (!isIsoDate(v)) {
    addIssue(ctx, "date");
    return z.NEVER;
  }
  return v;
});

/** Optional free text: trimmed, "" → null, at most `max` characters. */
export function optionalText(max: number, message: FormErrorKey) {
  return z.string().transform((raw, ctx): string | null => {
    const v = raw.trim();
    if (v === "") return null;
    if (v.length > max) {
      addIssue(ctx, message);
      return z.NEVER;
    }
    return v;
  });
}
