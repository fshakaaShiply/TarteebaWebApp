import { adminApi, adminUpload, backgroundPoll, unwrap, type ReadOptions } from "../client";
import type { DataEnvelope } from "../types";
import type {
  AdminCaseDetail,
  Assignee,
  CaseCategory,
  CaseOutcome,
  CasePriority,
  CasesPage,
  CloseReason,
  Compensation,
  CompensationsPage,
  CompensationType,
  FreeVisitAvailability,
  RatingDetail,
  RatingsPage,
  Attachment,
} from "./types";

/*
 * A10 endpoints (slice W2): the inbox and the case, messages and files, resolve with a compensation, the accountant's
 * queue and the ratings. One function per route through the typed admin client, answering the unwrapped body or
 * throwing AdminApiError. Writes that move money or send the customer a text carry an Idempotency-Key (one per intent,
 * lib/admin/idempotency.ts) and the aggregate's version as If-Match (409 STALE_VERSION). The generated schema types the
 * answers loosely, so the bodies are cast to the shapes of contracts A2 §8.2 and A3 §5.
 */

const idempotency = (key: string) => ({ "Idempotency-Key": key });
const ifMatch = (version: number | null | undefined) => (version === null || version === undefined ? {} : { "If-Match": String(version) });

function compact(query: Record<string, string | number | boolean | null | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    // Laravel's boolean rule takes 1/0, not "true".
    out[key] = value === true ? 1 : value;
  }
  return out;
}

// ---- the inbox and the case (complaints.manage | compensation.approve to read) --------------------------------------

export type CaseListQuery = {
  page?: number;
  perPage?: number;
  customerId?: string;
  type?: string;
  /** One status, or several (the "all" choice sends every status). Omitted: the API's default, the active ones. */
  status?: readonly string[];
  priority?: string;
  category?: string;
  /** "me", "unassigned" or a staff id. */
  assignee?: string;
  sla?: string;
  awaitingApproval?: boolean;
  customerReplied?: boolean;
  workerId?: number;
  zoneId?: number;
  from?: string;
  to?: string;
  q?: string;
  sort?: string;
};

export async function fetchCases(q: CaseListQuery, opts: ReadOptions = {}): Promise<CasesPage> {
  const query: Record<string, string | number> = compact({
    page: q.page,
    per_page: q.perPage,
    customer_id: q.customerId,
    "type[]": q.type,
    "priority[]": q.priority,
    "category[]": q.category,
    assignee: q.assignee,
    sla: q.sla,
    awaiting_approval: q.awaitingApproval,
    customer_replied: q.customerReplied,
    worker_id: q.workerId,
    zone_id: q.zoneId,
    from: q.from,
    to: q.to,
    q: q.q?.trim(),
    sort: q.sort,
  });
  // Several statuses are one array parameter: openapi-fetch writes `status[]=a&status[]=b` from an array value.
  const params = { ...query, ...(q.status && q.status.length > 0 ? { "status[]": q.status } : {}) };
  return unwrap<CasesPage>(adminApi.GET("/v1/admin/complaints", { params: { query: params as never }, headers: backgroundPoll(opts.background) }));
}

export async function fetchCase(id: number, opts: ReadOptions = {}): Promise<AdminCaseDetail> {
  const body = await unwrap<DataEnvelope<AdminCaseDetail>>(
    adminApi.GET("/v1/admin/complaints/{complaint}", { params: { path: { complaint: id } }, headers: backgroundPoll(opts.background) }),
  );
  return body.data;
}

export async function fetchAssignees(): Promise<Assignee[]> {
  const body = await unwrap<DataEnvelope<Assignee[]>>(adminApi.GET("/v1/admin/quality/assignees"));
  return body.data;
}

export type CreateCaseBody = {
  customer_id: string;
  booking_id?: number;
  type: "complaint" | "support";
  category?: CaseCategory;
  description: string;
  priority?: CasePriority;
  source: "phone" | "whatsapp" | "admin";
  window_override_reason?: string;
  attachment_ids?: string[];
};

/** A case staff log from a call or a message (complaints.manage). Idempotency-Key per body. */
export async function createCase(body: CreateCaseBody, key: string): Promise<AdminCaseDetail> {
  const answer = await unwrap<DataEnvelope<AdminCaseDetail>>(adminApi.POST("/v1/admin/complaints", { body: body as never, headers: idempotency(key) }));
  return answer.data;
}

export type CasePatch = {
  assignee_id?: number | null;
  priority?: CasePriority;
  category?: CaseCategory;
  worker_ids?: number[];
  driver_id?: number | null;
  status?: "in_review" | "awaiting_customer" | "closed";
  close_reason?: CloseReason | null;
  reason?: string;
};

