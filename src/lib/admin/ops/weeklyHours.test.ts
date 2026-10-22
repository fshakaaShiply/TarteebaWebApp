import { describe, expect, it } from "vitest";
import { parseDraft } from "../settings";
import {
  DAY_KEYS,
  WEEK_ORDER,
  applyToAllDays,
  readWeeklyHours,
  serializeWeeklyDraft,
  summarizeWeeklyHours,
  toWeeklyDraft,
  validateWeeklyDraft,
} from "./weeklyHours";

// SettingsDefaults: booking.working_hours = every day 08:00–20:00. The API answers it as a JSON list of seven days.
const seeded = Array.from({ length: 7 }, () => ({ open: "08:00", close: "20:00" }));

describe("weekly hours (booking.working_hours, R-13)", () => {
  it("shows Monday first but keeps the API weekday numbers (0 = Sunday)", () => {
    expect(WEEK_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(DAY_KEYS).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  });

  it("reads the stored week as a list (API answer) or as the \"0\"…\"6\" object", () => {
    expect(readWeeklyHours(seeded)[0]).toEqual({ open: "08:00", close: "20:00" });
    const asObject = { "0": null, "1": { open: "09:00", close: "17:00" }, "2": null, "3": null, "4": null, "5": null, "6": null };
    expect(readWeeklyHours(asObject)).toEqual({ 0: null, 1: { open: "09:00", close: "17:00" }, 2: null, 3: null, 4: null, 5: null, 6: null });
    expect(readWeeklyHours([1, 2])).toEqual({});
  });

  it("serializes every key \"0\"…\"6\", null for a closed day, with {open, close} in that order", () => {
    const draft = toWeeklyDraft(seeded);
    draft[5] = { ...draft[5], open: false }; // Friday closed
    draft[4] = { open: true, from: "08:00", to: "24:00" }; // Thursday until midnight
    const value = serializeWeeklyDraft(draft);
    expect(Object.keys(value)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(value["5"]).toBeNull();
    expect(value["4"]).toEqual({ open: "08:00", close: "24:00" });
    expect(Object.keys(value["1"]!)).toEqual(["open", "close"]);
    expect(value["0"]).toEqual({ open: "08:00", close: "20:00" });
  });

  it("allows 24:00 as a closing time only, on the quarter hour, opening before closing", () => {
    const draft = toWeeklyDraft(seeded);
    draft[1] = { open: true, from: "20:00", to: "08:00" };
    draft[2] = { open: true, from: "08:10", to: "12:00" };
    draft[3] = { open: true, from: "24:00", to: "24:00" };
    draft[4] = { open: true, from: "00:00", to: "24:00" };
    draft[6] = { open: false, from: "20:00", to: "08:00" }; // closed days are not checked
    expect(validateWeeklyDraft(draft)).toEqual({ 1: "hours_order", 2: "hours_format", 3: "hours_format" });
  });

  it("reports the first problem in display order through the settings editor", () => {
    const draft = toWeeklyDraft(seeded);
    draft[0] = { open: true, from: "12:00", to: "10:00" }; // Sunday (last in display order)
    draft[2] = { open: true, from: "12:00", to: "12:00" }; // Tuesday
    expect(parseDraft("weekly_hours", draft)).toEqual({ ok: false, error: "hours_order" });
    draft[2] = { open: true, from: "12:00", to: "13:15" };
    draft[0] = { open: false, from: "12:00", to: "10:00" };
    const result = parseDraft("weekly_hours", draft);
    expect(result.ok && (result.value as Record<string, unknown>)["0"]).toBeNull();
  });

  it("applies one day's state and hours to the whole week", () => {
    const draft = toWeeklyDraft(seeded);
    draft[1] = { open: true, from: "09:30", to: "18:45" };
    const all = applyToAllDays(draft, 1);
    for (let d = 0; d < 7; d++) expect(all[d]).toEqual({ open: true, from: "09:30", to: "18:45" });
    const closed = applyToAllDays({ ...draft, 3: { open: false, from: "08:00", to: "20:00" } }, 3);
    expect(Object.values(serializeWeeklyDraft(closed)).every((d) => d === null)).toBe(true);
  });

  it("summarizes runs of equal days, Monday first", () => {
    expect(summarizeWeeklyHours(seeded)).toEqual([{ days: [1, 2, 3, 4, 5, 6, 0], hours: { open: "08:00", close: "20:00" } }]);
    const week = [...seeded];
    week[5] = null as never; // Friday closed
    expect(summarizeWeeklyHours(week)).toEqual([
      { days: [1, 2, 3, 4], hours: { open: "08:00", close: "20:00" } },
      { days: [5], hours: null },
      { days: [6, 0], hours: { open: "08:00", close: "20:00" } },
    ]);
    expect(summarizeWeeklyHours({})).toBeNull();
  });
});
