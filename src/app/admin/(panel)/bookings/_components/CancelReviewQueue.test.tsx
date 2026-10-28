import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DashboardSummary } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { CancelReviewQueue } from "./CancelReviewQueue";

const ACCOUNTANT = ["bookings.view", "payments.view", "refunds.create", "invoices.manage"];

type ReviewsCard = NonNullable<DashboardSummary["cards"]["cancellation_reviews"]>;
const reviewsCard = (over: Partial<ReviewsCard> = {}): ReviewsCard => ({
  label: { ar: "طلبات إلغاء بانتظار المراجعة", en: "Cancellations waiting for review" },
  value: 3,
  oldest_request: {
    booking_id: 812,
    reference: "TRB-7Q2M9K",
    requested_at: "2026-10-22T21:30:00+00:00",
    waiting_minutes: 1110,
    link: { list: "booking", path: "/api/v1/admin/bookings/812", params: {} },
  },
  link: { list: "bookings", path: "/api/v1/admin/bookings", params: { cancel_review: 1, zone_id: 2 } },
  ...over,
});

describe("A02 cancellation review queue (the summary's cancellation_reviews card)", () => {
  it("gives the accountant the count, the review waiting longest and the whole filtered list", () => {
    renderWithProviders(<CancelReviewQueue card={reviewsCard()} />, { permissions: ACCOUNTANT });
    expect(screen.getByText("Cancellations waiting for review")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All reviews (3)" })).toHaveAttribute("href", "/admin/bookings?cancel_review=1&zone_id=2");
    const oldest = screen.getByRole("link", { name: "Open TRB-7Q2M9K" });
    expect(oldest).toHaveAttribute("href", "/admin/bookings/812");
    expect(oldest.parentElement).toHaveTextContent("Waiting longest: TRB-7Q2M9K, for 18 hours 30 minutes");
    expect(screen.getByText("Open a booking to resolve its cancellation with a refund.")).toBeInTheDocument();
  });

  it("tells coordinators what they do with a review, and says when none is waiting", () => {
    renderWithProviders(
      <CancelReviewQueue card={reviewsCard({ value: 0, oldest_request: null, link: { list: "bookings", path: "/api/v1/admin/bookings", params: { cancel_review: 1 } } })} />,
      { permissions: ["bookings.view", "bookings.cancel"] },
    );
    expect(screen.getByText("No cancellation is waiting for review.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All reviews (0)" })).toHaveAttribute("href", "/admin/bookings?cancel_review=1");
    expect(screen.queryByRole("link", { name: /^Open TRB/ })).not.toBeInTheDocument();
    expect(screen.getByText("Open a booking to keep it or cancel it.")).toBeInTheDocument();
  });

  it("is hidden when the API sends no card (roles that don't act on reviews)", () => {
    renderWithProviders(<CancelReviewQueue card={null} />, { permissions: ["bookings.view", "schedule.view"] });
    expect(screen.queryByText("Cancellations waiting for review")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
