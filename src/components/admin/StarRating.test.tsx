import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { StarRating } from "./StarRating";

describe("StarRating", () => {
  it("is one image named «N من 5» / 'N out of 5', not five stars", () => {
    const { unmount } = renderWithProviders(<StarRating value={4} />);
    expect(screen.getByRole("img", { name: "4 out of 5" })).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    unmount();
    renderWithProviders(<StarRating value={4} />, { locale: "ar" });
    expect(screen.getByRole("img", { name: "4 من 5" })).toBeInTheDocument();
  });

  it("fills whole stars and a fraction of the next for an average", () => {
    const { container } = renderWithProviders(<StarRating value={3.5} />);
    const filled = container.querySelectorAll<HTMLElement>("span[style]");
    // Three full stars and half of the fourth; the fifth has no fill.
    expect([...filled].map((el) => el.style.width)).toEqual(["100%", "100%", "100%", "50%"]);
  });

  it("rounds an average to one decimal and writes it beside the stars with the count", () => {
    renderWithProviders(<StarRating value={4.25} showValue count={12} />);
    expect(screen.getByRole("img", { name: "4.3 out of 5" })).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument();
    expect(screen.getByText("12 ratings")).toBeInTheDocument();
  });

  it("says 'Not rated' for no rating and clamps a value outside the scale", () => {
    const { unmount } = renderWithProviders(<StarRating value={null} showValue />);
    expect(screen.getByRole("img", { name: "Not rated" })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    unmount();
    renderWithProviders(<StarRating value={9} />);
    expect(screen.getByRole("img", { name: "5 out of 5" })).toBeInTheDocument();
  });

  it("fills from the start edge, so the stars follow the page direction", () => {
    const { container } = renderWithProviders(<StarRating value={2} />);
    expect(container.innerHTML).toContain("start-0");
    expect(container.innerHTML).not.toMatch(/\b(left|right)-0\b/);
  });
});
