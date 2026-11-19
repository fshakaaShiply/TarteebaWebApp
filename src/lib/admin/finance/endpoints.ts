import { adminApi, adminUpload, backgroundPoll, unwrap, type ReadOptions } from "../client";
import type { AdminPaymentDetail, AdminRefund, DataEnvelope, Paginated } from "../types";
import type { ExportRecord, ExportUrl } from "../exports";
import type { ItemDetail, ItemsPage, ResolveBody, RunDetail, RunsPage, SettlementFormat } from "./reconciliation";
import type { WalletAdjustBody, WalletPage, WalletTransaction } from "./wallet";

/*
 * Phase 5 A09 endpoints (slice W1): reconciliation runs and items, review flags, the provider's answer on a refund,
 * credit-note e-mail, exports and the customer's balance. One function per route, through the typed admin client,
 * answering the unwrapped body or throwing AdminApiError. Writes that move money carry an Idempotency-Key (one per
 * intent, lib/admin/idempotency.ts) and the aggregate's version as If-Match (409 STALE_VERSION). The generated schema
 * types some of these answers loosely, so the bodies are cast to the shapes of the contracts (A1a §5, A1b §2.3, §3.3).
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

// ---- reconciliation (reconciliation.run or payments.view to read) ---------------------------------------------------

export type RunListQuery = { page?: number; perPage?: number; from?: string; to?: string; status?: string; unresolved?: boolean; includeSuperseded?: boolean };

/** Newest report date first; superseded runs are hidden unless asked for (or filtered by status). */
export async function fetchReconciliationRuns(q: RunListQuery, opts: ReadOptions = {}): Promise<RunsPage> {
  return unwrap<RunsPage>(
    adminApi.GET("/v1/admin/reconciliation/runs", {
      params: {
        query: compact({
          page: q.page,
          per_page: q.perPage,
          from: q.from,
          to: q.to,
          status: q.status,
          unresolved: q.unresolved,
          include_superseded: q.includeSuperseded,
        }) as never,
      },
      headers: backgroundPoll(opts.background),
    }),
  );
}

export async function fetchReconciliationRun(id: number, opts: ReadOptions = {}): Promise<RunDetail> {
  const body = await unwrap<DataEnvelope<RunDetail>>(
    adminApi.GET("/v1/admin/reconciliation/runs/{run}", { params: { path: { run: id } }, headers: backgroundPoll(opts.background) }),
  );
  return body.data;
}

export type ItemListQuery = { page?: number; perPage?: number; view?: string; status?: string; lineType?: string; q?: string };

export async function fetchReconciliationItems(runId: number, q: ItemListQuery): Promise<ItemsPage> {
  return unwrap<ItemsPage>(
    adminApi.GET("/v1/admin/reconciliation/runs/{run}/items", {
      params: {
        path: { run: runId },
        // The array parameters are sent as `status[]=`: a single value is enough for the screen's filter.
        query: compact({ page: q.page, per_page: q.perPage, view: q.view, "status[]": q.status, "line_type[]": q.lineType, q: q.q?.trim() }) as never,
      },
    }),
  );
}

export async function fetchReconciliationItem(id: number): Promise<ItemDetail> {
  const body = await unwrap<DataEnvelope<ItemDetail>>(adminApi.GET("/v1/admin/reconciliation/items/{item}", { params: { path: { item: id } } }));
  return body.data;
}

export async function fetchSettlementFormats(): Promise<SettlementFormat[]> {
  const body = await unwrap<DataEnvelope<SettlementFormat[]>>(adminApi.GET("/v1/admin/reconciliation/formats"));
  return body.data;
}

/** The blank file of a format (a CSV attachment): a plain link, the session cookie authorises the read. */
export function settlementTemplateUrl(key: string): string {
  return `/backend/api/v1/admin/reconciliation/formats/${encodeURIComponent(key)}/template`;
}

