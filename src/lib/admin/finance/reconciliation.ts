import type { components } from "@/lib/api/schema";
import type { StatusTone } from "@/components/admin";
import { AdminApiError } from "../client";
import type { FilterSpec } from "./filters";

/*
 * A09 reconciliation (finance §3, §5.1; contracts A1a): a run reads one provider settlement report for one report date,
 * every line becomes an item matched to our payments and refunds and classified with the spec's five statuses plus a
 * closed reason. A person resolves each difference with a code and a note; three codes move money through the refund
 * actions. The shapes come from the generated schema; the list answers and the totals blocks are loosely typed there, so
 * the narrow shapes below follow the contract (A1a §5.1).
 */

type S = components["schemas"];

export type RunStatus = S["ReconciliationRunStatus"];
export type ItemStatus = S["ReconciliationItemStatus"];
export type ItemReason = S["ReconciliationReason"];
export type Resolution = S["ReconciliationResolution"];
export type LineType = S["SettlementLineType"];
export type DocumentCheck = S["DocumentCheck"];

export const RUN_STATUSES = ["pending", "processing", "completed", "failed", "superseded"] as const satisfies readonly RunStatus[];
export const ITEM_STATUSES = ["matched", "amount_mismatch", "missing_in_system", "missing_in_gateway", "status_mismatch"] as const satisfies readonly ItemStatus[];
export const ITEM_REASONS = [
  "ok",
  "amount_differs",
  "currency_differs",
  "payout_total_differs",
  "unknown_reference",
  "charge_not_current",
  "refund_unknown",
  "duplicate_line",
  "chargeback",
  "provider_adjustment",
  "charge_not_reported",
  "refund_not_reported",
  "not_captured_in_system",
  "refund_open_in_system",
  "refund_failed_in_system",
  "refund_payment_differs",
] as const satisfies readonly ItemReason[];
export const RESOLUTIONS = [
  "accepted",
  "provider_to_correct",
  "timing",
  "stray_charge_refunded",
  "refund_confirmed",
  "provider_refund_recorded",
  "refund_reinstated",
  "reported_later",
  "resolved_in_system",
] as const satisfies readonly Resolution[];
export const LINE_TYPES = ["charge", "refund", "chargeback", "chargeback_reversal", "fee", "adjustment", "payout"] as const satisfies readonly LineType[];
export const DOCUMENT_CHECKS = [
  "ok",
  "no_invoice",
  "invoice_differs",
  "no_credit_note",
  "credit_note_differs",
  "not_invoiceable",
  "refused",
  "not_applicable",
] as const satisfies readonly DocumentCheck[];

/** Codes whose resolution only records a note: a person may take them back (A1a: RESOLUTION_NOT_REOPENABLE for the rest). */
export const REOPENABLE_RESOLUTIONS: readonly Resolution[] = ["accepted", "provider_to_correct", "timing"];

type Both = { ar: string; en: string };

export type RunRow = Pick<
  S["ReconciliationRunResource"],
  | "id"
  | "gateway"
  | "report_date"
  | "source"
  | "parser"
  | "parser_label"
  | "source_file_name"
  | "status"
  | "status_label"
  | "lines_count"
  | "counts"
  | "unresolved_count"
  | "totals_brief"
  | "started_by"
  | "started_at"
  | "finished_at"
  | "failure_code"
  | "failure_label"
  | "supersedes_run_id"
  | "superseded_by_run_id"
>;

type Count = { count: number; amount_fils: number };

