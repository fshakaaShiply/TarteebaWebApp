import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookingRow } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { CancelReviewQueue, cancelReviewsHref } from "./CancelReviewQueue";

const api = { fetchBookings: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBookings: (...a: unknown[]) => api.fetchBookings(...a),
}));

const ACCOUNTANT = ["bookings.view", "payments.view", "refunds.create", "invoices.manage"];

describe("A02 cancellation review queue", () => {
  beforeEach(() => {
    api.fetchBookings.mockReset();
    api.fetchBookings.mockResolvedValue({
      data: [bookingRow({ id: 7, reference: "TRB-REV001", status: "confirmed", customer: { id: "01C", name: "Sara Ahmed", phone: "+971500000001" } })],
      meta: { current_page: 1, per_page: 5, total: 3, last_page: 1 },
    });
  });

  it("gives the accountant the bookings waiting for review and the whole filtered list", async () => {
    renderWithProviders(<CancelReviewQueue zoneId={2} />, { permissions: ACCOUNTANT });
    expect(await screen.findByRole("link", { name: "Open TRB-REV001" })).toHaveAttribute("href", "/admin/bookings/7");
    expect(api.fetchBookings).toHaveBeenCalledWith({ cancelReview: true, zoneId: 2, page: 1, perPage: 5 });
    expect(screen.getByRole("link", { name: "All reviews (3)" })).toHaveAttribute("href", "/admin/bookings?cancel_review=1&zone_id=2");
    expect(screen.getByText("Open a booking to resolve its cancellation with a refund.")).toBeInTheDocument();
  });

  it("tells coordinators what they do with a review, and says when none is waiting", async () => {
    api.fetchBookings.mockResolvedValue({ data: [], meta: { current_page: 1, per_page: 5, total: 0, last_page: 1 } });
    renderWithProviders(<CancelReviewQueue zoneId={null} />, { permissions: ["bookings.view", "bookings.cancel"] });
    expect(await screen.findByText("No cancellation is waiting for review.")).toBeInTheDocument();
    expect(screen.getByText("Open a booking to keep it or cancel it.")).toBeInTheDocument();
    expect(cancelReviewsHref()).toBe("/admin/bookings?cancel_review=1");
  });

  it("stays away from roles that don't act on reviews", () => {
    renderWithProviders(<CancelReviewQueue zoneId={null} />, { permissions: ["bookings.view", "schedule.view"] });
    expect(screen.queryByText("Cancellations waiting for review")).not.toBeInTheDocument();
    expect(api.fetchBookings).not.toHaveBeenCalled();
  });
});
