import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { CustomerBlockedBanner } from "./CustomerBlockedBanner";

const ULID = "01JC0000000000000000000001";

describe("«customer blocked» banner (P5-C10)", () => {
  it("shows for a blocked customer, with the profile link for staff who may open it", () => {
    renderWithProviders(<CustomerBlockedBanner customer={{ id: ULID, name: "Sara Ahmed", status: "blocked" }} />, { permissions: ["customers.view"] });
    expect(screen.getByText("Customer blocked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the profile of Sara Ahmed" })).toHaveAttribute("href", `/admin/customers/${ULID}`);
  });

  it("is plain text without customers.view", () => {
    renderWithProviders(<CustomerBlockedBanner customer={{ id: ULID, name: "Sara Ahmed", status: "blocked" }} />, { permissions: ["bookings.view"] });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Open the profile of Sara Ahmed")).toBeInTheDocument();
  });

  it("names the customer generically when she has no name, and is plain text for an id that is not a ULID", () => {
    renderWithProviders(<CustomerBlockedBanner customer={{ id: 11, name: null, status: "blocked" }} />, { permissions: ["customers.view"] });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Open the profile of the customer")).toBeInTheDocument();
  });

  it.each(["active", "pending_deletion", "deleted", undefined])("shows nothing for status %s", (status) => {
    renderWithProviders(<CustomerBlockedBanner customer={{ id: ULID, name: "Sara Ahmed", status }} />, { permissions: ["customers.view"] });
    expect(screen.queryByText("Customer blocked")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows nothing without a customer", () => {
    renderWithProviders(<CustomerBlockedBanner customer={null} />, { permissions: ["customers.view"] });
    expect(screen.queryByText("Customer blocked")).toBeNull();
  });
});