/** RunDetail `totals`: the provider's report, our records for the same transactions, and the tax documents (AC6). */
export type RunTotals = {
  gateway: {
    lines: number;
    charges: Count & { fee_fils: number };
    refunds: Count & { fee_fils: number };
    other: { count: number; net_fils: number };
    fee_fils: number;
    net_fils: number;
    payouts: { ref: string | null; amount_fils: number; lines_net_fils: number; difference_fils: number | null }[];
    payout_fils: number;
    payout_difference_fils: number;
    tolerance_difference_fils: number;
  };
  system: {
    expected_from?: string | null;
    expected: { charges: number; refunds: number };
    matched: { charges: Count; refunds: Count };
  };
  documents: {
    invoices: { count: number; subtotal_fils: number; discount_fils: number; net_fils: number; vat_fils: number; total_fils: number };
    credit_notes: { count: number; net_fils: number; vat_fils: number; total_fils: number };
    charges_vs_invoices_fils: number;
    refunds_vs_credit_notes_fils: number;
    net_vat_fils: number;
    checks: Partial<Record<DocumentCheck, number>>;
  };
};

export type RunError = { line: number | null; column: string | null; code: string; message: Both | string | null };

export type RunDetail = Omit<S["ReconciliationRunResource"], "totals" | "errors"> & {
  totals: RunTotals | null;
  errors: RunError[];
};

export type ItemRow = Omit<S["ReconciliationItemResource"], "payment_facts" | "refund_facts" | "pair_candidates" | "allowed_resolutions" | "history">;

export type AllowedResolution = { code: Resolution; label: Both; moves_money: boolean; needs_pair: boolean; needs_reason_code: boolean };

export type ItemDetail = ItemRow & {
  payment_facts: S["ReconciliationItemResource"]["payment_facts"];
  refund_facts: S["ReconciliationItemResource"]["refund_facts"];
  pair_candidates: ItemRow[];
  allowed_resolutions: AllowedResolution[];
  history: S["ReconciliationItemResource"]["history"];
};

export type RunsPage = { data: RunRow[]; meta: { current_page: number; per_page: number; total: number; last_page: number; unresolved_total: number } };
export type ItemsPage = {
  data: ItemRow[];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
    counts_by_status: Record<ItemStatus, number>;
    unresolved_count: number;
    documents_issues: number;
  };
};

export type SettlementFormat = {
  key: string;
  label: Both;
  accepts: string[];
  columns: { name: string; required: boolean; format: string }[];
};

// ---- runs list ------------------------------------------------------------------------------------------------------

/** Filters of the runs list, in the URL: report date range, status and "needs action only". */
export const RUN_FILTERS = {
  from: { kind: "date" },
  to: { kind: "date" },
  status: { kind: "enum", values: RUN_STATUSES },
  unresolved: { kind: "flag" },
} as const satisfies FilterSpec;

/** A run still being read: the list refreshes in the background while one is in flight (every 5 s). */
export const RUN_POLL_MS = 5_000;

export function runInFlight(status: RunStatus): boolean {
  return status === "pending" || status === "processing";
}

export function anyRunInFlight(rows: readonly Pick<RunRow, "status">[] | undefined): boolean {
  return (rows ?? []).some((r) => runInFlight(r.status));
}

export const runTone: Record<RunStatus, StatusTone> = {
  completed: "success",
  pending: "progress",
  processing: "progress",
  failed: "danger",
  superseded: "neutral",
};

export const itemTone: Record<ItemStatus, StatusTone> = {
  matched: "success",
  amount_mismatch: "danger",
  missing_in_system: "danger",
  missing_in_gateway: "pending",
  status_mismatch: "pending",
};

export const checkTone: Record<DocumentCheck, StatusTone> = {
  ok: "success",
  not_applicable: "neutral",
  no_invoice: "danger",
  invoice_differs: "danger",
  no_credit_note: "danger",
  credit_note_differs: "danger",
  not_invoiceable: "pending",
  refused: "pending",
};

// ---- items list -----------------------------------------------------------------------------------------------------

export const ITEM_VIEWS = ["differences", "documents", "matched", "resolved", "all"] as const;
export type ItemView = (typeof ITEM_VIEWS)[number];

/** The run page's items: the tab (API `view`), an optional status and line type, and a reference search. */
export const ITEM_FILTERS = {
  view: { kind: "enum", values: ITEM_VIEWS },
  status: { kind: "enum", values: ITEM_STATUSES },
  line_type: { kind: "enum", values: LINE_TYPES },
  q: { kind: "text", max: 120 },
} as const satisfies FilterSpec;