/** One or more fields of the case, the case's version as If-Match. */
export async function updateCase(id: number, patch: CasePatch, version: number): Promise<AdminCaseDetail> {
  const body = await unwrap<DataEnvelope<AdminCaseDetail>>(
    adminApi.PATCH("/v1/admin/complaints/{complaint}", { params: { path: { complaint: id } }, body: patch as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export type MessageBody = { body: string; is_internal: boolean; await_customer?: boolean; attachment_ids?: string[] };

export async function postMessage(id: number, input: MessageBody, key: string): Promise<AdminCaseDetail> {
  const body = await unwrap<DataEnvelope<AdminCaseDetail>>(
    adminApi.POST("/v1/admin/complaints/{complaint}/messages", { params: { path: { complaint: id } }, body: input as never, headers: idempotency(key) }),
  );
  return body.data;
}

/** A staff file for a reply or a new case: images are re-encoded by the API, a PDF goes on internal notes only. */
export async function uploadCaseFile(file: File, signal?: AbortSignal): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("purpose", "complaint");
  const body = await adminUpload<DataEnvelope<Attachment>>("/v1/admin/quality/attachments", form, { signal });
  return body.data;
}

export type ResolveBody = {
  outcome?: CaseOutcome;
  resolution?: string;
  compensation?: {
    type: CompensationType;
    amount_fils?: number;
    note?: string;
    free_visit?: { date: string; slot_template_id: number; workers_count?: number };
  };
};

export type ResolveResult = { data: AdminCaseDetail; meta: { result: "resolved" | "pending_approval" } };

/** Resolves the case, or (a refund or a credit) proposes the compensation to the accountant. Idempotency-Key and the case's version. */
export async function resolveCase(id: number, input: ResolveBody, version: number, key: string): Promise<ResolveResult> {
  return unwrap<ResolveResult>(
    adminApi.POST("/v1/admin/complaints/{complaint}/resolve", {
      params: { path: { complaint: id } },
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
}

export async function fetchFreeVisitAvailability(id: number, q: { from: string; to: string; slotTemplateId?: number }): Promise<FreeVisitAvailability> {
  return unwrap<FreeVisitAvailability>(
    adminApi.GET("/v1/admin/complaints/{complaint}/free-visit/availability", {
      params: { path: { complaint: id }, query: compact({ from: q.from, to: q.to, slot_template_id: q.slotTemplateId }) as never },
    }),
  );
}

// ---- compensations (complaints.manage | compensation.approve to read) -----------------------------------------------

export type CompensationListQuery = { page?: number; perPage?: number; status?: readonly string[]; type?: string; customerId?: string };

export async function fetchCompensations(q: CompensationListQuery): Promise<CompensationsPage> {
  const query = { ...compact({ page: q.page, per_page: q.perPage, "type[]": q.type, customer_id: q.customerId }), ...(q.status && q.status.length > 0 ? { "status[]": q.status } : {}) };
  return unwrap<CompensationsPage>(adminApi.GET("/v1/admin/compensations", { params: { query: query as never } }));
}

export type ApproveResult = { data: Compensation; case: AdminCaseDetail };

/** Executes the compensation (compensation.approve, and refunds.create for a refund): the amount shown is sent back. */
export async function approveCompensation(id: number, input: { expected_amount_fils: number; note?: string }, version: number, key: string): Promise<ApproveResult> {
  return unwrap<ApproveResult>(
    adminApi.POST("/v1/admin/compensations/{compensation}/approve", {
      params: { path: { compensation: id } },
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
}

export async function rejectCompensation(id: number, reason: string, version: number, key: string): Promise<Compensation> {
  const body = await unwrap<DataEnvelope<Compensation>>(
    adminApi.POST("/v1/admin/compensations/{compensation}/reject", {
      params: { path: { compensation: id } },
      body: { reason } as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

/** Withdraws a proposal that still waits (complaints.manage). */
export async function cancelCompensation(id: number, reason: string | undefined, version: number): Promise<Compensation> {
  const body = await unwrap<DataEnvelope<Compensation>>(
    adminApi.POST("/v1/admin/compensations/{compensation}/cancel", {
      params: { path: { compensation: id } },
      body: (reason ? { reason } : {}) as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

// ---- ratings (complaints.manage) -------------------------------------------------------------------------------------

export type RatingListQuery = {
  page?: number;
  perPage?: number;
  customerId?: string;
  low?: boolean;
  excluded?: boolean;
  workerId?: number;
  zoneId?: number;
  kind?: string;
  from?: string;
  to?: string;
  hasComment?: boolean;
  q?: string;
};

export async function fetchRatings(q: RatingListQuery): Promise<RatingsPage> {
  return unwrap<RatingsPage>(
    adminApi.GET("/v1/admin/ratings", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          customer_id: q.customerId,
          low: q.low,
          excluded: q.excluded,
          worker_id: q.workerId,
          zone_id: q.zoneId,
          "kind[]": q.kind,
          from: q.from,
          to: q.to,
          has_comment: q.hasComment,
          q: q.q?.trim(),
        }) as never,
      },
    }),
  );
}

export async function fetchRating(id: number): Promise<RatingDetail> {
  const body = await unwrap<DataEnvelope<RatingDetail>>(adminApi.GET("/v1/admin/ratings/{rating}", { params: { path: { rating: id } } }));
  return body.data;
}

/** Takes the rating out of every average (or puts it back), with a reason; the rating's version as If-Match. */
export async function setRatingExcluded(id: number, excluded: boolean, reason: string, version: number): Promise<RatingDetail> {
  const path = excluded ? "/v1/admin/ratings/{rating}/exclude" : "/v1/admin/ratings/{rating}/include";
  const body = await unwrap<DataEnvelope<RatingDetail>>(
    adminApi.POST(path, { params: { path: { rating: id } }, body: { reason } as never, headers: ifMatch(version) }),
  );
  return body.data;
}
