import { describe, expect, it } from "vitest";
import { card, confirmedCard, dayBoard, monthBoard } from "@/test/opsBoardFixtures";
import {
  calendarWeeks,
  cellCards,
  isDropTarget,
  isMovable,
  isRescheduleDrop,
  moveInputFor,
  moveTargets,
  scheduleFiltersFromParams,
  scheduleFiltersToParams,
  scheduleKey,
  scheduleQuery,
  shiftDate,
} from "./board";

describe("schedule URL filters", () => {
  it("reads the view, date and filters with the API's names and drops malformed values", () => {
    const filters = scheduleFiltersFromParams(
      new URLSearchParams("view=week&date=2026-10-24&service_id=1&slot_template_id=2&worker_id=5&status=scheduled,bogus,worker_assigned,scheduled"),
    );
    expect(filters).toEqual({ view: "week", date: "2026-10-24", serviceId: 1, slotTemplateId: 2, workerId: 5, statuses: ["scheduled", "worker_assigned"] });
    expect(scheduleFiltersFromParams(new URLSearchParams("view=year&date=2026-02-30&service_id=-1&worker_id=x"))).toEqual({
      view: "day",
      date: "",
      serviceId: null,
      slotTemplateId: null,
      workerId: null,
      statuses: [],
    });
  });

  it("writes back only what is set (day view and today implied) and builds the API query and cache key", () => {
    const filters = scheduleFiltersFromParams(new URLSearchParams("view=month&status=completed"));
    expect(scheduleFiltersToParams(filters).toString()).toBe("view=month&status=completed");
    expect(scheduleFiltersToParams({ ...filters, view: "day", statuses: [] }).toString()).toBe("");
    const query = scheduleQuery(filters, "2026-10-24", 1);
    expect(query).toEqual({ view: "month", date: "2026-10-24", zoneId: 1, serviceId: null, slotTemplateId: null, workerId: null, statuses: ["completed"] });
    expect(scheduleKey(query)).toEqual({ view: "month", date: "2026-10-24", zone: 1, service: 0, slot: 0, worker: 0, status: "completed" });
  });
});

describe("dates", () => {
  it("steps by a day, a week or a calendar month (clamping to the month's last day)", () => {
    expect(shiftDate("day", "2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("week", "2026-10-24", -1)).toBe("2026-10-17");
    expect(shiftDate("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftDate("month", "2026-01-15", -1)).toBe("2025-12-15");
  });

  it("lays a month out in Monday-first weeks", () => {
    const weeks = calendarWeeks(monthBoard().days);
    // 1 October 2026 is a Thursday: three empty cells first; 31 October is a Saturday: one after.
    expect(weeks[0].slice(0, 4).map((d) => d?.date ?? null)).toEqual([null, null, null, "2026-10-01"]);
    expect(weeks).toHaveLength(5);
    expect(weeks[4].map((d) => d?.date ?? null)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", null]);
  });
});

describe("moves", () => {
  it("moves only open visits: a pending or confirmed booking whose visit has not started", () => {
    expect(isMovable(card())).toBe(true);
    expect(isMovable(confirmedCard())).toBe(true);
    expect(isMovable(card({ status: "en_route" }))).toBe(false);
    expect(isMovable(card({ booking: { ...card().booking, status: "completed" } }))).toBe(false);
  });

  it("offers every row except the card's own and its team as a drop target", () => {
    const source = { card: confirmedCard(), fromWorkerId: 1 };
    expect(isDropTarget(source, { workerId: 1, date: "2026-10-24", slotId: 2 })).toBe(false);
    expect(isDropTarget(source, { workerId: 4, date: "2026-10-24", slotId: 2 })).toBe(false);
    expect(isDropTarget(source, { workerId: 5, date: "2026-10-24", slotId: 2 })).toBe(true);
    // Another slot or date is still a target: the API answers USE_RESCHEDULE.
    expect(isDropTarget(source, { workerId: 5, date: "2026-10-25", slotId: 1 })).toBe(true);
    expect(isRescheduleDrop(source, { workerId: 5, date: "2026-10-24", slotId: 1 })).toBe(true);
    expect(isRescheduleDrop(source, { workerId: 5, date: "2026-10-24", slotId: null })).toBe(false);
    expect(moveTargets(dayBoard(), confirmedCard()).map((w) => w.display_name)).toEqual(["Siti R.", "Tigist B.", "Grace N."]);
  });

  it("sends where the card was dropped; the week view's cells keep the card's own slot", () => {
    expect(moveInputFor({ card: card(), fromWorkerId: null }, { workerId: 5, date: "2026-10-24", slotId: 1 })).toEqual({
      visit_id: 4,
      from_worker_id: null,
      to_worker_id: 5,
      date: "2026-10-24",
      slot_template_id: 1,
    });
    expect(moveInputFor({ card: confirmedCard(), fromWorkerId: 1 }, { workerId: 5, date: "2026-10-25", slotId: null })).toEqual({
      visit_id: 7,
      from_worker_id: 1,
      to_worker_id: 5,
      date: "2026-10-25",
      slot_template_id: 2,
    });
  });

  it("puts each card in its slot column", () => {
    const maria = dayBoard().rows[0];
    expect(cellCards(maria, "2026-10-24", 2).map((c) => c.id)).toEqual([7]);
    expect(cellCards(maria, "2026-10-24", 1)).toEqual([]);
    expect(cellCards(maria, "2026-10-24", null).map((c) => c.id)).toEqual([7]);
  });
});
