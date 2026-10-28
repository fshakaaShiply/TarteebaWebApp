import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBookings, lookupCustomer, previewManualBooking, previewReschedule, resolveCancelReview, type ManualBookingPayload } from "./endpoints";

// Records what each endpoint hands the typed client: path, path/query params, body and headers. The component tests mock
// these functions away, and the list query is cast for the generated types, so the API's own names are pinned here.
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

describe("A03 bookings endpoints", () => {
  beforeEach(() => {
    calls.list = [];
  });

  it("lists bookings with the API's filter names (slot, cleaner, driver, review queue) and leaves out empty ones", async () => {
    await fetchBookings({ page: 1, perPage: 25, slotTemplateId: 2, workerId: 14, driverId: 3, cancelReview: true, search: " Sara " });
    expect(last()).toMatchObject({ method: "GET", path: "/v1/admin/bookings" });
    expect((last().options.params as { query: Record<string, unknown> }).query).toEqual({
      page: 1,
      per_page: 25,
      slot_template_id: 2,
      worker_id: 14,
      driver_id: 3,
      cancel_review: 1,
      search: "Sara",
    });

    await fetchBookings({ page: 2, status: "", slotTemplateId: null, workerId: null, driverId: null, cancelReview: undefined, zoneId: null });
    expect((last().options.params as { query: Record<string, unknown> }).query).toEqual({ page: 2 });
  });

  it("resolves a cancellation review with Idempotency-Key and If-Match", async () => {
    await resolveCancelReview(4, { refund_fils: 20000, note: "Late notice, fee kept" }, 3, "key-1");
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/bookings/{booking}/cancel-review/resolve",
      options: {
        params: { path: { booking: 4 } },
        body: { refund_fils: 20000, note: "Late notice, fee kept" },
        headers: { "Idempotency-Key": "key-1", "If-Match": "3" },
      },
    });

    await resolveCancelReview(4, { refund_fils: 0, note: "No refund" }, null, "key-2");
    expect(last().options.headers).toEqual({ "Idempotency-Key": "key-2" });
  });

  it("sends the dry runs and the customer lookup to their own paths", async () => {
    await previewReschedule(4, { service_date: "2026-10-24", slot_template_id: 2 });
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/bookings/{booking}/reschedule/preview",
      options: { params: { path: { booking: 4 } }, body: { service_date: "2026-10-24", slot_template_id: 2 } },
    });

    const payload = { source: "phone", customer: { phone: "+971501234567", name: null, locale: "ar" }, address: { id: "01A1" } } as ManualBookingPayload;
    await previewManualBooking(payload);
    expect(last()).toMatchObject({ method: "POST", path: "/v1/admin/bookings/preview", options: { body: payload } });
    expect(last().options).not.toHaveProperty("headers");

    await lookupCustomer("+971501234567");
    expect(last()).toEqual({ method: "GET", path: "/v1/admin/customers", options: { params: { query: { phone: "+971501234567" } } } });
  });
});
