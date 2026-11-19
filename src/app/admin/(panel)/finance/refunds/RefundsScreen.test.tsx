import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBuiltAdminPage } from "@/lib/admin/alerts";
import { AdminApiError } from "@/lib/admin/client";
import type { AdminRefund } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { RefundsScreen } from "./RefundsScreen";

const url = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set(next: string) {
      params = new URLSearchParams(next);
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/admin/finance/refunds",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = {
  fetchRefunds: vi.fn(),
  fetchRefundReasons: vi.fn(),
  recordRefundOutcome: vi.fn(),
  reinstateRefund: vi.fn(),
  clearRefundReview: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchRefunds: (...a: unknown[]) => api.fetchRefunds(...a),
  fetchRefundReasons: (...a: unknown[]) => api.fetchRefundReasons(...a),
}));
vi.mock("@/lib/admin/finance/endpoints", () => ({
  recordRefundOutcome: (...a: unknown[]) => api.recordRefundOutcome(...a),
  reinstateRefund: (...a: unknown[]) => api.reinstateRefund(...a),
  clearRefundReview: (...a: unknown[]) => api.clearRefundReview(...a),
  createExport: vi.fn(),
  fetchExport: vi.fn(),
  fetchExportUrl: vi.fn(),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const page = (rows: AdminRefund[]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });
const NOT_PAID = { ar: "لم يؤكد المزود الاسترداد", en: "The provider has not confirmed this refund" };

const refund = (over: Partial<AdminRefund> = {}): AdminRefund =>
  ({
    id: 3,
    ulid: "01R3",
    amount_fils: 18000,
    currency: "AED",
    status: "succeeded",
    status_label: { ar: "تم الاسترداد", en: "Refunded" },
    reason_code: "goodwill",
    reason_label: { ar: "بادرة حسن نية", en: "Goodwill gesture" },
    reason_text: null,
    requested_by: { type: "staff", id: 4, name: "Test Accountant" },
    gateway: "fake",
    destination: "card",
    context: null,
    gateway_refund_ref: "fref_3",
    failure_code: null,
    failure_message: null,
    credit_note_id: null,
    credit_note: null,
    estimated_arrival_text: null,
    needs_review: false,
    review: { reason: null, reason_label: null, cleared_at: null, cleared_by: null, note: null },
    version: 6,
    created_at: "2026-10-23T17:40:00+00:00",
    submitted_at: null,
    succeeded_at: "2026-10-23T17:41:00+00:00",
    failed_at: null,
    last_checked_at: null,
    payment: { id: 9, ulid: "01P9", status: "partially_refunded", gateway_payment_ref: "fpay_9", payable_type: "booking", payable_id: 9 },
    customer: { id: 2, ulid: "01C2", name: "Omar Khalid", phone: "+971500000002" },
    ...over,
  }) as AdminRefund;

const flaggedOpen = refund({
  id: 11,
  ulid: "01R11",
  status: "processing",
  status_label: { ar: "قيد المعالجة", en: "Processing" },
  gateway_refund_ref: null,
  succeeded_at: null,
  needs_review: true,
  review: { reason: "still_open", reason_label: NOT_PAID, cleared_at: null, cleared_by: null, note: null },
});
const failedPaid = refund({
  id: 12,
  ulid: "01R12",
  status: "failed",
  status_label: { ar: "تعذر الاسترداد", en: "Refund failed" },
  failure_code: "card_expired",
  needs_review: true,
  succeeded_at: null,
  failed_at: "2026-10-23T17:50:00+00:00",
  review: { reason: "refund_succeeded_reported_after_failed", reason_label: { ar: "أبلغ المزود أنه دفعه بعد تعذره", en: "The provider reported it paid after it failed" }, cleared_at: null, cleared_by: null, note: null },
});

beforeEach(() => {
  url.set("");
  Object.values(api).forEach((fn) => fn.mockReset());
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchRefunds.mockResolvedValue(page([refund()]));
  api.fetchRefundReasons.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

const ACCOUNTANT = ["payments.view", "refunds.create", "reconciliation.run"];
const open = (permissions: readonly string[] = ACCOUNTANT, locale: "en" | "ar" = "en") => renderWithProviders(<RefundsScreen />, { permissions, locale });

describe("A09 refunds list: destination and context", () => {
  it("shows where each refund went and what it compensates, with the link only for a person the API gave one", async () => {
    api.fetchRefunds.mockResolvedValue(
      page([
        refund(),
        refund({
          id: 4,
          ulid: "01R4",
          destination: "wallet",
          gateway: "wallet",
          gateway_refund_ref: null,
          context: { type: "complaint", id: 41, reference: "TC-ABC123", link: { list: "complaint", path: "/api/v1/admin/complaints/41", params: {} } },
        }),
        refund({ id: 5, ulid: "01R5", context: { type: "complaint", id: 42, reference: "TC-NOLINK", link: null } }),
      ]),
    );
    open();
    await screen.findAllByText("Goodwill gesture");
    const rows = within(screen.getByRole("table", { name: "Refunds" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Card");
    expect(rows[2]).toHaveTextContent("Tarteeba balance");
    expect(rows[2]).toHaveTextContent("Complaint TC-ABC123");
    const link = within(rows[2]).queryByRole("link", { name: "Complaint TC-ABC123" });
    expect(Boolean(link)).toBe(isBuiltAdminPage("/admin/quality/41"));
    expect(rows[3]).toHaveTextContent("Complaint TC-NOLINK");
    expect(within(rows[3]).queryByRole("link", { name: /TC-NOLINK/ })).not.toBeInTheDocument();
  });

  it("filters by destination and by what it was for, with the API's own parameter names", async () => {
    const user = userEvent.setup();
    open();
    await screen.findAllByText("Goodwill gesture");
    await user.selectOptions(screen.getByLabelText("Where it went"), "wallet");
    await waitFor(() => expect(api.fetchRefunds).toHaveBeenLastCalledWith(expect.objectContaining({ destination: "wallet" })));
    await user.selectOptions(screen.getByLabelText("What for"), "complaint");
    await waitFor(() => expect(api.fetchRefunds).toHaveBeenLastCalledWith(expect.objectContaining({ destination: "wallet", contextType: "complaint" })));
    expect(url.get().get("destination")).toBe("wallet");
    expect(url.get().get("context_type")).toBe("complaint");
  });

  it("marks a refund whose review was cleared", async () => {
    api.fetchRefunds.mockResolvedValue(page([refund({ review: { reason: "still_open", reason_label: null, cleared_at: "2026-11-18T08:00:00+00:00", cleared_by: 4, note: "ok" } })]));
    open();
    expect(await screen.findByText(/Review cleared/)).toBeInTheDocument();
  });

  it("reads in Arabic", async () => {
    api.fetchRefunds.mockResolvedValue(page([refund({ destination: "wallet", gateway: "wallet" })]));
    open(ACCOUNTANT, "ar");
    expect(await screen.findByText("رصيد ترتيبة")).toBeInTheDocument();
    expect(screen.getByLabelText("وجهة المبلغ")).toBeInTheDocument();
  });
});

describe("A09 refunds list: row actions", () => {
  it("offers each action only where it applies: record the answer on a flagged open refund, 'paid after all' on a failed one flagged so, clear on a final one", async () => {
    api.fetchRefunds.mockResolvedValue(page([flaggedOpen, failedPaid, refund({ id: 13, ulid: "01R13", needs_review: true, review: { reason: "refund_exceeds_capture", reason_label: null, cleared_at: null, cleared_by: null, note: null } }), refund()]));
    open();
    await screen.findAllByText("Goodwill gesture");
    const rows = within(screen.getByRole("table", { name: "Refunds" })).getAllByRole("row");
    expect(within(rows[1]).getByRole("button", { name: /Record provider answer/ })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole("button", { name: /Clear flag/ })).not.toBeInTheDocument();
    expect(within(rows[2]).getByRole("button", { name: /Provider paid after all/ })).toBeInTheDocument();
    expect(within(rows[2]).getByRole("button", { name: /Clear flag/ })).toBeInTheDocument();
    expect(within(rows[3]).getByRole("button", { name: /Clear flag/ })).toBeInTheDocument();
    expect(within(rows[3]).queryByRole("button", { name: /Provider paid after all/ })).not.toBeInTheDocument();
    expect(within(rows[4]).queryAllByRole("button")).toHaveLength(0);
  });

  it("offers none of them for a refund to the customer's balance, and none without the permission", async () => {
    api.fetchRefunds.mockResolvedValue(page([{ ...flaggedOpen, id: 14, ulid: "01R14", destination: "wallet", gateway: "wallet" } as AdminRefund, flaggedOpen]));
    const { unmount } = open();
    await screen.findAllByText("Goodwill gesture");
    const rows = within(screen.getByRole("table", { name: "Refunds" })).getAllByRole("row");
    expect(within(rows[1]).queryAllByRole("button")).toHaveLength(0);
    expect(within(rows[2]).getByRole("button", { name: /Record provider answer/ })).toBeInTheDocument();
    unmount();
    open(["payments.view"]);
    await screen.findAllByText("Goodwill gesture");
    expect(screen.queryByRole("button", { name: /Record provider answer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear flag/ })).not.toBeInTheDocument();
  });

  it("clears the flag of a final refund with a note, sending the refund's version", async () => {
    api.fetchRefunds.mockResolvedValue(page([refund({ needs_review: true, review: { reason: "refund_exceeds_capture", reason_label: null, cleared_at: null, cleared_by: null, note: null } })]));
    api.clearRefundReview.mockResolvedValue(refund());
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /Clear flag/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Note/), "Checked the capture");
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    await waitFor(() => expect(api.clearRefundReview).toHaveBeenCalledWith(3, "Checked the capture", 6));
    expect(await screen.findByText("The refund's review flag was cleared.")).toBeInTheDocument();
  });
});

describe("recording the provider's answer", () => {
  async function openOutcome(refundRow = flaggedOpen) {
    api.fetchRefunds.mockResolvedValue(page([refundRow]));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /Record provider answer/ }));
    return { user, dialog: await screen.findByRole("dialog") };
  }

  it("records a paid refund with the provider's reference after confirming the amount, with a key and the version", async () => {
    api.recordRefundOutcome.mockResolvedValue(refund({ id: 11, status: "succeeded" }));
    const { user, dialog } = await openOutcome();
    // The refund's facts first.
    expect(dialog).toHaveTextContent("AED 180.00");
    expect(dialog).toHaveTextContent("The provider has not confirmed this refund");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByText("Write a note.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Note/), "Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByText("Enter the provider's refund reference.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Provider's refund reference/), "fref_11");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Second step: nothing sent yet, the exact amount on the button.
    expect(api.recordRefundOutcome).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/The refund becomes paid and its credit note is issued/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    await waitFor(() => expect(api.recordRefundOutcome).toHaveBeenCalledTimes(1));
    const [id, body, version, key] = api.recordRefundOutcome.mock.calls[0];
    expect([id, version]).toEqual([11, 6]);
    expect(body).toEqual({ status: "succeeded", provider_refund_ref: "fref_11", note: "Seen on the provider statement" });
    expect(key).toMatch(UUID);
    expect(await screen.findByText("Recorded. Refund status: Refunded.")).toBeInTheDocument();
  });

  it("records a declined refund with the provider's failure code", async () => {
    api.recordRefundOutcome.mockResolvedValue(refund({ id: 11, status: "failed", status_label: { ar: "تعذر الاسترداد", en: "Refund failed" } }));
    const { user, dialog } = await openOutcome();
    await user.click(within(dialog).getByRole("radio", { name: "The provider declined the refund" }));
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider declined by e-mail");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByText("Enter the provider's failure code.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Provider's failure code/), "card_expired");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Record as declined" }));
    await waitFor(() => expect(api.recordRefundOutcome).toHaveBeenCalledTimes(1));
    expect(api.recordRefundOutcome.mock.calls[0][1]).toEqual({ status: "failed", failure_code: "card_expired", note: "Provider declined by e-mail" });
  });

  it("doesn't ask for a reference when the refund already has one", async () => {
    const { user, dialog } = await openOutcome({ ...flaggedOpen, gateway_refund_ref: "fref_have" } as AdminRefund);
    await user.type(within(dialog).getByLabelText(/^Note/), "Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" })).toBeInTheDocument();
  });

  it("says in words why the API refused: a reference already booked, an automatic balance refund", async () => {
    const { user, dialog } = await openOutcome({ ...flaggedOpen, gateway_refund_ref: "fref_have" } as AdminRefund);
    await user.type(within(dialog).getByLabelText(/^Note/), "Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.recordRefundOutcome.mockRejectedValueOnce(new AdminApiError(409, { code: "PROVIDER_REF_IN_USE", message: "x", details: { refund: { id: 1, ulid: "u", status: "succeeded" } } }));
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    expect(await within(dialog).findByText("That provider reference is already booked on another refund. One provider refund is booked only once.")).toBeInTheDocument();
    api.recordRefundOutcome.mockRejectedValueOnce(new AdminApiError(409, { code: "WALLET_REFUND_AUTOMATIC", message: "x", details: {} }));
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    expect(await within(dialog).findByText(/credited automatically/)).toBeInTheDocument();
  });

  it("after 409 STALE_VERSION shows the refund as the list reads it now and sends its new version on the next confirmation", async () => {
    const { user, dialog } = await openOutcome({ ...flaggedOpen, gateway_refund_ref: "fref_have" } as AdminRefund);
    await user.type(within(dialog).getByLabelText(/^Note/), "Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    // A provider's answer changed the refund meanwhile (another reference, version 7): the list reads it again.
    api.fetchRefunds.mockResolvedValue(page([{ ...flaggedOpen, gateway_refund_ref: "fref_new", version: 7 } as AdminRefund]));
    api.recordRefundOutcome.mockRejectedValueOnce(new AdminApiError(409, { code: "STALE_VERSION", message: "x", details: {} })).mockResolvedValue(refund({ id: 11 }));
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    // Back to the facts, now the new ones, and asked to check them before confirming again.
    expect(await within(dialog).findByText("Nothing was saved. Its latest details are shown here: check them, then confirm again.")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("This refund changed meanwhile");
    expect(dialog).toHaveTextContent("fref_new");
    expect(within(dialog).getByLabelText(/^Note/)).toHaveValue("Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    await waitFor(() => expect(api.recordRefundOutcome).toHaveBeenCalledTimes(2));
    expect(api.recordRefundOutcome.mock.calls.map((c) => c[2])).toEqual([6, 7]);
    expect(api.recordRefundOutcome.mock.calls[1][3]).not.toBe(api.recordRefundOutcome.mock.calls[0][3]);
    expect(await screen.findByText("Recorded. Refund status: Refunded.")).toBeInTheDocument();
  });

  it("says the action no longer applies when the provider settled the refund meanwhile (409 REFUND_NOT_OPEN)", async () => {
    const { user, dialog } = await openOutcome({ ...flaggedOpen, gateway_refund_ref: "fref_have" } as AdminRefund);
    await user.type(within(dialog).getByLabelText(/^Note/), "Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.fetchRefunds.mockResolvedValue(page([refund({ id: 11, ulid: "01R11", version: 7 })]));
    api.recordRefundOutcome.mockRejectedValueOnce(new AdminApiError(409, { code: "REFUND_NOT_OPEN", message: "x", details: { status: "succeeded" } }));
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    expect(await within(dialog).findByText("Nothing was saved. This refund no longer needs this action, so close this window.")).toBeInTheDocument();
    // The facts are the refund's status now (paid), and nothing more can be sent.
    expect(dialog).toHaveTextContent("Refunded");
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(api.recordRefundOutcome).toHaveBeenCalledTimes(1);
  });

  it("can't show the refund again once the list leaves it out, and sends nothing more", async () => {
    url.set("needs_review=1");
    const { user, dialog } = await openOutcome({ ...flaggedOpen, gateway_refund_ref: "fref_have" } as AdminRefund);
    await user.type(within(dialog).getByLabelText(/^Note/), "Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Its flag was cleared meanwhile: the "needs review" list no longer holds it.
    api.fetchRefunds.mockResolvedValue(page([]));
    api.recordRefundOutcome.mockRejectedValueOnce(new AdminApiError(409, { code: "NOT_FLAGGED", message: "x", details: {} }));
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    expect(await within(dialog).findByText(/its latest details can't be shown here: it may no longer match this list's filters/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("keeps the same key after a lost answer, so a repeat never records twice", async () => {
    api.recordRefundOutcome.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue(refund({ id: 11 }));
    const { user, dialog } = await openOutcome({ ...flaggedOpen, gateway_refund_ref: "fref_have" } as AdminRefund);
    await user.type(within(dialog).getByLabelText(/^Note/), "Seen on the provider statement");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    expect(await within(dialog).findByText("We don't know yet whether this was saved")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Record as paid (AED 180.00)" }));
    await waitFor(() => expect(api.recordRefundOutcome).toHaveBeenCalledTimes(2));
    expect(api.recordRefundOutcome.mock.calls[1][3]).toBe(api.recordRefundOutcome.mock.calls[0][3]);
  });
});

describe("Provider paid after all", () => {
  async function openReinstate() {
    api.fetchRefunds.mockResolvedValue(page([failedPaid]));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /Provider paid after all/ }));
    return { user, dialog: await screen.findByRole("dialog") };
  }

  it("confirms the refund's own amount, with an optional reference, and sends the key and the version", async () => {
    api.reinstateRefund.mockResolvedValue(refund({ id: 12 }));
    const { user, dialog } = await openReinstate();
    expect(dialog).toHaveTextContent("card_expired");
    expect(dialog).toHaveTextContent("The provider reported it paid after it failed");
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider statement of 23 Oct");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(api.reinstateRefund).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Record AED 180.00 as paid" }));
    await waitFor(() => expect(api.reinstateRefund).toHaveBeenCalledTimes(1));
    const [id, body, version, key] = api.reinstateRefund.mock.calls[0];
    expect([id, version]).toEqual([12, 6]);
    expect(body).toEqual({ expected_amount_fils: 18000, note: "Provider statement of 23 Oct" });
    expect(key).toMatch(UUID);
    expect(await screen.findByText("Recorded: the refund of AED 180.00 is paid.")).toBeInTheDocument();
  });

  it("shows the new amount, marked, and asks again when the amount moved (409 TERMS_CHANGED)", async () => {
    api.reinstateRefund
      .mockRejectedValueOnce(new AdminApiError(409, { code: "TERMS_CHANGED", message: "x", details: { amount_fils: 15000 } }))
      .mockResolvedValue(refund({ id: 12, amount_fils: 15000 }));
    const { user, dialog } = await openReinstate();
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider statement of 23 Oct");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Record AED 180.00 as paid" }));
    expect(await within(dialog).findByText("The amount changed")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The refund's amount is now AED 150.00 (it was AED 180.00). Check it, then confirm again.");
    expect(api.reinstateRefund).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Record AED 150.00 as paid" }));
    await waitFor(() => expect(api.reinstateRefund).toHaveBeenCalledTimes(2));
    expect(api.reinstateRefund.mock.calls[1][1].expected_amount_fils).toBe(15000);
    expect(api.reinstateRefund.mock.calls[1][3]).not.toBe(api.reinstateRefund.mock.calls[0][3]);
  });

  it("says why the API refused when the reference is already booked", async () => {
    const { user, dialog } = await openReinstate();
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider statement of 23 Oct");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.reinstateRefund.mockRejectedValueOnce(new AdminApiError(409, { code: "PROVIDER_REF_IN_USE", message: "x", details: {} }));
    await user.click(within(dialog).getByRole("button", { name: "Record AED 180.00 as paid" }));
    expect(await within(dialog).findByText(/already booked on another refund/)).toBeInTheDocument();
  });

  it("after 409 NOT_FLAGGED shows the refund as it is now and offers nothing more (someone cleared its flag)", async () => {
    const { user, dialog } = await openReinstate();
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider statement of 23 Oct");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.fetchRefunds.mockResolvedValue(
      page([{ ...failedPaid, needs_review: false, version: 7, review: { ...failedPaid.review!, cleared_at: "2026-10-23T18:00:00+00:00", cleared_by: 4, note: "Checked" } } as AdminRefund]),
    );
    api.reinstateRefund.mockRejectedValueOnce(new AdminApiError(409, { code: "NOT_FLAGGED", message: "x", details: {} }));
    await user.click(within(dialog).getByRole("button", { name: "Record AED 180.00 as paid" }));
    expect(await within(dialog).findByText("Nothing was saved. This refund no longer needs this action, so close this window.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(api.reinstateRefund).toHaveBeenCalledTimes(1);
  });

  it("after 409 STALE_VERSION confirms again with the refund's new version and a new key", async () => {
    const { user, dialog } = await openReinstate();
    await user.type(within(dialog).getByLabelText(/^Note/), "Provider statement of 23 Oct");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.fetchRefunds.mockResolvedValue(page([{ ...failedPaid, version: 8 } as AdminRefund]));
    api.reinstateRefund.mockRejectedValueOnce(new AdminApiError(409, { code: "STALE_VERSION", message: "x", details: {} })).mockResolvedValue(refund({ id: 12 }));
    await user.click(within(dialog).getByRole("button", { name: "Record AED 180.00 as paid" }));
    expect(await within(dialog).findByText(/Its latest details are shown here: check them, then confirm again/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Record AED 180.00 as paid" }));
    await waitFor(() => expect(api.reinstateRefund).toHaveBeenCalledTimes(2));
    expect(api.reinstateRefund.mock.calls.map((c) => c[2])).toEqual([6, 8]);
    expect(api.reinstateRefund.mock.calls[1][3]).not.toBe(api.reinstateRefund.mock.calls[0][3]);
  });
});

describe("clearing a refund's flag from the list after it moved", () => {
  it("after 409 STALE_VERSION sends the refund's new version on the next confirmation", async () => {
    const flaggedFinal = refund({ needs_review: true, review: { reason: "refund_exceeds_capture", reason_label: null, cleared_at: null, cleared_by: null, note: null } });
    api.fetchRefunds.mockResolvedValue(page([flaggedFinal]));
    api.clearRefundReview.mockRejectedValueOnce(new AdminApiError(409, { code: "STALE_VERSION", message: "x", details: {} })).mockResolvedValue(refund());
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: /Clear flag/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Note/), "Checked the capture");
    api.fetchRefunds.mockResolvedValue(page([{ ...flaggedFinal, version: 9 } as AdminRefund]));
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    expect(await within(dialog).findByText(/The refund has been read again: if you still want to clear its flag, confirm again/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Clear flag" }));
    await waitFor(() => expect(api.clearRefundReview).toHaveBeenCalledTimes(2));
    expect(api.clearRefundReview.mock.calls.map((c) => c[2])).toEqual([6, 9]);
    expect(await screen.findByText("The refund's review flag was cleared.")).toBeInTheDocument();
  });

  it("reads in Arabic", async () => {
    const flaggedFinal = refund({ needs_review: true, review: { reason: "refund_exceeds_capture", reason_label: null, cleared_at: null, cleared_by: null, note: null } });
    api.fetchRefunds.mockResolvedValue(page([flaggedFinal]));
    api.clearRefundReview.mockRejectedValueOnce(new AdminApiError(409, { code: "NOT_FLAGGED", message: "x", details: {} }));
    const user = userEvent.setup();
    open(ACCOUNTANT, "ar");
    await user.click(await screen.findByRole("button", { name: /إزالة العلامة/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^الملاحظة/), "راجعت المبلغ");
    api.fetchRefunds.mockResolvedValue(page([refund({ version: 9 })]));
    await user.click(within(dialog).getByRole("button", { name: "إزالة العلامة" }));
    expect(await within(dialog).findByText("لم يُحفظ شيء. لم يعد هذا الاسترداد يحتاج إلى هذا الإجراء، فأغلق هذه النافذة.")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("تغيّر هذا الاسترداد في هذه الأثناء");
  });
});
