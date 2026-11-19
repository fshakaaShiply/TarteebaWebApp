import type { components } from "@/lib/api/schema";
import type { Paginated, Translatable } from "../types";

/*
 * A07 customers and the privacy queue (slice W3): the shapes of contracts A4a §3 and A4b §3. The ones the generated schema
 * types exactly come from it; the privacy request and the staff deletion preview are written out here because the document
 * types `erasure_log`, `impact_snapshot` and `actions` loosely (they are the contracts' shapes).
 */

type Schemas = components["schemas"];

export type CustomerListItem = Schemas["AdminCustomerListItemResource"];
export type CustomerDetail = Schemas["AdminCustomerDetailResource"];
export type CustomerNote = Schemas["CustomerNoteResource"];
export type CustomerAddress = CustomerDetail["addresses"][number];
export type AdminAddress = Schemas["AdminAddressResource"];
export type CustomerConsents = CustomerDetail["consents"];
/** One of the profile's `links`: the owning module's own list, filtered to this customer (`params`). */
export type CustomerListLink = { list: string; path: string; params: Record<string, string> };
export type CustomerPage<T> = Paginated<T>;

export const CUSTOMER_STATUSES = ["active", "blocked", "pending_deletion", "deleted"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const CUSTOMER_SORTS = ["recent", "name", "created"] as const;

export const PRIVACY_TYPES = ["export", "delete"] as const;
export type PrivacyType = (typeof PRIVACY_TYPES)[number];
export const PRIVACY_STATUSES = ["received", "scheduled", "processing", "completed", "expired", "cancelled", "failed"] as const;
export type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];
export const PRIVACY_VERIFICATIONS = ["in_app_otp", "in_app_session", "registered_phone_call", "in_person", "written_request"] as const;
/** What staff can record when they file a request for a customer (A4b §3, P5-C24). */
export const STAFF_VERIFICATIONS = ["registered_phone_call", "in_person", "written_request"] as const;
export type StaffVerification = (typeof STAFF_VERIFICATIONS)[number];
/** Holds that keep a scheduled deletion waiting (`identity::privacy.waiting_on`). */
export const WAITING_ON_CODES = ["refund_processing", "payment_verifying", "payment_authorized", "wallet_balance", "compensation_pending", "open_booking"] as const;
/** Why a request failed (`identity::privacy.failure`). */
export const FAILURE_CODES = ["worker_lost", "blocked_hash_key_missing", "export_failed", "eraser_failed", "ledger_failed", "account_deleted"] as const;
/** Why a deletion cannot be filed or waits (`identity::privacy.blocking`, A4b §9). */
export const BLOCKING_CODES = ["visit_in_progress", "payment_verifying", "review_required", "cancel_review_pending", "wallet_balance", "open_booking", "open_subscription"] as const;

export type ImpactBooking = { ulid: string; reference: string; fee_fils: number; refund_fils: number; payment?: string };
export type ImpactSubscription = { ulid: string; reference: string; fee_fils: number; clawback_fils: number; refund_fils: number };

/** AdminPrivacyRequestResource (A4b §3). */
export type PrivacyRequest = {
  id: number;
  ulid: string;
  type: PrivacyType;
  type_label: { ar: string | null; en: string | null };
  status: PrivacyStatus;
  status_label: Translatable;
  source: "app" | "staff";
  verification: string;
  verification_label: Translatable;
  verification_note: string | null;
  otp_verified_at: string | null;
  customer: { id: string; name: string | null; phone: string | null; status: string; status_label: Translatable };
  previous_customer_status: string | null;
  impact_snapshot: {
    bookings?: ImpactBooking[];
    subscriptions?: ImpactSubscription[];
    refunds_in_flight?: { ulid: string; amount_fils: number }[];
    waitlist_closed?: number;
  } | null;
  scheduled_for: string | null;
  waiting_on: { code: string; label: Translatable }[];
  next_check_at: string | null;
  processing_started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  handled_by: { id: number; name: string } | null;
  handled_at: string | null;
  export: { size_bytes: number | null; expires_at: string | null; download_count: number; last_downloaded_at: string | null } | null;
  attempts: number;
  failure_code: string | null;
  failure_label: Translatable | null;
  failure_detail: string | null;
  erasure_log: Record<string, Record<string, number>> | null;
  version: number;
  created_at: string | null;
  updated_at: string | null;
  actions: { cancel: boolean; retry: boolean };
};

export type PrivacyPage = Paginated<PrivacyRequest> & {
  meta: { counts_by_status: Record<PrivacyStatus, number> };
};

/** GET /admin/customers/{ulid}/deletion-impact (staff print): what is open, so a deletion can be filed or must wait. */
export type DeletionImpactItem = {
  id: number | string;
  ulid?: string;
  reference: string;
  status_label?: Translatable | string | null;
  fee_fils?: number | null;
  refund_fils?: number | null;
};
export type DeletionBlocker = { code: string; type: string; id: number | string | null; reference: string | null; message: Translatable | string | null };
export type DeletionImpact = {
  can_request: boolean;
  grace_days: number;
  executes_after: string | null;
  bookings: DeletionImpactItem[];
  subscriptions: DeletionImpactItem[];
  blocking: DeletionBlocker[];
  totals?: { fee_fils: number; refund_fils: number; currency: string } | null;
};

export type PrivacyOtp = { phone_masked: string; expires_in: number; resend_in: number };

export type NoteStaff = CustomerNote["author"];
