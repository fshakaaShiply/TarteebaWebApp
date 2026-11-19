import { adminApi, adminUpload, backgroundPoll, unwrap, type ReadOptions } from "../client";
import type { DataEnvelope, Worker } from "../types";
import type {
  AdjustmentsPage,
  AttendanceDay,
  AttendanceDaysPage,
  AttendanceMonth,
  AttendanceStatus,
  ComputeResult,
  ExpectedLine,
  IncentiveAdjustment,
  IncentivePosting,
  IncentiveProposal,
  IncentiveRule,
  PostingsPage,
  ProposalsPage,
  RulePreview,
  SignedUrl,
  WaitlistEntry,
  WaitlistPage,
  WorkerDocument,
  WorkerStats,
} from "./types";

/*
 * A05 workforce, A09 incentive postings and A04 waitlist calls (slice W4): one function per route through the typed
 * admin client, answering the unwrapped body or throwing AdminApiError. Versioned writes send the record's version as
 * If-Match (409 STALE_VERSION); the writes that post or approve money, and the staff offer to the waitlist, carry an
 * Idempotency-Key (one per intent, lib/admin/idempotency.ts). Uploads go through `adminUpload` (multipart, CSRF, the
 * same proxy). The generated schema types every answer; request parameters are cast where the export is loose.
 */

const idempotency = (key: string) => ({ "Idempotency-Key": key });
const ifMatch = (version: number) => ({ "If-Match": String(version) });

function compact(query: Record<string, string | number | boolean | null | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    out[key] = value === true ? 1 : value;
  }
  return out;
}

// ---- documents (workers.documents) ---------------------------------------------------------------------------------

export async function fetchWorkerDocuments(workerId: number, includeArchived: boolean): Promise<WorkerDocument[]> {
  const body = await unwrap<DataEnvelope<WorkerDocument[]>>(
    adminApi.GET("/v1/admin/workers/{worker}/documents", {
      params: { path: { worker: workerId }, query: { include_archived: includeArchived ? 1 : 0 } as never },
    }),
  );
  return body.data;
}

export type DocumentFields = {
  type: string;
  title?: string | null;
  number?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  alert_days_before?: number | null;
  notes?: string | null;
};

/** A new document with its file; `supersedesId` makes it the renewal of a current one (the old row is archived). */
export async function createWorkerDocument(workerId: number, fields: DocumentFields, file: File | null, supersedesId?: number | null): Promise<WorkerDocument> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
  }
  if (supersedesId) form.append("supersedes_id", String(supersedesId));
  if (file) form.append("file", file);
  const body = await adminUpload<DataEnvelope<WorkerDocument>>(`/v1/admin/workers/${workerId}/documents`, form);
  return body.data;
}

