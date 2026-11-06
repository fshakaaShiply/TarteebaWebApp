import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RescheduleRequest } from "@/lib/admin/types";
import { bookingDetail, serviceOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { BookingDetailScreen } from "./BookingDetailScreen";

const api = { fetchBooking: vi.fn(), fetchVisitCandidates: vi.fn(), fetchRefundsByPhone: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBooking: (...a: unknown[]) => api.fetchBooking(...a),
  fetchVisitCandidates: (...a: unknown[]) => api.fetchVisitCandidates(...a),
  fetchRefundsByPhone: (...a: unknown[]) => api.fetchRefundsByPhone(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
}));

const STAFF = ["bookings.view", "bookings.confirm", "bookings.reschedule", "bookings.cancel", "schedule.view", "subscriptions.manage"];
const link = { id: 31, ulid: "01jb", reference: "TRS-7K2M9Q", type: "recurring", visit_no: 3, visits_total: 8 };

const seriesVisit = (over = {}) =>
  bookingDetail({ status: "confirmed", payment_status: "captured", kind: "subscription_visit", subscription: link, ...over });

/** A customer's move of the visit waiting for staff (MoveSeriesVisitBooking leaves it pending when approval is needed). */
const pendingRequest: RescheduleRequest = {
  id: 77,
  ulid: "01jrq",
  status: "pending",
  status_label: { ar: "بانتظار القرار", en: "Pending" },
  from: { service_date: "2026-11-03", slot: { id: 1, name: { ar: "صباحية", en: "Morning" }, start: "10:00", end: "14:00" } },
  to: { service_date: "2026-11-04", slot: { id: 1, name: { ar: "صباحية", en: "Morning" }, start: "10:00", end: "14:00" } },
  fee_fils: 0,
  price_diff_fils: 0,
  new_total_fils: 24000,
  decision_note: null,
  decided_at: null,
  created_at: "2026-10-23T10:00:00+00:00",
  booking_id: 4,
  booking_reference: "TRB-K2M9QX",
  requested_by_type: "customer",
  requested_by_id: 3,
  reason: null,
  rule_applied: "series_move",
  override: null,
  decided_by: null,
};
const requestsCard = async () => (await screen.findByRole("heading", { name: "Reschedule requests" })).closest("section") as HTMLElement;

describe("A03 booking page of a subscription visit", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchRefundsByPhone.mockResolvedValue([]);
    api.fetchVisitCandidates.mockResolvedValue({ visit: null, candidates: [] });
  });

  it("names the subscription and the visit's place, and sends staff there instead of cancel and reschedule", async () => {
    api.fetchBooking.mockResolvedValue(seriesVisit());
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const title = await screen.findByRole("heading", { level: 1 });
    const header = title.closest("section") as HTMLElement;
    expect(header).toHaveTextContent("Subscription TRS-7K2M9Q · visit 3 of 8");
    expect(within(header).getByText(/This visit belongs to a subscription/)).toBeInTheDocument();
    const open = within(header).getAllByRole("link", { name: /Open subscription TRS-7K2M9Q/ });
    expect(open.length).toBeGreaterThan(0);
    for (const a of open) expect(a).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(within(header).queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: "Reschedule" })).not.toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: /^Cancel/ })).not.toBeInTheDocument();
  });

  it("keeps cancel and reschedule on a single booking, with no subscription notice", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured" }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(within(header).getByRole("button", { name: /Reschedule/ })).toBeInTheDocument();
    expect(within(header).queryByText(/belongs to a subscription/)).not.toBeInTheDocument();
  });

  it("sends a series visit's pending reschedule request to the subscription instead of offering Approve and Reject", async () => {
    // DecideRescheduleRequest refuses both for a series visit (409 USE_SUBSCRIPTION_ACTIONS): A08 decides it.
    api.fetchBooking.mockResolvedValue(seriesVisit({ reschedule_requests: [pendingRequest] }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const card = await requestsCard();
    expect(card).toHaveTextContent("approved or declined on the subscription page");
    expect(within(card).getByRole("link", { name: "Open subscription TRS-7K2M9Q" })).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(within(card).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("names the subscription page without a link to staff who cannot open A08", async () => {
    api.fetchBooking.mockResolvedValue(seriesVisit({ reschedule_requests: [pendingRequest] }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: ["bookings.view", "bookings.reschedule"] });
    const card = await requestsCard();
    expect(card).toHaveTextContent("approved or declined on the subscription page");
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("keeps Approve and Reject on a single booking's pending request", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured", reschedule_requests: [pendingRequest] }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const card = await requestsCard();
    expect(within(card).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(card).not.toHaveTextContent("subscription page");
  });

  it("names a Live-out day with the admin's own Arabic term (Live-out), as the design does", async () => {
    api.fetchBooking.mockResolvedValue(
      seriesVisit({ kind: "live_out_day", subscription: { ...link, type: "live_out", visit_no: 5, visits_total: 26 } }),
    );
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF, locale: "ar" });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(header.textContent).toMatch(/Live-out TRS-7K2M9Q · اليوم (5|٥) من (26|٢٦)/);
    expect(header).not.toHaveTextContent("إقامة");
  });

  it("shows the notice without a link to staff who cannot open A08", async () => {
    api.fetchBooking.mockResolvedValue(seriesVisit());
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: ["bookings.view", "bookings.cancel"] });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(within(header).getByText(/This visit belongs to a subscription/)).toBeInTheDocument();
    expect(within(header).queryByRole("link", { name: /Open subscription/ })).not.toBeInTheDocument();
  });
});
