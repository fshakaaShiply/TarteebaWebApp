import { adminApi, backgroundPoll, unwrap, type ReadOptions } from "../client";
import type { DataEnvelope } from "../types";
import type {
  AssignResult,
  CalendarSummary,
  CancelParty,
  CancelPlan,
  CancelResult,
  CandidateRole,
  ConfirmPreview,
  EventsPage,
  FollowingPreview,
  FreezePreview,
  LiveOutDaysPreview,
  LiveOutDaysResult,
  MovePreview,
  RenewPreview,
  RenewResult,
  SkipPreview,
  SubscriptionCalendar,
  SubscriptionDetail,
  SubscriptionPage,
  UnfreezeResult,
  VisitWriteResult,
  VisitsPage,
  WorkerCandidate,
} from "./types";

/*
 * A08 endpoints (design §7.2): one function per route, through the typed admin client, answering the unwrapped body or
 * throwing AdminApiError. Writes that move money or capacity carry an Idempotency-Key (one per intent, see
 * lib/admin/idempotency.ts) and the aggregate's version as If-Match (409 STALE_VERSION); previews send neither.
 * The numeric subscription id addresses the admin routes, the occurrence's ULID the visit routes.
 */

const idempotency = (key: string) => ({ "Idempotency-Key": key });
const ifMatch = (version: number | null | undefined) => (version === null || version === undefined ? {} : { "If-Match": String(version) });

/** Drops undefined, null and empty-string entries so the query string only carries what is set. */
function compact(query: Record<string, string | number | boolean | null | undefined>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

const sub = (id: number) => ({ path: { subscription: id } });

// ---- Reads ----------------------------------------------------------------------------------------------------------

export type SubscriptionListQuery = {
  page: number;
  perPage: number;
  type?: string;
  /** Statuses, sent as a comma list (the API reads both a list and a comma list). */
  status?: readonly string[];
  paymentHealth?: string;
  renewalFrom?: string;
  renewalTo?: string;
  zoneId?: number | null;
  workerId?: number | null;
  conflicts?: boolean;
  cancelReview?: boolean;
  search?: string;
  sort?: string;
};

export async function fetchSubscriptions(q: SubscriptionListQuery): Promise<SubscriptionPage> {
  return unwrap<SubscriptionPage>(
    adminApi.GET("/v1/admin/subscriptions", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          type: q.type,
          status: q.status && q.status.length > 0 ? q.status.join(",") : undefined,
          payment_health: q.paymentHealth,
          renewal_from: q.renewalFrom,
          renewal_to: q.renewalTo,
          zone_id: q.zoneId ?? undefined,
          worker_id: q.workerId ?? undefined,
          conflicts: q.conflicts ? 1 : undefined,
          cancel_review: q.cancelReview ? 1 : undefined,
          q: q.search?.trim(),
          sort: q.sort,
        }) as never,
      },
    }),
  );
}

export async function fetchSubscription(id: number, opts: ReadOptions = {}): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.GET("/v1/admin/subscriptions/{subscription}", { params: sub(id), headers: backgroundPoll(opts.background) }),
  );
  return body.data;
}

export type VisitsQuery = { from?: string; to?: string; page?: number; perPage?: number };

/** The series' occurrences by served date (a range of at most 92 days; from defaults to today, to to +30 days). */
export async function fetchSubscriptionVisits(id: number, q: VisitsQuery = {}): Promise<VisitsPage> {
  return unwrap<VisitsPage>(
    adminApi.GET("/v1/admin/subscriptions/{subscription}/visits", {
      params: { ...sub(id), query: compact({ from: q.from, to: q.to, page: q.page, per_page: q.perPage }) as never },
    }),
  );
}

export async function fetchSubscriptionCalendar(id: number, month: string): Promise<SubscriptionCalendar> {
  const body = await unwrap<DataEnvelope<SubscriptionCalendar & { summary: CalendarSummary }>>(
    adminApi.GET("/v1/admin/subscriptions/{subscription}/calendar", { params: { ...sub(id), query: { month } as never } }),
  );
  return body.data;
}

export async function fetchSubscriptionEvents(id: number, page = 1): Promise<EventsPage> {
  return unwrap<EventsPage>(
    adminApi.GET("/v1/admin/subscriptions/{subscription}/events", { params: { ...sub(id), query: compact({ page }) as never } }),
  );
}