/** Fields of one document, the document's version as If-Match. `number: null` clears the number. */
export async function updateWorkerDocument(id: number, patch: Partial<DocumentFields>, version: number): Promise<WorkerDocument> {
  const body = await unwrap<DataEnvelope<WorkerDocument>>(
    adminApi.PATCH("/v1/admin/worker-documents/{document}", { params: { path: { document: id } }, body: patch as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export async function replaceDocumentFile(id: number, file: File, version: number): Promise<WorkerDocument> {
  const form = new FormData();
  form.append("file", file);
  const body = await adminUpload<DataEnvelope<WorkerDocument>>(`/v1/admin/worker-documents/${id}/file`, form, { headers: ifMatch(version) });
  return body.data;
}

export async function deleteWorkerDocument(id: number, version: number): Promise<void> {
  await unwrap<void>(adminApi.DELETE("/v1/admin/worker-documents/{document}", { params: { path: { document: id } }, headers: ifMatch(version) }));
}

/** A fresh signed link (15 minutes) to the document's file; never kept. */
export async function fetchDocumentFile(id: number): Promise<SignedUrl> {
  const body = await unwrap<DataEnvelope<SignedUrl>>(adminApi.GET("/v1/admin/worker-documents/{document}/file", { params: { path: { document: id } } }));
  return body.data;
}

// ---- photo (workers.manage) ----------------------------------------------------------------------------------------

/** Uploading is the approval: `approved_for_customers` is always sent true (the screen asks for the tick first). */
export async function uploadWorkerPhoto(workerId: number, file: File, version: number): Promise<Worker> {
  const form = new FormData();
  form.append("photo", file);
  form.append("approved_for_customers", "1");
  const body = await adminUpload<DataEnvelope<Worker>>(`/v1/admin/workers/${workerId}/photo`, form, { headers: ifMatch(version) });
  return body.data;
}

export async function deleteWorkerPhoto(workerId: number, version: number): Promise<Worker> {
  const body = await unwrap<DataEnvelope<Worker>>(
    adminApi.DELETE("/v1/admin/workers/{worker}/photo", { params: { path: { worker: workerId } }, headers: ifMatch(version) }),
  );
  return body.data;
}

// ---- stats ---------------------------------------------------------------------------------------------------------

export async function fetchWorkerStats(workerId: number, from: string, to: string): Promise<WorkerStats> {
  const body = await unwrap<DataEnvelope<WorkerStats>>(
    adminApi.GET("/v1/admin/workers/{worker}/stats", { params: { path: { worker: workerId }, query: { from, to } as never } }),
  );
  return body.data;
}

// ---- attendance (attendance.manage) ---------------------------------------------------------------------------------

export type AttendanceSheetQuery = { date: string; zoneId?: number; status?: string; search?: string; page?: number; perPage?: number };

export async function fetchAttendanceSheet(q: AttendanceSheetQuery, opts: ReadOptions = {}): Promise<AttendanceDaysPage> {
  return unwrap<AttendanceDaysPage>(
    adminApi.GET("/v1/admin/attendance", {
      params: { query: compact({ date: q.date, zone_id: q.zoneId, status: q.status, search: q.search?.trim(), page: q.page, per_page: q.perPage }) as never },
      headers: backgroundPoll(opts.background),
    }),
  );
}

export async function fetchWorkerAttendance(workerId: number, month: string): Promise<AttendanceMonth> {
  return unwrap<AttendanceMonth>(adminApi.GET("/v1/admin/workers/{worker}/attendance", { params: { path: { worker: workerId }, query: { month } as never } }));
}

export type AttendanceInput = {
  status: AttendanceStatus;
  late_minutes?: number;
  check_in_at?: string;
  check_out_at?: string;
  note?: string;
};

/** The day's row version is the If-Match; a day with no stored row sends 0. */
export async function recordAttendance(workerId: number, date: string, input: AttendanceInput, version: number): Promise<AttendanceDay> {
  const body = await unwrap<DataEnvelope<AttendanceDay>>(
    adminApi.PUT("/v1/admin/workers/{worker}/attendance/{date}", {
      params: { path: { worker: workerId, date } },
      body: input as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function revertAttendance(workerId: number, date: string, version: number): Promise<AttendanceDay> {
  const body = await unwrap<DataEnvelope<AttendanceDay>>(
    adminApi.DELETE("/v1/admin/workers/{worker}/attendance/{date}", { params: { path: { worker: workerId, date } }, headers: ifMatch(version) }),
  );
  return body.data;
}

// ---- incentives (incentives.approve) ---------------------------------------------------------------------------------

export type ProposalsQuery = { period: string; status?: readonly string[]; zoneId?: number; search?: string; sort?: string; page?: number; perPage?: number };

export async function fetchProposals(q: ProposalsQuery): Promise<ProposalsPage> {
  const query: Record<string, unknown> = compact({ period: q.period, zone_id: q.zoneId, search: q.search?.trim(), sort: q.sort, page: q.page, per_page: q.perPage });
  if (q.status && q.status.length > 0) query["status[]"] = q.status;
  return unwrap<ProposalsPage>(adminApi.GET("/v1/admin/incentives/proposals", { params: { query: query as never } }));
}

export async function fetchProposal(id: number): Promise<IncentiveProposal> {
  const body = await unwrap<DataEnvelope<IncentiveProposal>>(adminApi.GET("/v1/admin/incentives/proposals/{proposal}", { params: { path: { proposal: id } } }));
  return body.data;
}

export async function computeIncentives(period: string, key: string): Promise<ComputeResult> {
  const body = await unwrap<DataEnvelope<ComputeResult>>(adminApi.POST("/v1/admin/incentives/compute", { body: { period }, headers: idempotency(key) }));
  return body.data;
}

export async function recomputeProposal(id: number, version: number): Promise<IncentiveProposal> {
  const body = await unwrap<DataEnvelope<IncentiveProposal>>(
    adminApi.POST("/v1/admin/incentives/{proposal}/recompute", { params: { path: { proposal: id } }, headers: ifMatch(version) }),
  );
  return body.data;
}

export async function approveProposal(id: number, input: { approved_fils: number; adjust_reason?: string }, version: number): Promise<IncentiveProposal> {
  const body = await unwrap<DataEnvelope<IncentiveProposal>>(
    adminApi.POST("/v1/admin/incentives/{proposal}/approve", { params: { path: { proposal: id } }, body: input as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export async function rejectProposal(id: number, reason: string, version: number): Promise<IncentiveProposal> {
  const body = await unwrap<DataEnvelope<IncentiveProposal>>(
    adminApi.POST("/v1/admin/incentives/{proposal}/reject", { params: { path: { proposal: id } }, body: { reason } as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export async function reopenProposal(id: number, reason: string, version: number): Promise<IncentiveProposal> {
  const body = await unwrap<DataEnvelope<IncentiveProposal>>(
    adminApi.POST("/v1/admin/incentives/{proposal}/reopen", { params: { path: { proposal: id } }, body: { reason } as never, headers: ifMatch(version) }),
  );
  return body.data;
}

/** Bulk approve: the lines and the total are what the dialog showed; any difference under the locks is 409 TERMS_CHANGED. */
export async function bulkApprove(input: { proposal_ids: number[]; expected_lines: ExpectedLine[]; expected_total_fils: number }): Promise<{ approved: number; total_fils: number }> {
  const body = await unwrap<DataEnvelope<{ approved: number; total_fils: number }>>(adminApi.POST("/v1/admin/incentives/approve", { body: input as never }));
  return body.data;
}

export async function bulkReject(input: { proposal_ids: number[]; reason: string }): Promise<{ rejected: number }> {
  const body = await unwrap<DataEnvelope<{ rejected: number }>>(adminApi.POST("/v1/admin/incentives/reject", { body: input as never }));
  return body.data;
}

/** A post is final: one posting for the lines, its CSV stored. Idempotency-Key per body; 503 POSTING_BUSY is sent again with the same key. */
export type PostInput = {
  period: string;
  proposal_ids: number[];
  adjustment_ids: number[];
  expected_lines: ExpectedLine[];
  expected_total_fils: number;
};

export async function postIncentives(input: PostInput, key: string): Promise<IncentivePosting> {
  const body = await unwrap<DataEnvelope<IncentivePosting>>(adminApi.POST("/v1/admin/incentives/post", { body: input as never, headers: idempotency(key) }));
  return body.data;
}

/** `perPage` up to 100 (workforce.admin_per_page_max); the API's default is 25, in id order, posted ones included. */
export async function fetchAdjustments(q: { period?: string; status?: "open" | "posted"; page?: number; perPage?: number }): Promise<AdjustmentsPage> {
  return unwrap<AdjustmentsPage>(
    adminApi.GET("/v1/admin/incentives/adjustments", { params: { query: compact({ period: q.period, status: q.status, page: q.page, per_page: q.perPage }) as never } }),
  );
}

export type AdjustmentInput = { worker_id: number; period: string; amount_fils: number; reason: string; corrects_posting_id?: number };

export async function createAdjustment(input: AdjustmentInput, key: string): Promise<IncentiveAdjustment> {
  const body = await unwrap<DataEnvelope<IncentiveAdjustment>>(adminApi.POST("/v1/admin/incentives/adjustments", { body: input as never, headers: idempotency(key) }));
  return body.data;
}

export async function deleteAdjustment(id: number, version: number): Promise<void> {
  await unwrap<void>(adminApi.DELETE("/v1/admin/incentives/adjustments/{adjustment}", { params: { path: { adjustment: id } }, headers: ifMatch(version) }));
}

// ---- incentive rules -------------------------------------------------------------------------------------------------

export type RuleBody = {
  name: { ar: string; en: string };
  weights: IncentiveRule["weights"];
  thresholds: IncentiveRule["thresholds"];
  amounts: IncentiveRule["amounts"];
};

export async function fetchRules(): Promise<IncentiveRule[]> {
  const body = await unwrap<DataEnvelope<IncentiveRule[]>>(adminApi.GET("/v1/admin/incentive-rules"));
  return body.data;
}

export async function createRule(input: RuleBody): Promise<IncentiveRule> {
  const body = await unwrap<DataEnvelope<IncentiveRule>>(adminApi.POST("/v1/admin/incentive-rules", { body: input as never }));
  return body.data;
}

export async function updateRule(id: number, input: RuleBody, version: number): Promise<IncentiveRule> {
  const body = await unwrap<DataEnvelope<IncentiveRule>>(
    adminApi.PATCH("/v1/admin/incentive-rules/{rule}", { params: { path: { rule: id } }, body: { ...input, version } as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export async function deleteRule(id: number, version: number): Promise<void> {
  await unwrap<void>(adminApi.DELETE("/v1/admin/incentive-rules/{rule}", { params: { path: { rule: id } }, headers: ifMatch(version) }));
}

export async function activateRule(id: number, version: number): Promise<IncentiveRule> {
  const body = await unwrap<DataEnvelope<IncentiveRule>>(adminApi.POST("/v1/admin/incentive-rules/{rule}/activate", { params: { path: { rule: id } }, headers: ifMatch(version) }));
  return body.data;
}

export async function deactivateRule(id: number, version: number): Promise<IncentiveRule> {
  const body = await unwrap<DataEnvelope<IncentiveRule>>(adminApi.POST("/v1/admin/incentive-rules/{rule}/deactivate", { params: { path: { rule: id } }, headers: ifMatch(version) }));
  return body.data;
}

export async function previewRule(id: number, period: string): Promise<RulePreview> {
  const body = await unwrap<DataEnvelope<RulePreview>>(adminApi.POST("/v1/admin/incentive-rules/{rule}/preview", { params: { path: { rule: id } }, body: { period } }));
  return body.data;
}

// ---- postings (incentives.approve or incentives.view) -----------------------------------------------------------------

export async function fetchPostings(q: { period?: string; page?: number }): Promise<PostingsPage> {
  return unwrap<PostingsPage>(adminApi.GET("/v1/admin/incentive-postings", { params: { query: compact({ period: q.period, page: q.page }) as never } }));
}

export async function fetchPosting(id: number): Promise<IncentivePosting> {
  const body = await unwrap<DataEnvelope<IncentivePosting>>(adminApi.GET("/v1/admin/incentive-postings/{posting}", { params: { path: { posting: id } } }));
  return body.data;
}

/** A fresh signed link to the posting's CSV (accounting downloads it); never kept. */
export async function fetchPostingFile(id: number): Promise<SignedUrl> {
  const body = await unwrap<DataEnvelope<SignedUrl>>(adminApi.GET("/v1/admin/incentive-postings/{posting}/file", { params: { path: { posting: id } } }));
  return body.data;
}

// ---- waitlist (waitlist.manage) ----------------------------------------------------------------------------------------

export type WaitlistQuery = {
  dateFrom?: string;
  dateTo?: string;
  zoneId?: number;
  slotTemplateId?: number;
  /** One or more of waiting, notified, converted, expired, cancelled or open (the API default). */
  status?: readonly string[];
  q?: string;
  page?: number;
  perPage?: number;
};

export async function fetchWaitlist(q: WaitlistQuery, opts: ReadOptions = {}): Promise<WaitlistPage> {
  const query: Record<string, unknown> = compact({
    date_from: q.dateFrom,
    date_to: q.dateTo,
    zone_id: q.zoneId,
    slot_template_id: q.slotTemplateId,
    q: q.q?.trim(),
    page: q.page,
    per_page: q.perPage,
  });
  if (q.status && q.status.length > 0) query["status[]"] = q.status;
  return unwrap<WaitlistPage>(
    adminApi.GET("/v1/admin/waitlist", {
      params: { query: query as never },
      headers: backgroundPoll(opts.background),
    }),
  );
}

/** A staff offer. `force` only after the person confirmed "Notify again" over a live offer (P5-L32). */
export async function notifyWaitlistEntry(id: number, key: string, force = false): Promise<WaitlistEntry> {
  const body = await unwrap<DataEnvelope<WaitlistEntry>>(
    adminApi.POST("/v1/admin/waitlist/{waitlist}/notify", {
      params: { path: { waitlist: id } },
      body: (force ? { force: true } : {}) as never,
      headers: idempotency(key),
    }),
  );
  return body.data;
}