export function itemView(value: string): ItemView {
  return (ITEM_VIEWS as readonly string[]).includes(value) ? (value as ItemView) : "differences";
}

// ---- resolving ------------------------------------------------------------------------------------------------------

export const NOTE_MIN = 3;
export const NOTE_MAX = 1000;

export type ResolveFormError = "note_required" | "note_short" | "note_long" | "pair_required" | "reason_required" | "code_required";
export const RESOLVE_FORM_ERRORS: readonly ResolveFormError[] = ["note_required", "note_short", "note_long", "pair_required", "reason_required", "code_required"];

export type ResolveValues = { code: string; note: string; paired_item_id: string; refund_reason_code: string };

export type ResolveBody = {
  resolution_code: Resolution;
  note: string;
  paired_item_id?: number;
  refund_reason_code?: string;
  expected_amount_fils?: number;
};

/**
 * What the item resolves to, or the first thing missing. The money amount is the provider line's own amount: the person
 * confirms exactly that figure in the second step and the API refuses (409 TERMS_CHANGED) when the facts moved.
 */
export function buildResolveBody(
  values: ResolveValues,
  item: Pick<ItemDetail, "gateway_amount_fils" | "refund_facts">,
  allowed: readonly AllowedResolution[],
): { ok: true; body: ResolveBody; allowed: AllowedResolution } | { ok: false; error: ResolveFormError } {
  const rule = allowed.find((a) => a.code === values.code);
  if (!rule) return { ok: false, error: "code_required" };
  const note = values.note.trim();
  if (note === "") return { ok: false, error: "note_required" };
  if (note.length < NOTE_MIN) return { ok: false, error: "note_short" };
  if (note.length > NOTE_MAX) return { ok: false, error: "note_long" };
  const body: ResolveBody = { resolution_code: rule.code, note };
  if (rule.needs_pair) {
    if (!/^\d+$/.test(values.paired_item_id)) return { ok: false, error: "pair_required" };
    body.paired_item_id = Number(values.paired_item_id);
  }
  if (rule.needs_reason_code) {
    if (values.refund_reason_code === "") return { ok: false, error: "reason_required" };
    body.refund_reason_code = values.refund_reason_code;
  }
  if (rule.moves_money) {
    // refund_confirmed and refund_reinstated confirm the refund's own line; provider_refund_recorded books the line's amount.
    const amount = item.gateway_amount_fils ?? item.refund_facts?.amount_fils;
    if (amount === null || amount === undefined) return { ok: false, error: "code_required" };
    body.expected_amount_fils = amount;
  }
  return { ok: true, body, allowed: rule };
}

/** `{amount_fils}` of a 409 TERMS_CHANGED, else null. */
export function termsChangedAmount(error: unknown): number | null {
  if (!(error instanceof AdminApiError) || error.code !== "TERMS_CHANGED") return null;
  const value = error.details.amount_fils;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** The pair candidate's one-line summary needs its provider reference first, then the amount. */
export function itemRef(item: Pick<ItemRow, "gateway_ref" | "refund_ref" | "merchant_ref" | "payout_ref" | "line_no">): string | null {
  return item.refund_ref ?? item.gateway_ref ?? item.merchant_ref ?? item.payout_ref ?? null;
}

/** Document checks that need a person's eye (everything but ok and not applicable). */
export function documentIssues(checks: Partial<Record<DocumentCheck, number>> | undefined): number {
  return Object.entries(checks ?? {}).reduce((sum, [code, n]) => sum + (code === "ok" || code === "not_applicable" ? 0 : (n ?? 0)), 0);
}

/** A run's 422 line errors of an upload that failed while reading (the run is failed, its errors say where). */
export function runFailedWhileReading(run: Pick<RunDetail, "status" | "failure_code">): boolean {
  return run.status === "failed" && run.failure_code === "parse_failed";
}
