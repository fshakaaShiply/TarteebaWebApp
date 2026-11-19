import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookingDetail, serviceOptions, visitCandidates, zoneOptions } from "@/test/bookingFixtures";
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

const ULID = "01m5dtszzdhx5gtmwvj7bmbvm9";
const blocked = () => bookingDetail({ customer: { id: ULID, name: "Sara Ahmed", phone: "+971500000001", status: "blocked", status_label: { ar: "موقوف", en: "Blocked" } } });
const COORDINATOR = ["bookings.view", "customers.view"];

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchVisitCandidates.mockResolvedValue(visitCandidates());
  api.fetchRefundsByPhone.mockResolvedValue({ data: [], meta: { current_page: 1, per_page: 25, total: 0, last_page: 1 } });
});

describe("A03 booking page: the customer (A07)", () => {
  it("says the customer is blocked, links her profile, and says the visit stays for staff to decide (P5-C10)", async () => {
    api.fetchBooking.mockResolvedValue(blocked());
    renderWithProviders(<BookingDetailScreen id="12" />, { permissions: COORDINATOR });
    const banner = (await screen.findByText("Customer blocked")).closest("[role]")!;
    expect(banner).toHaveTextContent("This one stays for you to decide.");
    expect(within(banner as HTMLElement).getByRole("link", { name: "Open the profile of Sara Ahmed" })).toHaveAttribute("href", `/admin/customers/${ULID}`);
  });

  it("links the customer's name in the customer card to her profile", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail({ customer: { id: ULID, name: "Sara Ahmed", phone: "+971500000001", status: "active", status_label: { ar: "نشط", en: "Active" } } }));
    renderWithProviders(<BookingDetailScreen id="12" />, { permissions: COORDINATOR });
    const card = (await screen.findByRole("heading", { name: "Customer" })).closest("section")!;
    expect(within(card).getByRole("link", { name: "Sara Ahmed" })).toHaveAttribute("href", `/admin/customers/${ULID}`);
  });

  it("shows no banner for an active customer or an answer that carries no status", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail());
    renderWithProviders(<BookingDetailScreen id="12" />, { permissions: COORDINATOR });
    await screen.findByRole("heading", { name: "Customer" });
    expect(screen.queryByText("Customer blocked")).toBeNull();
  });

  it("keeps the banner and the names as plain text for staff who cannot open customers", async () => {
    api.fetchBooking.mockResolvedValue(blocked());
    renderWithProviders(<BookingDetailScreen id="12" />, { permissions: ["bookings.view"] });
    const banner = (await screen.findByText("Customer blocked")).closest("[role]")!;
    expect(within(banner as HTMLElement).queryByRole("link")).toBeNull();
    expect(banner).toHaveTextContent("Open the profile of Sara Ahmed");
    const card = screen.getByRole("heading", { name: "Customer" }).closest("section")!;
    expect(within(card).queryByRole("link", { name: "Sara Ahmed" })).toBeNull();
    expect(within(card).getByText("Sara Ahmed")).toBeInTheDocument();
  });

  it("speaks Arabic", async () => {
    api.fetchBooking.mockResolvedValue(blocked());
    renderWithProviders(<BookingDetailScreen id="12" />, { permissions: COORDINATOR, locale: "ar" });
    expect(await screen.findByText("العميل موقوف")).toBeInTheDocument();
  });
});
