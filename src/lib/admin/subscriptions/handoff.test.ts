import { describe, expect, it } from "vitest";
import { parseSeriesMove, seriesMoveHref } from "./handoff";

describe("A04 → A08 move hand-off", () => {
  it("links the subscription with the visit's booking, its date and where it was dropped, and reads it back", () => {
    const href = seriesMoveHref(31, { booking: 9, on: "2026-10-25", date: "2026-10-24", slotId: 1 });
    expect(href).toBe("/admin/subscriptions/31?date=2026-10-24&move=9&on=2026-10-25&slot=1");
    const query = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(parseSeriesMove(query)).toEqual({ booking: 9, on: "2026-10-25", date: "2026-10-24", slotId: 1 });
    // A drop that keeps the slot (none named) still names the date.
    expect(parseSeriesMove({ move: "9", on: "2026-10-25", date: "2026-10-26" })).toEqual({ booking: 9, on: "2026-10-25", date: "2026-10-26", slotId: null });
  });

  it("ignores a link without a usable hand-off", () => {
    expect(parseSeriesMove({})).toBeNull();
    expect(parseSeriesMove({ move: "x", on: "2026-10-25", date: "2026-10-24" })).toBeNull();
    expect(parseSeriesMove({ move: "9", on: "25/10/2026", date: "2026-10-24" })).toBeNull();
    expect(parseSeriesMove({ move: "9", on: "2026-10-25" })).toBeNull();
    expect(parseSeriesMove({ move: ["9", "10"], on: "2026-10-25", date: "2026-10-24", slot: "abc" })).toEqual({ booking: 9, on: "2026-10-25", date: "2026-10-24", slotId: null });
  });
});
