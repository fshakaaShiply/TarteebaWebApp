import { describe, expect, it } from "vitest";
import { round } from "@/test/opsBoardFixtures";
import {
  departInstant,
  duplicateSeats,
  fillSeats,
  isEditable,
  moveItem,
  passengerViolations,
  passengersPayload,
  reportTargets,
  roundChanges,
  roundEditDefaults,
  seatRows,
  splitWarnings,
} from "./rounds";

describe("trip planner helpers", () => {
  it("moves a stop within the order", () => {
    expect(moveItem([101, 102, 103], 2, 0)).toEqual([103, 101, 102]);
    expect(moveItem([101, 102, 103], 0, 1)).toEqual([102, 101, 103]);
    expect(moveItem([101, 102], 1, 5)).toEqual([101, 102]);
  });

  it("splits the warnings about one stop from the round's own", () => {
    const { round: own, byStop } = splitWarnings(round({ warnings: [...round().warnings, { type: "no_driver", message: { ar: "", en: "No driver" } }] }));
    expect(own.map((w) => w.type)).toEqual(["no_driver"]);
    expect(byStop.get(102)?.map((w) => w.type)).toEqual(["late_stop", "team_not_aboard"]);
    expect(byStop.has(101)).toBe(false);
  });

  it("sends only what changed, the departure as a Dubai instant with its offset", () => {
    const r = round();
    expect(roundEditDefaults(r)).toEqual({ vehicleId: "1", driverId: "1", departTime: "09:15" });
    expect(roundChanges(r, { vehicleId: "1", driverId: "1", departTime: "09:15" })).toEqual({});
    expect(roundChanges(r, { vehicleId: "2", driverId: "", departTime: "09:30" })).toEqual({
      vehicle_id: 2,
      driver_id: null,
      planned_depart_at: "2026-10-24T09:30:00+04:00",
    });
    expect(departInstant("2026-10-24", "24:00")).toBeNull();
  });

  it("lists the riders by stop, keeps their seats and fills the empty ones in stop order", () => {
    const rows = seatRows(round());
    expect(rows.map((r) => [r.name, r.sequence, r.seat])).toEqual([
      ["Maria S.", 1, "1"],
      ["Nirmala P.", 1, "2"],
      ["Tigist B.", 2, ""],
    ]);
    const filled = fillSeats(rows, 7);
    expect(passengersPayload(filled)).toEqual([
      { worker_id: 1, seat_no: 1 },
      { worker_id: 4, seat_no: 2 },
      { worker_id: 5, seat_no: 3 },
    ]);
    // Never past the van's seats.
    expect(fillSeats(rows, 2).find((r) => r.workerId === 5)?.seat).toBe("");
    expect([...duplicateSeats([...filled.slice(0, 2), { ...filled[2], seat: "1" }])]).toEqual(["1"]);
  });

  it("reads the team-rule violations of a refused seating", () => {
    expect(passengerViolations({ violations: { team_split: [8], not_on_round: [9] }, can_override: true })).toEqual({ notOnRound: [9], teamSplit: [8] });
    expect(passengerViolations({})).toEqual({ notOnRound: [], teamSplit: [] });
  });

  it("edits planned rounds only, and moves a report forward only", () => {
    expect(isEditable(round())).toBe(true);
    expect(isEditable(round({ status: "departed" }))).toBe(false);
    expect(reportTargets("open")).toEqual(["acknowledged", "resolved"]);
    expect(reportTargets("acknowledged")).toEqual(["resolved"]);
    expect(reportTargets("resolved")).toEqual([]);
  });
});
