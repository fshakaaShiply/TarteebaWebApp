import { describe, expect, it } from "vitest";
import { attachment, caseDetail, options } from "@/test/qualityFixtures";
import { buildClose, buildNewCase, buildReason, buildReopen, buildReply, buildResolve, canAwaitCustomer, closeReasonsFor, emptyResolve, needsOutcome } from "./forms";

const resolve = (over: Partial<typeof emptyResolve>) => ({ ...emptyResolve, outcome: "upheld", resolution: "We are sorry about the second bathroom.", ...over });

describe("reply", () => {
  const c = caseDetail();
  it("needs text, trims it and sends nothing else by default", () => {
    expect(buildReply({ body: "   ", internal: false, awaitCustomer: false }, c, [])).toEqual({ ok: false, field: "body", error: "required" });
    expect(buildReply({ body: "x".repeat(2001), internal: false, awaitCustomer: false }, c, [])).toMatchObject({ ok: false, error: "too_long" });
    expect(buildReply({ body: "  Hello  ", internal: false, awaitCustomer: false }, c, [])).toEqual({ ok: true, body: { body: "Hello", is_internal: false } });
  });

  it("offers waiting for the customer only with a public reply on a case the customer can see", () => {
    expect(canAwaitCustomer(c, false)).toBe(true);
    expect(canAwaitCustomer(c, true)).toBe(false);
    expect(canAwaitCustomer({ ...c, customer_visible: false }, false)).toBe(false);
    expect(buildReply({ body: "Which room?", internal: false, awaitCustomer: true }, c, [])).toMatchObject({ body: { await_customer: true } });
    // An internal note or a hidden follow-up never carries the flag, even if the box was ticked before.
    expect(buildReply({ body: "Note", internal: true, awaitCustomer: true }, c, [])).toEqual({ ok: true, body: { body: "Note", is_internal: true } });
    expect(buildReply({ body: "Hi", internal: false, awaitCustomer: true }, { ...c, customer_visible: false }, [])).toEqual({ ok: true, body: { body: "Hi", is_internal: false } });
  });

  it("names the uploaded files, and keeps a PDF off a public reply", () => {
    const photo = attachment({ id: "A1" });
    const pdf = attachment({ id: "A2", mime: "application/pdf" });
    expect(buildReply({ body: "See", internal: false, awaitCustomer: false }, c, [photo])).toMatchObject({ body: { attachment_ids: ["A1"] } });
    expect(buildReply({ body: "See", internal: false, awaitCustomer: false }, c, [photo, pdf])).toEqual({ ok: false, field: "files", error: "pdf_public" });
    expect(buildReply({ body: "See", internal: true, awaitCustomer: false }, c, [pdf])).toMatchObject({ ok: true, body: { attachment_ids: ["A2"] } });
  });
});

describe("resolve", () => {
  const c = caseDetail();

  it("needs the outcome of a complaint and a follow-up but not of a support request", () => {
    expect(needsOutcome(c)).toBe(true);
    expect(needsOutcome(caseDetail({ type: "support" }))).toBe(false);
    expect(buildResolve({ ...emptyResolve, resolution: "Sorry" }, c)).toMatchObject({ ok: false, field: "outcome", error: "outcome_required" });
    expect(buildResolve({ ...emptyResolve, resolution: "Sorry" }, caseDetail({ type: "support" })).ok).toBe(true);
  });

  it("needs the customer's text on a visible case and on any compensation, even on a hidden follow-up", () => {
    expect(buildResolve(resolve({ resolution: " " }), c)).toMatchObject({ ok: false, field: "resolution", error: "resolution_required" });
    const hidden = caseDetail({ customer_visible: false, type: "rating_followup" });
    expect(buildResolve(resolve({ resolution: "" }), hidden)).toMatchObject({ ok: true, body: { outcome: "upheld" } });
    expect(buildResolve(resolve({ resolution: "", compensation: "refund", amount: "10" }), hidden)).toMatchObject({ ok: false, field: "resolution" });
  });

  it("proposes a refund in fils, capped by the case's own maximum", () => {
    const built = buildResolve(resolve({ compensation: "refund", amount: "30.00", note: " half a room " }), c);
    expect(built).toEqual({
      ok: true,
      body: { outcome: "upheld", resolution: "We are sorry about the second bathroom.", compensation: { type: "refund", amount_fils: 3000, note: "half a room" } },
      summary: { kind: "refund", amount_fils: 3000 },
    });
    expect(buildResolve(resolve({ compensation: "refund", amount: "120" }), c)).toMatchObject({ ok: true });
    expect(buildResolve(resolve({ compensation: "refund", amount: "120.01" }), c)).toMatchObject({ ok: false, field: "amount", error: "amount_over" });
    expect(buildResolve(resolve({ compensation: "refund", amount: "0" }), c)).toMatchObject({ ok: false, error: "amount_zero" });
    expect(buildResolve(resolve({ compensation: "refund", amount: "" }), c)).toMatchObject({ ok: false, error: "amount_required" });
    expect(buildResolve(resolve({ compensation: "refund", amount: "1.234" }), c)).toMatchObject({ ok: false, error: "amount_precision" });
    expect(buildResolve(resolve({ compensation: "refund", amount: "abc" }), c)).toMatchObject({ ok: false, error: "amount_invalid" });
  });

  it("refuses a compensation the case does not offer", () => {
    const noCredit = caseDetail({ compensation_options: options({ credit: { available: false, max_fils: 0, reason: "wallet_disabled" } }) });
    expect(buildResolve(resolve({ compensation: "credit", amount: "10" }), noCredit)).toMatchObject({ ok: false, field: "compensation", error: "type_unavailable" });
    expect(buildResolve(resolve({ compensation: "refund", amount: "10" }), caseDetail({ compensation_options: null }))).toMatchObject({ ok: false, error: "type_unavailable" });
  });

  it("books a free visit with its date and slot, and no amount", () => {
    expect(buildResolve(resolve({ compensation: "free_visit" }), c)).toMatchObject({ ok: false, field: "freeDate" });
    expect(buildResolve(resolve({ compensation: "free_visit", freeDate: "2026-10-27" }), c)).toMatchObject({ ok: false, field: "freeSlot" });
    expect(buildResolve(resolve({ compensation: "free_visit", freeDate: "2026-10-27", freeSlot: "2", freeWorkers: "1" }), c)).toMatchObject({
      ok: true,
      body: { compensation: { type: "free_visit", free_visit: { date: "2026-10-27", slot_template_id: 2, workers_count: 1 } } },
      summary: { kind: "free_visit", date: "2026-10-27" },
    });
  });
});

