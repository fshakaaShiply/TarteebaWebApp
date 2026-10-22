import type { WeeklyHoursDay, WeeklyHoursValue } from "../types";
import { checkWindow } from "./fields";

/*
 * The "weekly_hours" setting type (booking.working_hours, owner ruling R-13): the hours the bookings team confirms
 * requests, per weekday. The API stores seven keys "0" (Sunday) … "6" (Saturday), each {open, close} ("HH:MM", open
 * before close, "24:00" allowed as a close) or null for a closed day. The editor shows Monday first (the UAE work
 * week) and uses 15-minute steps.
 */

/** Display order: Monday first. Values are the API weekday numbers (0 = Sunday). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const DAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

export type DayHoursDraft = { open: boolean; from: string; to: string };

/** The editor state, keyed by weekday 0..6. */
export type WeeklyHoursDraft = Record<number, DayHoursDraft>;

export type WeeklyHoursError = "hours_format" | "hours_order";

const DEFAULT_FROM = "08:00";
const DEFAULT_TO = "20:00";

function isDay(value: unknown): value is { open: string; close: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { open?: unknown }).open === "string" &&
    typeof (value as { close?: unknown }).close === "string"
  );
}

/**
 * The stored value by weekday. The API answers with a JSON list of seven days (PHP encodes an array keyed 0..6 as a
 * list) and accepts the "0".."6" object; both are read here. Anything else gives no days.
 */
export function readWeeklyHours(value: unknown): Partial<Record<number, WeeklyHoursDay>> {
  const out: Partial<Record<number, WeeklyHoursDay>> = {};
  if (Array.isArray(value)) {
    if (value.length !== 7) return out;
    value.forEach((day, i) => {
      out[i] = isDay(day) ? { open: day.open, close: day.close } : null;
    });
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const key of DAY_KEYS) {
      if (!(key in value)) continue;
      const day = (value as Record<string, unknown>)[key];
      out[Number(key)] = isDay(day) ? { open: day.open, close: day.close } : null;
    }
  }
  return out;
}

/** The editor's starting state; closed days keep the default hours ready for when they are opened. */
export function toWeeklyDraft(value: unknown): WeeklyHoursDraft {
  const days = readWeeklyHours(value);
  const draft: WeeklyHoursDraft = {};
  for (let d = 0; d < 7; d++) {
    const day = days[d];
    draft[d] = day ? { open: true, from: day.open, to: day.close } : { open: false, from: DEFAULT_FROM, to: DEFAULT_TO };
  }
  return draft;
}

/** Problems per weekday: open days need quarter-hour times with open before close. */
export function validateWeeklyDraft(draft: WeeklyHoursDraft): Partial<Record<number, WeeklyHoursError>> {
  const errors: Partial<Record<number, WeeklyHoursError>> = {};
  for (let d = 0; d < 7; d++) {
    const day = draft[d];
    if (!day) {
      errors[d] = "hours_format";
      continue;
    }
    if (!day.open) continue;
    const problem = checkWindow(day.from, day.to);
    if (problem) errors[d] = problem.error === "timeOrder" ? "hours_order" : "hours_format";
  }
  return errors;
}

/** The value PUT /admin/settings/booking.working_hours expects: every key "0".."6", null when closed. */
export function serializeWeeklyDraft(draft: WeeklyHoursDraft): WeeklyHoursValue {
  const out = {} as WeeklyHoursValue;
  for (const key of DAY_KEYS) {
    const day = draft[Number(key)];
    out[key] = day?.open ? { open: day.from, close: day.to } : null;
  }
  return out;
}

/** Copies one day's open/closed state and hours to every day. */
export function applyToAllDays(draft: WeeklyHoursDraft, sourceDay: number): WeeklyHoursDraft {
  const source = draft[sourceDay];
  if (!source) return draft;
  const next: WeeklyHoursDraft = {};
  for (let d = 0; d < 7; d++) next[d] = { ...source };
  return next;
}

/**
 * Runs of consecutive days (Monday first) with the same hours, for a one-line summary such as
 * "Mon–Thu 08:00–20:00 · Fri closed". Null when the value is not a full week.
 */
export function summarizeWeeklyHours(value: unknown): { days: number[]; hours: WeeklyHoursDay }[] | null {
  const days = readWeeklyHours(value);
  if (Object.keys(days).length !== 7) return null;
  const same = (a: WeeklyHoursDay | undefined, b: WeeklyHoursDay | undefined) =>
    (a ?? null) === null ? (b ?? null) === null : b != null && a!.open === b.open && a!.close === b.close;
  const runs: { days: number[]; hours: WeeklyHoursDay }[] = [];
  for (const d of WEEK_ORDER) {
    const last = runs[runs.length - 1];
    if (last && same(last.hours, days[d])) last.days.push(d);
    else runs.push({ days: [d], hours: days[d] ?? null });
  }
  return runs;
}
