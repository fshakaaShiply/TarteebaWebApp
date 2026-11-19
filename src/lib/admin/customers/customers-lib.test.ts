import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "../client";
import { customerQuery, privacyQuery } from "./filters";
import { FormProblem, NOTE_MAX, REASON_MAX, buildPrivacyRequest, checkNote, checkReason } from "./forms";
import { describeCustomerError, privacyRequestEnded, privacyStateOf } from "./errors";
import { isOpenBooking, isOpenSubscription, customerToneOf, privacyToneOf, isDeletedCustomer } from "./status";

describe("reason and note checks", () => {
  it("needs a reason of 3 to 500 characters, counted without the surrounding spaces", () => {
    expect(checkReason("")).toBe("required");
    expect(checkReason("   ")).toBe("required");
    expect(checkReason(" ab ")).toBe("tooShort");
    expect(checkReason("abc")).toBeNull();
    expect(checkReason("x".repeat(REASON_MAX))).toBeNull();
    expect(checkReason("x".repeat(REASON_MAX + 1))).toBe("tooLong");
    // Arabic text counts characters, not bytes.
    expect(checkReason("سبب")).toBeNull();
  });

  it("needs a note of 1 to 2000 characters", () => {
    expect(checkNote(" ")).toBe("required");
    expect(checkNote("a")).toBeNull();
    expect(checkNote("x".repeat(NOTE_MAX))).toBeNull();
    expect(checkNote("x".repeat(NOTE_MAX + 1))).toBe("tooLong");
  });

  it("carries the field and the problem of an invalid form out of a mutation", () => {
    const problem = new FormProblem("reason", "tooShort");
    expect(problem).toBeInstanceOf(Error);
    expect([problem.field, problem.error]).toEqual(["reason", "tooShort"]);
  });
});

describe("a staff-filed privacy request (P5-C50)", () => {
  it("proves a call by the code the caller read back", () => {
    expect(buildPrivacyRequest({ type: "export", verification: "registered_phone_call", note: "ignored", code: " 482913 ", codeFor: "export" })).toEqual({
      ok: true,
      body: { type: "export", verification: "registered_phone_call", otp_code: "482913" },
    });
    expect(buildPrivacyRequest({ type: "delete", verification: "registered_phone_call", note: "", code: "  ", codeFor: "delete" })).toEqual({ ok: false, field: "code", error: "required" });
    expect(buildPrivacyRequest({ type: "delete", verification: "registered_phone_call", note: "", code: "1".repeat(11), codeFor: "delete" })).toEqual({ ok: false, field: "code", error: "tooLong" });
  });

  it("takes a code only for the request it was sent for: a data copy's code never files a deletion (P5-C121, A4b §12)", () => {
    // The SMS said the code was for a copy of her data; the request is now a deletion.
    expect(buildPrivacyRequest({ type: "delete", verification: "registered_phone_call", note: "", code: "482913", codeFor: "export" })).toEqual({ ok: false, field: "code", error: "notSent" });
    expect(buildPrivacyRequest({ type: "export", verification: "registered_phone_call", note: "", code: "482913", codeFor: "delete" })).toEqual({ ok: false, field: "code", error: "notSent" });
    // A code typed in without one sent from this dialog proves nothing either.
    expect(buildPrivacyRequest({ type: "export", verification: "registered_phone_call", note: "", code: "482913", codeFor: null })).toEqual({ ok: false, field: "code", error: "notSent" });
    expect(buildPrivacyRequest({ type: "delete", verification: "registered_phone_call", note: "", code: "482913", codeFor: "delete" }).ok).toBe(true);
  });

  it("proves a visit or a letter by the reference of the document, 10 to 500 characters", () => {
    const base = { type: "delete", verification: "in_person", codeFor: null } as const;
    expect(buildPrivacyRequest({ ...base, note: "", code: "123456" })).toEqual({ ok: false, field: "note", error: "required" });
    expect(buildPrivacyRequest({ ...base, note: "ID 4321", code: "" })).toEqual({ ok: false, field: "note", error: "tooShort" });
    expect(buildPrivacyRequest({ ...base, note: "x".repeat(501), code: "" })).toEqual({ ok: false, field: "note", error: "tooLong" });
    expect(buildPrivacyRequest({ ...base, note: "  Emirates ID ending 4321  ", code: "999999" })).toEqual({
      ok: true,
      body: { type: "delete", verification: "in_person", verification_note: "Emirates ID ending 4321" },
    });
    expect(buildPrivacyRequest({ type: "export", verification: "written_request", note: "Letter dated 2026-11-02, ref L-77", code: "", codeFor: null }).ok).toBe(true);
  });
});

