import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_POLL_HEADER } from "./client";
import { fetchAlerts, fetchBooking, fetchDashboardAlerts, fetchDashboardSummary, fetchRefundsByPhone, fetchVisitCandidates } from "./endpoints";

// Records what each endpoint hands the typed client: path, params and the per-call headers.
const calls = vi.hoisted(() => ({ list: [] as { method: string; path: string; options: Record<string, unknown> }[] }));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  const record = (method: string) =>
    vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.list.push({ method, path, options });
      // Suits every unwrap below: { data } envelopes and plain pages alike.
      return { data: { data: { id: 1 }, meta: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }, response: new Response(null, { status: 200 }) };
    });
  return { ...actual, adminApi: { GET: record("GET"), POST: record("POST"), PUT: record("PUT"), PATCH: record("PATCH"), DELETE: record("DELETE") } };
});

const last = () => calls.list[calls.list.length - 1];
const POLL = { [BACKGROUND_POLL_HEADER]: "1" };

/**
 * The timed refresh (spec §13.2): each read a timer or a poll sets off sends X-Background-Poll: 1, so the API does not
 * count it as staff activity; the same read started by the user sends nothing.
 */
describe("background poll reads", () => {
  beforeEach(() => {
    calls.list = [];
  });

  const reads: [string, string, (background?: boolean) => Promise<unknown>][] = [
    ["the overview summary", "/v1/admin/dashboard/summary", (b) => fetchDashboardSummary({ date: "2026-10-23", zoneId: null }, b === undefined ? undefined : { background: b })],
    ["the overview alerts", "/v1/admin/dashboard/alerts", (b) => fetchDashboardAlerts({ zoneId: null }, b === undefined ? undefined : { background: b })],
    ["the bell", "/v1/admin/alerts", (b) => fetchAlerts({ since: "2026-10-23T15:59:00Z" }, b === undefined ? undefined : { background: b })],
    ["the booking page", "/v1/admin/bookings/{booking}", (b) => fetchBooking(4, b === undefined ? undefined : { background: b })],
    ["a visit's candidates", "/v1/admin/visits/{visit}/candidates", (b) => fetchVisitCandidates(4, b === undefined ? undefined : { background: b })],
    ["a customer's refunds", "/v1/admin/refunds", (b) => fetchRefundsByPhone("+971500000001", b === undefined ? undefined : { background: b })],
  ];

  it.each(reads)("%s: X-Background-Poll only on a background read", async (_name, path, read) => {
    await read(true);
    expect(last()).toMatchObject({ method: "GET", path });
    expect(last().options.headers).toEqual(POLL);

    await read(false);
    expect(last().options.headers).toEqual({});
    await read();
    expect(last().options.headers).toEqual({});
  });
});
