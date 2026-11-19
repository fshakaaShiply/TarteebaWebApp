import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveCompensation,
  cancelCompensation,
  createCase,
  fetchCases,
  fetchCompensations,
  fetchFreeVisitAvailability,
  fetchRatings,
  postMessage,
  rejectCompensation,
  resolveCase,
  setRatingExcluded,
  updateCase,
  uploadCaseFile,
} from "./endpoints";

const calls = vi.hoisted(() => ({ list: [] as { method: string; path: string; options: Record<string, unknown> }[], uploads: [] as { path: string; body: FormData }[] }));

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  const record = (method: string) =>
    vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.list.push({ method, path, options });
      return { data: { data: { id: 1 }, meta: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }, response: new Response(null, { status: 200 }) };
    });
  return {
    ...actual,
    adminApi: { GET: record("GET"), POST: record("POST"), PATCH: record("PATCH"), PUT: record("PUT"), DELETE: record("DELETE") },
    adminUpload: vi.fn(async (path: string, body: FormData) => {
      calls.uploads.push({ path, body });
      return { data: { id: "A1" } };
    }),
  };
});

const last = () => calls.list[calls.list.length - 1];

describe("A10 endpoints", () => {
  beforeEach(() => {
    calls.list = [];
    calls.uploads = [];
  });

  it("lists cases with the API's names: array filters as name[], flags as 1, empty ones left out", async () => {
    await fetchCases({ page: 2, perPage: 25, status: ["open", "in_review"], assignee: "me", awaitingApproval: true, customerReplied: false, q: " lila ", workerId: 3 });
    expect(last()).toEqual({
      method: "GET",
      path: "/v1/admin/complaints",
      options: { params: { query: { page: 2, per_page: 25, assignee: "me", awaiting_approval: 1, worker_id: 3, q: "lila", "status[]": ["open", "in_review"] } }, headers: {} },
    });
  });

  it("marks a timer-driven read as a background poll", async () => {
    await fetchCases({}, { background: true });
    expect(last().options.headers).toEqual({ "X-Background-Poll": "1" });
  });

  it("sends a reply with its Idempotency-Key, and a resolve also with the case's version as If-Match", async () => {
    await postMessage(7, { body: "Hi", is_internal: false }, "key-1");
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/complaints/{complaint}/messages",
      options: { params: { path: { complaint: 7 } }, body: { body: "Hi", is_internal: false }, headers: { "Idempotency-Key": "key-1" } },
    });
    await resolveCase(7, { outcome: "partial", resolution: "Sorry", compensation: { type: "refund", amount_fils: 3000 } }, 5, "key-2");
    expect(last().options.headers).toEqual({ "Idempotency-Key": "key-2", "If-Match": "5" });
    expect(last().options.body).toEqual({ outcome: "partial", resolution: "Sorry", compensation: { type: "refund", amount_fils: 3000 } });
  });

  it("edits a case with its version as If-Match", async () => {
    await updateCase(7, { assignee_id: 4 }, 5);
    expect(last()).toEqual({ method: "PATCH", path: "/v1/admin/complaints/{complaint}", options: { params: { path: { complaint: 7 } }, body: { assignee_id: 4 }, headers: { "If-Match": "5" } } });
  });

  it("logs a staff case with its key", async () => {
    await createCase({ customer_id: "01JC", booking_id: 4, type: "complaint", category: "quality", description: "x".repeat(12), source: "phone" }, "key-3");
    expect(last().path).toBe("/v1/admin/complaints");
    expect(last().options.headers).toEqual({ "Idempotency-Key": "key-3" });
  });

  it("approves with the amount that was shown, the key and the version; rejects and withdraws with the version", async () => {
    await approveCompensation(12, { expected_amount_fils: 3000, note: "ok" }, 3, "key-4");
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/compensations/{compensation}/approve",
      options: { params: { path: { compensation: 12 } }, body: { expected_amount_fils: 3000, note: "ok" }, headers: { "Idempotency-Key": "key-4", "If-Match": "3" } },
    });
    await rejectCompensation(12, "no proof", 3, "key-5");
    expect(last().options).toMatchObject({ body: { reason: "no proof" }, headers: { "Idempotency-Key": "key-5", "If-Match": "3" } });
    await cancelCompensation(12, undefined, 3);
    expect(last().options).toMatchObject({ body: {}, headers: { "If-Match": "3" } });
  });

  it("reads the queue with a status array and the free-visit dates with the case's id", async () => {
    await fetchCompensations({ status: ["failed"], type: "refund", page: 1 });
    expect(last().options).toEqual({ params: { query: { page: 1, "type[]": "refund", "status[]": ["failed"] } } });
    await fetchFreeVisitAvailability(7, { from: "2026-10-24", to: "2026-11-06", slotTemplateId: 2 });
    expect(last().options).toEqual({ params: { path: { complaint: 7 }, query: { from: "2026-10-24", to: "2026-11-06", slot_template_id: 2 } } });
  });

  it("filters ratings and excludes one with the reason and version", async () => {
    await fetchRatings({ low: true, excluded: false, kind: "single", q: "TRB" });
    expect(last().options).toEqual({ params: { query: { low: 1, "kind[]": "single", q: "TRB" } } });
    await setRatingExcluded(21, true, "customer was away", 2);
    expect(last()).toMatchObject({ path: "/v1/admin/ratings/{rating}/exclude", options: { body: { reason: "customer was away" }, headers: { "If-Match": "2" } } });
    await setRatingExcluded(21, false, "counts again", 3);
    expect(last().path).toBe("/v1/admin/ratings/{rating}/include");
  });

  it("uploads a staff file as the complaint purpose", async () => {
    await uploadCaseFile(new File(["x"], "a.jpg", { type: "image/jpeg" }));
    expect(calls.uploads[0].path).toBe("/v1/admin/quality/attachments");
    expect(calls.uploads[0].body.get("purpose")).toBe("complaint");
    expect((calls.uploads[0].body.get("file") as File).name).toBe("a.jpg");
  });
});
