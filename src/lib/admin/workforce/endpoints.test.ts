import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateRule,
  approveProposal,
  bulkApprove,
  bulkReject,
  computeIncentives,
  createAdjustment,
  createRule,
  createWorkerDocument,
  deactivateRule,
  deleteAdjustment,
  deleteRule,
  deleteWorkerDocument,
  deleteWorkerPhoto,
  fetchAdjustments,
  fetchAttendanceSheet,
  fetchDocumentFile,
  fetchPosting,
  fetchPostingFile,
  fetchPostings,
  fetchProposals,
  fetchRules,
  fetchWaitlist,
  fetchWorkerAttendance,
  fetchWorkerDocuments,
  fetchWorkerStats,
  notifyWaitlistEntry,
  postIncentives,
  previewRule,
  recomputeProposal,
  recordAttendance,
  rejectProposal,
  reopenProposal,
  replaceDocumentFile,
  revertAttendance,
  updateRule,
  updateWorkerDocument,
  uploadWorkerPhoto,
} from "./endpoints";

const calls = vi.hoisted(() => ({
  list: [] as { method: string; path: string; options: Record<string, unknown> }[],
  uploads: [] as { path: string; body: FormData; options: Record<string, unknown> | undefined }[],
}));

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
    adminUpload: vi.fn(async (path: string, body: FormData, options?: Record<string, unknown>) => {
      calls.uploads.push({ path, body, options });
      return { data: { id: 1 } };
    }),
  };
});

const last = () => calls.list[calls.list.length - 1];
const lastUpload = () => calls.uploads[calls.uploads.length - 1];
const KEY = "0b6f4f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  calls.list = [];
  calls.uploads = [];
});

describe("A05 documents and photo endpoints", () => {
  it("lists a worker's documents, archived ones as 1 or 0", async () => {
    await fetchWorkerDocuments(3, true);
    expect(last()).toEqual({ method: "GET", path: "/v1/admin/workers/{worker}/documents", options: { params: { path: { worker: 3 }, query: { include_archived: 1 } } } });
    await fetchWorkerDocuments(3, false);
    expect(last().options).toEqual({ params: { path: { worker: 3 }, query: { include_archived: 0 } } });
  });

  it("creates a document as multipart: the fields typed as text, the file, and supersedes_id for a renewal; empty fields are left out", async () => {
    const file = new File(["x"], "visa.pdf", { type: "application/pdf" });
    await createWorkerDocument(3, { type: "residency", title: null, number: "784-1999-1234567-1", issued_at: "2025-01-01", expires_at: "2027-01-01", alert_days_before: 30, notes: null }, file, 7);
    const { path, body, options } = lastUpload();
    expect(path).toBe("/v1/admin/workers/3/documents");
    expect(options).toBeUndefined();
    expect(Object.fromEntries([...body.entries()].filter(([, v]) => typeof v === "string"))).toEqual({
      type: "residency",
      number: "784-1999-1234567-1",
      issued_at: "2025-01-01",
      expires_at: "2027-01-01",
      alert_days_before: "30",
      supersedes_id: "7",
    });
    expect((body.get("file") as File).name).toBe("visa.pdf");
    await createWorkerDocument(3, { type: "passport" }, null);
    expect([...lastUpload().body.keys()]).toEqual(["type"]);
  });

  it("edits with the document's version as If-Match, clears a number with null, replaces a file and deletes with If-Match", async () => {
    await updateWorkerDocument(7, { number: null, notes: "kept" }, 4);
    expect(last()).toEqual({
      method: "PATCH",
      path: "/v1/admin/worker-documents/{document}",
      options: { params: { path: { document: 7 } }, body: { number: null, notes: "kept" }, headers: { "If-Match": "4" } },
    });
    await replaceDocumentFile(7, new File(["x"], "new.png", { type: "image/png" }), 5);
    expect(lastUpload().path).toBe("/v1/admin/worker-documents/7/file");
    expect(lastUpload().options).toEqual({ headers: { "If-Match": "5" } });
    expect((lastUpload().body.get("file") as File).name).toBe("new.png");
    await deleteWorkerDocument(7, 6);
    expect(last()).toEqual({ method: "DELETE", path: "/v1/admin/worker-documents/{document}", options: { params: { path: { document: 7 } }, headers: { "If-Match": "6" } } });
    await fetchDocumentFile(7);
    expect(last().path).toBe("/v1/admin/worker-documents/{document}/file");
  });

  it("uploads a photo with the approval ticked and the worker's version, and removes it with If-Match", async () => {
    await uploadWorkerPhoto(3, new File(["x"], "me.jpg", { type: "image/jpeg" }), 9);
    expect(lastUpload().path).toBe("/v1/admin/workers/3/photo");
    expect(lastUpload().options).toEqual({ headers: { "If-Match": "9" } });
    expect(lastUpload().body.get("approved_for_customers")).toBe("1");
    expect((lastUpload().body.get("photo") as File).name).toBe("me.jpg");
    await deleteWorkerPhoto(3, 10);
    expect(last()).toEqual({ method: "DELETE", path: "/v1/admin/workers/{worker}/photo", options: { params: { path: { worker: 3 } }, headers: { "If-Match": "10" } } });
  });
});