describe("list filters to API queries", () => {
  it("sends the customer search as q, never as phone", () => {
    const query = customerQuery({ page: 2, q: "", status: "blocked", sort: "name" }, "0559871234", 25);
    expect(query).toEqual({ page: 2, perPage: 25, q: "0559871234", status: "blocked", sort: "name" });
    expect(Object.keys(query)).not.toContain("phone");
    expect(customerQuery({ page: 1, q: "", status: "", sort: "" }, "", 25)).toEqual({ page: 1, perPage: 25, q: undefined, status: undefined, sort: undefined });
  });

  it("opens the privacy queue on the open requests, and lists every status on request", () => {
    expect(privacyQuery({ page: 1, q: "", type: "", status: "" }, "", 25)).toMatchObject({ status: "open", type: undefined });
    expect(privacyQuery({ page: 1, q: "", type: "delete", status: "failed" }, "sara", 25)).toMatchObject({ status: "failed", type: "delete", q: "sara" });
    expect(privacyQuery({ page: 3, q: "", type: "", status: "all" }, "", 25)).toMatchObject({ status: undefined, page: 3 });
  });
});

describe("statuses", () => {
  it("colours a customer's status and a request's status, and reads an unknown one as neutral", () => {
    expect(customerToneOf("active")).toBe("success");
    expect(customerToneOf("blocked")).toBe("danger");
    expect(customerToneOf("pending_deletion")).toBe("pending");
    expect(customerToneOf("deleted")).toBe("neutral");
    expect(customerToneOf("something_new")).toBe("neutral");
    expect(privacyToneOf("failed")).toBe("danger");
    expect(privacyToneOf("completed")).toBe("success");
    expect(privacyToneOf("something_new")).toBe("neutral");
    expect(isDeletedCustomer({ status: "deleted" })).toBe(true);
    expect(isDeletedCustomer({ status: "blocked" })).toBe(false);
  });

  it("calls a booking open from its confirmation request on, but not a checkout hold, and a subscription open once past checkout (P5-C86, P5-C92)", () => {
    for (const status of ["pending_confirmation", "alternative_proposed", "confirmed", "rescheduled"]) expect(isOpenBooking(status), status).toBe(true);
    for (const status of ["held", "draft", "completed", "cancelled", "rejected", "expired"]) expect(isOpenBooking(status), status).toBe(false);
    for (const status of ["pending_confirmation", "active", "paused", "expiring", "renewal_failed", "suspended"]) expect(isOpenSubscription(status), status).toBe(true);
    for (const status of ["pending_payment", "ended", "cancelled", "expired", "rejected"]) expect(isOpenSubscription(status), status).toBe(false);
  });
});

