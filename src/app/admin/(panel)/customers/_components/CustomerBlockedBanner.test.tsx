import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { CustomerBlockedBanner } from "./CustomerBlockedBanner";

const ULID = "01JC0000000000000000000001";

describe("«customer blocked» banner (P5-C10)", () => {
  it("shows for a blocked customer, with the profile link for staff who may open it", () => {
    renderWithProviders(<CustomerBlockedBanner kind="booking" customer={{ id: ULID, name: "Sara Ahmed", status: "blocked" }} />, { permissions: ["customers.view"] });
    expect(screen.getByText("Customer blocked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the profile of Sara Ahmed" })).toHaveAttribute("href", `/admin/customers/${ULID}`);
  });

  it("names what the page is about: this booking on a booking, this subscription on a subscription, in both languages", () => {
    const blocked = { id: ULID, name: "Sara Ahmed", status: "blocked" };
    const booking = renderWithProviders(<CustomerBlockedBanner kind="booking" customer={blocked} />, { permissions: ["customers.view"] });
    expect(screen.getByText(/This booking stays for you to decide\./)).toBeInTheDocument();
    booking.unmount();
    const subscription = renderWithProviders(<CustomerBlockedBanner kind="subscription" customer={blocked} />, { permissions: ["customers.view"] });
    expect(screen.getByText(/This subscription stays for you to decide\./)).toBeInTheDocument();
    expect(screen.queryByText(/booking stays/)).toBeNull();
    subscription.unmount();
    renderWithProviders(<CustomerBlockedBanner kind="subscription" customer={blocked} />, { permissions: ["customers.view"], locale: "ar" });
    expect(screen.getByText(/يبقى هذا الاشتراك لتقرر بشأنه/)).toBeInTheDocument();
    expect(screen.queryByText(/هذا الحجز/)).toBeNull();
  });

  it("is plain text without customers.view", () => {
    renderWithProviders(<CustomerBlockedBanner kind="booking" customer={{ id: ULID, name: "Sara Ahmed", status: "blocked" }} />, { permissions: ["bookings.view"] });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Open the profile of Sara Ahmed")).toBeInTheDocument();
  });

  it("names the customer generically when she has no name, and is plain text for an id that is not a ULID", () => {
    renderWithProviders(<CustomerBlockedBanner kind="booking" customer={{ id: 11, name: null, status: "blocked" }} />, { permissions: ["customers.view"] });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Open the profile of the customer")).toBeInTheDocument();
  });

  it.each(["active", "pending_deletion", "deleted", undefined])("shows nothing for status %s", (status) => {
    renderWithProviders(<CustomerBlockedBanner kind="booking" customer={{ id: ULID, name: "Sara Ahmed", status }} />, { permissions: ["customers.view"] });
    expect(screen.queryByText("Customer blocked")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows nothing without a customer", () => {
    renderWithProviders(<CustomerBlockedBanner kind="subscription" customer={null} />, { permissions: ["customers.view"] });
    expect(screen.queryByText("Customer blocked")).toBeNull();
  });
});