describe("A05 stats and attendance endpoints", () => {
  it("reads the stats of a period", async () => {
    await fetchWorkerStats(3, "2026-11-01", "2026-11-19");
    expect(last().options).toEqual({ params: { path: { worker: 3 }, query: { from: "2026-11-01", to: "2026-11-19" } } });
  });

  it("reads the day sheet and a worker's month with the API's names and the background header when asked", async () => {
    await fetchAttendanceSheet({ date: "2026-11-18", zoneId: 2, status: "unrecorded", search: " mar ", page: 2, perPage: 50 });
    expect(last().options).toMatchObject({ params: { query: { date: "2026-11-18", zone_id: 2, status: "unrecorded", search: "mar", page: 2, per_page: 50 } } });
    await fetchAttendanceSheet({ date: "2026-11-18" }, { background: true });
    expect(last().options).toMatchObject({ headers: { "X-Background-Poll": "1" } });
    await fetchWorkerAttendance(3, "2026-10");
    expect(last().options).toEqual({ params: { path: { worker: 3 }, query: { month: "2026-10" } } });
  });

  it("records a day with the row version as If-Match (0 for a day with no stored row) and reverts with it", async () => {
    await recordAttendance(3, "2026-11-18", { status: "late", late_minutes: 20, check_in_at: "2026-11-18T10:20:00+04:00", note: "traffic" }, 0);
    expect(last()).toEqual({
      method: "PUT",
      path: "/v1/admin/workers/{worker}/attendance/{date}",
      options: {
        params: { path: { worker: 3, date: "2026-11-18" } },
        body: { status: "late", late_minutes: 20, check_in_at: "2026-11-18T10:20:00+04:00", note: "traffic" },
        headers: { "If-Match": "0" },
      },
    });
    await revertAttendance(3, "2026-11-18", 4);
    expect(last()).toEqual({ method: "DELETE", path: "/v1/admin/workers/{worker}/attendance/{date}", options: { params: { path: { worker: 3, date: "2026-11-18" } }, headers: { "If-Match": "4" } } });
  });
});

