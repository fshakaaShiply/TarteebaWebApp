import { describe, expect, it } from "vitest";
import { minutesLeft, slaChip, slaDistance, slaKindOf } from "./sla";
import type { CaseSla } from "./types";

const NOW = Date.parse("2026-10-23T16:00:00Z");
const sla = (over: Partial<CaseSla> = {}): CaseSla => ({ state: "on_track", kind: "first_response", due_at: "2026-10-23T19:00:00+00:00", remaining_minutes: 180, ...over });

describe("SLA chip model", () => {
  it("words the distance in minutes, hours and days, never less than one", () => {
    expect(slaDistance(0)).toEqual({ unit: "minutes", value: 1 });
    expect(slaDistance(59)).toEqual({ unit: "minutes", value: 59 });
    expect(slaDistance(60)).toEqual({ unit: "hours", value: 1 });
    expect(slaDistance(-125)).toEqual({ unit: "hours", value: 2 });
    expect(slaDistance(47 * 60 + 59)).toEqual({ unit: "hours", value: 48 });
    expect(slaDistance(150)).toEqual({ unit: "hours", value: 3 });
    // A time still ahead rounds up, one already past rounds down.
    expect(slaDistance(49.5)).toEqual({ unit: "minutes", value: 50 });
    expect(slaDistance(-49.5)).toEqual({ unit: "minutes", value: 49 });
    expect(slaDistance(48 * 60)).toEqual({ unit: "days", value: 2 });
  });

  it("counts down from the deadline with the page's clock, not from the minutes the API sent", () => {
    expect(slaChip(sla(), NOW)).toEqual({ kind: "left", unit: "hours", value: 3, due: false });
    // Forty minutes later the same answer reads 2 h, with no new read.
    expect(slaChip(sla(), NOW + 40 * 60_000)).toEqual({ kind: "left", unit: "hours", value: 2, due: false });
    expect(minutesLeft(sla({ due_at: null, remaining_minutes: 42 }), NOW)).toBe(42);
  });

  it("marks a case due soon and one past its deadline as overdue", () => {
    expect(slaChip(sla({ state: "due_soon" }), NOW)).toMatchObject({ kind: "left", due: true });
    const past = sla({ state: "breached", due_at: "2026-10-23T14:00:00+00:00", remaining_minutes: -120 });
    expect(slaChip(past, NOW)).toEqual({ kind: "overdue", unit: "hours", value: 2 });
    // The tick passed the deadline before the next read said "breached".
    expect(slaChip(sla({ due_at: "2026-10-23T15:30:00+00:00" }), NOW)).toEqual({ kind: "overdue", unit: "minutes", value: 30 });
  });

  it("keeps a marked breach overdue even when its deadline moved ahead again", () => {
    expect(slaChip(sla({ state: "breached" }), NOW)).toEqual({ kind: "overdue", unit: null, value: 0 });
  });

  it("shows paused cases as paused and finished ones as nothing", () => {
    expect(slaChip(sla({ state: "paused", due_at: null, remaining_minutes: null }), NOW)).toEqual({ kind: "paused" });
    expect(slaChip(sla({ state: "none", due_at: null, kind: null }), NOW)).toEqual({ kind: "none" });
    expect(slaChip(sla({ state: "met", due_at: null, kind: null }), NOW)).toEqual({ kind: "none" });
    expect(slaKindOf(sla({ state: "met" }))).toBeNull();
    expect(slaKindOf(sla())).toBe("first_response");
  });
});
