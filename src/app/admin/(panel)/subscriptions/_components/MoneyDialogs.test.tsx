import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { renderWithProviders } from "@/test/render";
import { cancelPlan, subscriptionDetail, subscriptionPeriod } from "@/test/subscriptionFixtures";
import { CancelSubscriptionDialog } from "./CancelSubscriptionDialog";
import { RenewDialog } from "./RenewDialog";
import { ResolveReviewDialog } from "./ResolveReviewDialog";

const api = vi.hoisted(() => {
  const names = ["previewCancel", "cancelSubscription", "previewRenew", "renewSubscription", "resolveCancelReview"];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const sub = subscriptionDetail();
const MANAGER = ["subscriptions.manage"];

function show(ui: (p: { onClose: () => void; onStale: () => void }) => ReactElement, permissions = MANAGER) {
  const onClose = vi.fn();
  const onStale = vi.fn();
  const view = renderWithProviders(ui({ onClose, onStale }), { permissions });
  return { onClose, onStale, user: userEvent.setup(), unmount: view.unmount };
}

describe("A08 cancel dialog", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.previewCancel.mockImplementation(async (_id: number, party: string) =>
      party === "company"
        ? cancelPlan({ party: "company", rule_applied: "company_cancel", compensation: "credit", periods: [{ ...cancelPlan().periods[0], fee_fils: 0, refund_fils: 84000 }], totals: { ...cancelPlan().totals, fee_fils: 0, refund_fils: 84000 } })
        : cancelPlan(),
    );
  });

  it("shows the periods table with paid, refundable, unused, fee, clawback and refund, and the totals", async () => {
    show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    const table = await screen.findByRole("table", { name: "Periods of the cancellation" });
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["AED 960.00", "AED 960.00", "used 1 · left 7", "AED 840.00", "AED 12.00", "AED 0.00", "AED 828.00"]);
    expect(screen.getByText("Cancellation fee")).toBeInTheDocument();
    expect(screen.getByText("Visa •••• 4242")).toBeInTheDocument();
    expect(api.previewCancel).toHaveBeenCalledWith(31, "customer");
  });

  it("previews the company's cancellation with the rule applied and the compensation", async () => {
    const { user } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    await user.click(screen.getByRole("radio", { name: "The company's" }));
    expect(await screen.findByText("Company cancellation rule")).toBeInTheDocument();
    expect(screen.getByText("Credit for the customer")).toBeInTheDocument();
    expect(api.previewCancel).toHaveBeenLastCalledWith(31, "company");
  });

  it("needs a reason, and details for 'other', before it sends anything", async () => {
    const { user } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    expect(await screen.findByText("Choose a reason.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "other");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    expect(await screen.findByText("Write the details (at least 3 characters).")).toBeInTheDocument();
    expect(api.cancelSubscription).not.toHaveBeenCalled();
  });

  it("cancels with the previewed fee, refund and clawback as expected terms, the version and one key", async () => {
    api.cancelSubscription.mockResolvedValue({ data: sub, refunds: [{ ulid: "r1", amount_fils: 82800, status: "pending" }], review_requested: false });
    const { user, onClose } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "customer_request");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, body, version, key] = api.cancelSubscription.mock.calls[0];
    expect([id, version]).toEqual([31, 7]);
    expect(body).toEqual({ party: "customer", reason_code: "customer_request", expected_fee_fils: 1200, expected_refund_fils: 82800, expected_clawback_fils: 0 });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("TRS-7K2M9Q cancelled; refund AED 828.00.")).toBeInTheDocument();
  });

  it("offers the custom refund only with refunds.create, capped by what the periods can give back", async () => {
    const first = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    expect(screen.queryByLabelText("Refund amount (optional)", { exact: false })).not.toBeInTheDocument();
    first.unmount();

    api.cancelSubscription.mockResolvedValue({ data: sub, refunds: [], review_requested: false });
    const { user, onClose } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />, [...MANAGER, "refunds.create"]);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "no_capacity");
    const refund = screen.getByLabelText("Refund amount (optional)", { exact: false });
    await user.type(refund, "1200");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    expect(await screen.findByText("The periods can give back at most AED 960.00.")).toBeInTheDocument();
    expect(api.cancelSubscription).not.toHaveBeenCalled();
    await user.clear(refund);
    await user.type(refund, "500.50");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.cancelSubscription.mock.calls[0][1]).toMatchObject({ refund_fils: 50050, expected_refund_fils: 82800 });
  });

  it("sends a cancellation that needs a review to the review queue, and says so", async () => {
    api.previewCancel.mockResolvedValue(cancelPlan({ review_required: true }));
    api.cancelSubscription.mockResolvedValue({ data: sub, refunds: [], review_requested: true });
    const { user, onClose } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    expect(await screen.findByText(/The policy cannot decide this refund\. The cancellation goes to the finance review queue/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "customer_request");
    await user.click(screen.getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText("The cancellation of TRS-7K2M9Q was sent for review.")).toBeInTheDocument();
  });

  it("tells finance with refunds.create that they can decide the refund now", async () => {
    api.previewCancel.mockResolvedValue(cancelPlan({ review_required: true }));
    show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />, [...MANAGER, "refunds.create"]);
    expect(await screen.findByText(/Type the refund below to cancel now, or leave it empty to send the cancellation to review/)).toBeInTheDocument();
  });

  it("does not send a cancellation the API blocks", async () => {
    api.previewCancel.mockResolvedValue(cancelPlan({ allowed: false, blocked_reason: "visit_in_progress" }));
    const { user } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    expect(await screen.findByText("A visit is under way, so the customer cannot cancel yet.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "customer_request");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    expect(api.cancelSubscription).not.toHaveBeenCalled();
  });

  it("shows the new figures after 409 TERMS_CHANGED, marks what moved and needs a fresh confirm with a new key", async () => {
    const moved = cancelPlan({ totals: { ...cancelPlan().totals, fee_fils: 2400, refund_fils: 81600 }, periods: [{ ...cancelPlan().periods[0], fee_fils: 2400, refund_fils: 81600 }] });
    api.cancelSubscription.mockRejectedValueOnce(apiError(409, "TERMS_CHANGED", { preview: moved, changed: ["fee_fils", "refund_fils"] })).mockResolvedValueOnce({ data: sub, refunds: [], review_requested: false });
    const { user, onClose } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "customer_request");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    expect(await screen.findByText("The terms changed")).toBeInTheDocument();
    const fee = screen.getAllByText("AED 24.00").find((el) => el.closest("[data-changed=true]") || el.getAttribute("class")?.includes("apricot"));
    expect(fee).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel with the new figures" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.cancelSubscription.mock.calls[1][1]).toMatchObject({ expected_fee_fils: 2400, expected_refund_fils: 81600 });
    expect(api.cancelSubscription.mock.calls[1][3]).not.toBe(api.cancelSubscription.mock.calls[0][3]);
  });

  it("maps the refund-permission, verifying and stale answers", async () => {
    api.cancelSubscription.mockRejectedValueOnce(apiError(403, "REFUND_PERMISSION_REQUIRED")).mockRejectedValueOnce(apiError(409, "PAYMENT_VERIFYING")).mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 8 }));
    const { user, onStale, onClose } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "customer_request");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    expect(await screen.findByText(/Typing a refund amount needs the refunds permission/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    expect(await screen.findByText(/payment provider is still checking the payment/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    await waitFor(() => expect(onStale).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the API's refund cap when it refuses the amount", async () => {
    api.cancelSubscription.mockRejectedValue(apiError(422, "REFUND_AMOUNT_INVALID", { max_fils: 40000 }));
    const { user } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />, [...MANAGER, "refunds.create"]);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "customer_request");
    await user.type(screen.getByLabelText("Refund amount (optional)", { exact: false }), "800");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    expect(await screen.findByText("The periods can give back at most AED 400.00.")).toBeInTheDocument();
  });

  it("reads Arabic: the title, the table and the money in the admin's format", async () => {
    const onClose = vi.fn();
    renderWithProviders(<CancelSubscriptionDialog subscription={sub} onClose={onClose} onStale={vi.fn()} />, { permissions: MANAGER, locale: "ar" });
    expect(await screen.findByText("إلغاء TRS-7K2M9Q")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "فترات الإلغاء" });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("828.00 د.إ");
    expect(screen.getByRole("button", { name: "إلغاء الاشتراك" })).toBeInTheDocument();
  });

  it("disables its buttons while the cancellation is on its way", async () => {
    api.cancelSubscription.mockReturnValue(new Promise(() => undefined));
    const { user } = show((p) => <CancelSubscriptionDialog subscription={sub} {...p} />);
    await screen.findByRole("table", { name: "Periods of the cancellation" });
    await user.selectOptions(screen.getByLabelText("Reason", { exact: false }), "customer_request");
    await user.click(screen.getByRole("button", { name: "Cancel the subscription" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
  });
});

const renewPreview = (over: Record<string, unknown> = {}) => ({ amount_fils: 96000, card_label: "Visa •••• 4242", period: { start: "2026-11-29", end: "2026-12-26" }, attempt_no: 2, ...over });
const failing = subscriptionDetail({ status: "renewal_failed", actions: { ...sub.actions, renew: true } });

describe("A08 renew dialog", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.previewRenew.mockResolvedValue(renewPreview());
  });

  it("shows the amount, the card and the period, and charges with expected_amount_fils and one key", async () => {
    api.renewSubscription.mockResolvedValue({ data: failing, payment: { ulid: "p1", status: "captured" } });
    const { user, onClose } = show((p) => <RenewDialog subscription={failing} {...p} />);
    expect(await screen.findByText("AED 960.00")).toBeInTheDocument();
    expect(screen.getByText("Visa •••• 4242")).toBeInTheDocument();
    expect(screen.getByText("Sun, 29 Nov 2026 – Sat, 26 Dec 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Charge the card" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, amount, key] = api.renewSubscription.mock.calls[0];
    expect([id, amount]).toEqual([31, 96000]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows the new amount after 409 TERMS_CHANGED and charges it only on a fresh confirm", async () => {
    api.renewSubscription
      .mockRejectedValueOnce(apiError(409, "TERMS_CHANGED", { preview: renewPreview({ amount_fils: 99000 }), changed: ["amount_fils"] }))
      .mockResolvedValueOnce({ data: failing, payment: { ulid: "p1", status: "pending" } });
    const { user, onClose } = show((p) => <RenewDialog subscription={failing} {...p} />);
    await screen.findByText("AED 960.00");
    await user.click(screen.getByRole("button", { name: "Charge the card" }));
    expect(await screen.findByText("AED 990.00")).toBeInTheDocument();
    expect(screen.getByText("AED 990.00").closest("dd")).toHaveAttribute("data-changed", "true");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Charge the new amount" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.renewSubscription.mock.calls[1][1]).toBe(99000);
    expect(api.renewSubscription.mock.calls[1][2]).not.toBe(api.renewSubscription.mock.calls[0][2]);
    expect(await screen.findByText(/The renewal charge for TRS-7K2M9Q was sent/)).toBeInTheDocument();
  });

  it("does not charge a renewal that could not be priced", async () => {
    api.previewRenew.mockResolvedValue(renewPreview({ amount_fils: null }));
    const { user } = show((p) => <RenewDialog subscription={failing} {...p} />);
    expect(await screen.findByText("The renewal could not be priced, so it cannot be charged.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Charge the card" }));
    expect(api.renewSubscription).not.toHaveBeenCalled();
  });

  it("says no renewal is due when the preview answers 409 RENEWAL_NOT_DUE, and that a charge is in progress", async () => {
    api.previewRenew.mockRejectedValue(apiError(409, "RENEWAL_NOT_DUE"));
    show((p) => <RenewDialog subscription={failing} {...p} />);
    expect(await screen.findByText("No renewal is due to be charged now.")).toBeInTheDocument();
  });

  it("maps 409 RENEWAL_IN_PROGRESS on the charge", async () => {
    api.renewSubscription.mockRejectedValue(apiError(409, "RENEWAL_IN_PROGRESS"));
    const { user } = show((p) => <RenewDialog subscription={failing} {...p} />);
    await screen.findByText("AED 960.00");
    await user.click(screen.getByRole("button", { name: "Charge the card" }));
    expect(await screen.findByText(/already being processed/)).toBeInTheDocument();
  });
});

