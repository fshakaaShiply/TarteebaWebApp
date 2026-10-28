import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRefund,
  emailInvoice,
  fetchBillingRefusals,
  fetchCreditNotePdf,
  fetchFinanceSummary,
  fetchInvoicePdf,
  fetchInvoices,
  fetchNotificationTemplates,
  fetchPayments,
  fetchRefundReasons,
  previewNotificationTemplate,
  retryBillingRefusal,
  updateNotificationTemplate,
} from "./endpoints";

// Records what each endpoint hands the typed client: path, path/query params, body and headers.
const calls = vi.hoisted(() => ({ list: [] as { method: string; path: string; options: Record<string, unknown> }[] }));

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  const record = (method: string) =>
    vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.list.push({ method, path, options });
      // A list answers with rows (the template list walks its pages), a record with an object.
      const data = path === "/v1/admin/notification-templates" ? [] : { id: 1 };
      return { data: { data, meta: { current_page: 1, per_page: 100, total: 0, last_page: 1 } }, response: new Response(null, { status: 200 }) };
    });
  return {
    ...actual,
    adminApi: { GET: record("GET"), POST: record("POST"), PUT: record("PUT"), PATCH: record("PATCH"), DELETE: record("DELETE") },
  };
});

const last = () => calls.list[calls.list.length - 1];

describe("A09 finance endpoints", () => {
  beforeEach(() => {
    calls.list = [];
  });

  it("sends a refund in fils with its Idempotency-Key", async () => {
    await createRefund(9, { amount_fils: 18000, reason_code: "goodwill", reason_text: null }, "0b6f4f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/payments/{payment}/refunds",
      options: {
        params: { path: { payment: 9 } },
        body: { amount_fils: 18000, reason_code: "goodwill", reason_text: null },
        headers: { "Idempotency-Key": "0b6f4f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b" },
      },
    });
  });

  it("lists payments with the API's filter names, the review flag as 1 and empty filters left out", async () => {
    await fetchPayments({ page: 2, perPage: 25, status: "captured", phone: " 0501 ", needsReview: true, reference: "", payableType: "booking" });
    expect(last().options).toEqual({
      params: { query: { page: 2, per_page: 25, status: "captured", phone: "0501", payable_type: "booking", needs_review: 1 } },
    });
    await fetchPayments({ needsReview: false });
    expect(last().options).toEqual({ params: { query: {} } });
  });

  it("reads the refund reasons and the A09 summary, leaving the API's defaults to the API", async () => {
    await fetchRefundReasons();
    expect(last()).toEqual({ method: "GET", path: "/v1/admin/refund-reasons", options: {} });
    await fetchFinanceSummary({ from: "2026-10-01", to: "2026-10-19", zoneId: 3 });
    expect(last()).toEqual({
      method: "GET",
      path: "/v1/admin/finance/summary",
      options: { params: { query: { from: "2026-10-01", to: "2026-10-19", zone_id: 3 } } },
    });
    // Month to date and every zone: nothing sent.
    await fetchFinanceSummary({ from: undefined, to: undefined, zoneId: null });
    expect(last().options).toEqual({ params: { query: {} } });
  });

  it("finds a customer's or a payment's invoices, asks for signed PDF links and queues the e-mail", async () => {
    await fetchInvoices({ customerId: 2, perPage: 100 });
    expect(last()).toMatchObject({ path: "/v1/admin/invoices", options: { params: { query: { customer_id: 2, per_page: 100 } } } });
    await fetchInvoices({ paymentId: 9, page: 1 });
    expect(last().options).toEqual({ params: { query: { payment_id: 9, page: 1 } } });
    await fetchInvoicePdf(4);
    expect(last()).toEqual({ method: "GET", path: "/v1/admin/invoices/{invoice}/pdf", options: { params: { path: { invoice: 4 } } } });
    await fetchCreditNotePdf(2);
    expect(last()).toEqual({ method: "GET", path: "/v1/admin/credit-notes/{creditNote}/pdf", options: { params: { path: { creditNote: 2 } } } });
    await emailInvoice(4);
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/invoices/{invoice}/email", options: { params: { path: { invoice: 4 } } } });
  });

  it("lists and retries refused documents", async () => {
    await fetchBillingRefusals({ document: "credit_note", paymentId: 7 });
    expect(last().options).toEqual({ params: { query: { document: "credit_note", payment_id: 7 } } });
    await retryBillingRefusal(3);
    expect(last()).toEqual({ method: "POST", path: "/v1/admin/billing-refusals/{refusal}/retry", options: { params: { path: { refusal: 3 } } } });
  });
});

describe("A11 notification template endpoints", () => {
  beforeEach(() => {
    calls.list = [];
  });

  it("walks every page of templates, 100 at a time, with the sibling filters", async () => {
    await fetchNotificationTemplates({ eventKey: "booking.confirmed", audience: "customer", channel: "push" });
    expect(last().options).toEqual({
      params: { query: { event_key: "booking.confirmed", audience: "customer", channel: "push", page: 1, per_page: 100 } },
    });
  });

  it("saves with the loaded version as If-Match and in the body", async () => {
    await updateNotificationTemplate(17, { body: "Hi {{reference}}", reason: "Wording" }, 3);
    expect(last()).toEqual({
      method: "PATCH",
      path: "/v1/admin/notification-templates/{template}",
      options: { params: { path: { template: "17" } }, body: { body: "Hi {{reference}}", reason: "Wording", version: 3 }, headers: { "If-Match": "3" } },
    });
  });

  it("previews a draft with a sample payload map", async () => {
    await previewNotificationTemplate(17, { body: "Draft {{reference}}", payload: { reference: { ar: "TRB-1" } } });
    expect(last()).toEqual({
      method: "POST",
      path: "/v1/admin/notification-templates/{template}/preview",
      options: { params: { path: { template: "17" } }, body: { body: "Draft {{reference}}", payload: { reference: { ar: "TRB-1" } } } },
    });
  });
});
