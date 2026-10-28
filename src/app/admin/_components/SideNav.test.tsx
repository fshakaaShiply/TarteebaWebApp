import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { NavContent } from "./SideNav";

const page = vi.hoisted(() => ({ pathname: "/admin/bookings", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => page.pathname,
  useSearchParams: () => new URLSearchParams(page.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

/** Accountant: reads bookings and payments, resolves cancellation reviews with a refund. */
const ACCOUNTANT = ["bookings.view", "payments.view", "invoices.manage", "refunds.create"];

const current = () =>
  within(screen.getByRole("navigation", { name: "Admin navigation" }))
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);

describe("admin side navigation", () => {
  beforeEach(() => {
    page.pathname = "/admin/bookings";
    page.search = "";
  });

  it("marks the cancellation reviews, and only them, on the bookings list filtered to the reviews", () => {
    page.search = "cancel_review=1";
    renderWithProviders(<NavContent />, { permissions: ACCOUNTANT });
    expect(current()).toEqual(["Cancellation reviews"]);
    expect(screen.getByRole("link", { name: "Cancellation reviews" })).toHaveAttribute("href", "/admin/bookings?cancel_review=1");
    expect(screen.getByRole("link", { name: "Bookings" })).not.toHaveAttribute("aria-current");
    // The group holding the current page is open.
    expect(screen.getByRole("button", { name: "Payments & invoices" })).toHaveAttribute("aria-expanded", "true");
  });

  it("marks Bookings on the plain list, with the finance group closed", () => {
    renderWithProviders(<NavContent />, { permissions: ACCOUNTANT });
    expect(current()).toEqual(["Bookings"]);
    expect(screen.getByRole("button", { name: "Payments & invoices" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the filtered list under Bookings for a user without the review entry", () => {
    page.search = "cancel_review=1";
    renderWithProviders(<NavContent />, { permissions: ["bookings.view"] });
    expect(screen.queryByRole("link", { name: "Cancellation reviews" })).not.toBeInTheDocument();
    expect(current()).toEqual(["Bookings"]);
  });

  it("marks one finance page under its own entry", () => {
    page.pathname = "/admin/finance/payments/9";
    renderWithProviders(<NavContent />, { permissions: ACCOUNTANT });
    expect(current()).toEqual(["Payments"]);
  });
});
