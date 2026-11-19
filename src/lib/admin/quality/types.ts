import type { PageMeta, Translatable } from "../types";

/*
 * A10 quality (Phase 5, slice W2): the shapes of the Quality admin answers as the API builds them (contracts A2 §8.2,
 * A3 §5; Quality/Http/Resources/Admin*Resource.php). The generated schema types these payloads loosely
 * (`data: unknown[]`), so the bodies are cast to these. Every label the API sends is an {ar, en} pair.
 */

export const CASE_TYPES = ["complaint", "support", "rating_followup"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_STATUSES = ["open", "in_review", "awaiting_customer", "resolved", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_CATEGORIES = ["quality", "lateness", "conduct", "damage", "billing", "other"] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const CASE_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CASE_OUTCOMES = ["upheld", "not_upheld", "partial"] as const;
export type CaseOutcome = (typeof CASE_OUTCOMES)[number];

export const CASE_SOURCES = ["app", "phone", "whatsapp", "admin", "rating"] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

export const CLOSE_REASONS = ["resolved", "no_customer_reply", "customer_withdrew", "duplicate", "merged", "not_actionable", "account_closed"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const COMPENSATION_TYPES = ["none", "refund", "credit", "free_visit"] as const;
export type CompensationType = (typeof COMPENSATION_TYPES)[number];
/** A compensation row's type (never "none"). */
export type MoneyCompensationType = Exclude<CompensationType, "none">;

export const COMPENSATION_STATUSES = ["pending_approval", "executed", "rejected", "cancelled", "failed"] as const;
export type CompensationStatus = (typeof COMPENSATION_STATUSES)[number];

export const SLA_STATES = ["on_track", "due_soon", "breached", "paused", "met", "none"] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const CASE_STAFF_STATUSES = ["in_review", "awaiting_customer", "closed"] as const;

export type CaseSla = {
  state: SlaState;
  kind: "first_response" | "resolution" | null;
  due_at: string | null;
  remaining_minutes: number | null;
};

/** A file of a case or a rating: the link is temporary (15 minutes) and `url_expires_at` says when it dies. */
export type Attachment = {
  id: string;
  purpose: string;
  mime: string;
  size_bytes: number;
  url: string | null;
  url_expires_at: string | null;
  expires_at?: string | null;
};

export type CaseCompensationSummary = { type: MoneyCompensationType; status: CompensationStatus; amount_fils: number };

/** One row of the inbox (GET /admin/complaints). */
export type AdminCaseRow = {
  id: number;
  reference: string;
  type: CaseType;
  type_label: Translatable;
  category: CaseCategory;
  category_label: Translatable;
  rating: { overall: number } | null;
  customer: { id: string; name_short: string | null };
  booking: { id: number; reference: string } | null;
  workers: { id: number; name: string }[];
  priority: CasePriority;
  priority_label: Translatable;
  status: CaseStatus;
  status_label: Translatable;
  assignee: { id: number; name: string } | null;
  sla: CaseSla;
  compensation: CaseCompensationSummary | null;
  awaiting_approval: boolean;
  customer_replied: boolean;
  created_at: string;
};

export type CaseCounts = { active: number; unassigned: number; breached: number; awaiting_approval: number };

export type CasesPage = { data: AdminCaseRow[]; meta: PageMeta & { counts: CaseCounts } };

export type CaseMessage = {
  id: string;
  author_type: "customer" | "staff" | "system";
  author: { id: number | null; name: string | null } | null;
  kind: "message" | "resolution" | "system";
  body: string;
  is_internal: boolean;
  attachments: Attachment[];
  created_at: string;
};

export type CaseEvent = {
  type: string;
  actor: { type: "customer" | "staff" | "system"; id: number | null; name: string | null };
  data: Record<string, unknown>;
  created_at: string;
};

export type RefundDestination = "card" | "wallet";

/** The Compensation shape of the accountant's queue and of a case's `compensations` (A3 §5.3). */
export type Compensation = {
  id: number;
  ulid: string;
  case?: { id: number; reference: string; type: CaseType; category: CaseCategory };
  customer?: { id: string; name: string | null };
  type: MoneyCompensationType;
  type_label: Translatable;
  amount_fils: number;
  currency: string;
  status: CompensationStatus;
  status_label: Translatable;
  destination: RefundDestination | null;
  note: string | null;
  proposed_by: { id: number; name: string } | null;
  proposed_at: string;
  decided_by: { id: number; name: string } | null;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
  settled_at: string | null;
  failed_at: string | null;
  failure_code: "refund_failed" | "refund_failed_manual" | "visit_cancelled" | "visit_missed" | null;
  reinstated_at: string | null;
  refund: { id: number; ulid: string; status: string; status_label: Translatable } | null;
  recovery_booking: { id: number; reference: string; service_date: string; status: string } | null;
  wallet_transaction_id: number | null;
  version: number;
};

export type CompensationOption = { available: boolean; reason: string | null };
export type CompensationOptions = {
  refund: CompensationOption & { max_fils: number; destination: RefundDestination | null };
  credit: CompensationOption & { max_fils: number };
  free_visit: CompensationOption;
};

export type CasePayment = {
  status: string;
  status_label: Translatable;
  captured_fils: number;
  refunded_fils: number;
  disputed_fils: number;
  refundable_fils: number;
  destination: RefundDestination;
  payable_reference: string | null;
  link: string | null;
};

export type CaseBooking = {
  id: number;
  ulid: string;
  reference: string;
  kind: string;
  kind_label: Translatable;
  status: string;
  status_label: Translatable;
  service_date: string;
  /** The slot template's name is cast as an array on the API (SlotTemplate `name`): both languages, like the service's. */
  slot: { id: number; start: string; end: string; name: Translatable };
  service: { code: string; name: Translatable };
  workers_count: number;
  zone: { id: number; name: Translatable | string };
  payment_status: string;
};

export type CaseRating = {
  id: number;
  overall: number;
  quality: number | null;
  punctuality: number | null;
  conduct: number | null;
  comment: string | null;
  photos: Attachment[];
  request_same_worker: boolean;
  excluded: boolean;
};

export type CaseActions = {
  assign: boolean;
  reply: boolean;
  resolve: boolean;
  close: boolean;
  reopen: boolean;
  approve: boolean;
  reject: boolean;
  cancel_compensation: boolean;
};

export type PendingResolution = {
  outcome?: CaseOutcome | null;
  resolution?: string | null;
  compensation_id?: number;
  requested_by?: number | { id: number; name: string } | null;
  requested_at?: string | null;
};

/** The detail answer replaces the row's short customer name with the customer's full record. */
export type AdminCaseDetail = Omit<AdminCaseRow, "customer"> & {
  description: string;
  source: CaseSource;
  source_label: Translatable;
  customer_visible: boolean;
  customer: { id: string; name: string | null; phone: string | null; status: string };
  attachments: Attachment[];
  booking: CaseBooking | null;
  visit: { id: number; status: string; status_label: Translatable; arrived_at: string | null; completed_at: string | null; late_minutes: number | null } | null;
  subscription: { id: number; reference: string; type: string } | null;
  payment: CasePayment | null;
  worker_options: { id: number; name: string; role: string; released: boolean }[];
  driver: { id: number; name: string | null } | null;
  driver_options: { id: number; name: string | null; round_kind: string }[];
  rating: CaseRating | null;
  messages: CaseMessage[];
  events: CaseEvent[];
  compensations: Compensation[];
  pending_resolution: PendingResolution | null;
  compensation_options: CompensationOptions | null;
  outcome: CaseOutcome | null;
  outcome_label: Translatable | null;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: { id: number; name: string } | null;
  close_reason: CloseReason | null;
  close_reason_label: Translatable | null;
  closed_at: string | null;
  merged_into: { id: number; reference: string } | null;
  first_response_due_at: string;
  first_responded_at: string | null;
  resolution_due_at: string | null;
  reopened_count: number;
  actions: CaseActions;
  version: number;
};

export type Assignee = { id: number; name: string; roles: string[] };

export type CompensationsPage = { data: Compensation[]; meta: PageMeta };

export type RatingRow = {
  id: number;
  ulid: string;
  booking: { id: number; reference: string; kind: string };
  customer: { id: string; name: string | null };
  workers: { id: number; name: string }[];
  overall: number;
  quality: number | null;
  punctuality: number | null;
  conduct: number | null;
  comment: string | null;
  photos_count: number;
  request_same_worker: boolean;
  is_low: boolean;
  excluded: boolean;
  case: { id: number; reference: string; status: CaseStatus; status_label: Translatable } | null;
  service_date: string;
  created_at: string;
};

export type RatingDetail = RatingRow & {
  photos: Attachment[];
  exclusion: { at: string; by: { id: number; name: string } | null; reason: string | null } | null;
  version: number;
};

export type RatingsPage = { data: RatingRow[]; meta: PageMeta & { average: number | null; count: number } };

export type FreeVisitSlot = { slot_template_id: number; code: string; name: string; start: string; end: string; status: "available" | "limited" | "full" | "closed"; remaining?: number };
export type FreeVisitAvailability = {
  data: { date: string; slots: FreeVisitSlot[] }[];
  meta: { timezone: string; horizon_days: number; limited_threshold: number; workers: number };
};

/** The `quality` block of GET /admin/bookings/{id} (A03): `cases` is null for staff without complaints.manage. */
export type BookingQuality = {
  rating: { id: number; overall: number; is_low: boolean } | null;
  cases: { id: number; reference: string; type: CaseType; status: CaseStatus; status_label: Translatable }[] | null;
};
