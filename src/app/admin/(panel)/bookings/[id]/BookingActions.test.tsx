import type { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { AlternativesPreview, CancelPreview, ReschedulePreview } from "@/lib/admin/types";
import { bookingDetail, serviceOptions, slotTemplateOptions, visitCandidates, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { BookingDetailScreen } from "./BookingDetailScreen";

const api = {
  fetchBooking: vi.fn(),
  confirmBooking: vi.fn(),
  rejectBooking: vi.fn(),
  proposeAlternatives: vi.fn(),
  previewAlternatives: vi.fn(),
  previewCancellation: vi.fn(),
  cancelBooking: vi.fn(),
  previewReschedule: vi.fn(),
  rescheduleBooking: vi.fn(),
  fetchVisitCandidates: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBooking: (...a: unknown[]) => api.fetchBooking(...a),
  confirmBooking: (...a: unknown[]) => api.confirmBooking(...a),
  rejectBooking: (...a: unknown[]) => api.rejectBooking(...a),
  proposeAlternatives: (...a: unknown[]) => api.proposeAlternatives(...a),
  previewAlternatives: (...a: unknown[]) => api.previewAlternatives(...a),
  previewCancellation: (...a: unknown[]) => api.previewCancellation(...a),
  cancelBooking: (...a: unknown[]) => api.cancelBooking(...a),
  previewReschedule: (...a: unknown[]) => api.previewReschedule(...a),
  rescheduleBooking: (...a: unknown[]) => api.rescheduleBooking(...a),
  fetchVisitCandidates: (...a: unknown[]) => api.fetchVisitCandidates(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchSlotTemplateOptions: async () => slotTemplateOptions,
}));

const apiError = (status: number, code: string, details: Record<string, unknown> = {}, message = "") => new AdminApiError(status, { code, message, details });

const COORDINATOR = [
  "bookings.view",
  "bookings.confirm",
  "bookings.reject",
  "bookings.propose_alternative",
  "bookings.reschedule",
  "bookings.cancel",
  "assignments.manage",
];

const consoleError = vi.spyOn(console, "error");

let lastClient: QueryClient | null = null;
/** The query cache of the last screen openAction rendered (to load a newer booking underneath a dialog). */
const queryClient = () => lastClient!;

async function openAction(name: string, permissions: string[] = COORDINATOR) {
  const user = userEvent.setup();
  lastClient = renderWithProviders(<BookingDetailScreen id="4" />, { permissions }).queryClient;
  await user.click(await screen.findByRole("button", { name }));
  return user;
}

const plan = (over: Partial<CancelPreview> = {}): CancelPreview => ({
  allowed: true,
  mode: "refund",
  fee_fils: 0,
  kept_fees_fils: 0,
  refund_fils: 24000,
  paid_fils: 24000,
  held_fils: 0,
  requires_review: false,
  rule_applied: "full_refund",
  explanation: { ar: "…", en: "Full refund." },
  ...over,
});

const moveTerms = (over: Partial<ReschedulePreview> = {}): ReschedulePreview => ({
  allowed: true,
  blockers: [],
  requires_approval: false,
  fee_fils: 0,
  price_diff_fils: -4000,
  new_total_fils: 20000,
  refund_fils: 4000,
  paid_fils: 24000,
  kept_fees_fils: 0,
  currency: "AED",
  availability: { status: "available", reason: null },
  rule_applied: "staff",
  explanation: "",
  ...over,
});

const confirmed = () => bookingDetail({ status: "confirmed", payment_status: "captured" });

const altPreview = (over: Partial<AlternativesPreview> = {}): AlternativesPreview => ({
  current_total_fils: 24000,
  authorized_fils: 24000,
  currency: "AED",
  answer_window_hours: 24,
  expires_at: "2026-10-24T16:00:00+00:00",
  can_send: true,
  options: [],
  ...over,
});
const altOption = (index: number, over: Partial<AlternativesPreview["options"][number]> = {}): AlternativesPreview["options"][number] => ({
  index,
  service_date: "2026-10-24",
  slot: { id: 2, name: { ar: "المسائية", en: "Evening" }, start: "15:00", end: "19:00" },
  allowed: true,
  availability: { status: "available", reason: null },
  total_fils: 20000,
  price_diff_fils: -4000,
  problem: null,
  ...over,
});

/** Opens "Suggest other times" and picks the time of the first option (the date is tomorrow by default). */
async function proposeWithTime(slotId: string) {
  const user = await openAction("Suggest other times");
  const dialog = screen.getByRole("dialog", { name: "Suggest other times for TRB-R4RYSD" });
  const slot = within(dialog).getByRole("combobox", { name: "Time" });
  await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
  await user.selectOptions(slot, slotId);
  return { user, dialog };
}

describe("A03 booking actions", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchBooking.mockResolvedValue(bookingDetail());
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates());
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("offers the pending request's actions only", async () => {
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
    for (const name of ["Confirm", "Suggest other times", "Reject", "Cancel booking"]) {
      expect(await screen.findByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Reschedule" })).not.toBeInTheDocument();
    expect(screen.getByText(/^Confirm within/)).toBeInTheDocument();
  });

  it("hides every action from a read-only role", async () => {
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: ["bookings.view"] });
    expect(await screen.findByRole("heading", { name: /TRB-R4RYSD/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
  });

  it("confirm: “the bank did not answer” (502) keeps the dialog and retries with the same Idempotency-Key", async () => {
    api.confirmBooking.mockRejectedValueOnce(apiError(502, "PAYMENT_RESULT_UNKNOWN")).mockResolvedValueOnce(bookingDetail({ status: "confirmed" }));
    const user = await openAction("Confirm");
    const dialog = screen.getByRole("alertdialog", { name: "Confirm TRB-R4RYSD?" });
    expect(dialog).toHaveTextContent("The payment of AED 240 is taken now");
    await user.click(within(dialog).getByRole("button", { name: "Confirm and take payment" }));

    expect(await within(dialog).findByText("The bank did not answer")).toBeInTheDocument();
    const [id, version, key] = api.confirmBooking.mock.calls[0];
    expect([id, version]).toEqual([4, 3]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);

    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.confirmBooking).toHaveBeenCalledTimes(2));
    expect(api.confirmBooking.mock.calls[1][2]).toBe(key);
    expect(await screen.findByText("TRB-R4RYSD is confirmed.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirm: not offered while the provider is still verifying the payment (the API refuses at once)", async () => {
    const base = bookingDetail();
    api.fetchBooking.mockResolvedValue(bookingDetail({ payment_status: "verifying", payment: { ...base.payment!, status: "verifying" } }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
    expect(await screen.findByText("The payment provider is still checking this payment. Confirming becomes available once it answers.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("confirm: focus goes to the booking heading once the Confirm button is gone", async () => {
    const done = bookingDetail({ status: "confirmed", payment_status: "captured", version: 4 });
    api.confirmBooking.mockResolvedValue(done);
    // The refresh after the action reads the confirmed booking too.
    api.fetchBooking.mockResolvedValueOnce(bookingDetail()).mockResolvedValue(done);
    const user = await openAction("Confirm");
    await user.click(screen.getByRole("button", { name: "Confirm and take payment" }));
    expect(await screen.findByText("TRB-R4RYSD is confirmed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /TRB-R4RYSD/ })).toHaveFocus());
  });

  it("an open dialog keeps the version it opened with: a change made meanwhile is refused (STALE_VERSION), never accepted", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewCancellation.mockResolvedValue(plan());
    api.cancelBooking.mockRejectedValue(apiError(409, "STALE_VERSION"));
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<BookingDetailScreen id="4" />, { permissions: [...COORDINATOR, "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Cancel booking" }));
    const dialog = screen.getByRole("alertdialog", { name: "Cancel TRB-R4RYSD?" });
    expect(await within(dialog).findByRole("textbox", { name: /Refund amount/ })).toHaveValue("240.00");

    // Another coordinator moves the booking; a refetch (focus, another action) loads version 4 underneath.
    await act(async () => {
      queryClient.setQueryData(["admin", "bookings", "detail", 4], bookingDetail({ status: "confirmed", payment_status: "captured", version: 4, reschedule_fee_fils: 5000 }));
    });
    expect(await within(dialog).findByText("This booking changed")).toBeInTheDocument();
    // The preview the refund was based on is not swapped underneath.
    expect(api.previewCancellation).toHaveBeenCalledTimes(1);

    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "no_capacity");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledTimes(1));
    expect(api.cancelBooking.mock.calls[0][2]).toBe(3);
    expect(await screen.findByRole("dialog", { name: /changed|Someone/i })).toBeInTheDocument();
  });

  it("an open dialog stays (with what was typed) when the refreshed booking no longer offers its action", async () => {
    const user = await openAction("Reject");
    const dialog = screen.getByRole("alertdialog", { name: "Reject TRB-R4RYSD?" });
    await user.type(within(dialog).getByRole("textbox", { name: /Details/ }), "Called twice");
    // Another coordinator confirmed it meanwhile: no pending actions are offered any more.
    await act(async () => {
      queryClient().setQueryData(["admin", "bookings", "detail", 4], bookingDetail({ status: "confirmed", payment_status: "captured", version: 4 }));
    });
    expect(await within(dialog).findByText("This booking changed")).toBeInTheDocument();
    // (The page behind the modal is aria-hidden, hence `hidden`.)
    expect(screen.queryByRole("button", { name: "Reject", hidden: true })).not.toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Reject TRB-R4RYSD?" })).toBe(dialog);
    expect(within(dialog).getByRole("textbox", { name: /Details/ })).toHaveValue("Called twice");
  });

  it("confirm: STALE_VERSION asks to reload", async () => {
    api.confirmBooking.mockRejectedValueOnce(apiError(409, "STALE_VERSION"));
    const user = await openAction("Confirm");
    await user.click(screen.getByRole("button", { name: "Confirm and take payment" }));
    expect(await screen.findByRole("dialog", { name: /changed|Someone/i })).toBeInTheDocument();
  });

  it("reject: a reason from the API's list; “other” needs the details", async () => {
    api.rejectBooking.mockResolvedValue(bookingDetail({ status: "cancelled" }));
    const user = await openAction("Reject");
    const dialog = screen.getByRole("alertdialog", { name: "Reject TRB-R4RYSD?" });
    await user.click(within(dialog).getByRole("button", { name: "Reject request" }));
    expect(within(dialog).getByText("Choose a value.")).toBeInTheDocument();

    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "other");
    await user.click(within(dialog).getByRole("button", { name: "Reject request" }));
    expect(within(dialog).getByText("Describe the reason.")).toBeInTheDocument();
    expect(api.rejectBooking).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole("textbox", { name: /Details/ }), "Customer called twice");
    await user.click(within(dialog).getByRole("button", { name: "Reject request" }));
    await waitFor(() =>
      expect(api.rejectBooking).toHaveBeenCalledWith(4, { reason_code: "other", reason_text: "Customer called twice" }, 3, expect.stringMatching(/^[0-9a-f-]{36}$/)),
    );
  });

  it("cancel: shows the policy preview for the chosen party and sends its terms back", async () => {
    const release = (over: Partial<CancelPreview>) =>
      plan({ mode: "release", refund_fils: 0, paid_fils: 0, held_fils: 24000, rule_applied: "not_charged", explanation: { ar: "…", en: "No fee applies: this request is not confirmed yet." }, ...over });
    api.previewCancellation.mockImplementation(async (_id: number, party: string) =>
      party === "company" ? release({ explanation: { ar: "…", en: "We cancelled this visit." } }) : release({}),
    );
    api.cancelBooking.mockResolvedValue({ payment: "voided", fee_fils: 0, refund_fils: 0, booking: bookingDetail({ status: "cancelled" }) });
    const user = await openAction("Cancel booking");
    const dialog = screen.getByRole("alertdialog", { name: "Cancel TRB-R4RYSD?" });
    expect(await within(dialog).findByText("No fee applies: this request is not confirmed yet.")).toBeInTheDocument();
    expect(api.previewCancellation).toHaveBeenCalledWith(4, "customer");

    await user.click(within(dialog).getByRole("radio", { name: "Tarteeba" }));
    expect(await within(dialog).findByText("We cancelled this visit.")).toBeInTheDocument();
    expect(api.previewCancellation).toHaveBeenLastCalledWith(4, "company");

    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "no_capacity");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    await waitFor(() =>
      expect(api.cancelBooking).toHaveBeenCalledWith(
        4,
        { party: "company", reason_code: "no_capacity", reason_text: null, expected_fee_fils: 0, expected_refund_fils: 0 },
        3,
        expect.any(String),
      ),
    );
  });

  it("cancel: a review the policy asks for, with no customer request waiting, is for someone with both permissions; nothing is sent without refunds.create", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewCancellation.mockResolvedValue(plan({ fee_fils: null, refund_fils: null, requires_review: true, rule_applied: "exception_review", explanation: { ar: "…", en: "Review required." } }));
    const user = await openAction("Cancel booking");
    const dialog = screen.getByRole("alertdialog", { name: "Cancel TRB-R4RYSD?" });
    expect(await within(dialog).findByText("Review required", { selector: "p" })).toBeInTheDocument();
    // Finance resolves only a customer's request waiting for review: this cancellation would go nowhere there.
    expect(dialog).toHaveTextContent("must be decided by someone who may both cancel bookings and decide refunds (a system admin)");
    expect(dialog).not.toHaveTextContent("decided by finance");
    expect(within(dialog).queryByRole("textbox", { name: /Refund amount/ })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "customer_request");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    expect(api.cancelBooking).not.toHaveBeenCalled();
    // Pressing Cancel says why nothing happens, with the same wording.
    expect(within(dialog).getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/must be decided by someone who may both cancel bookings and decide refunds/);
  });

  it("cancel: a customer's request waiting for review is a task for finance", async () => {
    const base = confirmed();
    api.fetchBooking.mockResolvedValue(
      bookingDetail({
        status: "confirmed",
        payment_status: "captured",
        cancellation: { ...base.cancellation, review_requested_at: "2026-10-23T08:00:00+00:00", review: { party: "customer", reason_code: "customer_request", reason_text: null } as never },
      }),
    );
    api.previewCancellation.mockResolvedValue(plan({ fee_fils: null, refund_fils: null, requires_review: true, rule_applied: "exception_review", explanation: { ar: "…", en: "Review required." } }));
    const user = await openAction("Cancel booking");
    const dialog = screen.getByRole("alertdialog", { name: "Cancel TRB-R4RYSD?" });
    expect(await within(dialog).findByText("Review required", { selector: "p" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The refund for this cancellation is decided by finance");
    // As the company's cancellation it is no longer the customer's request finance resolves.
    await user.click(within(dialog).getByRole("radio", { name: "Tarteeba" }));
    await waitFor(() => expect(api.previewCancellation).toHaveBeenLastCalledWith(4, "company"));
    expect(await within(dialog).findByText(/must be decided by someone who may both cancel bookings and decide refunds/)).toBeInTheDocument();
  });

  it("cancel: with refunds.create the typed refund is sent in fils, with the preview's terms (null for a review) unchanged", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewCancellation.mockResolvedValue(plan({ fee_fils: null, refund_fils: null, requires_review: true, rule_applied: "exception_review", explanation: { ar: "…", en: "Review required." } }));
    api.cancelBooking.mockResolvedValue({ payment: "refunded", fee_fils: 19000, refund_fils: 5000, booking: bookingDetail({ status: "cancelled" }) });
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: [...COORDINATOR, "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Cancel booking" }));
    const dialog = screen.getByRole("alertdialog", { name: "Cancel TRB-R4RYSD?" });
    const refund = await within(dialog).findByRole("textbox", { name: /Refund amount/ });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "customer_request");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    expect(await within(dialog).findByText("Enter the amount to refund.")).toBeInTheDocument();

    await user.type(refund, "300");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    expect(await within(dialog).findByText("The refund can't be more than what can still be refunded.")).toBeInTheDocument();

    await user.clear(refund);
    await user.type(refund, "50");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    await waitFor(() =>
      expect(api.cancelBooking).toHaveBeenCalledWith(
        4,
        { party: "customer", reason_code: "customer_request", reason_text: null, refund_fils: 5000, expected_fee_fils: null, expected_refund_fils: null },
        3,
        expect.any(String),
      ),
    );
    expect(await screen.findByText("TRB-R4RYSD is cancelled. A refund of AED 50 was requested from the payment provider.")).toBeInTheDocument();
  });

  it("cancel: TERMS_CHANGED shows the new amounts marked and needs a fresh confirm, sent with a new Idempotency-Key", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewCancellation.mockResolvedValue(plan());
    api.cancelBooking
      .mockRejectedValueOnce(
        apiError(409, "TERMS_CHANGED", {
          ...plan({ fee_fils: 4000, refund_fils: 20000, rule_applied: "late_cancel", explanation: { ar: "…", en: "Less than 24 hours before the visit: a fee applies." } }),
          currency: "AED",
          changed: ["fee_fils", "refund_fils"],
        }),
      )
      .mockResolvedValueOnce({ payment: "refunded", fee_fils: 4000, refund_fils: 20000, booking: bookingDetail({ status: "cancelled" }) });
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: [...COORDINATOR, "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Cancel booking" }));
    const dialog = screen.getByRole("alertdialog", { name: "Cancel TRB-R4RYSD?" });
    const refund = await within(dialog).findByRole("textbox", { name: /Refund amount/ });
    expect(refund).toHaveValue("240.00");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "customer_request");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));

    expect(await within(dialog).findByText("The amounts changed")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Nothing was cancelled.");
    expect(within(dialog).getByText("Less than 24 hours before the visit: a fee applies.")).toBeInTheDocument();
    const changed = dialog.querySelectorAll("[data-changed]");
    expect([...changed].map((n) => n.textContent)).toEqual(["AED 40 (changed)", "AED 200 (changed)"]);
    // The policy's refund in the field follows the new terms (it was not typed by hand).
    expect(refund).toHaveValue("200.00");
    const [, firstBody, , firstKey] = api.cancelBooking.mock.calls[0];
    expect(firstBody).toMatchObject({ refund_fils: 24000, expected_fee_fils: 0, expected_refund_fils: 24000 });

    await user.click(within(dialog).getByRole("button", { name: "Cancel at the new amounts" }));
    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledTimes(2));
    const [, secondBody, , secondKey] = api.cancelBooking.mock.calls[1];
    expect(secondBody).toMatchObject({ refund_fils: 20000, expected_fee_fils: 4000, expected_refund_fils: 20000 });
    expect(secondKey).not.toBe(firstKey);
    expect(await screen.findByText("TRB-R4RYSD is cancelled. A refund of AED 200 was requested from the payment provider.")).toBeInTheDocument();
  });

  it("cancel: a refund typed by hand goes as refund_fils while expected_* stay the preview's own amounts, also after TERMS_CHANGED", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewCancellation.mockResolvedValue(plan());
    api.cancelBooking
      .mockRejectedValueOnce(
        apiError(409, "TERMS_CHANGED", {
          ...plan({ fee_fils: 4000, refund_fils: 20000, rule_applied: "late_cancel", explanation: { ar: "…", en: "Less than 24 hours before the visit: a fee applies." } }),
          currency: "AED",
          changed: ["fee_fils", "refund_fils"],
        }),
      )
      .mockResolvedValueOnce({ payment: "refunded", fee_fils: 4000, refund_fils: 15000, booking: bookingDetail({ status: "cancelled" }) });
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: [...COORDINATOR, "refunds.create"] });
    await user.click(await screen.findByRole("button", { name: "Cancel booking" }));
    const dialog = screen.getByRole("alertdialog", { name: "Cancel TRB-R4RYSD?" });
    const refund = await within(dialog).findByRole("textbox", { name: /Refund amount/ });
    await waitFor(() => expect(refund).toHaveValue("240.00"));
    await user.clear(refund);
    await user.type(refund, "150");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "customer_request");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));

    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledTimes(1));
    expect(api.cancelBooking.mock.calls[0]).toEqual([
      4,
      { party: "customer", reason_code: "customer_request", reason_text: null, refund_fils: 15000, expected_fee_fils: 0, expected_refund_fils: 24000 },
      3,
      expect.any(String),
    ]);

    // The new terms: the amount typed by hand stays, the expected amounts follow the new preview.
    expect(await within(dialog).findByText("The amounts changed")).toBeInTheDocument();
    expect(refund).toHaveValue("150");
    await user.click(within(dialog).getByRole("button", { name: "Cancel at the new amounts" }));
    await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledTimes(2));
    expect(api.cancelBooking.mock.calls[1][1]).toMatchObject({ refund_fils: 15000, expected_fee_fils: 4000, expected_refund_fils: 20000 });
  });

  it("reschedule: shows the new time's terms first and sends them back", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewReschedule.mockResolvedValue(moveTerms());
    api.rescheduleBooking.mockResolvedValue({ reschedule_request: {}, booking: confirmed() });
    const user = await openAction("Reschedule");
    const dialog = screen.getByRole("dialog", { name: "Reschedule TRB-R4RYSD" });
    expect(within(dialog).getByText("Choose the new date and time to see the amounts.")).toBeInTheDocument();
    const slot = within(dialog).getByRole("combobox", { name: /New time/ });
    // The slot pick-list for the service's kind: Morning and Evening (no live-out or inactive slot).
    await waitFor(() => expect(within(slot).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a time", "Morning · 10:00–14:00", "Evening · 15:00–19:00"]));
    await user.selectOptions(slot, "2");

    const terms = await within(dialog).findByRole("region", { name: "What changes" });
    expect(api.previewReschedule).toHaveBeenCalledWith(4, { service_date: "2026-10-24", slot_template_id: 2 });
    expect(terms).toHaveTextContent("Current totalAED 240");
    expect(terms).toHaveTextContent("New totalAED 200");
    expect(terms).toHaveTextContent("DifferenceAED 40 less");
    expect(terms).toHaveTextContent("Refund of the differenceAED 40");
    // The answer reaches screen readers through the dialog's one live region (it said "Checking…" before).
    expect(within(dialog).getByText("New total: AED 200. Difference: AED 40 less. Refund of the difference: AED 40.")).toHaveAttribute("role", "status");

    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Customer asked for the evening");
    await user.click(within(dialog).getByRole("button", { name: "Reschedule" }));
    await waitFor(() =>
      expect(api.rescheduleBooking).toHaveBeenCalledWith(
        4,
        { service_date: "2026-10-24", slot_template_id: 2, reason: "Customer asked for the evening", expected_fee_fils: 0, expected_new_total_fils: 20000 },
        3,
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ),
    );
    expect(await screen.findByText("TRB-R4RYSD is moved to the new time.")).toBeInTheDocument();
    // The refresh after the move does not send the dry run again.
    expect(api.previewReschedule).toHaveBeenCalledTimes(1);
  });

  it("reschedule: TERMS_CHANGED replaces the numbers, marks what changed and needs a fresh confirm with a new key", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewReschedule.mockResolvedValue(moveTerms());
    api.rescheduleBooking
      .mockRejectedValueOnce(apiError(409, "TERMS_CHANGED", { ...moveTerms({ new_total_fils: 22000, price_diff_fils: -2000, refund_fils: 2000 }), changed: ["new_total_fils"] }))
      .mockResolvedValueOnce({ reschedule_request: {}, booking: confirmed() });
    const user = await openAction("Reschedule");
    const dialog = screen.getByRole("dialog", { name: "Reschedule TRB-R4RYSD" });
    const slot = within(dialog).getByRole("combobox", { name: /New time/ });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(slot, "2");
    await within(dialog).findByRole("region", { name: "What changes" });
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Customer asked for the evening");
    await user.click(within(dialog).getByRole("button", { name: "Reschedule" }));

    expect(await within(dialog).findByText("The amounts changed")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Nothing was moved.");
    const terms = within(dialog).getByRole("region", { name: "What changes" });
    expect(terms).toHaveTextContent("New totalAED 220 (changed)");
    expect([...terms.querySelectorAll("[data-changed]")].map((n) => n.textContent)).toEqual(["AED 220 (changed)"]);
    // Nothing goes out again until the user confirms the new amounts.
    expect(api.rescheduleBooking).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Reschedule" }));
    await waitFor(() => expect(api.rescheduleBooking).toHaveBeenCalledTimes(2));
    const [, first, , firstKey] = api.rescheduleBooking.mock.calls[0];
    const [, second, , secondKey] = api.rescheduleBooking.mock.calls[1];
    expect(first).toMatchObject({ expected_new_total_fils: 20000, expected_fee_fils: 0 });
    expect(second).toMatchObject({ expected_new_total_fils: 22000, expected_fee_fils: 0 });
    expect(secondKey).not.toBe(firstKey);
  });

  it("reschedule: a waiting customer request (409 RESCHEDULE_PENDING) is pointed to, and nothing is sent", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewReschedule.mockRejectedValue(apiError(409, "RESCHEDULE_PENDING", { request_id: "01RQ" }));
    const user = await openAction("Reschedule");
    const dialog = screen.getByRole("dialog", { name: "Reschedule TRB-R4RYSD" });
    const slot = within(dialog).getByRole("combobox", { name: /New time/ });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(slot, "1");
    expect(await within(dialog).findByText("A customer request is waiting")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Approve or reject that request on the booking page first.");
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Customer asked for the morning");
    await user.click(within(dialog).getByRole("button", { name: "Reschedule" }));
    // No amounts will come for this time: the warning points at the waiting request, never "wait for them".
    const pointer = await within(dialog).findByText("The booking can't be moved while the customer's request waits: approve or reject it first.");
    expect(pointer.closest('[role="alert"]')).not.toBeNull();
    expect(within(dialog).queryByText(/aren't shown yet/)).not.toBeInTheDocument();
    expect(api.rescheduleBooking).not.toHaveBeenCalled();
  });

  it("reschedule: pressed while the new time is still being checked, it asks to wait for the amounts", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewReschedule.mockReturnValue(new Promise(() => undefined));
    const user = await openAction("Reschedule");
    const dialog = screen.getByRole("dialog", { name: "Reschedule TRB-R4RYSD" });
    const slot = within(dialog).getByRole("combobox", { name: /New time/ });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(slot, "2");
    expect(await within(dialog).findByText("Checking the new time…")).toHaveAttribute("role", "status");
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Customer asked for the evening");
    await user.click(within(dialog).getByRole("button", { name: "Reschedule" }));
    expect(await within(dialog).findByText(/The amounts for the new time aren't shown yet/)).toBeInTheDocument();
    expect(api.rescheduleBooking).not.toHaveBeenCalled();
  });

  it("reschedule: a check refused for another reason (422 SAME_SLOT) points at the problem shown", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewReschedule.mockRejectedValue(apiError(422, "SAME_SLOT"));
    const user = await openAction("Reschedule");
    const dialog = screen.getByRole("dialog", { name: "Reschedule TRB-R4RYSD" });
    const slot = within(dialog).getByRole("combobox", { name: /New time/ });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(slot, "1");
    expect(await within(dialog).findByRole("button", { name: "Check again" })).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "Customer asked for the morning");
    await user.click(within(dialog).getByRole("button", { name: "Reschedule" }));
    expect(await within(dialog).findByText("The new time couldn't be checked: fix the problem shown above, or press “Check again”.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/aren't shown yet/)).not.toBeInTheDocument();
    expect(api.rescheduleBooking).not.toHaveBeenCalled();
  });

  it("reschedule: a full time needs an override (offered only with capacity.override)", async () => {
    api.fetchBooking.mockResolvedValue(confirmed());
    api.previewReschedule.mockResolvedValue(moveTerms({ allowed: false, blockers: ["slot"], availability: { status: "full", reason: "no_workers" } }));
    const user = await openAction("Reschedule");
    const dialog = screen.getByRole("dialog", { name: "Reschedule TRB-R4RYSD" });
    const slot = within(dialog).getByRole("combobox", { name: /New time/ });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(slot, "2");
    expect(await within(dialog).findByText("This time is full or closed for this team. Choose another time.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: /override/ })).not.toBeInTheDocument();
  });

  it("alternatives: checks each option as it is entered and offers Send only when every option can be offered", async () => {
    const preview = altPreview;
    const option = altOption;
    api.previewAlternatives.mockImplementation(async (_id: number, input: { options: { slot_template_id: number }[] }) =>
      input.options.some((o) => o.slot_template_id === 1)
        ? preview({
            can_send: false,
            options: input.options.map((o, i) =>
              o.slot_template_id === 1
                ? option(i, {
                    allowed: false,
                    total_fils: 27000,
                    price_diff_fils: 3000,
                    problem: { code: "OPTION_PRICE_HIGHER", message: "This time costs AED 30 more than the customer authorized.", details: {} },
                  })
                : option(i),
            ),
          })
        : preview({ options: input.options.map((_o, i) => option(i)) }),
    );
    api.proposeAlternatives.mockResolvedValue({ proposal: {}, booking: bookingDetail({ status: "alternative_proposed" }) });
    const user = await openAction("Suggest other times");
    const dialog = screen.getByRole("dialog", { name: "Suggest other times for TRB-R4RYSD" });
    expect(dialog).toHaveTextContent("Each time must cost no more than the AED 240 the customer authorized");
    const send = within(dialog).getByRole("button", { name: "Send to the customer" });
    expect(send).toBeDisabled();

    const slot = within(dialog).getByRole("combobox", { name: "Time" });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(slot, "1");
    expect(await within(dialog).findByText("This time costs AED 30 more than the customer authorized.")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("AED 270 · AED 30 more");
    // The option's answer and the dialog's verdict are announced through live regions that stayed mounted.
    const optionStatus = within(within(dialog).getByRole("group", { name: "Option 1" })).getByRole("status");
    expect(optionStatus).toHaveTextContent("Option 1: AED 270 · AED 30 moreThis time costs AED 30 more than the customer authorized.");
    expect(within(dialog).getByText("You can send once every option can be offered.")).toHaveAttribute("role", "status");
    expect(send).toBeDisabled();

    await user.selectOptions(slot, "2");
    expect(await within(dialog).findByText("Can be offered.")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("AED 200 · AED 40 cheaper");
    // The customer's deadline if sent now, in Dubai time.
    expect(dialog).toHaveTextContent("If you send now, the customer has until 24 Oct 2026, 20:00 to answer (24 hours).");
    await waitFor(() => expect(send).toBeEnabled());
    expect(api.previewAlternatives).toHaveBeenLastCalledWith(4, { options: [{ service_date: "2026-10-24", slot_template_id: 2 }], note: null });
    expect(within(dialog).getByText("Every option can be offered: you can send.")).toHaveAttribute("role", "status");
    const checks = api.previewAlternatives.mock.calls.length;

    await user.click(send);
    await waitFor(() =>
      expect(api.proposeAlternatives).toHaveBeenCalledWith(4, { options: [{ service_date: "2026-10-24", slot_template_id: 2, note: null }], note: null }, 3),
    );
    expect(await screen.findByText("Other times sent to the customer for TRB-R4RYSD.")).toBeInTheDocument();
    // The refresh after sending does not check the options again.
    expect(api.previewAlternatives).toHaveBeenCalledTimes(checks);
  });

  it("alternatives: the same date and time twice is marked on the repeated option and never checked", async () => {
    api.previewAlternatives.mockImplementation(async (_id: number, input: { options: unknown[] }) => altPreview({ options: input.options.map((_o, i) => altOption(i)) }));
    const { user, dialog } = await proposeWithTime("2");
    expect(await within(dialog).findByText("Can be offered.")).toBeInTheDocument();
    expect(api.previewAlternatives).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Add another time" }));
    const second = within(dialog).getByRole("group", { name: "Option 2" });
    const secondSlot = within(second).getByRole("combobox", { name: "Time" });
    await user.selectOptions(secondSlot, "2");
    expect(secondSlot).toHaveAccessibleDescription("The same date and time is offered twice.");
    expect(within(within(dialog).getByRole("group", { name: "Option 1" })).getByRole("combobox", { name: "Time" })).not.toHaveAccessibleDescription(
      /offered twice/,
    );
    expect(within(dialog).getByRole("button", { name: "Send to the customer" })).toBeDisabled();
    // Nothing for the API to refuse: no check of the repeated options, and no generic "check the fields" notice.
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(api.previewAlternatives).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByText("Check the highlighted fields.")).not.toBeInTheDocument();

    await user.selectOptions(secondSlot, "1");
    await waitFor(() => expect(api.previewAlternatives).toHaveBeenCalledTimes(2));
    expect(secondSlot).not.toHaveAccessibleDescription(/offered twice/);
  });

  it("alternatives: a 422 of the check lands on the option it names, with the API's words and no “Check again”", async () => {
    api.previewAlternatives.mockRejectedValue(
      new AdminApiError(422, { code: "VALIDATION_FAILED", message: "The given data was invalid.", details: { fields: { "options.0": ["This option can't be offered on that date."] } } }),
    );
    const { dialog } = await proposeWithTime("2");
    const slot = within(dialog).getByRole("combobox", { name: "Time" });
    await waitFor(() => expect(slot).toHaveAccessibleDescription("This option can't be offered on that date."));
    expect(within(dialog).queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send to the customer" })).toBeDisabled();
  });

  it("alternatives: a refusal of the proposal itself (dearer than authorized by then) is explained on the option", async () => {
    api.previewAlternatives.mockImplementation(async (_id: number, input: { options: unknown[] }) => altPreview({ options: input.options.map((_o, i) => altOption(i)) }));
    api.proposeAlternatives.mockRejectedValue(apiError(422, "OPTION_PRICE_HIGHER", { option_index: 0, price_diff_fils: 3000, authorized_fils: 24000 }));
    const { user, dialog } = await proposeWithTime("2");
    const send = within(dialog).getByRole("button", { name: "Send to the customer" });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    expect(await within(dialog).findByText("Option 1 costs more than the customer authorized")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("It costs AED 30 more than the AED 240 the customer authorized.");
    expect(within(dialog).getByRole("combobox", { name: "Time" })).toHaveAccessibleDescription("This option can't be offered.");
  });

  it("alternatives: an option no longer available when sent (409 OPTION_UNAVAILABLE) is named", async () => {
    api.previewAlternatives.mockImplementation(async (_id: number, input: { options: unknown[] }) => altPreview({ options: input.options.map((_o, i) => altOption(i)) }));
    api.proposeAlternatives.mockRejectedValue(apiError(409, "OPTION_UNAVAILABLE", { option_index: 0 }));
    const { user, dialog } = await proposeWithTime("2");
    const send = within(dialog).getByRole("button", { name: "Send to the customer" });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    expect(await within(dialog).findByText("Option 1 can't be offered")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Time" })).toHaveAccessibleDescription("This option can't be offered.");
  });

  it("alternatives: a booking-level refusal of the check is shown with a way to check again", async () => {
    api.previewAlternatives.mockRejectedValue(apiError(409, "PAYMENT_VERIFYING"));
    const user = await openAction("Suggest other times");
    const dialog = screen.getByRole("dialog", { name: "Suggest other times for TRB-R4RYSD" });
    const slot = within(dialog).getByRole("combobox", { name: "Time" });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(3));
    await user.selectOptions(slot, "2");
    expect(await within(dialog).findByRole("button", { name: "Check again" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send to the customer" })).toBeDisabled();
  });
});