describe("error words", () => {
  const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);
  const fallback = () => "shared";
  const error = (code: string, details: Record<string, unknown> = {}) => new AdminApiError(409, { code, message: "api words", details });

  it("names the status an action does not fit and the proof still missing", () => {
    expect(describeCustomerError(error("INVALID_STATE", { status: "deleted" }), t, fallback)).toBe("invalidState.deleted");
    expect(describeCustomerError(error("INVALID_STATE", { status: "unheard_of" }), t, fallback)).toBe("INVALID_STATE");
    expect(describeCustomerError(error("VERIFICATION_REQUIRED", { required: "otp_code" }), t, fallback)).toBe("verificationRequired.otp_code");
    expect(describeCustomerError(error("VERIFICATION_REQUIRED", {}), t, fallback)).toBe("VERIFICATION_REQUIRED");
  });

  it("puts the attempts left of a wrong code in, and falls back for codes that are not its own", () => {
    expect(describeCustomerError(error("OTP_INVALID", { attempts_left: 2 }), t, fallback)).toBe('OTP_INVALID_left:{"count":2}');
    expect(describeCustomerError(error("OTP_INVALID"), t, fallback)).toBe("OTP_INVALID");
    expect(describeCustomerError(error("ERASURE_STARTED", { processing_started_at: "x" }), t, fallback)).toBe("ERASURE_STARTED");
    expect(describeCustomerError(error("STALE_VERSION"), t, fallback)).toBe("shared");
    expect(describeCustomerError(new Error("boom"), t, fallback)).toBe("shared");
  });

  it("reads the privacy queue's INVALID_STATE as the request's own status, never a customer's", () => {
    expect(privacyStateOf(error("INVALID_STATE", { status: "processing" }))).toBe("processing");
    expect(privacyStateOf(error("INVALID_STATE", { status: "cancelled" }))).toBe("cancelled");
    expect(privacyStateOf(error("INVALID_STATE", { status: "blocked" }))).toBeNull();
    expect(privacyStateOf(error("STALE_VERSION"))).toBeNull();
    expect(privacyRequestEnded(error("INVALID_STATE", { status: "completed" }))).toBe(true);
    expect(privacyRequestEnded(error("ERASURE_STARTED"))).toBe(true);
    expect(privacyRequestEnded(error("STALE_VERSION"))).toBe(false);
  });
});

// ---- endpoints -------------------------------------------------------------------------------------------------------

const calls = vi.hoisted(() => ({ list: [] as { method: string; path: string; options: Record<string, unknown> }[] }));

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  const record = (method: string) =>
    vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.list.push({ method, path, options });
      return { data: { data: { id: "x" }, meta: { current_page: 1, per_page: 25, total: 0, last_page: 1 } }, response: new Response(null, { status: 200 }) };
    });
  return { ...actual, adminApi: { GET: record("GET"), POST: record("POST"), PATCH: record("PATCH"), PUT: record("PUT"), DELETE: record("DELETE") } };
});