export async function fetchWorkerCandidates(id: number, role: CandidateRole, from?: string): Promise<WorkerCandidate[]> {
  const body = await unwrap<DataEnvelope<WorkerCandidate[]>>(
    adminApi.GET("/v1/admin/subscriptions/{subscription}/worker-candidates", { params: { ...sub(id), query: compact({ role, from }) as never } }),
  );
  return body.data;
}

// ---- Confirm and reject ---------------------------------------------------------------------------------------------

/** `undefined` leaves the customer's choice; `null` clears that role (a Live-out primary stays required). */
export type ConfirmInput = { primary_worker_id?: number | null; backup_worker_id?: number | null };

export async function previewConfirm(id: number, input: ConfirmInput): Promise<ConfirmPreview> {
  const body = await unwrap<DataEnvelope<ConfirmPreview>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/confirm/preview", { params: sub(id), body: input as never }),
  );
  return body.data;
}

export async function confirmSubscription(id: number, input: ConfirmInput, version: number | null, key: string): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/confirm", {
      params: sub(id),
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

export async function rejectSubscription(id: number, reason: string, version: number | null, key: string): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/reject", {
      params: sub(id),
      body: { reason },
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

// ---- One visit and the following ones -------------------------------------------------------------------------------

export type MoveScope = { scope: "this"; date: string; slot_template_id: number; override?: boolean; override_reason?: string | null };
export type FollowingScope = { scope: "following"; days_of_week?: number[]; slot_template_id?: number; rest_weekdays?: number[] };
export type VisitWrite =
  | (MoveScope & { action: "move"; reason?: string | null })
  | { scope: "this"; action: "cancel_by_company"; reason: string }
  | (FollowingScope & { action: "edit"; expected_term_end_date?: string | null });

export async function previewVisitMove(id: number, visit: string, input: MoveScope): Promise<MovePreview> {
  const body = await unwrap<DataEnvelope<MovePreview>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/visits/{visit}/preview", { params: { path: { subscription: id, visit } }, body: input as never }),
  );
  return body.data;
}

export async function previewFollowing(id: number, visit: string, input: FollowingScope): Promise<FollowingPreview> {
  const body = await unwrap<DataEnvelope<FollowingPreview>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/visits/{visit}/preview", { params: { path: { subscription: id, visit } }, body: input as never }),
  );
  return body.data;
}

export async function writeVisit(id: number, visit: string, input: VisitWrite, version: number | null, key: string): Promise<VisitWriteResult> {
  return unwrap<VisitWriteResult>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/visits/{visit}", {
      params: { path: { subscription: id, visit } },
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
}

export async function decideRescheduleRequest(
  id: number,
  visit: string,
  input: { decision: "approve" | "decline"; reason?: string | null },
  version: number | null,
  key: string,
): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/visits/{visit}/reschedule-request", {
      params: { path: { subscription: id, visit } },
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

// ---- Skip, freeze ---------------------------------------------------------------------------------------------------

export async function previewSkip(id: number, visitId: string): Promise<SkipPreview> {
  const body = await unwrap<DataEnvelope<SkipPreview>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/skip/preview", { params: sub(id), body: { visit_id: visitId } as never }),
  );
  return body.data;
}

export async function skipVisit(id: number, visitId: string, expectedTermEnd: string | null, version: number | null, key: string): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/skip", {
      params: sub(id),
      body: { visit_id: visitId, ...(expectedTermEnd ? { expected_term_end_date: expectedTermEnd } : {}) } as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

export async function undoSkip(id: number, visitId: string, version: number | null, key: string): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/skip/undo", {
      params: sub(id),
      body: { visit_id: visitId } as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

export type FreezeInput = { from: string; to: string; reason?: string | null; expected_term_end_date?: string | null };

export async function previewFreeze(id: number, input: Pick<FreezeInput, "from" | "to" | "reason">): Promise<FreezePreview> {
  const body = await unwrap<DataEnvelope<FreezePreview>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/freeze/preview", { params: sub(id), body: input as never }),
  );
  return body.data;
}

export async function freezeSubscription(id: number, input: FreezeInput, version: number | null, key: string): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/freeze", {
      params: sub(id),
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

