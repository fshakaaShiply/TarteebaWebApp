import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("shows the notice without a link to staff who cannot open A08", async () => {
    api.fetchBooking.mockResolvedValue(seriesVisit());
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: ["bookings.view", "bookings.cancel"] });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(within(header).getByText(/This visit belongs to a subscription/)).toBeInTheDocument();
    expect(within(header).queryByRole("link", { name: /Open subscription/ })).not.toBeInTheDocument();
  });
});
