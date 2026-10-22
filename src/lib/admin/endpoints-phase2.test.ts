import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveLeave,
  deleteSlotRule,
  fetchWorkers,
  overrideCapacity,
  rejectLeave,
  setWorkerServices,
  updateSetting,
  updateVehicle,
  updateWorker,
  updateWorkerShifts,
} from "./endpoints";

// Records what each endpoint hands the typed client: path, path/query params, body and headers.
const calls = vi.hoisted(() => ({ list: [] as { method: string; path: string; options: Record<string, unknown> }[] }));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  const record = (method: string) =>
    vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.list.push({ method, path, options });
      return { data: { data: { id: 1 }, meta: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }, response: new Response(null, { status: 200 }) };
    });
  return {
    ...actual,
    adminApi: { GET: record("GET"), POST: record("POST"), PUT: record("PUT"), PATCH: record("PATCH"), DELETE: record("DELETE") },
  };
});

const last = () => calls.list[calls.list.length - 1];

describe("Phase 2 endpoints", () => {
  beforeEach(() => {
    calls.list = [];
  });

  it("approves a leave with If-Match, and only adds force + reason when saving anyway", async () => {
    await approveLeave(5, null, 3);
    expect(last()).toMatchObject({
      method: "POST",
      path: "/v1/admin/leaves/{leave}/approve",
      options: { params: { path: { leave: 5 } }, body: { note: null, version: 3 }, headers: { "If-Match": "3" } },
    });
    expect(last().options.body).not.toHaveProperty("force");

    await approveLeave(5, "Covered by Siti", 3, { reason: "  Both visits reassigned to Siti  " });
    expect(last().options.body).toEqual({ note: "Covered by Siti", version: 3, force: true, reason: "Both visits reassigned to Siti" });
  });

  it("rejects a leave with its note and version", async () => {
    await rejectLeave(5, "Peak week", 4);
    expect(last().options).toMatchObject({ body: { note: "Peak week", version: 4 }, headers: { "If-Match": "4" } });
  });

  it("sends the whole week with the rest day, and force on the workforce writes the guard checks", async () => {
    const shifts = Array.from({ length: 7 }, (_, d) => ({ day_of_week: d, is_working: d !== 5, start_time: d !== 5 ? "09:00" : null, end_time: d !== 5 ? "24:00" : null }));
    await updateWorkerShifts(1, { shifts, weekly_rest_day: 5 }, 2, { reason: "Accepted shortfall for training" });
    expect(last()).toMatchObject({
      method: "PUT",
      path: "/v1/admin/workers/{worker}/shifts",
      options: { body: { shifts, weekly_rest_day: 5, version: 2, force: true, reason: "Accepted shortfall for training" }, headers: { "If-Match": "2" } },
    });

    await setWorkerServices(1, [1, 2], 3);
    expect(last().options.body).toEqual({ service_ids: [1, 2], version: 3 });

    await updateWorker(1, { employment_status: "suspended" }, 4, { reason: "Suspended pending review" });
    expect(last().options.body).toEqual({ employment_status: "suspended", version: 4, force: true, reason: "Suspended pending review" });

    await updateVehicle(2, { seats: 4 }, 1);
    expect(last().options).toMatchObject({ body: { seats: 4, version: 1 }, headers: { "If-Match": "1" } });
  });

  it("drops empty list filters", async () => {
    await fetchWorkers({ page: 2, perPage: 25, search: "  ", status: "", zoneId: 1, skill: "" });
    expect(last().options).toEqual({ params: { query: { page: 2, per_page: 25, zone_id: 1 } } });
  });

  it("deletes a slot rule with the version and the audit reason", async () => {
    await deleteSlotRule(9, 2, "Season over");
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/v1/admin/slot-rules/{slotRule}",
      options: { body: { version: 2, reason: "Season over" }, headers: { "If-Match": "2" } },
    });
  });

  it("posts a capacity override as built by the dialog", async () => {
    await overrideCapacity({ date: "2026-10-24", zone_id: 1, slot_template_id: 1, action: "open", reason: "Phone booking for a VIP" });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/v1/admin/capacity/override",
      options: { body: { date: "2026-10-24", zone_id: 1, slot_template_id: 1, action: "open", reason: "Phone booking for a VIP" } },
    });
  });

  it("saves booking.working_hours as the \"0\"…\"6\" object with the reason and If-Match", async () => {
    const value = { "0": null, "1": { open: "08:00", close: "20:00" }, "2": null, "3": null, "4": null, "5": null, "6": null };
    await updateSetting("booking.working_hours", value, "Ramadan hours", 7);
    expect(last()).toMatchObject({
      method: "PUT",
      path: "/v1/admin/settings/{key}",
      options: { params: { path: { key: "booking.working_hours" } }, body: { value, reason: "Ramadan hours", version: 7 }, headers: { "If-Match": "7" } },
    });
  });
});