describe("close, reopen and reasons", () => {
  it("closes an active case as a duplicate, merged or not actionable, and a resolved one as resolved", () => {
    expect(closeReasonsFor("in_review")).toEqual(["duplicate", "merged", "not_actionable"]);
    expect(closeReasonsFor("resolved")).toEqual(["resolved"]);
    expect(buildClose("duplicate", "open", " same as TC-1 ")).toEqual({ ok: true, body: { status: "closed", close_reason: "duplicate", reason: "same as TC-1" } });
    expect(buildClose("resolved", "open", "")).toMatchObject({ ok: false, field: "reason" });
    expect(buildClose("resolved", "resolved", "")).toEqual({ ok: true, body: { status: "closed", close_reason: "resolved" } });
  });

  it("reopens only with a reason", () => {
    expect(buildReopen("  ")).toEqual({ ok: false, field: "reason", error: "reason_required" });
    expect(buildReopen("Customer called again")).toEqual({ ok: true, body: { status: "in_review", reason: "Customer called again" } });
  });

  it("takes 3 to 500 characters for a rejection or an exclusion", () => {
    expect(buildReason("")).toMatchObject({ error: "reason_required" });
    expect(buildReason("ab")).toMatchObject({ error: "too_short" });
    expect(buildReason("x".repeat(501))).toMatchObject({ error: "too_long" });
    expect(buildReason(" no ")).toBeDefined();
    expect(buildReason(" yes ")).toEqual({ ok: true, body: { reason: "yes" } });
  });
});

describe("a case staff log", () => {
  const target = { customerUlid: "01JC0000000000000000000001", bookingId: 4 };
  const values = { category: "quality", description: "The customer called: the kitchen was left dirty.", priority: "", source: "phone", overrideReason: "" };
  it("sends the customer, the booking and the words, and only the optional fields that were filled", () => {
    expect(buildNewCase(values, target)).toEqual({
      ok: true,
      body: { customer_id: target.customerUlid, booking_id: 4, type: "complaint", category: "quality", description: values.description, source: "phone" },
    });
    expect(buildNewCase({ ...values, priority: "urgent", overrideReason: "Customer was abroad" }, target)).toMatchObject({ body: { priority: "urgent", window_override_reason: "Customer was abroad" } });
  });
  it("checks what the API checks", () => {
    expect(buildNewCase({ ...values, category: "" }, target)).toMatchObject({ ok: false, field: "category" });
    expect(buildNewCase({ ...values, description: "short" }, target)).toMatchObject({ ok: false, field: "description", error: "too_short" });
    expect(buildNewCase({ ...values, description: "" }, target)).toMatchObject({ ok: false, error: "required" });
    expect(buildNewCase({ ...values, source: "app" }, target)).toMatchObject({ ok: false, field: "source" });
    expect(buildNewCase({ ...values, overrideReason: "ab" }, target)).toMatchObject({ ok: false, field: "overrideReason" });
  });
});
