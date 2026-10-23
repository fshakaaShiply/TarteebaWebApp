import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { CapacityView, CancelPreview } from "@/lib/admin/types";
import { bookingDetail, serviceOptions, visitCandidates, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { BookingDetailScreen } from "./BookingDetailScreen";

const api = {
  fetchBooking: vi.fn(),
  confirmBooking: vi.fn(),
  rejectBooking: vi.fn(),
  proposeAlternatives: vi.fn(),
  previewCancellation: vi.fn(),
  cancelBooking: vi.fn(),
  fetchCapacity: vi.fn(),
  fetchVisitCandidates: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBooking: (...a: unknown[]) => api.fetchBooking(...a),
  confirmBooking: (...a: unknown[]) => api.confirmBooking(...a),
  rejectBooking: (...a: unknown[]) => api.rejectBooking(...a),
  proposeAlternatives: (...a: unknown[]) => api.proposeAlternatives(...a),
  previewCancellation: (...a: unknown[]) => api.previewCancellation(...a),
  cancelBooking: (...a: unknown[]) => api.cancelBooking(...a),
  fetchCapacity: (...a: unknown[]) => api.fetchCapacity(...a),
  fetchVisitCandidates: (...a: unknown[]) => api.fetchVisitCandidates(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
}));

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });

const COORDINATOR = [
  "bookings.view",
  "bookings.confirm",
  "bookings.reject",
  "bookings.propose_alternative",
  "bookings.reschedule",
  "bookings.cancel",
  "assignments.manage",
  "schedule.view",
];

const capacity = (date: string): CapacityView => ({
  date,
  zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay & Downtown" } },
  timezone: "Asia/Dubai",
  travel_buffer_minutes: 30,
  live_out_block_scope: "whole_day",
  slots: [
    {
      slot_template_id: 2,
      code: "EVENING",
      name: { ar: "المسائية", en: "Evening" },
      start: "15:00",
      end: "19:00",
      service_kind: "standard_visit",
      is_active: true,
      service: { id: 1, code: "STANDARD_VISIT" },
      status: "available",
      reason: null,
      available_workers: 5,
      reserved_workers: 0,
      reserved_competing: 0,
      remaining_workers: 5,
      vehicles: [],
      max_single_vehicle_free: 7,
      total_free_seats: 7,
      bookings_count: 0,
      max_bookings: null,
      rule: null,
      max_workers_fit: 5,
      holds: { active: 0, converted: 0 },
      zone_workers: 6,
      excluded: {},
    },
  ],
});

const consoleError = vi.spyOn(console, "error");

async function openAction(name: string) {
  const user = userEvent.setup();
  renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
  await user.click(await screen.findByRole("button", { name }));
  return user;
}

describe("A03 booking actions", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchBooking.mockResolvedValue(bookingDetail());
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates());
    api.fetchCapacity.mockImplementation(async ({ date }: { date: string }) => capacity(date));
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

  it("cancel: shows the policy preview for the chosen party before anything moves", async () => {
    const plan = (over: Partial<CancelPreview>): CancelPreview => ({
      allowed: true,
      mode: "release",
      fee_fils: 0,
      kept_fees_fils: 0,
      refund_fils: 0,
      paid_fils: 0,
      held_fils: 24000,
      requires_review: false,
      rule_applied: "not_charged",
      explanation: { ar: "…", en: "No fee applies: this request is not confirmed yet." },
      ...over,
    });
    api.previewCancellation.mockImplementation(async (_id: number, party: string) =>
      party === "company" ? plan({ explanation: { ar: "…", en: "We cancelled this visit." } }) : plan({}),
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
      expect(api.cancelBooking).toHaveBeenCalledWith(4, { party: "company", reason_code: "no_capacity", reason_text: null }, 3, expect.any(String)),
    );
  });

  it("cancel: a review the policy asks for is a task for finance; nothing is sent without refunds.create", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured" }));
    api.previewCancellation.mockResolvedValue({
      allowed: true,
      mode: "refund",
      fee_fils: null,
      kept_fees_fils: 0,
      refund_fils: null,
      paid_fils: 24000,
      held_fils: 0,
      requires_review: true,
      rule_applied: "exception_review",
      explanation: { ar: "…", en: "Review required." },
    } satisfies CancelPreview);
    const user = await openAction("Cancel booking");
    const dialog = screen.getByRole("alertdialog", { name: "Cancel TRB-R4RYSD?" });
    expect(await within(dialog).findByText("Review required", { selector: "p" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /Refund amount/ })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "customer_request");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    expect(api.cancelBooking).not.toHaveBeenCalled();
  });

  it("cancel: with refunds.create the refund amount is required and sent in fils", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured" }));
    api.previewCancellation.mockResolvedValue({
      allowed: true,
      mode: "refund",
      fee_fils: null,
      kept_fees_fils: 0,
      refund_fils: null,
      paid_fils: 24000,
      held_fils: 0,
      requires_review: true,
      rule_applied: "exception_review",
      explanation: { ar: "…", en: "Review required." },
    } satisfies CancelPreview);
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
      expect(api.cancelBooking).toHaveBeenCalledWith(4, { party: "customer", reason_code: "customer_request", reason_text: null, refund_fils: 5000 }, 3, expect.any(String)),
    );
    expect(await screen.findByText("TRB-R4RYSD is cancelled. A refund of AED 50 was requested from the payment provider.")).toBeInTheDocument();
  });

  it("alternatives: explains an option dearer than what the customer authorized", async () => {
    api.proposeAlternatives.mockRejectedValue(apiError(422, "OPTION_PRICE_HIGHER", { option_index: 0, price_diff_fils: 3000, authorized_fils: 24000 }));
    const user = await openAction("Suggest other times");
    const dialog = screen.getByRole("dialog", { name: "Suggest other times for TRB-R4RYSD" });
    expect(dialog).toHaveTextContent("Each time must cost no more than the AED 240 the customer authorized");
    const slot = within(dialog).getByRole("combobox", { name: "Time" });
    await waitFor(() => expect(within(slot).getAllByRole("option")).toHaveLength(2));
    await user.selectOptions(slot, "2");
    await user.click(within(dialog).getByRole("button", { name: "Send to the customer" }));

    expect(await within(dialog).findByText("Option 1 costs more than the customer authorized")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("It costs AED 30 more than the AED 240 the customer authorized.");
    expect(api.proposeAlternatives).toHaveBeenCalledWith(4, { options: [{ service_date: expect.any(String), slot_template_id: 2, note: null }], note: null }, 3);
  });
});
