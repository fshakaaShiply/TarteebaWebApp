import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { CustomerLink, isCustomerUlid } from "./CustomerLink";

const ULID = "01JC4Z8M3Q7R5T9V2X4Y6A8B0D";

describe("CustomerLink", () => {
  it("links the customer by ULID to the A07 profile for staff who may see customers", () => {
    renderWithProviders(<CustomerLink customer={{ id: ULID, name: "Sara Ahmed" }} />, { permissions: ["customers.view"] });
    expect(screen.getByRole("link", { name: "Sara Ahmed" })).toHaveAttribute("href", `/admin/customers/${ULID}`);
  });

  it("shows the same text unlinked without customers.view", () => {
    renderWithProviders(<CustomerLink customer={{ id: ULID, name: "Sara Ahmed" }} />, { permissions: ["bookings.view"] });
    expect(screen.getByText("Sara Ahmed")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("never links a numeric id or a malformed one (A07 binds customers by ULID, P5-X11)", () => {
    const { unmount } = renderWithProviders(<CustomerLink customer={{ id: 12, name: "Old answer" }} />, { permissions: ["customers.view"] });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<CustomerLink customer={{ id: "12", name: "Digits" }} />, { permissions: ["customers.view"] });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(isCustomerUlid("01JC4Z8M3Q7R5T9V2X4Y6A8B0")).toBe(false);
    expect(isCustomerUlid("01JC4Z8M3Q7R5T9V2X4Y6A8B0I")).toBe(false);
    expect(isCustomerUlid(ULID)).toBe(true);
    expect(isCustomerUlid(ULID.toLowerCase())).toBe(true);
  });

  it("falls back to the phone (left to right), then to 'Customer', for an account without a name", () => {
    const { unmount } = renderWithProviders(<CustomerLink customer={{ id: ULID, name: null, phone: "+971 50 *** 0001" }} />, { permissions: ["customers.view"] });
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("+971 50 *** 0001");
    expect(link.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    unmount();
    renderWithProviders(<CustomerLink customer={{ id: ULID, name: null }} />, { permissions: ["customers.view"] });
    expect(screen.getByRole("link", { name: "Customer" })).toBeInTheDocument();
  });

  it("takes the text of its children, and says 'عميل' in Arabic", () => {
    const { unmount } = renderWithProviders(<CustomerLink customer={{ id: ULID, name: "Sara" }}>Sara · TRB-1</CustomerLink>, { permissions: ["customers.view"] });
    expect(screen.getByRole("link", { name: "Sara · TRB-1" })).toBeInTheDocument();
    unmount();
    renderWithProviders(<CustomerLink customer={null} />, { permissions: ["customers.view"], locale: "ar" });
    expect(screen.getByText("عميل")).toBeInTheDocument();
  });
});
