import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignWorker,
  cancelSubscription,
  changeLiveOutDay,
  confirmSubscription,
  decideRescheduleRequest,
  fetchSubscriptionVisits,
  fetchSubscriptions,
  freezeSubscription,
  previewConfirm,
  previewFollowing,
  previewVisitMove,
  rejectSubscription,
  renewSubscription,
  resolveCancelReview,
  skipVisit,
  switchAutoRenewOff,
  unfreezeSubscription,
  writeVisit,
} from "./endpoints";

// Records what each endpoint hands the typed client (path, path/query params, body, headers): the component tests mock
// these functions away, and the bodies are cast for the generated types, so the API's own names are pinned here.
const calls = vi.hoisted(() => ({ list: [] as { method: string; path: string; options: Record<string, unknown> }[] }));

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  const record = (method: string) =>
    vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.list.push({ method, path, options });
      return { data: { data: { id: 1 }, meta: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }, response: new Response(null, { status: 200 }) };
    });
  return { ...actual, adminApi: { GET: record("GET"), POST: record("POST") } };
});

const last = () => calls.list[calls.list.length - 1];
const query = () => (last().options.params as { query: Record<string, unknown> }).query;

describe("A08 endpoints", () => {
  beforeEach(() => {
    calls.list = [];
  });

  it("lists with the API's filter names, a comma status list, and leaves out empty ones", async () => {
    await fetchSubscriptions({ page: 2, perPage: 25, status: ["active", "paused"], zoneId: 1, workerId: null, conflicts: true, cancelReview: false, search: " Sara ", paymentHealth: "", type: undefined });
    expect(last()).toMatchObject({ method: "GET", path: "/v1/admin/subscriptions" });
    expect(query()).toEqual({ page: 2, per_page: 25, status: "active,paused", zone_id: 1, conflicts: 1, q: "Sara" });
  });

  it("reads the visits in a range, by occurrence", async () => {
    await fetchSubscriptionVisits(31, { from: "2026-11-01", to: "2026-12-01", perPage: 100 });
    expect(last()).toMatchObject({ method: "GET", path: "/v1/admin/subscriptions/{subscription}/visits" });
    expect(query()).toEqual({ from: "2026-11-01", to: "2026-12-01", per_page: 100 });
  });

  it("confirms with Idempotency-Key and If-Match, naming only the workers staff chose", async () => {
    await previewConfirm(31, { primary_worker_id: 14 });
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/subscriptions/{subscription}/confirm/preview", options: { params: { path: { subscription: 31 } }, body: { primary_worker_id: 14 } } });
    await confirmSubscription(31, { primary_worker_id: 14, backup_worker_id: 15 }, 7, "key-1");
    expect(last().options).toEqual({
      params: { path: { subscription: 31 } },
      body: { primary_worker_id: 14, backup_worker_id: 15 },
      headers: { "Idempotency-Key": "key-1", "If-Match": "7" },
    });
    await rejectSubscription(31, "No capacity", null, "key-2");
    expect(last().options.headers).toEqual({ "Idempotency-Key": "key-2" });
    expect(last().options.body).toEqual({ reason: "No capacity" });
  });

  it("sends the visit dry runs and writes to the occurrence's ULID", async () => {
    await previewVisitMove(31, "01jocc", { scope: "this", date: "2026-11-02", slot_template_id: 2 });
    expect(last()).toMatchObject({ path: "/v1/admin/subscriptions/{subscription}/visits/{visit}/preview", options: { params: { path: { subscription: 31, visit: "01jocc" } }, body: { scope: "this", date: "2026-11-02", slot_template_id: 2 } } });
    await previewFollowing(31, "01jocc", { scope: "following", days_of_week: [1, 4] });
    expect(last().options.body).toEqual({ scope: "following", days_of_week: [1, 4] });
    await writeVisit(31, "01jocc", { scope: "following", action: "edit", days_of_week: [1, 4], expected_term_end_date: "2026-11-28" }, 7, "key-3");
    expect(last()).toMatchObject({
      path: "/v1/admin/subscriptions/{subscription}/visits/{visit}",
      options: { body: { scope: "following", action: "edit", days_of_week: [1, 4], expected_term_end_date: "2026-11-28" }, headers: { "Idempotency-Key": "key-3", "If-Match": "7" } },
    });
    await writeVisit(31, "01jocc", { scope: "this", action: "cancel_by_company", reason: "No cleaner" }, 7, "key-4");
    expect(last().options.body).toEqual({ scope: "this", action: "cancel_by_company", reason: "No cleaner" });
    await decideRescheduleRequest(31, "01jocc", { decision: "decline", reason: "Full" }, 7, "key-5");
    expect(last()).toMatchObject({ path: "/v1/admin/subscriptions/{subscription}/visits/{visit}/reschedule-request", options: { body: { decision: "decline", reason: "Full" } } });
  });

  it("skips with the end date shown, freezes with it, and unfreezes with only If-Match", async () => {
    await skipVisit(31, "01jocc", "2026-12-01", 7, "key-6");
    expect(last().options).toEqual({ params: { path: { subscription: 31 } }, body: { visit_id: "01jocc", expected_term_end_date: "2026-12-01" }, headers: { "Idempotency-Key": "key-6", "If-Match": "7" } });
    await freezeSubscription(31, { from: "2026-11-15", to: "2026-11-21", reason: "Travel", expected_term_end_date: "2026-12-05" }, 7, "key-7");
    expect(last()).toMatchObject({ path: "/v1/admin/subscriptions/{subscription}/freeze", options: { body: { from: "2026-11-15", to: "2026-11-21", reason: "Travel", expected_term_end_date: "2026-12-05" } } });
    await unfreezeSubscription(31, 7);
    expect(last()).toMatchObject({ path: "/v1/admin/subscriptions/{subscription}/unfreeze", options: { headers: { "If-Match": "7" } } });
  });

  it("switches auto-renew only off, renews with the amount the preview showed, and cancels with the expected terms", async () => {
    await switchAutoRenewOff(31, "Customer asked", 7);
    expect(last().options).toMatchObject({ body: { auto_renew: false, reason: "Customer asked" }, headers: { "If-Match": "7" } });
    await renewSubscription(31, 96000, "key-8");
    expect(last().options).toEqual({ params: { path: { subscription: 31 } }, body: { expected_amount_fils: 96000 }, headers: { "Idempotency-Key": "key-8" } });
    await cancelSubscription(31, { party: "company", reason_code: "no_capacity", refund_fils: 5000, expected_fee_fils: 0, expected_refund_fils: 82800, expected_clawback_fils: 0 }, 7, "key-9");
    expect(last()).toMatchObject({
      path: "/v1/admin/subscriptions/{subscription}/cancel",
      options: { body: { party: "company", reason_code: "no_capacity", refund_fils: 5000, expected_fee_fils: 0, expected_refund_fils: 82800, expected_clawback_fils: 0 }, headers: { "Idempotency-Key": "key-9", "If-Match": "7" } },
    });
    await resolveCancelReview(31, { refund_fils: 4000, note: "Agreed" }, 7, "key-10");
    expect(last()).toMatchObject({ path: "/v1/admin/subscriptions/{subscription}/cancel-review/resolve", options: { body: { refund_fils: 4000, note: "Agreed" } } });
  });

  it("assigns the primary and the backup to their own routes, with a null to clear", async () => {
    await assignWorker(31, "primary", 14, "2026-11-02", 7);
    expect(last()).toMatchObject({ path: "/v1/admin/subscriptions/{subscription}/assign-primary", options: { body: { worker_id: 14, apply_from: "2026-11-02" }, headers: { "If-Match": "7" } } });
    await assignWorker(31, "backup", null, null, 7);
    expect(last()).toMatchObject({ path: "/v1/admin/subscriptions/{subscription}/assign-backup", options: { body: { worker_id: null } } });
  });

  it("changes a Live-out day on the date's own path", async () => {
    await changeLiveOutDay(32, "2026-11-11", { change: "absence", scope: "this", substitute_worker_id: 15 }, 3, "key-11");
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/subscriptions/{subscription}/live-out-days/{date}",
      options: { params: { path: { subscription: 32, date: "2026-11-11" } }, body: { change: "absence", scope: "this", substitute_worker_id: 15 }, headers: { "Idempotency-Key": "key-11", "If-Match": "3" } },
    });
  });
});