describe("A05 incentive endpoints", () => {
  it("lists proposals of a month with statuses as an array and empty filters left out", async () => {
    await fetchProposals({ period: "2026-10", status: ["proposed", "approved"], search: " ma ", sort: "amount", page: 2, perPage: 25 });
    expect(last().options).toEqual({ params: { query: { period: "2026-10", search: "ma", sort: "amount", page: 2, per_page: 25, "status[]": ["proposed", "approved"] } } });
    await fetchProposals({ period: "2026-10" });
    expect(last().options).toEqual({ params: { query: { period: "2026-10" } } });
  });

  it("computes with an Idempotency-Key", async () => {
    await computeIncentives("2026-10", KEY);
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/incentives/compute", options: { body: { period: "2026-10" }, headers: { "Idempotency-Key": KEY } } });
  });

  it("recomputes, approves, rejects and reopens with the proposal's version as If-Match", async () => {
    await recomputeProposal(5, 2);
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/incentives/{proposal}/recompute", options: { params: { path: { proposal: 5 } }, headers: { "If-Match": "2" } } });
    await approveProposal(5, { approved_fils: 40000, adjust_reason: "Covered two extra Fridays" }, 2);
    expect(last().options).toEqual({ params: { path: { proposal: 5 } }, body: { approved_fils: 40000, adjust_reason: "Covered two extra Fridays" }, headers: { "If-Match": "2" } });
    await rejectProposal(5, "Left early", 2);
    expect(last().path).toBe("/v1/admin/incentives/{proposal}/reject");
    expect(last().options).toMatchObject({ body: { reason: "Left early" }, headers: { "If-Match": "2" } });
    await reopenProposal(5, "Wrong month", 3);
    expect(last().path).toBe("/v1/admin/incentives/{proposal}/reopen");
  });

  it("bulk approves with the lines and the total the dialog showed, and bulk rejects with a reason", async () => {
    await bulkApprove({ proposal_ids: [1, 2], expected_lines: [{ id: 1, amount_fils: 35000 }, { id: 2, amount_fils: 50000 }], expected_total_fils: 85000 });
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/incentives/approve",
      options: { body: { proposal_ids: [1, 2], expected_lines: [{ id: 1, amount_fils: 35000 }, { id: 2, amount_fils: 50000 }], expected_total_fils: 85000 } },
    });
    await bulkReject({ proposal_ids: [3], reason: "No" });
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/incentives/reject", options: { body: { proposal_ids: [3], reason: "No" } } });
  });

  it("posts with an Idempotency-Key and every line with its kind", async () => {
    const input = {
      period: "2026-10",
      proposal_ids: [1],
      adjustment_ids: [4],
      expected_lines: [
        { kind: "incentive" as const, id: 1, amount_fils: 40000 },
        { kind: "adjustment" as const, id: 4, amount_fils: -5000 },
      ],
      expected_total_fils: 35000,
    };
    await postIncentives(input, KEY);
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/incentives/post", options: { body: input, headers: { "Idempotency-Key": KEY } } });
  });

  it("adds an adjustment with a key, lists them by month and status, and deletes an open one with If-Match", async () => {
    await createAdjustment({ worker_id: 3, period: "2026-10", amount_fils: -5000, reason: "Overpaid", corrects_posting_id: 2 }, KEY);
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/incentives/adjustments",
      options: { body: { worker_id: 3, period: "2026-10", amount_fils: -5000, reason: "Overpaid", corrects_posting_id: 2 }, headers: { "Idempotency-Key": KEY } },
    });
    await fetchAdjustments({ period: "2026-10", status: "open", page: 2 });
    expect(last().options).toEqual({ params: { query: { period: "2026-10", status: "open", page: 2 } } });
    await fetchAdjustments({ period: "2026-10", status: "open", page: 1, perPage: 100 });
    expect(last().options).toEqual({ params: { query: { period: "2026-10", status: "open", page: 1, per_page: 100 } } });
    await deleteAdjustment(4, 1);
    expect(last()).toEqual({ method: "DELETE", path: "/v1/admin/incentives/adjustments/{adjustment}", options: { params: { path: { adjustment: 4 } }, headers: { "If-Match": "1" } } });
  });

  it("writes rules with If-Match, activates and deactivates them, and previews a month", async () => {
    const body = {
      name: { ar: "قاعدة", en: "Rule" },
      weights: { hours: 40, rating: 30, punctuality: 20, repeat_requests: 10 },
      thresholds: { hours_target_minutes: 9600, min_hours_minutes: 4800, rating_floor_x100: 300, min_ratings: 5, max_absent_days: 2 },
      amounts: [{ min_score_bp: 6000, amount_fils: 20000 }],
    };
    await fetchRules();
    expect(last().path).toBe("/v1/admin/incentive-rules");
    await createRule(body);
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/incentive-rules", options: { body } });
    await updateRule(8, body, 3);
    expect(last().options).toEqual({ params: { path: { rule: 8 } }, body: { ...body, version: 3 }, headers: { "If-Match": "3" } });
    await activateRule(8, 4);
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/incentive-rules/{rule}/activate", options: { params: { path: { rule: 8 } }, headers: { "If-Match": "4" } } });
    await deactivateRule(8, 5);
    expect(last().path).toBe("/v1/admin/incentive-rules/{rule}/deactivate");
    await deleteRule(8, 6);
    expect(last()).toEqual({ method: "DELETE", path: "/v1/admin/incentive-rules/{rule}", options: { params: { path: { rule: 8 } }, headers: { "If-Match": "6" } } });
    await previewRule(8, "2026-10");
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/incentive-rules/{rule}/preview", options: { params: { path: { rule: 8 } }, body: { period: "2026-10" } } });
  });

  it("reads the postings, one posting and its file link", async () => {
    await fetchPostings({ period: "2026-10", page: 2 });
    expect(last().options).toEqual({ params: { query: { period: "2026-10", page: 2 } } });
    await fetchPosting(4);
    expect(last()).toEqual({ method: "GET", path: "/v1/admin/incentive-postings/{posting}", options: { params: { path: { posting: 4 } } } });
    await fetchPostingFile(4);
    expect(last().path).toBe("/v1/admin/incentive-postings/{posting}/file");
  });
});

describe("A04 waitlist endpoints", () => {
  it("lists with the API's filter names and statuses as an array", async () => {
    await fetchWaitlist({ dateFrom: "2026-11-26", dateTo: "2026-11-26", zoneId: 3, slotTemplateId: 13, status: ["open"], q: " mar ", page: 2, perPage: 25 });
    expect(last().options).toMatchObject({
      params: { query: { date_from: "2026-11-26", date_to: "2026-11-26", zone_id: 3, slot_template_id: 13, q: "mar", page: 2, per_page: 25, "status[]": ["open"] } },
    });
    await fetchWaitlist({}, { background: true });
    expect(last().options).toMatchObject({ params: { query: {} }, headers: { "X-Background-Poll": "1" } });
  });

  it("offers with an Idempotency-Key and force only when asked", async () => {
    await notifyWaitlistEntry(41, KEY);
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/waitlist/{waitlist}/notify", options: { params: { path: { waitlist: 41 } }, body: {}, headers: { "Idempotency-Key": KEY } } });
    await notifyWaitlistEntry(41, KEY, true);
    expect(last().options).toMatchObject({ body: { force: true } });
  });
});
