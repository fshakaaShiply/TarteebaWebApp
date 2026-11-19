import { adminApi, backgroundPoll, unwrap, type ReadOptions } from "../client";
import type { DataEnvelope, Paginated } from "../types";
import type {
  AdminAddress,
  CustomerDetail,
  CustomerListItem,
  CustomerListLink,
  CustomerNote,
  DeletionImpact,
  PrivacyOtp,
  PrivacyPage,
  PrivacyRequest,
} from "./types";
import type { PrivacyRequestBody } from "./forms";

/*
 * A07 endpoints (slice W3): the customer search, the profile with its notes, the blocks, the marketing opt-out and the
 * privacy requests (contracts A4a §3, A4b §3). One function per route through the typed admin client, answering the
 * unwrapped body or throwing AdminApiError. Customers and addresses are addressed by ULID. Block, unblock and the address
 * block send the record's version as If-Match (409 STALE_VERSION); a cancel or retry of a privacy request sends the
 * request's. None of them moves money, so none sends an Idempotency-Key: a second identical block writes nothing (P2-03),
 * and a second request of the same type is refused (409 PRIVACY_REQUEST_OPEN).
 */

const ifMatch = (version: number | null | undefined) => (version === null || version === undefined ? {} : { "If-Match": String(version) });

function compact(query: Record<string, string | number | boolean | null | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    out[key] = value === true ? 1 : value;
  }
  return out;
}

// ---- the list and the profile (customers.view) -------------------------------------------------------------------

export type CustomerListQuery = { page?: number; perPage?: number; q?: string; status?: string; sort?: string };

/** GET /admin/customers: never with `phone` (422 USE_LOOKUP_ENDPOINT; the exact-phone lookup belongs to the manual booking). */
export async function fetchCustomers(q: CustomerListQuery): Promise<Paginated<CustomerListItem>> {
  return unwrap<Paginated<CustomerListItem>>(
    adminApi.GET("/v1/admin/customers", { params: { query: compact({ page: q.page, per_page: q.perPage, q: q.q?.trim(), status: q.status, sort: q.sort }) as never } }),
  );
}

export async function fetchCustomer(ulid: string): Promise<CustomerDetail> {
  const body = await unwrap<DataEnvelope<CustomerDetail>>(adminApi.GET("/v1/admin/customers/{customer}", { params: { path: { customer: ulid } } }));
  return body.data;
}

export async function fetchCustomerNotes(ulid: string, q: { page?: number; perPage?: number } = {}): Promise<Paginated<CustomerNote>> {
  return unwrap<Paginated<CustomerNote>>(
    adminApi.GET("/v1/admin/customers/{customer}/notes", { params: { path: { customer: ulid }, query: compact({ page: q.page, per_page: q.perPage }) as never } }),
  );
}

/** customers.notes: an append-only note (1 to 2000 characters), shown with its author and time. */
export async function addCustomerNote(ulid: string, body: string): Promise<CustomerNote> {
  const answer = await unwrap<DataEnvelope<CustomerNote>>(adminApi.POST("/v1/admin/customers/{customer}/notes", { params: { path: { customer: ulid } }, body: { body } as never }));
  return answer.data;
}

/**
 * The customer's bookings, subscriptions, payments, cases or ratings: the owning module's own list, asked for with the
 * parameters the profile's `links` name (the customer's id in the form that list takes), so no list needs to know A07.
 */
export async function fetchLinked<T>(link: Pick<CustomerListLink, "path" | "params">, q: { page?: number; perPage?: number; extra?: Record<string, string | number> } = {}): Promise<Paginated<T>> {
  const path = link.path.replace(/^\/api/, "");
  const query = compact({ ...link.params, ...q.extra, page: q.page, per_page: q.perPage });
  return unwrap<Paginated<T>>(adminApi.GET(path as never, { params: { query } } as never));
}

// ---- blocks and the marketing opt-out ---------------------------------------------------------------------------

/** customers.block + customers.view: the customer cannot sign in or book; renewals stop. Answers the whole profile. */
export async function blockCustomer(ulid: string, reason: string, version: number): Promise<CustomerDetail> {
  const body = await unwrap<DataEnvelope<CustomerDetail>>(
    adminApi.POST("/v1/admin/customers/{customer}/block", { params: { path: { customer: ulid } }, body: { reason: reason.trim() }, headers: ifMatch(version) } as never),
  );
  return body.data;
}