export type CreateFetchRun = { report_date: string; gateway?: string; replace?: boolean; reason?: string };

/** 202 with the run `pending`: the report is read in the background (reconciliation.run). 409 RECONCILIATION_RUN_EXISTS {run_id} asks for a replace. */
export async function createFetchRun(input: CreateFetchRun): Promise<RunDetail> {
  const body = await unwrap<DataEnvelope<RunDetail>>(
    adminApi.POST("/v1/admin/reconciliation/runs", { body: { source: "fetch", ...input } as never }),
  );
  return body.data;
}

export type UploadRun = { report_date: string; file: File; format?: string; gateway?: string; replace?: boolean; reason?: string };

/** Multipart upload of a settlement file; the run is `pending` until the background job has read it. */
export async function uploadSettlementRun(input: UploadRun): Promise<RunDetail> {
  const form = new FormData();
  form.append("source", "upload");
  form.append("report_date", input.report_date);
  form.append("file", input.file);
  if (input.format) form.append("format", input.format);
  if (input.gateway) form.append("gateway", input.gateway);
  if (input.replace) form.append("replace", "1");
  if (input.reason) form.append("reason", input.reason);
  const body = await adminUpload<DataEnvelope<RunDetail>>("/v1/admin/reconciliation/runs", form);
  return body.data;
}

export type ResolveResult = { data: ItemDetail; refund: AdminRefund | null };

/**
 * Resolves one item (reconciliation.run; the three money codes also need refunds.create, 403 REFUND_PERMISSION_REQUIRED).
 * Idempotency-Key per intent, the item's version as If-Match.
 */
