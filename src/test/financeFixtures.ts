import type { ExportRecord } from "@/lib/admin/exports";
import type { AllowedResolution, ItemDetail, ItemRow, RunDetail, RunRow, RunTotals } from "@/lib/admin/finance/reconciliation";
import type { WalletPage, WalletTransaction } from "@/lib/admin/finance/wallet";

/*
 * Shapes as the Phase 5 finance API answers them (A1a §5.1, A1b §2.3 and §3.3), for the reconciliation, export and balance
 * screens. A run of Wednesday 18 November 2026 with one amount difference and one line we don't know.
 */

export const totals: RunTotals = {
  gateway: {
    lines: 10,
    charges: { count: 6, amount_fils: 705900, fee_fils: 17600 },
    refunds: { count: 3, amount_fils: 36000, fee_fils: 0 },
    other: { count: 0, net_fils: 0 },
    fee_fils: 17600,
    net_fils: 652300,
    payouts: [{ ref: "PO-1118", amount_fils: 652300, lines_net_fils: 652300, difference_fils: 0 }],
    payout_fils: 652300,
    payout_difference_fils: 0,
    tolerance_difference_fils: 0,
  },
  system: {
    expected_from: "2026-11-18T00:00:00+04:00",
    expected: { charges: 6, refunds: 3 },
    matched: { charges: { count: 5, amount_fils: 585900 }, refunds: { count: 3, amount_fils: 36000 } },
  },
  documents: {
    invoices: { count: 5, subtotal_fils: 560000, discount_fils: 5000, net_fils: 555000, vat_fils: 27750, total_fils: 582750 },
    credit_notes: { count: 3, net_fils: 34286, vat_fils: 1714, total_fils: 36000 },
    charges_vs_invoices_fils: 3150,
    refunds_vs_credit_notes_fils: 0,
    net_vat_fils: 26036,
    checks: { ok: 7, invoice_differs: 1, not_applicable: 2 },
  },
};

export const runRow = (over: Partial<RunRow> = {}): RunRow => ({
  id: 41,
  gateway: "fake",
  report_date: "2026-11-18",
  source: "upload",
  parser: "tarteeba_settlement_v1",
  parser_label: { ar: "تسوية ترتيبة (CSV)", en: "Tarteeba settlement (CSV)" },
  source_file_name: "settlement-2026-11-18.csv",
  status: "completed",
  status_label: { ar: "مكتملة", en: "Done" },
  lines_count: 10,
  counts: { matched: 8, amount_mismatch: 1, missing_in_system: 1, missing_in_gateway: 0, status_mismatch: 0 },
  unresolved_count: 2,
  totals_brief: { charges_fils: 705900, refunds_fils: 36000, fees_fils: 17600, net_fils: 652300 },
  started_by: { id: 4, name: "Test Accountant" },
  started_at: "2026-11-19T06:00:00+00:00",
  finished_at: "2026-11-19T06:00:09+00:00",
  failure_code: null,
  failure_label: null,
  supersedes_run_id: null,
  superseded_by_run_id: null,
  ...over,
});

export const runDetail = (over: Partial<RunDetail> = {}): RunDetail => ({
  ...runRow(),
  source_file: { name: "settlement-2026-11-18.csv", sha256: "a".repeat(64), bytes: 2048 },
  report_ref: "fake-20261118",
  currency: "AED",
  replace_reason: null,
  errors: [],
  errors_total: 0,
  totals,
  version: 3,
  ...over,
});

const baseItem: ItemRow = {
  id: 501,
  run_id: 41,
  report_date: "2026-11-18",
  line_no: 3,
  line_type: "charge",
  line_type_label: { ar: "خصم", en: "Charge" },
  line_key: "charge:fpay_b3",
  gateway_ref: "fpay_b3",
  refund_ref: null,
  merchant_ref: "01PAYB3",
  payout_ref: "PO-1118",
  transaction_at: "2026-11-18T07:02:00+00:00",
  settled_on: "2026-11-19",
  currency: "AED",
  system_amount_fils: 21900,
  gateway_amount_fils: 22400,
  difference_fils: 500,
  fee_fils: 548,
  net_fils: 21852,
  status: "amount_mismatch",
  status_label: { ar: "فرق في المبلغ", en: "Amount differs" },
  reason_code: "amount_differs",
  reason_label: { ar: "المبلغان مختلفان", en: "The amounts differ" },
  payment: { id: 9, ulid: "01PAYB3", status: "captured", payable_type: "booking", reference: "TRB-7K2Q9M", customer: { id: 2, ulid: "01C2", name: "Omar Khalid" } },
  refund: null,
  document_check: "invoice_differs",
  document_check_label: { ar: "الفاتورة مختلفة", en: "Invoice differs" },
  invoice: { id: 318, number: "INV-2026-000318" },
  credit_note: null,
  document_total_fils: 21900,
  document_vat_fils: 1043,
  document_discount_fils: 0,
  needs_action: true,
  resolution: null,
  version: 1,
};

