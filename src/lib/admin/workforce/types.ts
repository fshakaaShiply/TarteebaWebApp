import type { components, operations } from "@/lib/api/schema";

/*
 * A05 workforce, A09 incentive postings and A04 waitlist shapes (slice W4). Every one comes from the generated schema
 * (contracts A5 §7 and A6 §5.2); nothing here copies an API shape by hand except where the export is loose and the
 * contract says more (the waitlist `position` is a number or null, `offer.state` one of three words).
 */

type Schemas = components["schemas"];
type Ok<K extends keyof operations> = operations[K]["responses"] extends { 200: { content: { "application/json": infer B } } } ? B : never;

// ---- documents and photo -----------------------------------------------------------------------------------------

export type WorkerDocument = Schemas["WorkerDocumentResource"];
export type DocumentType = WorkerDocument["type"];
export type DocumentState = WorkerDocument["state"];

/** The answer of GET /worker-documents/{id}/file and /incentive-postings/{id}/file (a signed link). */
export type SignedUrl = { url: string; expires_at?: string | null; file_name?: string | null };

// ---- attendance and stats ----------------------------------------------------------------------------------------

export type AttendanceDay = Schemas["AttendanceDayResource"];
export type AttendanceStatus = NonNullable<AttendanceDay["status"]>;
export type AttendanceDaysPage = Ok<"admin.workforce.attendance.index">;
export type AttendanceCounts = AttendanceDaysPage["meta"]["counts"];
export type AttendanceMonth = Ok<"admin.workforce.workers.attendance.index">;
export type AttendanceSummary = AttendanceMonth["meta"]["summary"];
export type WorkerStats = Ok<"admin.workforce.workers.stats">["data"];

// ---- incentives --------------------------------------------------------------------------------------------------

export type IncentiveProposal = Schemas["IncentiveProposalResource"];
export type IncentiveStatus = IncentiveProposal["status"];
export type ProposalsPage = Ok<"admin.workforce.incentives.proposals.index">;
export type ProposalTotals = ProposalsPage["meta"]["totals"];
export type ComputeResult = Ok<"admin.workforce.incentives.compute">["data"];
export type IncentiveAdjustment = Schemas["IncentiveAdjustmentResource"];
export type AdjustmentsPage = Ok<"admin.workforce.incentives.adjustments.index">;
export type IncentivePosting = Schemas["IncentivePostingResource"];
export type PostingsPage = Ok<"admin.workforce.incentive-postings.index">;
export type IncentiveRule = Schemas["IncentiveRuleResource"];
export type RulePreview = Ok<"admin.workforce.incentive-rules.preview">["data"];
export type IncentiveGate = IncentiveProposal["gates"][number];
export type ScoreKey = "hours" | "rating" | "punctuality" | "repeat_requests";

/** One line a bulk approve or a post names, as the screen showed it (`kind` only on a post, which mixes both kinds). */
export type ExpectedLine = { id: number; amount_fils: number; kind?: "incentive" | "adjustment" };

// ---- waitlist ----------------------------------------------------------------------------------------------------

export type WaitlistStatus = "waiting" | "notified" | "converted" | "expired" | "cancelled";
export type WaitlistOfferState = "none" | "live" | "lapsed";
export type NotifyBlockedReason = NonNullable<Schemas["AdminWaitlistEntryResource"]["actions"]["notify_blocked_reason"]>;

export type WaitlistEntry = Omit<Schemas["AdminWaitlistEntryResource"], "position" | "status" | "offer"> & {
  status: WaitlistStatus;
  /** 1-based place in the offer order, waiting rows only. */
  position: number | null;
  /** `offered_by` is a staff id (a number, contract A6 §5.2) or null for an automatic offer; the export types the id as text. */
  offer: { state: WaitlistOfferState; expires_at: string | null; offered_at: string | null; offered_by: { id: number; name: string } | null };
};

export type WaitlistPage = {
  data: WaitlistEntry[];
  meta: Omit<Ok<"admin.scheduling.waitlist.index">["meta"], never>;
};
export type WaitlistCounts = WaitlistPage["meta"]["counts_by_status"];