describe("A07 endpoints", () => {
  beforeEach(() => {
    calls.list = [];
  });
  const last = () => calls.list[calls.list.length - 1];

  it("searches with q, status and sort, leaving empty ones out", async () => {
    const { fetchCustomers } = await import("./endpoints");
    await fetchCustomers({ page: 2, perPage: 25, q: " sara ", status: "blocked", sort: "" });
    expect(last()).toMatchObject({ method: "GET", path: "/v1/admin/customers", options: { params: { query: { page: 2, per_page: 25, q: "sara", status: "blocked" } } } });
  });

  it("reads a profile and its notes by ULID", async () => {
    const { fetchCustomer, fetchCustomerNotes, addCustomerNote } = await import("./endpoints");
    await fetchCustomer("01JC0000000000000000000001");
    expect(last()).toMatchObject({ path: "/v1/admin/customers/{customer}", options: { params: { path: { customer: "01JC0000000000000000000001" } } } });
    await fetchCustomerNotes("01JC0000000000000000000001", { page: 2, perPage: 20 });
    expect(last().options).toMatchObject({ params: { query: { page: 2, per_page: 20 } } });
    await addCustomerNote("01JC0000000000000000000001", "Call after 4");
    expect(last()).toMatchObject({ method: "POST", path: "/v1/admin/customers/{customer}/notes", options: { body: { body: "Call after 4" } } });
  });

  it("sends a block, unblock and address block with the reason and the record's version as If-Match", async () => {
    const { blockCustomer, unblockCustomer, blockAddress, unblockAddress, optOutMarketing } = await import("./endpoints");
    await blockCustomer("01JC", " Abuse ", 5);
    expect(last()).toMatchObject({ method: "POST", path: "/v1/admin/customers/{customer}/block", options: { body: { reason: "Abuse" }, headers: { "If-Match": "5" } } });
    await unblockCustomer("01JC", "Resolved", 6);
    expect(last()).toMatchObject({ path: "/v1/admin/customers/{customer}/unblock", options: { headers: { "If-Match": "6" } } });
    await blockAddress("01JA", "Guard", 4);
    expect(last()).toMatchObject({ path: "/v1/admin/addresses/{address}/block", options: { params: { path: { address: "01JA" } }, headers: { "If-Match": "4" } } });
    await unblockAddress("01JA", "Fine now", 5);
    expect(last().path).toBe("/v1/admin/addresses/{address}/unblock");
    // The opt-out is no version change: no If-Match.
    await optOutMarketing("01JC", "Asked by phone");
    expect(last()).toMatchObject({ path: "/v1/admin/customers/{customer}/marketing-opt-out", options: { body: { reason: "Asked by phone" } } });
    expect(last().options.headers).toBeUndefined();
  });

  it("reads another module's list through the profile's link, with the link's own parameters", async () => {
    const { fetchLinked } = await import("./endpoints");
    await fetchLinked({ path: "/api/v1/admin/bookings", params: { customer_id: "01JC" } }, { perPage: 5, extra: { kind: "single" } });
    expect(last()).toMatchObject({ method: "GET", path: "/v1/admin/bookings", options: { params: { query: { customer_id: "01JC", kind: "single", per_page: 5 } } } });
    await fetchLinked({ path: "/api/v1/admin/payments", params: { customer_id: "01JC" } }, { page: 3, perPage: 10 });
    expect(last().path).toBe("/v1/admin/payments");
    expect(last().options).toMatchObject({ params: { query: { page: 3, per_page: 10 } } });
  });

  it("sends the privacy calls: the staff code names its type, a cancel carries the request's version", async () => {
    const { sendPrivacyOtp, createPrivacyRequest, fetchPrivacyRequests, cancelPrivacyRequest, retryPrivacyRequest, fetchDeletionImpact } = await import("./endpoints");
    await sendPrivacyOtp("01JC", "export");
    expect(last()).toMatchObject({ path: "/v1/admin/customers/{customer}/privacy-requests/otp", options: { body: { type: "export" } } });
    await createPrivacyRequest("01JC", { type: "delete", verification: "in_person", verification_note: "Emirates ID ending 4321" });
    expect(last()).toMatchObject({ path: "/v1/admin/customers/{customer}/privacy-requests", options: { body: { type: "delete", verification: "in_person", verification_note: "Emirates ID ending 4321" } } });
    await fetchPrivacyRequests({ page: 1, perPage: 25, status: "open", type: "delete", q: " sara " });
    expect(last()).toMatchObject({ path: "/v1/admin/privacy-requests", options: { params: { query: { page: 1, per_page: 25, type: "delete", status: "open", q: "sara" } }, headers: {} } });
    await cancelPrivacyRequest(21, " Customer called ", 3);
    expect(last()).toMatchObject({ path: "/v1/admin/privacy-requests/{privacyRequest}/cancel", options: { params: { path: { privacyRequest: 21 } }, body: { reason: "Customer called" }, headers: { "If-Match": "3" } } });
    await retryPrivacyRequest(21, 4);
    expect(last()).toMatchObject({ path: "/v1/admin/privacy-requests/{privacyRequest}/retry", options: { headers: { "If-Match": "4" } } });
    await fetchDeletionImpact("01JC");
    expect(last().path).toBe("/v1/admin/customers/{customer}/deletion-impact");
  });

  it("reads one privacy request by its id", async () => {
    const { fetchPrivacyRequest } = await import("./endpoints");
    await fetchPrivacyRequest(21);
    expect(last()).toMatchObject({ method: "GET", path: "/v1/admin/privacy-requests/{privacyRequest}", options: { params: { path: { privacyRequest: 21 } } } });
  });
});
