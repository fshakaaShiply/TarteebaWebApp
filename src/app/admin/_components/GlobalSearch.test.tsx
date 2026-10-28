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

  it("is not offered to staff who cannot read bookings", () => {
    renderWithProviders(<GlobalSearch />, { permissions: ["schedule.view"] });
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