const review = {
  requested_at: "2026-10-23T10:00:00+00:00",
  reason_code: "customer_request",
  reason_text: "Moving abroad",
  party: "customer",
  decision: null,
  preview: cancelPlan(),
};
const periods = [subscriptionPeriod(), subscriptionPeriod({ id: 202, ulid: "01jper2", sequence: 2, start: "2026-11-29", end: "2026-12-26", refundable_fils: 40000, refunded_fils: 56000 })];
const reviewing = subscriptionDetail({ cancel_review: review as never, periods, actions: { ...sub.actions, resolve_review: true } });

describe("A08 resolve review dialog", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it("shows the request, what each period can give back and fills in the policy's refund", async () => {
    show((p) => <ResolveReviewDialog subscription={reviewing} {...p} />, ["subscriptions.view", "refunds.create"]);
    expect(await screen.findByText("Customer request")).toBeInTheDocument();
    expect(screen.getByText("Moving abroad")).toBeInTheDocument();
    expect(screen.getByText("At most AED 1,360.00 in total.")).toBeInTheDocument();
    expect(screen.getByLabelText("Total refund", { exact: false })).toHaveValue("828.00");
  });

  it("caps the refund by the periods and needs a note", async () => {
    api.resolveCancelReview.mockResolvedValue({ data: sub, refunds: [], review_requested: false });
    const { user, onClose } = show((p) => <ResolveReviewDialog subscription={reviewing} {...p} />, ["subscriptions.view", "refunds.create"]);
    const refund = await screen.findByLabelText("Total refund", { exact: false });
    await user.clear(refund);
    await user.type(refund, "2000");
    await user.click(screen.getByRole("button", { name: "Cancel and refund" }));
    expect(await screen.findByText("The periods can give back at most AED 1,360.00.")).toBeInTheDocument();
    expect(await screen.findByText("Write a note of at least 3 characters.")).toBeInTheDocument();
    expect(api.resolveCancelReview).not.toHaveBeenCalled();
    await user.clear(refund);
    await user.type(refund, "1000");
    await user.type(screen.getByLabelText("Note (kept with the refund)", { exact: false }), "Agreed with the customer");
    await user.click(screen.getByRole("button", { name: "Cancel and refund" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, body, version, key] = api.resolveCancelReview.mock.calls[0];
    expect([id, body, version]).toEqual([31, { refund_fils: 100000, note: "Agreed with the customer" }, 7]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows the API's own cap on 422 REFUND_AMOUNT_INVALID and a closed review on 409", async () => {
    api.resolveCancelReview.mockRejectedValueOnce(apiError(422, "REFUND_AMOUNT_INVALID", { max_fils: 50000 })).mockRejectedValueOnce(apiError(409, "CANCEL_REVIEW_NOT_PENDING"));
    const { user } = show((p) => <ResolveReviewDialog subscription={reviewing} {...p} />, ["subscriptions.view", "refunds.create"]);
    await user.type(await screen.findByLabelText("Note (kept with the refund)", { exact: false }), "Agreed");
    await user.click(screen.getByRole("button", { name: "Cancel and refund" }));
    expect(await screen.findByText("The periods can give back at most AED 500.00.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel and refund" }));
    expect(await screen.findByText("This cancellation review was already closed.")).toBeInTheDocument();
  });
});
