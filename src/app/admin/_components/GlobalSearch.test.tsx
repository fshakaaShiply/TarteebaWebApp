import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { GlobalSearch } from "./GlobalSearch";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

describe("top bar search (spec §17)", () => {
  beforeEach(() => push.mockReset());

  it("opens the bookings list searched by the term", async () => {
    renderWithProviders(<GlobalSearch />, { permissions: ["bookings.view"] });
    const user = userEvent.setup();
    const field = screen.getByRole("searchbox", { name: "Search bookings" });
    expect(field).toHaveAttribute("placeholder", "Reference, phone, name or address");
    await user.type(field, "  +971 50 123 4567 {Enter}");
    expect(push).toHaveBeenCalledWith("/admin/bookings?search=%2B971+50+123+4567");
  });

  it("ignores an empty search", async () => {
    renderWithProviders(<GlobalSearch />, { permissions: ["bookings.view"] });
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox", { name: "Search bookings" }), "   {Enter}");
    expect(push).not.toHaveBeenCalled();
  });

  it("also opens the customers list searched by the term, for staff who read customers (A07)", async () => {
    renderWithProviders(<GlobalSearch />, { permissions: ["bookings.view", "customers.view"] });
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Customers" });
    // Nothing to search for yet.
    expect(button).toBeDisabled();
    await user.type(screen.getByRole("searchbox", { name: "Search bookings" }), " 0559871234 ");
    await user.click(button);
    expect(push).toHaveBeenCalledWith("/admin/customers?q=0559871234");
    // Enter still searches bookings.
    await user.type(screen.getByRole("searchbox", { name: "Search bookings" }), "{Enter}");
    expect(push).toHaveBeenLastCalledWith("/admin/bookings?search=0559871234");
  });

  it("searches customers from the box itself for staff who read customers but not bookings", async () => {
    renderWithProviders(<GlobalSearch />, { permissions: ["customers.view"] });
    const user = userEvent.setup();
    const field = screen.getByRole("searchbox", { name: "Search customers" });
    expect(field).toHaveAttribute("placeholder", "Phone, name, e-mail, address or reference");
    expect(screen.queryByRole("button", { name: "Customers" })).toBeNull();
    await user.type(field, "sara{Enter}");
    expect(push).toHaveBeenCalledWith("/admin/customers?q=sara");
  });

  it("is not offered to staff who cannot read bookings", () => {
    renderWithProviders(<GlobalSearch />, { permissions: ["schedule.view"] });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
