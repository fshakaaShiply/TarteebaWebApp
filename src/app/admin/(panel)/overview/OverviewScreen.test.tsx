import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardAlerts } from "@/lib/admin/types";
import { bookingRow, dashboardSummary, serviceOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { OverviewScreen } from "./OverviewScreen";

const api = { fetchDashboardSummary: vi.fn(), fetchDashboardAlerts: vi.fn(), fetchBookings: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchDashboardSummary: (...a: unknown[]) => api.fetchDashboardSummary(...a),
  fetchDashboardAlerts: (...a: unknown[]) => api.fetchDashboardAlerts(...a),
  fetchBookings: (...a: unknown[]) => api.fetchBookings(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
}));

const alerts: DashboardAlerts = {
  data: [
    {
      type: "sla_due",
      severity: "urgent",
      at: "2026-10-23T08:00:00+00:00",
      title: { ar: "تأكيد مستحق", en: "Confirmation due" },
      message: { ar: "…", en: "The confirmation deadline of request TRB-R4RYSD passed at 12:00." },
      entity: { type: "booking", id: 4, reference: "TRB-R4RYSD" },
      link: { list: "booking", path: "/api/v1/admin/bookings/4", params: [] },
      details: {},
    },
    {
      type: "payment_failed",
      severity: "warning",
      at: "2026-10-23T09:00:00+00:00",
      title: { ar: "فشل الدفع", en: "Payment failed" },
      message: { ar: "…", en: "A payment failed." },
      entity: { type: "payment", id: 9 },
      link: { list: "payment", path: "/api/v1/admin/payments/9", params: [] },
      details: {},
    },
  ],
  meta: { generated_at: "", date: "2026-10-23", timezone: "Asia/Dubai", zone: null, types: [], counts: {}, total: 2, urgent: 1, limit_per_type: 50 },
};

const consoleError = vi.spyOn(console, "error");

describe("A02 daily operations overview", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchDashboardSummary.mockResolvedValue(dashboardSummary());
    api.fetchDashboardAlerts.mockResolvedValue(alerts);
    api.fetchBookings.mockResolvedValue({ data: [bookingRow()], meta: { current_page: 1, per_page: 5, total: 1, last_page: 1 } });
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("shows exactly four KPI cards, each opening its filtered list", async () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view", "bookings.create_manual"] });

    const today = await screen.findByRole("link", { name: /Today's bookings/ });
    expect(today).toHaveAttribute("href", "/admin/bookings?from=2026-10-23&to=2026-10-23");
    expect(today).toHaveTextContent("18");
    expect(today).toHaveTextContent("Morning 10 · Evening 8");
    expect(today).toHaveTextContent("26 cleaners booked");

    const pending = screen.getByRole("link", { name: /^Pending confirmation\s*6/ });
    expect(pending).toHaveAttribute("href", "/admin/bookings?status=pending_confirmation");
    expect(pending).toHaveTextContent("Next deadline in 35 minutes");
    expect(pending).toHaveTextContent("Oldest waiting for 2 hours 10 minutes");
    expect(pending).toHaveTextContent("1 request past the deadline");

    // The A04 board is a later phase: uncovered visits open the capacity view of the day, on-time the day's bookings.
    const uncovered = screen.getByRole("link", { name: /Uncovered visits/ });
    expect(uncovered.getAttribute("href")).toMatch(/^\/admin\/capacity\?date=\d{4}-\d{2}-\d{2}$/);
    expect(uncovered).toHaveTextContent("3 cleaners still to assign");

    const onTime = screen.getByRole("link", { name: /On-time arrival/ });
    expect(onTime.getAttribute("href")).toMatch(/^\/admin\/bookings\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect(onTime).toHaveTextContent("92%");
    expect(onTime).toHaveTextContent("11 of 12 on time · 1 late");

    expect(today.parentElement?.children).toHaveLength(4);
    expect(api.fetchDashboardSummary).toHaveBeenCalledWith({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), zoneId: null });
    expect(screen.getByRole("link", { name: "Manual booking" })).toHaveAttribute("href", "/admin/bookings/new");
  });

  it("lists the alerts, urgent ones marked, each linking to its booking when that page exists", async () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
    const card = (await screen.findByRole("heading", { name: "Alerts that need action" })).closest("section")!;
    expect(await within(card).findByText("Confirmation due")).toBeInTheDocument();
    expect(within(card).getByText("Urgent")).toBeInTheDocument();
    expect(within(card).getByText("2 alerts · 1 urgent")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open: Confirmation due" })).toHaveAttribute("href", "/admin/bookings/4");
    // Payment pages come with A09: the alert is listed without a link.
    expect(within(card).getByText("Payment failed")).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Open: Payment failed" })).not.toBeInTheDocument();
  });

  it("shows the panels and the requests waiting for confirmation", async () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
    expect(await screen.findByRole("meter", { name: "Available" })).toHaveAttribute("aria-valuenow", "9");
    expect(screen.getByRole("meter", { name: "Morning · seats used" })).toHaveAttribute("aria-valuenow", "10");
    expect(screen.getByText("1 uncovered")).toBeInTheDocument();
    expect(screen.getByText("4 of 20 cleaner places booked")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Review TRB-R4RYSD" })).toHaveAttribute("href", "/admin/bookings/4");
    expect(api.fetchBookings).toHaveBeenCalledWith({ status: "pending_confirmation", zoneId: null, page: 1, perPage: 5 });
  });

  it("welcomes staff without bookings or schedule access instead of loading figures", () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["catalog.manage"] });
    expect(screen.getByText("Welcome to Tarteeba operations")).toBeInTheDocument();
    expect(api.fetchDashboardSummary).not.toHaveBeenCalled();
  });
});