export async function unblockCustomer(ulid: string, reason: string, version: number): Promise<CustomerDetail> {
  const body = await unwrap<DataEnvelope<CustomerDetail>>(
    adminApi.POST("/v1/admin/customers/{customer}/unblock", { params: { path: { customer: ulid } }, body: { reason: reason.trim() }, headers: ifMatch(version) } as never),
  );
  return body.data;
}

/** customers.privacy_requests + customers.view: records, on the customer's request, that she no longer wants marketing (409 ALREADY_OPTED_OUT). */
export async function optOutMarketing(ulid: string, reason: string): Promise<CustomerDetail> {
  const body = await unwrap<DataEnvelope<CustomerDetail>>(
    adminApi.POST("/v1/admin/customers/{customer}/marketing-opt-out", { params: { path: { customer: ulid } }, body: { reason: reason.trim() } as never }),
  );
  return body.data;
}

export async function blockAddress(ulid: string, reason: string, version: number): Promise<AdminAddress> {
  const body = await unwrap<DataEnvelope<AdminAddress>>(
    adminApi.POST("/v1/admin/addresses/{address}/block", { params: { path: { address: ulid } }, body: { reason: reason.trim() }, headers: ifMatch(version) } as never),
  );
  return body.data;
}

export async function unblockAddress(ulid: string, reason: string, version: number): Promise<AdminAddress> {
  const body = await unwrap<DataEnvelope<AdminAddress>>(
    adminApi.POST("/v1/admin/addresses/{address}/unblock", { params: { path: { address: ulid } }, body: { reason: reason.trim() }, headers: ifMatch(version) } as never),
  );
  return body.data;
}

// ---- privacy requests (customers.privacy_requests) ---------------------------------------------------------------

/** What a deletion would do now: the open bookings and subscriptions (staff cancel them first) and what blocks it. */
export async function fetchDeletionImpact(ulid: string): Promise<DeletionImpact> {
  const body = await unwrap<DataEnvelope<DeletionImpact>>(adminApi.GET("/v1/admin/customers/{customer}/deletion-impact", { params: { path: { customer: ulid } } }));
  return body.data;
}

/** Sends a one-time code to the registered number; the caller reads it back (P5-C50). `type` words the SMS (A4b §12). */
export async function sendPrivacyOtp(ulid: string, type: "export" | "delete"): Promise<PrivacyOtp> {
  const body = await unwrap<DataEnvelope<PrivacyOtp>>(
    adminApi.POST("/v1/admin/customers/{customer}/privacy-requests/otp", { params: { path: { customer: ulid } }, body: { type } as never }),
  );
  return body.data;
}

export async function createPrivacyRequest(ulid: string, body: PrivacyRequestBody): Promise<PrivacyRequest> {
  const answer = await unwrap<DataEnvelope<PrivacyRequest>>(adminApi.POST("/v1/admin/customers/{customer}/privacy-requests", { params: { path: { customer: ulid } }, body: body as never }));
  return answer.data;
}

export type PrivacyListQuery = { page?: number; perPage?: number; type?: string; status?: string; q?: string };

export async function fetchPrivacyRequests(q: PrivacyListQuery, opts: ReadOptions = {}): Promise<PrivacyPage> {
  return unwrap<PrivacyPage>(
    adminApi.GET("/v1/admin/privacy-requests", {
      params: { query: compact({ page: q.page, per_page: q.perPage, type: q.type, status: q.status, q: q.q?.trim() }) as never },
      headers: backgroundPoll(opts.background),
    }),
  );
}

/** Cancels a request that has not started erasing (409 ERASURE_STARTED after that); a deletion is restored to the earlier status. */
export async function cancelPrivacyRequest(id: number, reason: string, version: number): Promise<PrivacyRequest> {
  const body = await unwrap<DataEnvelope<PrivacyRequest>>(
    adminApi.POST("/v1/admin/privacy-requests/{privacyRequest}/cancel", { params: { path: { privacyRequest: id } }, body: { reason: reason.trim() }, headers: ifMatch(version) } as never),
  );
  return body.data;
}

export async function retryPrivacyRequest(id: number, version: number): Promise<PrivacyRequest> {
  const body = await unwrap<DataEnvelope<PrivacyRequest>>(
    adminApi.POST("/v1/admin/privacy-requests/{privacyRequest}/retry", { params: { path: { privacyRequest: id } }, headers: ifMatch(version) } as never),
  );
  return body.data;
}