export const itemRow = (over: Partial<ItemRow> = {}): ItemRow => ({ ...baseItem, ...over });

export const refundItem = (over: Partial<ItemRow> = {}): ItemRow =>
  itemRow({
    id: 502,
    line_no: 8,
    line_type: "refund",
    line_type_label: { ar: "استرداد", en: "Refund" },
    gateway_ref: "fpay_s1",
    refund_ref: "fref_r3",
    merchant_ref: "01REFR3",
    system_amount_fils: 12000,
    gateway_amount_fils: 12000,
    difference_fils: 0,
    status: "status_mismatch",
    status_label: { ar: "فرق في الحالة", en: "Status differs" },
    reason_code: "refund_open_in_system",
    reason_label: { ar: "استرداد ما زال مفتوحًا لدينا", en: "Refund still open on our side" },
    refund: { id: 9, ulid: "01REFR3", status: "processing", amount_fils: 12000 },
    document_check: "no_credit_note",
    document_check_label: { ar: "لا يوجد إشعار دائن", en: "No credit note" },
    ...over,
  });

export const accepted: AllowedResolution = {
  code: "accepted",
  label: { ar: "مقبول كما هو", en: "Accepted as it is" },
  moves_money: false,
  needs_pair: false,
  needs_reason_code: false,
};
export const confirmed: AllowedResolution = {
  code: "refund_confirmed",
  label: { ar: "تم تأكيد الاسترداد", en: "Refund confirmed" },
  moves_money: true,
  needs_pair: false,
  needs_reason_code: false,
};
export const recorded: AllowedResolution = {
  code: "provider_refund_recorded",
  label: { ar: "سُجّل استرداد المزود", en: "Provider refund recorded" },
  moves_money: true,
  needs_pair: false,
  needs_reason_code: true,
};
export const stray: AllowedResolution = {
  code: "stray_charge_refunded",
  label: { ar: "خصم شارد تم استرداده", en: "Stray charge, refunded" },
  moves_money: false,
  needs_pair: true,
  needs_reason_code: false,
};

export const itemDetail = (row: ItemRow, allowed: AllowedResolution[], over: Partial<ItemDetail> = {}): ItemDetail => ({
  ...row,
  payment_facts: {
    id: 9,
    gateway_payment_ref: "fpay_b3",
    currency: "AED",
    amount_fils: 21900,
    captured_fils: 21900,
    refunded_fils: 0,
    disputed_fils: 0,
    refundable_fils: 21900,
    needs_review: false,
    has_open_refund: false,
  },
  refund_facts: null,
  pair_candidates: [],
  allowed_resolutions: allowed,
  history: [],
  ...over,
});

export const exportRecord = (over: Partial<ExportRecord> = {}): ExportRecord => ({
  id: 7,
  report: "payments",
  report_label: { ar: "المدفوعات", en: "Payments" },
  format: "xlsx",
  status: "ready",
  status_label: { ar: "جاهز", en: "Ready" },
  row_count: 120,
  file_name: "payments_2026-11-01_2026-11-16_20261116-1030.xlsx",
  size_bytes: 20480,
  filters: {},
  created_at: "2026-11-16T06:30:00+00:00",
  finished_at: "2026-11-16T06:30:08+00:00",
  expires_at: "2026-11-17T06:30:08+00:00",
  failure_code: null,
  ...over,
});

export const txn = (over: Partial<WalletTransaction> = {}): WalletTransaction => ({
  id: "01jd0000000000000000000001",
  type: "credit",
  source: "goodwill",
  source_label: { ar: "رصيد ترضية", en: "Goodwill credit" },
  amount_fils: 15000,
  balance_after_fils: 15000,
  remaining_fils: 15000,
  expires_at: "2027-11-16T06:00:00+00:00",
  payment: null,
  refund: null,
  context: null,
  reason_code: "goodwill",
  note: "Late arrival on 14 Nov",
  created_by: { type: "staff", id: 7, name: "Test Accountant" },
  created_at: "2026-11-16T06:00:00+00:00",
  ...over,
});

export const walletPage = (over: Partial<WalletPage["data"]> = {}, rows: WalletTransaction[] = [txn()]): WalletPage => ({
  data: { customer_id: "01C2", currency: "AED", enabled: true, balance_fils: 15000, expiring_30d_fils: 5000, transactions: rows, ...over },
  meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 },
});