export async function unfreezeSubscription(id: number, version: number | null): Promise<UnfreezeResult> {
  return unwrap<UnfreezeResult>(adminApi.POST("/v1/admin/subscriptions/{subscription}/unfreeze", { params: sub(id), headers: ifMatch(version) }));
}

// ---- Renewal --------------------------------------------------------------------------------------------------------

/** Staff can only switch auto-renew off (on the customer's request); on is the customer's consent. */
export async function switchAutoRenewOff(id: number, reason: string, version: number | null): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/auto-renew", {
      params: sub(id),
      body: { auto_renew: false, reason } as never,
      headers: ifMatch(version),
    }),
  );
  return body.data;
}

export async function previewRenew(id: number): Promise<RenewPreview> {
  const body = await unwrap<DataEnvelope<RenewPreview>>(adminApi.POST("/v1/admin/subscriptions/{subscription}/renew/preview", { params: sub(id) }));
  return body.data;
}

/** Charges the subscription's own card (never another one); `expected_amount_fils` is the previewed amount. */
export async function renewSubscription(id: number, expectedAmountFils: number, key: string): Promise<RenewResult> {
  return unwrap<RenewResult>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/renew", {
      params: sub(id),
      body: { expected_amount_fils: expectedAmountFils },
      headers: idempotency(key),
    }),
  );
}

// ---- Cancellation ---------------------------------------------------------------------------------------------------

export async function previewCancel(id: number, party: CancelParty, reasonCode?: string): Promise<CancelPlan> {
  const body = await unwrap<DataEnvelope<CancelPlan>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/cancel/preview", {
      params: sub(id),
      body: { party, ...(reasonCode ? { reason_code: reasonCode } : {}) } as never,
    }),
  );
  return body.data;
}

export type CancelInput = {
  party: CancelParty;
  reason_code: string;
  reason_text?: string | null;
  /** A custom total refund (refunds.create). */
  refund_fils?: number;
  expected_fee_fils?: number;
  expected_refund_fils?: number;
  expected_clawback_fils?: number;
};

export async function cancelSubscription(id: number, input: CancelInput, version: number | null, key: string): Promise<CancelResult> {
  return unwrap<CancelResult>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/cancel", {
      params: sub(id),
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
}

/** refunds.create: finishes the customer's cancellation waiting for review with a refund (capped per period). */
export async function resolveCancelReview(id: number, input: { refund_fils: number; note: string }, version: number | null, key: string): Promise<CancelResult> {
  return unwrap<CancelResult>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/cancel-review/resolve", {
      params: sub(id),
      body: input,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
}

/** subscriptions.manage: the subscription runs on, no money moves. */
export async function declineCancelReview(id: number, note: string, version: number | null): Promise<SubscriptionDetail> {
  const body = await unwrap<DataEnvelope<SubscriptionDetail>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/cancel-review/decline", { params: sub(id), body: { note }, headers: ifMatch(version) }),
  );
  return body.data;
}

// ---- Workers and Live-out days --------------------------------------------------------------------------------------

export async function assignWorker(id: number, role: CandidateRole, workerId: number | null, applyFrom: string | null, version: number | null): Promise<AssignResult> {
  const path = role === "primary" ? "/v1/admin/subscriptions/{subscription}/assign-primary" : "/v1/admin/subscriptions/{subscription}/assign-backup";
  return unwrap<AssignResult>(
    adminApi.POST(path, { params: sub(id), body: { worker_id: workerId, ...(applyFrom ? { apply_from: applyFrom } : {}) } as never, headers: ifMatch(version) }),
  );
}

export type LiveOutDayInput = {
  change: "absence" | "service" | "public_holiday";
  scope: "this" | "following";
  until?: string | null;
  substitute_worker_id?: number | null;
};

export async function previewLiveOutDay(id: number, date: string, input: LiveOutDayInput): Promise<LiveOutDaysPreview> {
  const body = await unwrap<DataEnvelope<LiveOutDaysPreview>>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/live-out-days/{date}/preview", { params: { path: { subscription: id, date } }, body: input as never }),
  );
  return body.data;
}

export async function changeLiveOutDay(id: number, date: string, input: LiveOutDayInput, version: number | null, key: string): Promise<LiveOutDaysResult> {
  return unwrap<LiveOutDaysResult>(
    adminApi.POST("/v1/admin/subscriptions/{subscription}/live-out-days/{date}", {
      params: { path: { subscription: id, date } },
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
}