export async function resolveItem(id: number, input: ResolveBody, version: number, key: string): Promise<ResolveResult> {
  return unwrap<ResolveResult>(
    adminApi.POST("/v1/admin/reconciliation/items/{item}/resolve", {
      params: { path: { item: id } },
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
}

export async function reopenItem(id: number, note: string, version: number): Promise<ItemDetail> {
  const body = await unwrap<DataEnvelope<ItemDetail>>(
    adminApi.POST("/v1/admin/reconciliation/items/{item}/reopen", { params: { path: { item: id } }, body: { note } as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export type RecheckResult = { data: RunDetail; rechecked: number; auto_resolved: number };

export async function recheckRun(id: number): Promise<RecheckResult> {
  return unwrap<RecheckResult>(adminApi.POST("/v1/admin/reconciliation/runs/{run}/recheck", { params: { path: { run: id } } }));
}

// ---- review flags and the provider's answer (reconciliation.run / refunds.create) ----------------------------------------

export async function clearPaymentReview(id: number, note: string, version: number): Promise<AdminPaymentDetail> {
  const body = await unwrap<DataEnvelope<AdminPaymentDetail>>(
    adminApi.POST("/v1/admin/payments/{payment}/review/clear", { params: { path: { payment: id } }, body: { note } as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export async function clearRefundReview(id: number, note: string, version: number): Promise<AdminRefund> {
  const body = await unwrap<DataEnvelope<AdminRefund>>(
    adminApi.POST("/v1/admin/refunds/{refund}/review/clear", { params: { path: { refund: id } }, body: { note } as never, headers: ifMatch(version) }),
  );
  return body.data;
}

export type RefundOutcomeBody =
  | { status: "succeeded"; provider_refund_ref?: string; note: string }
  | { status: "failed"; failure_code: string; note: string };

/** Records what the provider answered for a flagged open refund (refunds.create). */
export async function recordRefundOutcome(id: number, input: RefundOutcomeBody, version: number, key: string): Promise<AdminRefund> {
  const body = await unwrap<DataEnvelope<AdminRefund>>(
    adminApi.POST("/v1/admin/refunds/{refund}/outcome", {
      params: { path: { refund: id } },
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

export type ReinstateBody = { expected_amount_fils: number; provider_refund_ref?: string; note: string };

/** "Provider paid after all": a failed refund the provider later reported paid (refunds.create). */
export async function reinstateRefund(id: number, input: ReinstateBody, version: number, key: string): Promise<AdminRefund> {
  const body = await unwrap<DataEnvelope<AdminRefund>>(
    adminApi.POST("/v1/admin/refunds/{refund}/reinstate", {
      params: { path: { refund: id } },
      body: input as never,
      headers: { ...idempotency(key), ...ifMatch(version) },
    }),
  );
  return body.data;
}

export type CreditNoteEmailResult = { status: "queued"; email: string; message: string };

/** Queues the credit note e-mail to the customer's own address (invoices.manage; 422 EMAIL_MISSING, 429). */
export async function emailCreditNote(id: number): Promise<CreditNoteEmailResult> {
  const body = await unwrap<DataEnvelope<CreditNoteEmailResult>>(
    adminApi.POST("/v1/admin/credit-notes/{creditNote}/email", { params: { path: { creditNote: id } } }),
  );
  return body.data;
}

// ---- exports (reports.export) --------------------------------------------------------------------------------------------

export async function createExport(input: { report: string; format: string; filters: Record<string, unknown> }): Promise<ExportRecord> {
  const body = await unwrap<DataEnvelope<ExportRecord>>(adminApi.POST("/v1/admin/exports", { body: input as never }));
  return body.data;
}

export async function fetchExport(id: number, opts: ReadOptions = {}): Promise<ExportRecord> {
  const body = await unwrap<DataEnvelope<ExportRecord>>(
    adminApi.GET("/v1/admin/exports/{export}", { params: { path: { export: id } }, headers: backgroundPoll(opts.background) }),
  );
  return body.data;
}

export async function fetchExports(q: { page?: number; perPage?: number } = {}, opts: ReadOptions = {}): Promise<Paginated<ExportRecord>> {
  return unwrap<Paginated<ExportRecord>>(
    adminApi.GET("/v1/admin/exports", { params: { query: compact({ page: q.page, per_page: q.perPage }) as never }, headers: backgroundPoll(opts.background) }),
  );
}

/** A fresh 15-minute signed link to a ready export (409 EXPORT_NOT_READY, 410 EXPORT_EXPIRED). */
export async function fetchExportUrl(id: number): Promise<ExportUrl> {
  const body = await unwrap<DataEnvelope<ExportUrl>>(adminApi.GET("/v1/admin/exports/{export}/url", { params: { path: { export: id } } }));
  return body.data;
}

// ---- the customer's balance (customers.view or payments.view to read; refunds.create to adjust) ------------------------------

export async function fetchCustomerWallet(customerUlid: string, q: { page?: number; perPage?: number } = {}): Promise<WalletPage> {
  return unwrap<WalletPage>(
    adminApi.GET("/v1/admin/customers/{customer}/wallet", {
      params: { path: { customer: customerUlid }, query: compact({ page: q.page, per_page: q.perPage }) as never },
    }),
  );
}

/** Goodwill credit or correction debit; Idempotency-Key per intent (422 IDEMPOTENCY_KEY_REUSED for another body). */
export async function adjustCustomerWallet(
  customerUlid: string,
  input: WalletAdjustBody,
  key: string,
): Promise<{ data: WalletTransaction; balance_fils: number }> {
  return unwrap<{ data: WalletTransaction; balance_fils: number }>(
    adminApi.POST("/v1/admin/customers/{customer}/wallet/transactions", {
      params: { path: { customer: customerUlid } },
      body: input as never,
      headers: idempotency(key),
    }),
  );
}

/** Whether the customer balance is switched on (the public config, readable by every staff session). */
export async function fetchWalletEnabled(): Promise<boolean> {
  const body = await unwrap<{ data: { wallet?: { enabled?: boolean } } }>(adminApi.GET("/v1/public/config"));
  return body.data.wallet?.enabled === true;
}
