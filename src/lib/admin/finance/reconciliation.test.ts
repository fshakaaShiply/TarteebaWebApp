import { describe, expect, it } from "vitest";
import { accepted, confirmed, itemDetail, itemRow, recorded, refundItem, stray } from "@/test/financeFixtures";
import { AdminApiError } from "../client";
import {
  ITEM_FILTERS,
  REOPENABLE_RESOLUTIONS,
  RUN_FILTERS,
  anyRunInFlight,
  buildResolveBody,
  documentIssues,
  itemRef,
  itemView,
  runInFlight,
  termsChangedAmount,
} from "./reconciliation";
import { filtersFromParams, filtersToParams } from "./filters";

const values = (over: Partial<Parameters<typeof buildResolveBody>[0]> = {}) => ({ code: "accepted", note: "Checked the statement", paired_item_id: "", refund_reason_code: "", ...over });
const detail = (allowed = [accepted]) => itemDetail(itemRow(), allowed);

describe("buildResolveBody", () => {
  it("builds a note-only resolution without an amount", () => {
    const built = buildResolveBody(values(), detail(), [accepted]);
    expect(built).toMatchObject({ ok: true, body: { resolution_code: "accepted", note: "Checked the statement" } });
    expect(built.ok && built.body.expected_amount_fils).toBeUndefined();
  });

  it("refuses a code the API did not allow for this item, and a missing or too short note", () => {
    expect(buildResolveBody(values({ code: "refund_confirmed" }), detail(), [accepted])).toEqual({ ok: false, error: "code_required" });
    expect(buildResolveBody(values({ note: "  " }), detail(), [accepted])).toEqual({ ok: false, error: "note_required" });
    expect(buildResolveBody(values({ note: "ok" }), detail(), [accepted])).toEqual({ ok: false, error: "note_short" });
    expect(buildResolveBody(values({ note: "x".repeat(1001) }), detail(), [accepted])).toEqual({ ok: false, error: "note_long" });
  });

  it("sends the provider line's amount with the money codes, as the person saw it", () => {
    const item = itemDetail(refundItem(), [confirmed], { refund_facts: { id: 9, ulid: "01REFR3", status: "processing", amount_fils: 12000, currency: "AED", gateway_refund_ref: null, reason_code: "goodwill", needs_review: true, succeeded_at: null, failed_at: null } });
    const built = buildResolveBody(values({ code: "refund_confirmed" }), item, [confirmed]);
    expect(built).toMatchObject({ ok: true, body: { resolution_code: "refund_confirmed", expected_amount_fils: 12000 } });
  });

  it("needs the refund reason for provider_refund_recorded and the pair for a stray charge", () => {
    const item = detail([recorded, stray]);
    expect(buildResolveBody(values({ code: "provider_refund_recorded" }), item, [recorded])).toEqual({ ok: false, error: "reason_required" });
    expect(buildResolveBody(values({ code: "provider_refund_recorded", refund_reason_code: "goodwill" }), item, [recorded])).toMatchObject({
      ok: true,
      body: { refund_reason_code: "goodwill", expected_amount_fils: 22400 },
    });
    expect(buildResolveBody(values({ code: "stray_charge_refunded" }), item, [stray])).toEqual({ ok: false, error: "pair_required" });
    expect(buildResolveBody(values({ code: "stray_charge_refunded", paired_item_id: "77" }), item, [stray])).toMatchObject({ ok: true, body: { paired_item_id: 77 } });
  });
});

describe("helpers", () => {
  it("reads the new amount of a 409 TERMS_CHANGED, and nothing else", () => {
    expect(termsChangedAmount(new AdminApiError(409, { code: "TERMS_CHANGED", message: "", details: { amount_fils: 13000 } }))).toBe(13000);
    expect(termsChangedAmount(new AdminApiError(409, { code: "TERMS_CHANGED", message: "", details: {} }))).toBeNull();
    expect(termsChangedAmount(new AdminApiError(409, { code: "STALE_VERSION", message: "", details: { amount_fils: 1 } }))).toBeNull();
  });

  it("knows which runs are still being read and which resolutions can be taken back", () => {
    expect(runInFlight("pending")).toBe(true);
    expect(runInFlight("processing")).toBe(true);
    expect(runInFlight("completed")).toBe(false);
    expect(anyRunInFlight([{ status: "completed" }, { status: "processing" }])).toBe(true);
    expect(anyRunInFlight(undefined)).toBe(false);
    expect(REOPENABLE_RESOLUTIONS).toEqual(["accepted", "provider_to_correct", "timing"]);
  });

  it("counts the document checks that need a look, and names an item by its first provider reference", () => {
    expect(documentIssues({ ok: 7, invoice_differs: 1, no_credit_note: 2, not_applicable: 4 })).toBe(3);
    expect(documentIssues(undefined)).toBe(0);
    expect(itemRef(itemRow())).toBe("fpay_b3");
    expect(itemRef(refundItem())).toBe("fref_r3");
  });

  it("keeps the runs filters and the items tab in the URL, and ignores what the API doesn't know", () => {
    const params = new URLSearchParams("from=2026-11-01&status=failed&unresolved=1&bogus=1");
    expect(filtersFromParams(RUN_FILTERS, params)).toMatchObject({ from: "2026-11-01", status: "failed", unresolved: "1" });
    expect(filtersFromParams(RUN_FILTERS, new URLSearchParams("status=nope")).status).toBe("");
    const items = filtersFromParams(ITEM_FILTERS, new URLSearchParams("view=documents&status=matched&line_type=refund&q=fpay"));
    expect(items).toMatchObject({ view: "documents", status: "matched", line_type: "refund", q: "fpay" });
    expect(filtersToParams(ITEM_FILTERS, items).toString()).toBe("view=documents&status=matched&line_type=refund&q=fpay");
    expect(itemView("documents")).toBe("documents");
    expect(itemView("")).toBe("differences");
    expect(itemView("zzz")).toBe("differences");
  });
});
